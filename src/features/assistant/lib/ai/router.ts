import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiConfig, ChatMessage } from './types';
import {
  applySpecialist,
  fetchRoutableSpecialists,
  isAgentOnDuty,
  readTriggerKeywords,
  type AgentRow,
} from './agents';
import { generateReply } from './generate';
import { latestUserMessage } from './query';

// ============================================================
// Supervisor router — hybrid cascade (2026 agentic architecture).
//
// The account's DEFAULT agent is the front door for every
// conversation. Admins can create any number of CUSTOM agents (own
// persona, optional own provider/model/key, own auto-reply schedule,
// own reply cap and escalation target). This router decides which
// agent answers, in three tiers — cheapest first:
//
//   Tier 0 — eligibility: enabled custom agents with a route
//            description, filtered to those ON DUTY right now (an
//            agent with its own schedule is only routable inside it).
//   Tier 1 — keyword triggers: if any of an agent's configured
//            trigger keywords appears in the customer's latest
//            message, route there instantly. Deterministic, free,
//            microseconds. First match in creation order wins.
//   Tier 2 — LLM classifier: a small routing pass on the default
//            agent's own model matches the conversation against each
//            agent's route description. Runs only when Tier 1 found
//            nothing and at least one agent is eligible.
//   Fallback — the default agent. Any error, timeout, unparseable
//            answer, or "no clear match" lands here. Routing must
//            never break the reply path.
//
// Guardrail inheritance: the routed agent's OWN cap/schedule/
// escalation override the default's only where explicitly set —
// see applySpecialist. Zero custom agents → zero extra cost.
// ============================================================

export interface RouteDecision {
  /** Config to generate the reply with (routed agent applied when matched). */
  config: AiConfig & { agentId: string; specialistId?: string };
  /** The matched custom agent row, when routing chose one. */
  specialist: AgentRow | null;
  /** Which tier decided: 'keyword' | 'llm' | 'default'. */
  tier: 'keyword' | 'llm' | 'default';
}

/** Hard cap on transcript context fed to the routing pass — routing
 *  needs the gist, not the whole conversation. */
const ROUTER_CONTEXT_TURNS = 6;
const ROUTER_MESSAGE_CHARS = 500;

/**
 * Tier 1 — deterministic keyword triggers. Case-insensitive substring
 * match of each agent's configured keywords against the customer's
 * latest message. First agent (creation order) with a hit wins.
 */
export function matchByKeywords(
  agents: AgentRow[],
  message: string
): AgentRow | null {
  const haystack = message.toLowerCase();
  if (!haystack.trim()) return null;
  for (const agent of agents) {
    const keywords = readTriggerKeywords(
      (agent.settings as Record<string, unknown> | null)?.triggerKeywords
    );
    if (keywords.some((kw) => haystack.includes(kw))) return agent;
  }
  return null;
}

function buildRouterPrompt(agents: AgentRow[]): string {
  const lines = agents.map(
    (s, i) =>
      `${i + 1}. ${s.display_name}: ${(s.route_description ?? '').trim()}`
  );
  return [
    'You are a routing classifier for a customer support system.',
    'Given the recent conversation, decide which ONE agent below should handle it.',
    '',
    'Agents:',
    ...lines,
    '',
    'Rules:',
    '- Answer with ONLY the number of the matching agent (e.g. "2").',
    '- If no agent clearly matches, answer "0".',
    '- When unsure, prefer "0". Never explain.',
  ].join('\n');
}

/** Parse the first integer out of the router's raw answer, tolerant
 *  of stray formatting ("2", "2.", "Answer: 2"). Null when absent. */
export function parseRouterChoice(
  text: string,
  agentCount: number
): number | null {
  const m = text.match(/\d+/);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  if (!Number.isFinite(n) || n < 0 || n > agentCount) return null;
  return n;
}

/**
 * Decide which agent answers this conversation. Returns the default
 * config untouched when there are no eligible custom agents (no model
 * call in that case) or when routing fails/declines.
 */
export async function routeConversation(
  db: SupabaseClient,
  accountId: string,
  baseConfig: AiConfig & { agentId: string },
  messages: ChatMessage[],
  now: Date = new Date()
): Promise<RouteDecision> {
  let candidates: AgentRow[] = [];
  try {
    candidates = await fetchRoutableSpecialists(db, accountId);
  } catch {
    return { config: baseConfig, specialist: null, tier: 'default' };
  }

  // Tier 0 — on-duty filter: agents with their own schedule are only
  // routable inside that window.
  const eligible = candidates.filter((a) => isAgentOnDuty(a, now));
  if (eligible.length === 0) {
    return { config: baseConfig, specialist: null, tier: 'default' };
  }

  // Tier 1 — keyword triggers on the latest customer message.
  const lastMessage = latestUserMessage(messages);
  const keywordHit = matchByKeywords(eligible, lastMessage);
  if (keywordHit) {
    return {
      config: applySpecialist(baseConfig, keywordHit),
      specialist: keywordHit,
      tier: 'keyword',
    };
  }

  // Tier 2 — LLM classifier on the default agent's own model.
  const context = messages.slice(-ROUTER_CONTEXT_TURNS).map((m) => ({
    role: m.role,
    content:
      m.content.length > ROUTER_MESSAGE_CHARS
        ? `${m.content.slice(0, ROUTER_MESSAGE_CHARS)}…`
        : m.content,
  }));

  try {
    const result = await generateReply({
      config: baseConfig,
      systemPrompt: buildRouterPrompt(eligible),
      messages: [
        ...context,
        {
          role: 'user',
          content:
            'Which agent number should handle this conversation? Answer with only the number.',
        },
      ],
    });

    const choice = parseRouterChoice(result.text, eligible.length);
    if (!choice) {
      return { config: baseConfig, specialist: null, tier: 'default' };
    }
    const specialist = eligible[choice - 1];
    return {
      config: applySpecialist(baseConfig, specialist),
      specialist,
      tier: 'llm',
    };
  } catch {
    // Routing must never break the reply path.
    return { config: baseConfig, specialist: null, tier: 'default' };
  }
}
