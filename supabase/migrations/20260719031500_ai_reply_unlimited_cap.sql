-- ============================================================
-- Unlimited / higher auto-reply caps.
--
-- Previously `auto_reply_max_per_conversation` was hard-capped at
-- 1..20 by CHECK constraints, and the atomic claim function stopped
-- at `max_replies`. Product now needs:
--   * higher caps (up to 500), and
--   * "unlimited" — encoded as 0 (the bot never goes quiet on count;
--     handoff / pause still stop it).
--
-- 0 was chosen over NULL because ai_configs' column is NOT NULL and
-- NULL already means "inherit" on ai_bots.
-- ============================================================

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_auto_reply_max_per_conversation_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_auto_reply_max_per_conversation_check
  CHECK (auto_reply_max_per_conversation BETWEEN 0 AND 500);

ALTER TABLE ai_bots
  DROP CONSTRAINT IF EXISTS ai_bots_auto_reply_max_per_conversation_check;
ALTER TABLE ai_bots
  ADD CONSTRAINT ai_bots_auto_reply_max_per_conversation_check
  CHECK (auto_reply_max_per_conversation IS NULL
         OR auto_reply_max_per_conversation BETWEEN 0 AND 500);

-- Claim function: max_replies <= 0 now means "no cap" — the increment
-- still happens (usage stats / greeting logic rely on ai_reply_count),
-- but the count no longer gates the claim.
CREATE OR REPLACE FUNCTION public.claim_ai_reply_slot(
  conversation_id uuid,
  max_replies integer
)
RETURNS boolean AS $$
  WITH claimed AS (
    UPDATE conversations
    SET ai_reply_count = ai_reply_count + 1
    WHERE id = conversation_id
      AND (max_replies <= 0 OR ai_reply_count < max_replies)
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer) TO service_role;
