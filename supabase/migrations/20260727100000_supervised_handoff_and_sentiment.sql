-- 20260727100000_supervised_handoff_and_sentiment.sql
--
-- Fixes the "AI goes permanently silent after handoff" defect and lays
-- the groundwork for sentiment/empathy reporting.
--
-- THE DEFECT
-- ----------
-- On escalation, auto-reply.ts set `ai_autoreply_disabled = true`, which
-- is sticky forever. The customer got one warm-bridge message and then
-- silence: every later inbound was a no-op because the eligibility gate
-- reads that flag. If the assigned agent never showed up, the thread was
-- abandoned with no timeout, no nudge, and no re-escalation.
--
-- THE MODEL
-- ---------
-- Replace the binary on/off with an explicit lifecycle:
--
--   none          -- AI owns the thread, normal autonomous replying
--   awaiting_human-- escalated, no human has spoken yet. AI stays on in
--                    a restricted "caretaker" mode: acknowledge, show
--                    empathy, set expectations, gather detail. It must
--                    not promise outcomes or invent policy.
--   human_active  -- a human has actually replied. AI goes fully quiet;
--                    this is the only state where silence is correct.
--   resolved      -- thread closed out.
--
-- The key insight is that "a human was *assigned*" and "a human actually
-- *replied*" are different events. The old code conflated them, so it
-- went quiet on assignment — before anyone had spoken to the customer.
--
-- `ai_autoreply_disabled` is retained and kept in sync as a generated
-- mirror of `human_active` so existing reads keep working during rollout.

-- ---------------------------------------------------------------------
-- 1. Handoff lifecycle on conversations
-- ---------------------------------------------------------------------

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_handoff_state TEXT NOT NULL DEFAULT 'none'
    CHECK (ai_handoff_state IN
      ('none', 'awaiting_human', 'human_active', 'resolved'));

-- When the first human reply landed. NULL while awaiting_human.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_human_first_reply_at TIMESTAMPTZ;

-- Caretaker bookkeeping. Counted separately from `ai_reply_count` so a
-- holding message never consumes the customer's normal reply budget --
-- otherwise a long wait for a human would exhaust the cap and reproduce
-- the very silence this migration exists to prevent.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_caretaker_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_last_caretaker_at TIMESTAMPTZ;

-- How many times we have nudged the assigned agent / re-escalated.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_sla_nudge_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_sla_last_nudge_at TIMESTAMPTZ;

COMMENT ON COLUMN public.conversations.ai_handoff_state IS
  'Handoff lifecycle. awaiting_human keeps the AI in restricted caretaker mode so the customer is never left in silence; only human_active silences it.';

-- Backfill: threads previously escalated-and-muted become awaiting_human
-- so the SLA watchdog can pick up already-abandoned conversations rather
-- than leaving them stranded by the old behaviour.
UPDATE public.conversations
   SET ai_handoff_state = 'awaiting_human'
 WHERE ai_autoreply_disabled = true
   AND ai_escalated_at IS NOT NULL
   AND status <> 'closed'
   AND ai_handoff_state = 'none';

-- The watchdog scans by (state, escalated_at). Partial index keeps it
-- cheap -- only open escalations are ever candidates.
CREATE INDEX IF NOT EXISTS idx_conversations_awaiting_human
  ON public.conversations (ai_escalated_at)
  WHERE ai_handoff_state = 'awaiting_human';

-- ---------------------------------------------------------------------
-- 2. Sentiment + empathy history
-- ---------------------------------------------------------------------
--
-- `conversations.ai_sentiment` only ever held the *latest* value, so it
-- could answer "how does this customer feel now?" but not "is sentiment
-- trending down?", "did escalation help?", or "how empathetic are our
-- replies?". Reporting needs a time series, so events go in their own
-- append-only table.

CREATE TABLE IF NOT EXISTS public.conversation_sentiment_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES public.contacts(id) ON DELETE SET NULL,

  -- Customer emotional state. Extends the original 4-value set; the
  -- legacy values stay valid so historical rows remain comparable.
  sentiment       TEXT NOT NULL
    CHECK (sentiment IN
      ('angry', 'frustrated', 'confused', 'neutral', 'satisfied', 'happy')),

  -- Signed intensity, -1.0 (most negative) .. 1.0 (most positive).
  -- Enables trend maths that ordinal labels alone cannot express.
  score           NUMERIC(3,2)
    CHECK (score IS NULL OR (score >= -1 AND score <= 1)),

  -- Model's confidence in the label, 0..1. Low-confidence rows can be
  -- excluded from reports instead of silently skewing them.
  confidence      NUMERIC(3,2)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),

  -- Finer-grained emotions behind the label (e.g. {anxious,let_down}).
  emotions        TEXT[] NOT NULL DEFAULT '{}',

  -- How empathetic OUR outgoing reply was, 0..1. Scores the agent side,
  -- not the customer -- this is the coaching signal.
  empathy_score   NUMERIC(3,2)
    CHECK (empathy_score IS NULL OR (empathy_score >= 0 AND empathy_score <= 1)),

  -- Friction proxy (repetition, going in circles). Higher = more effort
  -- demanded of the customer.
  effort_score    NUMERIC(3,2)
    CHECK (effort_score IS NULL OR (effort_score >= 0 AND effort_score <= 1)),

  -- Whether this turn triggered an escalation, for before/after cuts.
  escalated       BOOLEAN NOT NULL DEFAULT false,
  escalation_reason TEXT,

  -- 'customer' = reading the inbound; 'agent' = scoring our outbound.
  subject         TEXT NOT NULL DEFAULT 'customer'
    CHECK (subject IN ('customer', 'agent')),

  -- Provenance, so a model swap doesn't invalidate comparisons.
  source          TEXT NOT NULL DEFAULT 'llm'
    CHECK (source IN ('llm', 'heuristic', 'human')),
  model           TEXT,

  message_id      UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.conversation_sentiment_events IS
  'Append-only sentiment/empathy time series. conversations.ai_sentiment holds only the latest value; reporting and trend detection read from here.';

-- Reports are always account-scoped and time-bounded.
CREATE INDEX IF NOT EXISTS idx_sentiment_events_account_time
  ON public.conversation_sentiment_events (account_id, created_at DESC);

-- Per-thread timeline (trend within one conversation).
CREATE INDEX IF NOT EXISTS idx_sentiment_events_conversation
  ON public.conversation_sentiment_events (conversation_id, created_at);

-- Negative-sentiment hunting for the at-risk queue.
CREATE INDEX IF NOT EXISTS idx_sentiment_events_negative
  ON public.conversation_sentiment_events (account_id, created_at DESC)
  WHERE sentiment IN ('angry', 'frustrated');

-- ---------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------
-- Tenant isolation follows the same account-membership pattern as the
-- rest of the schema. Writes are server-side only (service role), so no
-- INSERT/UPDATE policy is granted to end users.

ALTER TABLE public.conversation_sentiment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read own account sentiment" ON public.conversation_sentiment_events;
CREATE POLICY "Members read own account sentiment"
  ON public.conversation_sentiment_events
  FOR SELECT USING (
    is_account_member(account_id, 'viewer') OR is_platform_super_admin()
  );
