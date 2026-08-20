# ADR-006 Outbound Window Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the WhatsApp 24-hour window, WhatsApp consent, and template
approval server-side in the single outbound choke point, and give the
one-to-one send a real product surface — implementing ADR-006 (D1–D21).

**Architecture:** One pure policy module guards `sendChannelMessage` (the
unified orchestrator, relocated into the `channels` feature first). The window
truth is a denormalised `conversations.last_inbound_at`; consent is
`contacts.whatsapp_opted_out`. Rejections are typed 409s raised **before** the
provider call and the `messages` insert. Broadcast delivery is re-routed
through the orchestrator so the guard actually dominates every caller.

**Tech Stack:** Next.js 16 route handlers, Supabase (Postgres + RLS,
service-role admin client), Vitest, idempotent SQL migrations via
`pnpm db:push`.

## Global Constraints

- Migrations are **idempotent**, named `YYYYMMDDHHMMSS_description.sql`, never edited after landing (`AGENTS.md`).
- After any schema change: `pnpm db:push`, `pnpm db:doc`, `pnpm docs:sync`.
- Every service-role query filters by `account_id` (ADR-006 F2). No lookup by id alone.
- Guard failure direction is **closed**: `last_inbound_at IS NULL` → window closed; unknown payload kind → free-form (D21 allowlist).
- Deploy order is part of the decision: **columns + verified backfill first, guard second** (F3). Tasks 2–3 ship before Task 5.
- Error codes are exact strings: `window_closed`, `contact_opted_out`, `template_not_approved`, all HTTP 409 (D4, D6, D8).
- No branch anywhere may key off provider tier/trial (D10). Guard applies only when `channel === 'whatsapp'`.
- Run `pnpm check` before declaring any task done.
- Phase C (MSG91) is severable — dropping it does not reopen ADR-006 (R8).

---

## Phase A — the boundary (Tasks 1–8)

### Task 1: Relocate the orchestrator into `channels` (D18)

**Files:**
- Move: `src/features/admin/lib/orchestration/outbound.ts` → `src/features/channels/lib/orchestration/outbound.ts`
- Modify (imports only): `src/features/whatsapp/lib/send-message.ts:38`, `src/features/flows/lib/meta-send.ts`, `src/features/assistant/lib/ai/auto-reply.ts`, plus every other file matching the old import path.

**Interfaces:**
- Produces: `sendChannelMessage`, `SendChannelMessageArgs`, `SendChannelMessageResult` importable from `@/features/channels/lib/orchestration/outbound`. Signatures unchanged.

- [ ] **Step 1: Find every importer**

Run: `grep -rn "features/admin/lib/orchestration/outbound" src/`
Record the list — each file gets a one-line import change.

- [ ] **Step 2: Move the file** (git mv so history follows)

```bash
mkdir -p src/features/channels/lib/orchestration
git mv src/features/admin/lib/orchestration/outbound.ts src/features/channels/lib/orchestration/outbound.ts
```

- [ ] **Step 3: Rewrite the imports** in every file from Step 1:

```ts
import { sendChannelMessage } from '@/features/channels/lib/orchestration/outbound';
```

- [ ] **Step 4: Verify nothing else changed**

Run: `pnpm typecheck && pnpm check:boundaries && pnpm test`
Expected: all green; `git diff --stat` shows only import lines + the rename.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(channels): move outbound orchestrator home (ADR-006 D18)"
```

### Task 2: Migration — window column + consent columns (D3, D8, D11, F3)

**Files:**
- Create: `supabase/migrations/20260820120000_outbound_window_and_whatsapp_consent.sql`
- Regenerate: `.agents/context/database-schema.md` (`pnpm db:doc`), mirror (`pnpm docs:sync`)

**Interfaces:**
- Produces: `conversations.last_inbound_at timestamptz NULL`, `contacts.whatsapp_opted_out boolean NOT NULL DEFAULT false`, `contacts.whatsapp_opted_out_at timestamptz NULL`, partial index `contacts_whatsapp_opted_out_idx`.

- [ ] **Step 1: Write the migration**

```sql
-- Outbound window truth + WhatsApp consent (ADR-006 D3, D8, D11).
-- last_inbound_at: newest customer message per conversation. NULL = no
-- inbound ever = window closed (fails safe, F3). Backfilled here so the
-- guard (shipped separately, after this migration is verified) never
-- reads an unpopulated column on a live conversation.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;

