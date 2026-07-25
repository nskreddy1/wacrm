import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiConfig, ChatMessage } from './types';
import {
  applySpecialist,
  fetchRoutableSpecialists,
  type AgentRow,
} from './agents';
import { generateReply } from './generate';

// ============================================================
// Router → Specialist handoff (2026 agentic architecture).
//
// The account's single DEFAULT agent is the front door for every
// conversation. When the account has custom specialist agents (kind
// 'custom', enabled, with a route_description), a cheap routing pass
// classifies the conversation against those descriptions and — on a
// confident match — the matched specialist's persona (and provider,
// if it has its own complete one) takes over the reply.
//
// Design decisions:
//  - The ROUTING call runs on the default agent's own model. No
//    second provider/key to configure, and the router stays governed
//    by the same spend controls as everything else.
//  - Specialists override the persona; behavior guardrails (reply
//    cap, active hours, escalation handoff) ALWAYS stay with the
//    default agent — one place to govern safety regardless of who
//    answers (see applySpecialist).
//  - Fail open: any routing error, timeout, or unparseable answer
//    routes to the default agent. Routing must never break replies.
//  - Zero specialists → zero extra cost: the router short-circuits
//    without any model call, so accounts that never add specialists
//    pay nothing for this feature.
// ============================================================

export interface RouteDecision {
  /** Config to generate the reply with (specialist applied when matched). */
  config: AiConfig & { agentId: string; specialistId?: string };
  /** The matched specialist row, when routing chose one. */
  specialist: AgentRow | null;
}

/** Hard cap on transcript context fed to the routing pass — routing
 *  needs the gist, not the whole conversation. */
const ROUTER_CONTEXT_TURNS = 6;
const ROUTER_MESSAGE_CHARS = 500;

function buildRouterPrompt(specialists: AgentRow[]): string {
  const lines = specialists.map(
    (s, i) =>
      `${i + 1}. ${s.display_name}: ${(s.route_description ?? '').trim()}`
  );
  return [
    'You are a routing classifier for a customer support system.',
    'Given the recent conversation, decide which ONE specialist below should handle it.',
    '',
    'Specialists:',
    ...lines,
    '',
    'Rules:',
    '- Answer with ONLY the number of the matching specialist (e.g. "2").',
    '- If no specialist clearly matches, answer "0".',
    '- When unsure, prefer "0". Never explain.',
  ].join('\n');
}

/** Parse the first integer out of the router's raw answer, tolerant
 *  of stray formatting ("2", "2.", "Answer: 2"). Null when absent. */
export function parseRouterChoice(
  text: string,
  specialistCount: number
): number | null {
  const m = text.match(/\d+/);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  if (!Number.isFinite(n) || n < 0 || n > specialistCount) return null;
  return n;
}

/**
 * Decide which agent answers this conversation. Returns the default
 * config untouched when there are no routable specialists (no model
 * call in that case) or when routing fails/declines.
 */
export async function routeConversation(
  db: SupabaseClient,
  accountId: string,
  baseConfig: AiConfig & { agentId: string },
  messages: ChatMessage[]
): Promise<RouteDecision> {
  let specialists: AgentRow[] = [];
  try {
    specialists = await fetchRoutableSpecialists(db, accountId);
  } catch {
    return { config: baseConfig, specialist: null }; // fail open
  }
  if (specialists.length === 0) {
    return { config: baseConfig, specialist: null };
  }

  // Trimmed transcript: last few turns, each clipped, oldest first.
  const context = messages
    .slice(-ROUTER_CONTEXT_TURNS)
    .map((m) => ({
      role: m.role,
      content:
        m.content.length > ROUTER_MESSAGE_CHARS
          ? `${m.content.slice(0, ROUTER_MESSAGE_CHARS)}…`
          : m.content,
    }));

  try {
    const result = await generateReply({
      config: baseConfig,
      systemPrompt: buildRouterPrompt(specialists),
      messages: [
        ...context,
        {
          role: 'user',
          content:
            'Which specialist number should handle this conversation? Answer with only the number.',
        },
      ],
    });

    const choice = parseRouterChoice(result.text, specialists.length);
    if (!choice) {
      return { config: baseConfig, specialist: null };
    }
    const specialist = specialists[choice - 1];
    return {
      config: applySpecialist(baseConfig, specialist),
      specialist,
    };
  } catch {
    // Routing must never break the reply path.
    return { config: baseConfig, specialist: null };
  }
}
