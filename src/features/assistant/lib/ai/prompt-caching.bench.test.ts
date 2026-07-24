import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildPromptParts } from './defaults';
import type { ChatMessage } from './types';

// ============================================================
// Cache-efficiency benchmark: legacy vs cache-aligned prompt.
//
// Provider prompt caches (OpenAI automatic, Anthropic
// cache_control, Gemini implicit) bill a discount ONLY for the
// longest request prefix byte-identical to a previous call.
// So the deterministic cost proxy — no live keys needed — is:
//
//   uncached bytes per call = len(request) - commonPrefix(prev)
//
// Key mechanic under test: in the legacy prompt the retrieved
// knowledge sits INSIDE the system prompt (start of request),
// so a new retrieval invalidates everything after it — i.e.
// the ENTIRE conversation history is re-billed at full price
// every turn, a cost that grows with conversation length. The
// cache-aligned prompt moves knowledge to the FINAL user turn,
// so each call only pays for genuinely new content (last
// exchange + fresh retrieval), constant per turn.
//
// Simulation: 20-turn WhatsApp support conversation, realistic
// message sizes, fully distinct retrieved chunks every turn
// (worst case for caching).
// ============================================================

const BUSINESS_PROMPT =
  'We are Candlewick Co. We sell handmade soy candles and wax melts across three ' +
  'collections. Standard shipping is 2 business days via UPS; free over $50. ' +
  'Support hours 9am-5pm ET Monday to Friday. Wholesale enquiries go to our sales ' +
  'team. Always be warm but concise, and never promise custom scents.';

/** Fully distinct chunk text per turn — no shared prefixes, mimicking
 *  retrievals that hit different KB rows for each question. */
const CHUNK_TOPICS = [
  'shipping carriers and holiday cutoff schedules for the northeast region',
  'wholesale pricing tiers and the minimum order quantities per collection',
  'returns and exchanges for damaged goods including photo requirements',
  'candle care instructions covering first burn and wick trimming guidance',
  'subscription box contents and the rotation calendar for seasonal scents',
  'gift wrapping options and personalized note cards at checkout',
  'international duties and which destinations we currently cannot serve',
  'loyalty program points accrual and redemption thresholds explained',
  'wax melt safety guidance for households with pets and small children',
  'corporate bulk order lead times and custom label minimums',
];

function knowledgeForTurn(turn: number): string[] {
  const a = CHUNK_TOPICS[(turn * 2) % CHUNK_TOPICS.length];
  const b = CHUNK_TOPICS[(turn * 2 + 1) % CHUNK_TOPICS.length];
  return [
    `Excerpt regarding ${a}. It runs several sentences long with the concrete details an agent needs, including numbers, thresholds and exceptions specific to topic ${turn}-A.`,
    `Excerpt regarding ${b}. Additional operational specifics follow here, with edge cases and the exact policy wording a customer might be quoted, unique to topic ${turn}-B.`,
  ];
}

/** Realistic WhatsApp sizing: short customer texts, fuller bot replies. */
function historyUpTo(turn: number): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (let t = 1; t <= turn; t++) {
    msgs.push({
      role: 'user',
      content: `Hi, quick question number ${t} — can you tell me about ${CHUNK_TOPICS[t % CHUNK_TOPICS.length]}?`,
    });
    if (t < turn) {
      msgs.push({
        role: 'assistant',
        content:
          `Of course! Here is a helpful, complete answer number ${t} covering the policy, ` +
          `the relevant thresholds, what to expect next, and a friendly closing question ` +
          `to keep the conversation moving along naturally.`,
      });
    }
  }
  return msgs;
}

/** Serialize a full request in provider wire order. */
function serializeRequest(
  systemPrompt: string,
  messages: ChatMessage[]
): string {
  return [systemPrompt, ...messages.map((m) => `${m.role}:${m.content}`)].join(
    '\u0000'
  );
}

function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

interface BenchResult {
  /** Total bytes billed at FULL price across the conversation
   *  (uncached portion of every call after the first). */
  totalUncachedBytes: number;
  /** Uncached bytes per call — reveals growth vs constant cost. */
  uncachedPerTurn: number[];
  /** Mean cacheable fraction per call. */
  meanCachedFraction: number;
}

