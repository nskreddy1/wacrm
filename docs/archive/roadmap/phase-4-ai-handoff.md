# Phase 4 — AI Skill-Based Smart Handoff Routing (TODO)

Today handoff routes to ONE fixed `handoff_agent_id`. Big accounts need the
bot to hand off to the RIGHT kind of person (sales question → sales rep,
billing issue → billing team) — company-type-aware, all data-driven.

## Work items (same migration `043_ai_context_and_routing.sql` as phase 3)

1. **`ai_handoff_routes` table**

```
id           UUID PK
account_id   UUID FK accounts
name         TEXT           -- 'Sales', 'Billing', 'Technical Support'
description  TEXT           -- what belongs here; shown to the model for classification
agent_id     UUID FK auth.users NULL   -- null = shared queue for the department
priority     INTEGER        -- tie-break order
is_active    BOOLEAN
```

RLS: members read, admin+ write.

2. **Protocol**: sentinel becomes `[[HANDOFF:route-name]]` (plain `[[HANDOFF]]`
   stays valid — backward compatible). System prompt (`src/lib/ai/defaults.ts`)
   lists the account's active routes with descriptions.
3. **Dispatch** (`src/lib/ai/auto-reply.ts` + `generate.ts` `parseGeneration()`):
   extract route name → assign that route's agent (or queue) → fall back to
   `handoff_agent_id` → shared inbox queue. Handoff note records the chosen
   route and why.
4. **Settings UI**: routes CRUD list in `src/components/settings/ai-config.tsx`.
5. **Default routes** seeded via the phase-1 template catalog
   (`kind='ai_routes'`): starter "Sales" and "Support" routes for new accounts.
   (The provisioner's CASE needs an `ai_routes` branch added.)

## Verification

- Unit tests for `[[HANDOFF:route]]` parsing incl. unknown-route fallback.
- "I want to talk to sales" message → conversation assigned to the Sales
  route's agent, note records the route.
