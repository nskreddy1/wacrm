-- Supervised handoff
--
-- Problem this fixes
-- ------------------
-- When the assistant escalated, it set BOTH `ai_autoreply_disabled = true`
-- and `assigned_agent_id`. The auto-reply entry gate returns early on
-- either, so the bot muted itself the moment it announced the handoff.
-- From then on the customer got silence -- indefinitely -- even when no
-- human had ever opened the thread. Assignment was being treated as
-- contact.
--
-- Model
-- -----
-- Ownership becomes an explicit lifecycle instead of an inference from
-- two overloaded booleans:
--
--   none          -- bot owns the thread, normal auto-reply
--   awaiting_human -- escalated, but NO human has spoken yet.
--                     The bot stays on as CARETAKER: it may keep the
--                     customer company, acknowledge, and collect detail,
--                     but must not re-promise resolution.
--   human_active  -- a human actually sent a message. Bot goes silent.
--
-- `ai_autoreply_disabled` keeps its original meaning and is now ONLY the
-- manual operator kill-switch ("Resume AI" toggles it). It is no longer
-- set by escalation, so the two concepts stop colliding.

-- ---------------------------------------------------------------------
-- 1. Lifecycle + caretaker/SLA bookkeeping
-- ---------------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_handoff_state TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ai_human_first_reply_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_caretaker_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_last_caretaker_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_sla_reminder_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_sla_last_reminder_at TIMESTAMPTZ;

DO $$
BEGIN
  ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_ai_handoff_state_check
    CHECK (ai_handoff_state IN ('none', 'awaiting_human', 'human_active'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------
-- 2. Backfill -- deliberately conservative
-- ---------------------------------------------------------------------
-- Every thread that has ALREADY escalated is marked `human_active`, i.e.
-- permanently silent, even though some never received a human reply.
--
-- This is intentional. Marking them `awaiting_human` would be "correct"
-- but catastrophic in practice: on deploy, the caretaker would wake up
-- across the entire backlog and start messaging customers about issues
-- that are days or weeks old. Existing threads keep today's behaviour;
-- the new lifecycle governs escalations from here forward only.
UPDATE public.conversations
   SET ai_handoff_state = 'human_active'
 WHERE ai_escalated_at IS NOT NULL
   AND ai_handoff_state = 'none';

-- Partial index for the SLA watchdog sweep: only unattended threads are
-- ever scanned, so this stays small regardless of table size.
CREATE INDEX IF NOT EXISTS conversations_awaiting_human_idx
  ON public.conversations (ai_escalated_at)
  WHERE ai_handoff_state = 'awaiting_human';

-- ---------------------------------------------------------------------
-- 3. Detect real human contact via trigger
-- ---------------------------------------------------------------------
-- Deliberately a trigger rather than application code. A human reply can
-- originate from the web inbox, the public API, a mobile client, or any
-- future surface; a trigger catches every path by construction, so no
-- send path can forget to close the handoff. `sender_type = 'agent'` is
-- the only signal that means "a person spoke" ('bot' is the assistant).
CREATE OR REPLACE FUNCTION public.close_handoff_on_agent_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_type = 'agent' THEN
    UPDATE public.conversations
       SET ai_handoff_state = 'human_active',
           ai_human_first_reply_at = COALESCE(ai_human_first_reply_at, now())
     WHERE id = NEW.conversation_id
       AND ai_handoff_state <> 'human_active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS close_handoff_on_agent_message ON public.messages;
CREATE TRIGGER close_handoff_on_agent_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.close_handoff_on_agent_message();

-- ---------------------------------------------------------------------
-- 4. Atomic caretaker slot claim
-- ---------------------------------------------------------------------
-- Mirrors the existing reply-slot pattern. Budget check and increment
-- happen inside one statement so two inbound messages arriving together
-- (customer sends "hello?" twice) cannot both win a slot and produce two
-- near-identical holding messages.
--
-- Returns TRUE only if a slot was claimed.
CREATE OR REPLACE FUNCTION public.claim_ai_caretaker_slot(
  p_conversation_id UUID,
  p_max_messages INTEGER,
  p_cooloff_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_claimed BOOLEAN := FALSE;
BEGIN
  UPDATE public.conversations
     SET ai_caretaker_count = ai_caretaker_count + 1,
         ai_last_caretaker_at = now()
   WHERE id = p_conversation_id
     AND ai_handoff_state = 'awaiting_human'
     AND ai_autoreply_disabled = FALSE
     AND ai_caretaker_count < p_max_messages
     AND (
       ai_last_caretaker_at IS NULL
       OR ai_last_caretaker_at < now() - make_interval(secs => p_cooloff_seconds)
     )
  RETURNING TRUE INTO v_claimed;

  RETURN COALESCE(v_claimed, FALSE);
END;
$$;

-- ---------------------------------------------------------------------
-- 5. SLA watchdog sweep
-- ---------------------------------------------------------------------
-- Returns threads that escalated more than p_overdue_minutes ago and
-- still have no human reply, respecting a re-notification cool-off so a
-- once-a-minute cron cannot spam the team about the same conversation.
--
-- Read-only and side-effect free: the caller decides what to do (notify,
-- reassign, escalate to a supervisor) and records it via
-- `mark_handoff_sla_notified`. Keeping the sweep pure makes it safe to
-- call repeatedly and easy to dry-run.
CREATE OR REPLACE FUNCTION public.find_overdue_handoffs(
  p_overdue_minutes INTEGER DEFAULT 10,
  p_renotify_minutes INTEGER DEFAULT 15,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  conversation_id UUID,
  account_id UUID,
  contact_id UUID,
  assigned_agent_id UUID,
  escalated_at TIMESTAMPTZ,
  waiting_minutes INTEGER,
  reminder_count INTEGER,
  escalation_reason TEXT,
  sentiment TEXT
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.id,
         c.account_id,
         c.contact_id,
         c.assigned_agent_id,
         c.ai_escalated_at,
         GREATEST(0, (EXTRACT(EPOCH FROM (now() - c.ai_escalated_at)) / 60)::INTEGER),
         c.ai_sla_reminder_count,
         c.ai_escalation_reason,
         c.ai_sentiment
    FROM public.conversations c
   WHERE c.ai_handoff_state = 'awaiting_human'
     AND c.ai_escalated_at IS NOT NULL
     AND c.ai_escalated_at < now() - make_interval(mins => p_overdue_minutes)
     AND c.status <> 'closed'
     AND (
       c.ai_sla_last_reminder_at IS NULL
       OR c.ai_sla_last_reminder_at < now() - make_interval(mins => p_renotify_minutes)
     )
   ORDER BY c.ai_escalated_at ASC
   LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.mark_handoff_sla_notified(
  p_conversation_id UUID
)
RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.conversations
     SET ai_sla_reminder_count = ai_sla_reminder_count + 1,
         ai_sla_last_reminder_at = now()
   WHERE id = p_conversation_id;
$$;

COMMENT ON COLUMN public.conversations.ai_handoff_state IS
  'Handoff lifecycle: none | awaiting_human (escalated, bot acts as caretaker) | human_active (a human replied, bot silent).';
COMMENT ON COLUMN public.conversations.ai_autoreply_disabled IS
  'Manual operator kill-switch only (the Resume AI toggle). Escalation no longer sets this -- see ai_handoff_state.';
