-- ============================================================
-- 20260725110000_release_ai_reply_slot.sql
--
-- Fix: failed outbound sends permanently burn the auto-reply cap.
--
-- `claim_ai_reply_slot` (029) increments `ai_reply_count` BEFORE the
-- send (fail-safe: under-reply rather than over-reply). But when the
-- send itself fails (e.g. Twilio 21703 during the Messaging Service
-- misconfiguration), the slot was never refunded — three failed sends
-- consumed the whole "Max 3 replies per conversation" cap without the
-- customer receiving a single message, and the bot went silent on the
-- thread forever.
--
-- This function is the exact inverse of the claim: an atomic decrement
-- floored at 0. The app calls it only when `sendChannelMessage` throws
-- after a successful claim.
--
-- Grant mirrors 029/031: only the service role (webhook-driven bot)
-- ever touches reply slots.
-- ============================================================

CREATE OR REPLACE FUNCTION public.release_ai_reply_slot(
  conversation_id uuid
)
RETURNS void AS $$
  UPDATE conversations
  SET ai_reply_count = GREATEST(ai_reply_count - 1, 0)
  WHERE id = conversation_id;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.release_ai_reply_slot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_ai_reply_slot(uuid) TO service_role;