UPDATE public.conversations c
SET last_inbound_at = m.max_inbound
FROM (
  SELECT conversation_id, max(created_at) AS max_inbound
  FROM public.messages
  WHERE sender_type = 'customer'
  GROUP BY conversation_id
) m
WHERE m.conversation_id = c.id
  AND c.last_inbound_at IS NULL;

-- WhatsApp consent, mirroring 051_sms_opt_out.sql exactly.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS whatsapp_opted_out boolean NOT NULL DEFAULT false;
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS whatsapp_opted_out_at timestamptz;

CREATE INDEX IF NOT EXISTS contacts_whatsapp_opted_out_idx
  ON public.contacts (account_id, whatsapp_opted_out)
  WHERE whatsapp_opted_out = true;
```

- [ ] **Step 2: Apply and verify the backfill (F3 acceptance)**

Run: `pnpm db:push`
Then verify against live data (Supabase SQL editor or a one-off script):

```sql
-- Must return 0: every conversation with a customer message has the column set.
SELECT count(*) FROM public.conversations c
WHERE c.last_inbound_at IS NULL
  AND EXISTS (SELECT 1 FROM public.messages m
              WHERE m.conversation_id = c.id AND m.sender_type = 'customer');
```

Expected: `0`. If non-zero, the guard MUST NOT ship until this is explained.

- [ ] **Step 3: Regenerate schema docs**

Run: `pnpm db:doc && pnpm docs:sync && pnpm check:docs`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260820120000_outbound_window_and_whatsapp_consent.sql .agents/context/database-schema.md docs/architecture/
git commit -m "feat(db): last_inbound_at + whatsapp consent columns (ADR-006 D3/D8)"
```

### Task 3: Write `last_inbound_at` on both inbound paths (D3, C8)

**Files:**
- Modify: `src/features/channels/lib/inbound.ts:202` (conversation update)
- Modify: `src/app/api/whatsapp/webhook/route.ts:739` (conversation update)
- Test: `src/features/channels/lib/inbound.test.ts` (extend existing file)

**Interfaces:**
- Produces: every inbound customer message sets `last_inbound_at` alongside the existing `last_message_at` write, using the same timestamp value.

- [ ] **Step 1: Write the failing test** — extend `inbound.test.ts` with an
  assertion that the conversation update payload passed to the mocked client
  includes `last_inbound_at` equal to the message timestamp. Follow the
  file's existing mock style (vi mocks over the admin client).

```ts
it('stamps last_inbound_at on the conversation for inbound messages', async () => {
  // reuse the file's existing happy-path arrangement; capture the
  // .update() payload the same way existing tests capture inserts
  expect(capturedConversationUpdate).toMatchObject({
    last_message_at: expect.any(String),
    last_inbound_at: expect.any(String),
  });
  expect(capturedConversationUpdate.last_inbound_at).toBe(
    capturedConversationUpdate.last_message_at
  );
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm test inbound` → FAIL (no `last_inbound_at` key).

- [ ] **Step 3: Implement.** In `inbound.ts`, in the conversation update object at `:202`:

```ts
        last_message_at: timestamp,
        last_inbound_at: timestamp,
```

In `api/whatsapp/webhook/route.ts` at `:739` (this update runs for inbound customer messages):

```ts
      last_message_at: new Date().toISOString(),
      last_inbound_at: new Date().toISOString(),
```

(If the webhook path uses one shared `now` variable, use it for both keys.)

- [ ] **Step 4: Run tests** — `pnpm test inbound` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(channels): stamp last_inbound_at on both inbound paths (ADR-006 D3)"`

### Task 4: Pure outbound policy module (D1, D4, D6, D8, D21) — TDD