function bench(
  buildRequest: (turn: number) => string,
  turns: number
): BenchResult {
  const uncachedPerTurn: number[] = [];
  const fractions: number[] = [];
  let prev: string | null = null;
  for (let t = 1; t <= turns; t++) {
    const req = buildRequest(t);
    if (prev !== null) {
      const cached = commonPrefixLen(prev, req);
      uncachedPerTurn.push(req.length - cached);
      fractions.push(cached / req.length);
    }
    prev = req;
  }
  return {
    totalUncachedBytes: uncachedPerTurn.reduce((s, v) => s + v, 0),
    uncachedPerTurn,
    meanCachedFraction: fractions.reduce((s, v) => s + v, 0) / fractions.length,
  };
}

const TURNS = 20;

describe('benchmark: legacy vs cache-aligned prompt structure', () => {
  const legacy = bench((turn) => {
    // Legacy: knowledge embedded INSIDE the system prompt.
    const systemPrompt = buildSystemPrompt({
      userPrompt: BUSINESS_PROMPT,
      mode: 'auto_reply',
      knowledge: knowledgeForTurn(turn),
    });
    return serializeRequest(systemPrompt, historyUpTo(turn));
  }, TURNS);

  const cacheAligned = bench((turn) => {
    // New: stable blocks up front, volatile knowledge as the final turn
    // — mirrors exactly what generateReply sends with the flag ON.
    const { systemBlocks, volatileContext } = buildPromptParts({
      userPrompt: BUSINESS_PROMPT,
      mode: 'auto_reply',
      knowledge: knowledgeForTurn(turn),
    });
    const messages: ChatMessage[] = [
      ...historyUpTo(turn),
      ...(volatileContext
        ? [{ role: 'user' as const, content: volatileContext }]
        : []),
    ];
    return serializeRequest(systemBlocks.join('\n\n'), messages);
  }, TURNS);

  it('cache-aligned pays for dramatically fewer full-price bytes overall', () => {
    const saving =
      1 - cacheAligned.totalUncachedBytes / legacy.totalUncachedBytes;
    console.log(
      `[v0] legacy total uncached bytes:        ${legacy.totalUncachedBytes}`
    );
    console.log(
      `[v0] cache-aligned total uncached bytes: ${cacheAligned.totalUncachedBytes}`
    );
    console.log(
      `[v0] full-price input reduction:         ${(saving * 100).toFixed(1)}%`
    );
    console.log(
      `[v0] mean cached fraction — legacy: ${(legacy.meanCachedFraction * 100).toFixed(1)}%  cache-aligned: ${(cacheAligned.meanCachedFraction * 100).toFixed(1)}%`
    );
    expect(cacheAligned.totalUncachedBytes).toBeLessThan(
      legacy.totalUncachedBytes
    );
    expect(saving).toBeGreaterThan(0.25);
  });

  it('legacy per-turn cost grows with history; cache-aligned stays flat', () => {
    const firstHalf = (arr: number[]) =>
      arr.slice(0, Math.floor(arr.length / 2));
    const secondHalf = (arr: number[]) => arr.slice(Math.floor(arr.length / 2));
    const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;

    const legacyGrowth =
      mean(secondHalf(legacy.uncachedPerTurn)) /
      mean(firstHalf(legacy.uncachedPerTurn));
    const alignedGrowth =
      mean(secondHalf(cacheAligned.uncachedPerTurn)) /
      mean(firstHalf(cacheAligned.uncachedPerTurn));

    console.log(
      `[v0] uncached-bytes growth (2nd half / 1st half) — legacy: ${legacyGrowth.toFixed(2)}x  cache-aligned: ${alignedGrowth.toFixed(2)}x`
    );
    // Legacy re-bills the ever-growing history every turn.
    expect(legacyGrowth).toBeGreaterThan(1.5);
    // Cache-aligned pays a near-constant amount per turn.
    expect(alignedGrowth).toBeLessThan(1.25);
  });
});
