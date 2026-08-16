import type { UIMessage } from 'ai';
import type { AccountContext } from '@/features/auth/lib/account';

// ============================================================
// Mira chat history — persistence for the copilot transcript.
//
// Every read and write here goes through `ctx.supabase`, the
// RLS-scoped SSR client. The policies on assistant_sessions /
// assistant_messages require `is_account_member(account_id) AND
// user_id = auth.uid()`, so a caller physically cannot address
// another user's thread even if an id leaks — the filters below are
// defence in depth, not the boundary itself. We never use the
// service-role client for this data.
// ============================================================

/** Row shape for the history list. */
export interface AssistantSessionSummary {
  id: string;
  title: string | null;
  lastMessageAt: string;
}

/**
 * Transcript cap per session.
 *
 * Bounds both the row count we write and the payload we hand back to
 * the client when reopening a thread. The chat route separately trims
 * what it sends to the model, so this is about storage and transfer,
 * not context window.
 */
const MAX_MESSAGES_PER_SESSION = 200;

/** Longest stored title; the UI truncates visually well before this. */
const MAX_TITLE_LENGTH = 80;

/**
 * Derive a thread title from the first thing the user said.
 *
 * Deliberately mechanical — no model call. Titling is cosmetic, and
 * spending a request (and sending the user's text to the provider a
 * second time) to generate one is not worth it.
 */
export function titleFromText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return 'New chat';
  if (flat.length <= MAX_TITLE_LENGTH) return flat;
  // Prefer a word boundary so titles don't end mid-word.
  const cut = flat.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Pull the first plain-text part out of a UI message. */
function firstText(message: UIMessage): string {
  for (const part of message.parts) {
    if (part.type === 'text' && typeof part.text === 'string' && part.text) {
      return part.text;
    }
  }
  return '';
}

/**
 * The user's own threads, newest activity first.
 *
 * Ordered by `last_message_at` rather than `updated_at` so a rename
 * never reshuffles the list.
 */
export async function listAssistantSessions(
  ctx: AccountContext,
  limit = 50
): Promise<AssistantSessionSummary[]> {
  const { data, error } = await ctx.supabase
    .from('assistant_sessions')
    .select('id, title, last_message_at')
    .eq('account_id', ctx.accountId)
    .eq('user_id', ctx.userId)
    .order('last_message_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to list chat history: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: (row.title as string | null) ?? null,
    lastMessageAt: row.last_message_at as string,
  }));
}

/**
 * Load one thread's messages in transcript order.
 *
 * Returns `null` when the session does not exist OR is not the
 * caller's — RLS collapses "forbidden" into "not found", which is the
 * behaviour we want: it leaks nothing about whether an id is real.
 */
export async function loadAssistantSession(
  ctx: AccountContext,
  sessionId: string
): Promise<{ id: string; title: string | null; messages: UIMessage[] } | null> {
  const { data: session, error: sessionError } = await ctx.supabase
    .from('assistant_sessions')
    .select('id, title')
    .eq('id', sessionId)
    .eq('account_id', ctx.accountId)
    .eq('user_id', ctx.userId)
    .maybeSingle();

  if (sessionError) {
    throw new Error(`Failed to load chat: ${sessionError.message}`);
  }
  if (!session) return null;

  const { data: rows, error: messagesError } = await ctx.supabase
    .from('assistant_messages')
    .select('message_id, role, parts')
    .eq('session_id', sessionId)
    .order('seq', { ascending: true })
    .limit(MAX_MESSAGES_PER_SESSION);

  if (messagesError) {
    throw new Error(`Failed to load chat: ${messagesError.message}`);
  }

  return {
    id: session.id as string,
    title: (session.title as string | null) ?? null,
    messages: (rows ?? []).map(
      (row) =>
        ({
          id: row.message_id as string,
          role: row.role as UIMessage['role'],
          parts: (row.parts ?? []) as UIMessage['parts'],
        }) satisfies UIMessage
    ),
  };
}

/**
 * Create a thread for the caller, titled from their opening message.
 *
 * The session is created by the CLIENT before the first send (not
 * lazily on the server) so the id is stable and known to both sides
 * from the outset: the composer can address a specific thread on turn
 * one, and a mid-stream failure can't leave a persisted transcript the
 * UI has no id for.
 */