**Files:**
- Create: `src/features/channels/lib/orchestration/outbound-policy.ts`
- Test: `src/features/channels/lib/orchestration/outbound-policy.test.ts`

**Interfaces:**
- Produces:

```ts
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export class OutboundPolicyError extends Error {
  readonly code: 'window_closed' | 'contact_opted_out' | 'template_not_approved';
  readonly status: 409;
  constructor(code: OutboundPolicyError['code'], message: string);
}

export interface WhatsAppPolicyInput {
  payloadKind: string;               // OutboundMessagePayload['kind']
  lastInboundAt: string | null;      // conversations.last_inbound_at
  contactOptedOut: boolean;          // contacts.whatsapp_opted_out
  /** message_templates.status for template sends; null = row not synced locally. */
  templateStatus: string | null;
  now?: Date;                        // injectable clock for tests
}

export function assertWhatsAppOutboundAllowed(input: WhatsAppPolicyInput): void;
```

- [ ] **Step 1: Write the failing tests** (the ADR's acceptance matrix, action item 9):

```ts
import { describe, expect, it } from 'vitest';
import {
  assertWhatsAppOutboundAllowed,
  OutboundPolicyError,
  WHATSAPP_WINDOW_MS,
} from './outbound-policy';

const NOW = new Date('2026-08-20T12:00:00Z');
const hoursAgo = (h: number) =>
  new Date(NOW.getTime() - h * 3600_000).toISOString();

const base = {
  payloadKind: 'text',
  lastInboundAt: null as string | null,
  contactOptedOut: false,
  templateStatus: null as string | null,
  now: NOW,
};

function code(input: typeof base) {
  try {
    assertWhatsAppOutboundAllowed(input);
    return null;
  } catch (e) {
    if (e instanceof OutboundPolicyError) return e.code;
    throw e;
  }
}

describe('window (D4/D21 allowlist)', () => {
  it('rejects free-form with no inbound ever (NULL = closed)', () =>
    expect(code(base)).toBe('window_closed'));
  it('rejects free-form at 24h01m', () =>
    expect(code({ ...base, lastInboundAt: hoursAgo(24.02) })).toBe('window_closed'));
  it('allows free-form at 23h59m', () =>
    expect(code({ ...base, lastInboundAt: hoursAgo(23.98) })).toBeNull());
  it('treats media, interactive, email, and unknown kinds as free-form', () => {
    for (const k of ['media', 'interactive', 'email', 'future-kind'])
      expect(code({ ...base, payloadKind: k })).toBe('window_closed');
  });
  it('never window-rejects a template', () =>
    expect(code({ ...base, payloadKind: 'template', templateStatus: 'APPROVED' })).toBeNull());
});

describe('consent (D8)', () => {
  it('rejects template AND text to an opted-out contact', () => {
    expect(code({ ...base, contactOptedOut: true, lastInboundAt: hoursAgo(1) })).toBe('contact_opted_out');
    expect(code({ ...base, contactOptedOut: true, payloadKind: 'template', templateStatus: 'APPROVED' })).toBe('contact_opted_out');
  });
});

describe('template approval (D6)', () => {
  it('rejects a locally-known non-approved template', () => {
    for (const s of ['PENDING', 'REJECTED', 'PAUSED', 'DISABLED'])
      expect(code({ ...base, payloadKind: 'template', templateStatus: s })).toBe('template_not_approved');
  });
  it('passes an unsynced template through (Meta stays the authority)', () =>
    expect(code({ ...base, payloadKind: 'template', templateStatus: null })).toBeNull());
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test outbound-policy` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// ADR-006 guard. Pure — no I/O, injectable clock. Evaluation order:
// consent → template approval → window. Consent first because an
// opted-out contact is unreachable regardless of payload (D8).
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

const NON_APPROVED = new Set(['PENDING', 'REJECTED', 'PAUSED', 'DISABLED']);

export class OutboundPolicyError extends Error {
  readonly code: 'window_closed' | 'contact_opted_out' | 'template_not_approved';
  readonly status = 409 as const;
  constructor(code: OutboundPolicyError['code'], message: string) {
    super(message);
    this.name = 'OutboundPolicyError';
    this.code = code;
  }
}

export interface WhatsAppPolicyInput {
  payloadKind: string;
  lastInboundAt: string | null;
  contactOptedOut: boolean;
  templateStatus: string | null;
  now?: Date;
}

export function assertWhatsAppOutboundAllowed(i: WhatsAppPolicyInput): void {
  if (i.contactOptedOut) {
    throw new OutboundPolicyError(
      'contact_opted_out',
      'This contact has opted out of WhatsApp messages.'
    );
  }
  // Allowlist (D21): only 'template' escapes the window. Every other
  // kind — including ones added after this file was written — is
  // free-form and fails closed.
  if (i.payloadKind === 'template') {
    const status = i.templateStatus?.toUpperCase() ?? null;
    if (status && NON_APPROVED.has(status)) {
      throw new OutboundPolicyError(
        'template_not_approved',
        `This template is ${status} with Meta and cannot be sent yet.`
      );
    }
    return; // approved or unsynced — legal at any time (D4/D6)
  }
  const now = i.now ?? new Date();
  const openedAt = i.lastInboundAt ? Date.parse(i.lastInboundAt) : NaN;
  const open =
    Number.isFinite(openedAt) && now.getTime() - openedAt < WHATSAPP_WINDOW_MS;
  if (!open) {
    throw new OutboundPolicyError(
      'window_closed',
      'The 24-hour window is closed — send an approved template instead.'
    );
  }
}
```

- [ ] **Step 4: Run tests** — `pnpm test outbound-policy` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(channels): pure outbound policy guard (ADR-006 D1/D4/D6/D8/D21)"`

### Task 5: Wire the guard into `sendChannelMessage` (D1, D5, D20, F1, F2, F4)

**Files:**
- Modify: `src/features/channels/lib/orchestration/outbound.ts` (step-1 loads + guard call before step 2/3/4)
- Test: `src/features/channels/lib/orchestration/outbound.guard.test.ts`

**Interfaces:**
- Consumes: `assertWhatsAppOutboundAllowed`, `OutboundPolicyError` from Task 4.
- Produces: `sendChannelMessage` throws `OutboundPolicyError` before any adapter call or `messages` insert when the policy denies a WhatsApp send. Non-WhatsApp channels are untouched.

- [ ] **Step 1: Write the failing tests.** Mock `channelAdmin` (as other
  orchestration tests mock the admin client) so the conversation row carries
  `last_inbound_at`, the contact carries `whatsapp_opted_out`, and the
  adapter send is a `vi.fn()`. Assert:

```ts
it('rejects a cold free-form WhatsApp send before the adapter and the insert', async () => {
  await expect(sendChannelMessage(coldTextArgs)).rejects.toMatchObject({
    name: 'OutboundPolicyError', code: 'window_closed', status: 409,
  });
  expect(adapterSend).not.toHaveBeenCalled();
  expect(messagesInsert).not.toHaveBeenCalled(); // F4: no partial record
});

it('sends free-form inside an open window', async () => { /* last_inbound_at = 1h ago → adapterSend called */ });
it('rejects any send to an opted-out contact', async () => { /* template payload → contact_opted_out */ });
it('leaves SMS sends completely unguarded', async () => { /* channel: 'sms', cold, text → adapterSend called */ });
```

- [ ] **Step 2: Run to verify failure** — the orchestrator today sends happily; the reject tests FAIL.

- [ ] **Step 3: Implement.** In `sendChannelMessage`:

(a) widen the two loads (F2 — keep the `account_id` filters exactly as they are):

```ts
    .select('id, contact_id, channel, channel_connection_id, last_inbound_at')
```
```ts
    .select('id, phone, whatsapp_opted_out')
```

(b) after both loads succeed and before connection resolution, insert:

```ts
  const channel =
    (conversation.channel as ChannelConnection['channel']) ?? 'whatsapp';
  if (channel === 'whatsapp') {
    let templateStatus: string | null = null;
    if (args.payload.kind === 'template') {
      const { data: tpl } = await db
        .from('message_templates')
        .select('status')
        .eq('account_id', args.accountId)
        .eq('name', args.payload.templateName)
        .maybeSingle();
      templateStatus = (tpl?.status as string | null) ?? null;
    }
    try {
      assertWhatsAppOutboundAllowed({
        payloadKind: args.payload.kind,
        lastInboundAt: (conversation.last_inbound_at as string | null) ?? null,
        contactOptedOut: Boolean(
          (contact as { whatsapp_opted_out?: boolean }).whatsapp_opted_out
        ),
        templateStatus,
      });
    } catch (err) {
      if (err instanceof OutboundPolicyError) {
        // D20: rejections must be observable — one structured line.
        console.warn('[outbound-policy] rejected', {
          code: err.code,
          accountId: args.accountId,
          conversationId: args.conversationId,
          payloadKind: args.payload.kind,
        });
      }
      throw err;
    }
  }
```

(Reuse the existing `conversationChannel` variable rather than re-deriving, if ordering allows.)

- [ ] **Step 4: Run the full suite** — `pnpm test` → PASS, including untouched orchestrator tests (they may need `last_inbound_at` in their fixtures; set it to a recent timestamp — this is the "tests now need a plausible window" consequence the ADR accepts).

- [ ] **Step 5: Commit** — `git commit -m "feat(channels): enforce 24h window, consent, template approval in orchestrator (ADR-006 D1/D5)"`

### Task 6: Map policy errors onto callers (D4, F6)

**Files:**
- Modify: `src/features/whatsapp/lib/send-message.ts` (orchestrator error mapping, step 5 of its pipeline)
- Test: extend `src/features/whatsapp/lib/send-message.test.ts`
- Verify (no change expected): `src/app/api/whatsapp/send/route.ts`, `src/app/api/v1/messages/route.ts` already map `SendMessageError.status`/`code`.

**Interfaces:**
- Consumes: `OutboundPolicyError` from Task 4.
- Produces: `sendMessageToConversation` rethrows policy errors as `SendMessageError(code, message, 409)` so both routes surface `window_closed` / `contact_opted_out` / `template_not_approved` verbatim at 409. 404-before-409 ordering holds automatically because the RLS-scoped conversation load (step 2) runs before the orchestrator (F6).

- [ ] **Step 1: Failing test** — mock the orchestrator to throw `new OutboundPolicyError('window_closed', '…')`; assert the caller receives `SendMessageError` with `code === 'window_closed'`, `status === 409`.
- [ ] **Step 2: Run** → FAIL (today it surfaces as a generic 500/502 mapping).
- [ ] **Step 3: Implement** in the catch that maps orchestrator errors:

```ts
    if (err instanceof OutboundPolicyError) {
      throw new SendMessageError(err.code, err.message, err.status);
    }
```

- [ ] **Step 4: Run** → PASS. Manually confirm both routes pass `code` through (`toErrorResponse` / v1 envelope) — if the dashboard route drops `code` and sends only `error`, add `code: err.code` to its JSON body.
- [ ] **Step 5: Commit** — `git commit -m "feat(whatsapp): surface policy 409s through both send routes (ADR-006 D4)"`

### Task 7: WhatsApp STOP/START keywords (D19, D8)

**Files:**
- Create: `src/features/channels/lib/opt-keywords.ts` + `opt-keywords.test.ts`
- Modify: `src/features/channels/lib/inbound.ts`, `src/app/api/whatsapp/webhook/route.ts` (both inbound text paths)

**Interfaces:**
- Produces: `whatsappOptEvent(body: string): 'out' | 'in' | null` — exact-match, case-insensitive, trimmed. `STOP`/`UNSUBSCRIBE` → `'out'`; `START`/`UNSTOP` → `'in'`.

- [ ] **Step 1: Failing tests**

```ts
it('detects opt-out exactly', () => {
  expect(whatsappOptEvent(' stop ')).toBe('out');
  expect(whatsappOptEvent('UNSUBSCRIBE')).toBe('out');
});
it('detects opt-in exactly', () => {
  expect(whatsappOptEvent('start')).toBe('in');
  expect(whatsappOptEvent('UNSTOP')).toBe('in');
});
it('never substring-matches', () => {
  expect(whatsappOptEvent("please don't stop the delivery")).toBeNull();
  expect(whatsappOptEvent('stops')).toBeNull();
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**

```ts
const OPT_OUT = new Set(['STOP', 'UNSUBSCRIBE']);
const OPT_IN = new Set(['START', 'UNSTOP']);

export function whatsappOptEvent(body: string): 'out' | 'in' | null {
  const t = body.trim().toUpperCase();
  if (OPT_OUT.has(t)) return 'out';
  if (OPT_IN.has(t)) return 'in';
  return null;
}
```

- [ ] **Step 4: Wire both inbound paths**, mirroring the Twilio handler at
  `api/channels/webhooks/twilio/route.ts:284–293` — after the inbound text
  message persists, when channel is whatsapp:

```ts
  const opt = whatsappOptEvent(text);
  if (opt) {
    await db
      .from('contacts')
      .update(
        opt === 'out'
          ? { whatsapp_opted_out: true, whatsapp_opted_out_at: new Date().toISOString() }
          : { whatsapp_opted_out: false, whatsapp_opted_out_at: null }
      )
      .eq('id', contactId)
      .eq('account_id', accountId);
  }
```

Note: the STOP message itself still stamps `last_inbound_at` (it is a
customer message); the consent flag is what makes the open window unusable.

- [ ] **Step 5: Run `pnpm test`, commit** — `git commit -m "feat(channels): whatsapp STOP/START consent keywords (ADR-006 D19)"`

### Task 8: Broadcasts — plan-time filter + orchestrator routing (D8, D13)

**Files:**
- Modify: `src/app/api/whatsapp/broadcast/route.ts` (recipient resolution + per-recipient send at `:218`)
- Modify: `src/app/api/sms/broadcast/route.ts` (add `whatsapp` is N/A — verify its existing `sms_opted_out` filter still stands; no change if so)
- Test: extend the broadcast route's existing test file (or add `broadcast-route.test.ts` following siblings)

**Interfaces:**
- Consumes: `sendChannelMessage` (Task 1 path), guard behavior (Task 5).
- Produces: WhatsApp broadcast recipients are (a) filtered on `whatsapp_opted_out = false` when the plan resolves, and (b) delivered via `sendChannelMessage` with a `template` payload instead of `sendTemplateMessage()` — so D1/D8 cover bulk by construction.

- [ ] **Step 1: Failing test** — recipient list containing an opted-out contact: assert the planned count excludes them; assert delivery calls the orchestrator (mock it) once per remaining recipient with `payload.kind === 'template'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Add `.eq('whatsapp_opted_out', false)` to the recipient query. Replace the per-recipient `sendTemplateMessage({...})` call with:

```ts
        const result = await sendChannelMessage({
          accountId,
          conversationId: recipientConversationId, // find-or-create as the route already does
          contactId: recipient.id,
          senderType: 'agent',
          senderUserId: user.id,
          payload: {
            kind: 'template',
            templateName: template.name,
            language: template.language,
            components, // built by the same template-send-builder the route already uses
          },
        });
```

Keep the route's existing pacing, per-recipient error capture, and result
accounting — only the send call changes. Delete the now-unused
`sendTemplateMessage` import last.

- [ ] **Step 4: Run `pnpm test` + a manual broadcast against the sandbox** → per-recipient results unchanged in shape; opted-out contacts absent from the approved count.
- [ ] **Step 5: Commit** — `git commit -m "feat(broadcasts): route delivery through orchestrator, filter opted-out at plan time (ADR-006 D13/D8)"`

---

## Phase B — the product surface (Tasks 9–13)

### Task 9: Composer reads server truth, fails closed, ticks (D9, C6, action 11)

**Files:**
- Modify: `src/features/inbox/components/message-thread.tsx:301–…` (`sessionInfo`)
- Modify: `src/features/inbox/components/message-composer.tsx` (banner copy already exists; verify 409 `window_closed` from Task 6 maps onto the amber banner)

**Interfaces:**
- Consumes: `conversations.last_inbound_at` (already on the conversation row the thread loads — add to its select if absent).
- Produces: `sessionInfo` derived from `last_inbound_at` + a 60s interval tick, with a 10-minute composer margin.

- [ ] **Step 1: Fix the fail-open** — `if (!messages.length) return { expired: false … }` becomes `expired: true` unless `last_inbound_at` is present and fresh. The empty-thread case is exactly what the `contact_id` path creates (C6).
- [ ] **Step 2: Re-derive from `last_inbound_at`** instead of scanning the loaded message page, and add a `useEffect` interval (60s) driving a `now` state so the memo re-evaluates on the clock, not only on new messages.
- [ ] **Step 3: Apply the margin** — composer treats the window as closed at `23h50m` (`WINDOW_MS - 10 * 60_000`); the banner copy says the window is "about to close" in the margin band. Server stays absolute at 24h (D9).
- [ ] **Step 4: Map the 409** — on `window_closed` from the send call, show the existing amber template-picker banner instead of a generic error toast.
- [ ] **Step 5: Verify in the browser** (agent-browser): empty thread → composer disabled with template prompt; thread with 1h-old inbound → enabled. Commit.

### Task 10: Contact record → "Message" (D14, entry point 1)

**Files:**
- Modify: `src/features/contacts/components/contact-record-sheet.tsx` (add the action)
- Create: `src/features/contacts/components/send-message-dialog.tsx`

**Interfaces:**
- Consumes: `POST /api/whatsapp/send` with `contact_id` (existing route, unchanged — D7's "no new endpoint" stands); the conversation's window state via its `last_inbound_at` (fetch the found conversation, or treat "no conversation" as closed).
- Produces: a dialog titled **"Send a message to this contact"** (never "broadcast"): window open → free-form composer; window closed → template picker with variable inputs (reuse the template-picker + `template-send-builder` components the inbox uses). On success, link to the conversation in the inbox.

- [ ] Step 1: Build the dialog with the two states; default to the template state whenever window state is unknown (fail closed, same direction as everything else).
- [ ] Step 2: Wire the "Message" button into the contact record sheet, gated on the contact having a phone.
- [ ] Step 3: Map `window_closed` (races happen) by flipping the dialog to the template state with the banner, and `contact_opted_out` to a terminal "this contact has opted out" notice.
- [ ] Step 4: Browser-verify both states, `pnpm check`, commit.

### Task 11: Inbox → "New message" (D14, entry point 2)

**Files:**
- Modify: the inbox conversation-list header component (locate via `grep -rn "New conversation\|conversation-list" src/features/inbox/components/`)
- Reuse: `send-message-dialog.tsx` from Task 10, prefixed with a contact search (existing contact-search component if one exists; otherwise a `cmdk` list over `/api/v1/contacts`-equivalent internal fetcher).

- [ ] Step 1: Add the "New message" button opening contact search → the Task 10 dialog with the chosen contact.
- [ ] Step 2: On success, navigate to the (found-or-created) conversation.
- [ ] Step 3: Browser-verify, `pnpm check`, commit.

### Task 12: Contact list → bounded "Quick send" (D14 entry point 3, D21 bound)

**Files:**
- Modify: the contacts table/list component (multi-select already exists or is added here)
- Create: `src/features/contacts/components/quick-send-dialog.tsx`

**Interfaces:**
- Consumes: N sequential calls to `POST /api/whatsapp/send` with `contact_id`, template payload only (cold contacts are the norm).
- Produces: per-recipient result list (sent / failed with code). **Cap: 10 recipients** — chosen to sit safely inside `RATE_LIMITS.send`'s per-user budget (D21; verify the constant in `src/lib/rate-limit.ts` and lower the cap if the budget is tighter). Above the cap, the UI links to Broadcasts.

- [ ] Step 1: Check `RATE_LIMITS.send` and set the cap so a full quick-send cannot trip the limiter.
- [ ] Step 2: Build the dialog: template picker once, then sequential sends with a visible per-recipient status column; a 429 or 409 on one recipient does not abort the rest — it is recorded on that row.
- [ ] Step 3: No campaign record, no pacing, no `broadcasts:manage` — this is N single sends under `inbox:send`.
- [ ] Step 4: Browser-verify with 3 recipients (one opted-out → row shows `contact_opted_out`), `pnpm check`, commit.

### Task 13: Permission gating (C11, action 14)

**Files:**
- Modify: `src/app/api/whatsapp/send/route.ts`, `src/app/api/whatsapp/broadcast/route.ts`, `src/app/api/sms/broadcast/route.ts`, `src/app/api/email/broadcast/route.ts`
- Reuse: the module/permission helper ADR-001 established (locate via `grep -rn "inbox:send\|broadcasts:manage" src/ --include=*.ts` and the account grants helpers under `src/lib/account/`).

- [ ] Step 1: Gate the send route on `inbox:send`, the broadcast routes on `broadcasts:manage`, returning 403 with a typed code, checked server-side after auth and before any side effect.
- [ ] Step 2: Tests: viewer-role caller → 403 on send; agent → 200 path reachable; admin → broadcast allowed.
- [ ] Step 3: `pnpm check`, commit.

---

## Phase C — docs + severable seam proof (Tasks 14–15)

### Task 14: Documentation close-out (action 10, D15)

- [ ] Update `docs/outbound-messaging.md`: §5.1/§5.2 marked resolved by ADR-006; §1 cost claims dated with the 2026-10-01 change (service messages + in-window utility templates become per-message billable; market rates published by 2026-09-01).
- [ ] Same dated caveat in ADR-008's cost positioning.
- [ ] Update `.agents/context/api-routes.md` (new 409 codes, permission gates) → `pnpm docs:sync`.
- [ ] Flip ADR-006 **Status: Proposed → Accepted** with the implementation date.
- [ ] `pnpm check` + production build, commit.

### Task 15 (severable — do not start before Tasks 1–8 are merged): MSG91 adapter as seam conformance test (D17, actions 15–16)

- [ ] `channel_provider` enum migration adding `'msg91'` **in its own transaction** (SQLSTATE 55P04 precedent: the `040`/`041` split), then widen the `channel_provider_pair` CHECK to `('meta','twilio','msg91')` for whatsapp in a second migration.
- [ ] `'msg91'` on `ChannelProvider` (`types/index.ts`), `PROVIDER_CHANNELS` / `PROVIDER_LABEL` entries.
- [ ] `adapters/msg91.ts`: `send` (POST `api/v5/whatsapp/whatsapp-outbound-message/bulk/`, header `authkey`, `integrated_number` in body — both encrypted in `channel_connections` via `lib/crypto/secrets.ts`), `checkHealth`, `sendTest`. The bulk shape stays inside the adapter (D13 warning).
- [ ] Add `verifyWebhook?(request): Promise<boolean>` to `ChannelAdapter`; Meta's HMAC and MSG91's timing-safe shared-secret-header check both move behind it; both fail closed when their secret is unset.
- [ ] `api/channels/webhooks/msg91/route.ts` → `persistInboundChannelMessage`.
- [ ] **Pass condition (the entire point):** `git diff` for this task touches **no** guard, orchestrator, contract payload, or UI file. If it does, stop and reopen ADR-006 D17.

---

## Self-review notes

- Every ADR action item 1–16 maps to a task: 1→T2, 2→T3, 3→T4/T5, 4→T4, 5→ordering constraint, 6→T10, 7→T9, 8→T8, 9→T4/T5/T6 tests, 10→T14, 11→T9, 12→T8, 13→T10–T12, 14→T13+T14, 15→T15, 16→T15. New items 17–20 (D18–D21) → T1, T7, T5 logging, T4 allowlist.
- Type consistency: `OutboundPolicyError` is defined once (T4) and consumed in T5, T6; `whatsappOptEvent` defined in T7 and used in both inbound paths; `sendChannelMessage` import path settles in T1 before any other task touches it.
- Deploy-order constraint (F3) is enforced by task order: T2 (columns + verified backfill) and T3 (writers) land and deploy before T5 (guard).
