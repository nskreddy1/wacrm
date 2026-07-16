-- ============================================================
-- 043_ai_sentiment_escalation.sql — AI sentiment, escalation
-- routing (round-robin), and richer notifications.
--
-- Companion to the [[META]] classification contract (see
-- docs/ai-auto-reply.md): the auto-reply model now returns structured
-- sentiment + escalation data in the same call, and escalations are
-- routed round-robin across the account's members when no explicit
-- handoff agent is configured.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. Sentiment + escalation state on the conversation.
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_sentiment TEXT
    CHECK (ai_sentiment IS NULL OR ai_sentiment IN ('angry', 'frustrated', 'neutral', 'happy'));

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_escalation_reason TEXT
    CHECK (ai_escalation_reason IS NULL OR ai_escalation_reason IN
      ('human_requested', 'angry_customer', 'out_of_scope', 'needs_account_data', 'purchase_ready'));

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_escalated_at TIMESTAMPTZ;

-- ============================================================
-- 2. Audit which key paid for each LLM call (account BYO vs the
--    deployment's shared GEMINI_API_KEY fallback).
-- ============================================================
ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS key_source TEXT NOT NULL DEFAULT 'account'
    CHECK (key_source IN ('account', 'env'));

-- ============================================================
-- 3. Round-robin cursor on profiles.
--    NULL means "never assigned by the AI" → picked first.
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_ai_assignment_at TIMESTAMPTZ;

-- ============================================================
-- 4. claim_round_robin_agent — atomically pick the account member who
--    was AI-assigned least recently and advance the cursor.
--
--    FOR UPDATE SKIP LOCKED so two concurrent escalations in one
--    account never pick the same member at the same instant — the
--    second caller skips the locked row and takes the next-oldest.
--    Returns NULL when the account has no members (caller leaves the
--    conversation in the shared queue).
--
--    Account-wide for now; a future p_department_id parameter can be
--    added without breaking callers.
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_round_robin_agent(
  p_account_id uuid
)
RETURNS uuid AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT user_id INTO v_user_id
  FROM profiles
  WHERE account_id = p_account_id
  ORDER BY last_ai_assignment_at ASC NULLS FIRST, user_id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE profiles
  SET last_ai_assignment_at = now()
  WHERE user_id = v_user_id AND account_id = p_account_id;

  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Only the service role (the webhook-driven auto-reply bot) claims
-- assignments — mirrors claim_ai_reply_slot (031).
REVOKE ALL ON FUNCTION public.claim_round_robin_agent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_round_robin_agent(uuid) TO service_role;

-- ============================================================
-- 5. Notifications: allow the AI-escalation fan-out type, and enrich
--    the assignment notification with sentiment + escalation reason.
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'ai_escalation'));

CREATE OR REPLACE FUNCTION notify_conversation_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
  v_body TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Skip self-assignment — nothing to notify the agent about.
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  v_body := COALESCE(v_actor_name, 'Someone') || ' assigned you a conversation with '
    || COALESCE(v_contact_name, 'a contact');

  -- AI escalation context, when present: why the bot handed off and how
  -- the customer is feeling, so the agent triages from the notification.
  IF NEW.ai_escalation_reason IS NOT NULL THEN
    v_body := v_body || ' — AI escalated (' || replace(NEW.ai_escalation_reason, '_', ' ') || ')';
  END IF;
  IF NEW.ai_sentiment IS NOT NULL AND NEW.ai_sentiment <> 'neutral' THEN
    v_body := v_body || ' — customer seems ' || NEW.ai_sentiment;
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    'conversation_assigned',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    'New conversation assigned',
    v_body
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the assignment itself.
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_conversation_assigned() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_conversation_assigned ON conversations;
CREATE TRIGGER on_conversation_assigned
  AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION notify_conversation_assigned();
