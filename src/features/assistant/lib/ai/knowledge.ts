import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiConfig } from './types';
import { chunkText } from './chunk';
import { embedTexts, toVectorLiteral } from './embeddings';

// ============================================================
// Knowledge base: ingest (chunk + optionally embed) and hybrid
// retrieve (semantic when an embeddings key is present, topped up with
// lexical full-text search).
// ============================================================

interface MatchRow {
  id: string;
  content: string;
}

/**
 * (Re)build the chunks for one document. Deletes the document's
 * existing chunks, re-chunks the content, and — when the account has an
 * embeddings key — embeds each chunk. Runs under whatever client the
 * caller passes (service-role for ingest routes).
 *
 * Throws on embedding failure so the ingest route can report it; the
 * chunks are only written once embedding (if attempted) succeeds, so a
 * failed embed never leaves half-indexed rows.
 */
export async function ingestDocument(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  documentId: string,
  content: string
): Promise<void> {
  const chunks = chunkText(content);

  // Replace, don't append — re-ingest must be idempotent.
  const { error: delErr } = await db
    .from('ai_knowledge_chunks')
    .delete()
    .eq('document_id', documentId);
  if (delErr) throw delErr;

  if (chunks.length === 0) return;

  // Embed if a key is set, but DON'T let an embedding failure stop the
  // chunks from being stored: a failed embed must still leave the
  // document searchable lexically. We record the error and rethrow it
  // AFTER inserting (embedding-less) rows, so the route can warn
  // "semantic indexing failed" — which is now truthful, because lexical
  // search really does still work.
  let embeddings: number[][] | null = null;
  let embedError: unknown = null;
  if (config.embeddingsApiKey) {
    try {
      embeddings = await embedTexts(config.embeddingsApiKey, chunks);
    } catch (err) {
      embedError = err;
    }
  }

  const rows = chunks.map((content, i) => ({
    document_id: documentId,
    account_id: accountId,
    chunk_index: i,
    content,
    embedding: embeddings ? toVectorLiteral(embeddings[i]) : null,
  }));

  const { error: insErr } = await db.from('ai_knowledge_chunks').insert(rows);
  if (insErr) throw insErr;

  if (embedError) throw embedError;
}

/**
 * Reciprocal Rank Fusion smoothing constant. k=60 is the standard from
 * the original RRF paper and what production hybrid-search systems use;
 * it dampens the gap between rank 1 and rank 2 so one retriever's
 * over-confidence can't drown out agreement from the other.
 */
const RRF_K = 60;

/**
 * Fuse several ranked lists with Reciprocal Rank Fusion:
 * score(doc) = Σ over lists of 1 / (RRF_K + rank).
 *
 * Rank-based rather than score-based on purpose — cosine similarity and
 * ts_rank live on incomparable scales, and normalising them is exactly
 * the trap RRF exists to avoid. A chunk surfaced by BOTH retrievers
 * accumulates from each list and rises: retriever agreement is the
 * strongest relevance signal available without a reranker.
 */
function fuseRrf(lists: MatchRow[][]): MatchRow[] {
  const scores = new Map<string, { row: MatchRow; score: number }>();
  for (const list of lists) {
    list.forEach((row, i) => {
      const entry = scores.get(row.id);
      const add = 1 / (RRF_K + i + 1);
      if (entry) entry.score += add;
      else scores.set(row.id, { row, score: add });
    });
  }
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((e) => e.row);
}

/**
 * Retrieve up to `k` knowledge excerpts relevant to `queryText`.
 *
 * Hybrid when an embeddings key is configured: semantic (cosine) and
 * lexical (FTS) retrieval run in PARALLEL and are fused with RRF.
 * The old sequential "semantic first, top up with lexical" merge let
 * semantic monopolise the result the moment it returned k rows — which
 * is precisely when exact identifiers (order numbers, SKUs, error
 * codes) got lost, because embeddings blur them while FTS nails them.
 *
 * This split also carries the multilingual load (see ADR-002): the FTS
 * side uses the language-neutral `simple` config, so native-script
 * queries (Devanagari, Tamil, ...) tokenize correctly, while the
 * embedding side handles cross-lingual hits (Tamil question → English
 * KB doc) that lexical search can never see.
 *
 * Lexical-only when there's no key. Best-effort: any failure (no KB,
 * embedding error, RPC error) degrades to fewer or zero results and
 * never throws into the draft / auto-reply path.
 */
export async function retrieveKnowledge(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  queryText: string,
  k = 5
): Promise<string[]> {
  const query = queryText.trim();
  if (!query || k <= 0) return [];

  // Skip everything when the account has no knowledge base — otherwise
  // every draft / auto-reply would pay for a query embedding + two RPCs
  // just to get []. One cheap indexed COUNT (head, no rows) instead of a
  // paid embeddings call on the hot path.
  try {
    const { count, error } = await db
      .from('ai_knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId);
    if (error || !count) return [];
  } catch {
    return [];
  }

  // Give the fuser more candidates than we return — fusion over k+k
  // candidates from each side is where RRF earns its keep.
  const fetchCount = Math.max(k * 2, 10);

  const lexicalPromise: Promise<MatchRow[]> = (async () => {
    try {
      const { data, error } = await db.rpc('match_ai_knowledge_fts', {
        p_account_id: accountId,
        p_query: query,
        p_match_count: fetchCount,
      });
      return !error && Array.isArray(data) ? (data as MatchRow[]) : [];
    } catch (err) {
      console.error('[ai knowledge] lexical retrieval failed:', err);
      return [];
    }
  })();

  const semanticPromise: Promise<MatchRow[]> = (async () => {
    if (!config.embeddingsApiKey) return [];
    try {
      const [queryEmbedding] = await embedTexts(config.embeddingsApiKey, [
        query,
      ]);
      if (!queryEmbedding) return [];
      const { data, error } = await db.rpc('match_ai_knowledge_semantic', {
        p_account_id: accountId,
        p_query_embedding: toVectorLiteral(queryEmbedding),
        p_match_count: fetchCount,
      });
      return !error && Array.isArray(data) ? (data as MatchRow[]) : [];
    } catch (err) {
      console.error(
        '[ai knowledge] semantic retrieval failed, lexical still stands:',
        err
      );
      return [];
    }
  })();

  const [semantic, lexical] = await Promise.all([
    semanticPromise,
    lexicalPromise,
  ]);

  return fuseRrf([semantic, lexical])
    .slice(0, k)
    .map((row) => row.content);
}