export async function createAssistantSession(
  ctx: AccountContext,
  firstMessageText?: string
): Promise<AssistantSessionSummary> {
  const { data, error } = await ctx.supabase
    .from('assistant_sessions')
    .insert({
      account_id: ctx.accountId,
      user_id: ctx.userId,
      title: firstMessageText ? titleFromText(firstMessageText) : null,
    })
    .select('id, title, last_message_at')
    .single();

  if (error || !data) {
    throw new Error(`Failed to start chat: ${error?.message ?? 'no row'}`);
  }

  return {
    id: data.id as string,
    title: (data.title as string | null) ?? null,
    lastMessageAt: data.last_message_at as string,
  };
}

/**
 * Persist the merged transcript for a completed turn.
 *
 * Called from the chat route's `onEnd`, where the SDK hands back the
 * full message list (originals + the response message) already
 * reconciled. Writing the whole list rather than just the new message
 * matters because earlier messages mutate: a tool part moves through
 * pending → approval-requested → output as the turn resolves.
 *
 * `upsert` on the (session_id, message_id) unique index makes this
 * idempotent, so a retried or duplicated finish event rewrites rows in
 * place instead of doubling the transcript.
 */
export async function saveAssistantTurn(
  ctx: AccountContext,
  sessionId: string,
  messages: UIMessage[]
): Promise<void> {
  // Ownership check before writing. The insert would be blocked by RLS
  // anyway, but an explicit read means a foreign id fails as a clean
  // no-op rather than a policy violation surfacing as a 500.
  const { data: session, error: sessionError } = await ctx.supabase
    .from('assistant_sessions')
    .select('id, title')
    .eq('id', sessionId)
    .eq('account_id', ctx.accountId)
    .eq('user_id', ctx.userId)
    .maybeSingle();

  if (sessionError) {
    throw new Error(`Failed to save chat: ${sessionError.message}`);
  }
  if (!session) return;

  // Keep the tail: if a thread runs past the cap, the recent end is
  // what has any value. `seq` is the index within this window, so it
  // stays dense and ascending after trimming.
  const trimmed = messages.slice(-MAX_MESSAGES_PER_SESSION);

  const rows = trimmed.map((message, index) => ({
    session_id: sessionId,
    account_id: ctx.accountId,
    user_id: ctx.userId,
    message_id: message.id,
    role: message.role,
    // Stored verbatim — this is the SDK's own part array, including
    // tool calls and approval records, so reopening a thread restores
    // the tool steps and not just the prose.
    parts: message.parts ?? [],
    seq: index,
  }));

  if (rows.length > 0) {
    const { error } = await ctx.supabase
      .from('assistant_messages')
      .upsert(rows, { onConflict: 'session_id,message_id' });
    if (error) throw new Error(`Failed to save chat: ${error.message}`);
  }

  // Backfill the title if the session was created before the first
  // user message existed.
  const patch: Record<string, unknown> = { last_message_at: new Date().toISOString() };
  if (!session.title) {
    const firstUser = trimmed.find((m) => m.role === 'user');
    const text = firstUser ? firstText(firstUser) : '';
    if (text) patch.title = titleFromText(text);
  }

  const { error: touchError } = await ctx.supabase
    .from('assistant_sessions')
    .update(patch)
    .eq('id', sessionId)
    .eq('account_id', ctx.accountId)
    .eq('user_id', ctx.userId);

  if (touchError) throw new Error(`Failed to save chat: ${touchError.message}`);
}

/**
 * Delete one of the caller's threads.
 *
 * Messages go with it via ON DELETE CASCADE. This is the user's own
 * "forget this conversation" control, complementing the scheduled
 * 90-day purge — someone who has just pasted a customer's details
 * into the panel shouldn't have to wait a quarter for them to age out.
 */
export async function deleteAssistantSession(
  ctx: AccountContext,
  sessionId: string
): Promise<void> {
  const { error } = await ctx.supabase
    .from('assistant_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('account_id', ctx.accountId)
    .eq('user_id', ctx.userId);

  if (error) throw new Error(`Failed to delete chat: ${error.message}`);
}
