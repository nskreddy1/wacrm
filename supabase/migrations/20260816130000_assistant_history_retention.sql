-- ============================================================
-- 20260816130000_assistant_history_retention.sql
--
-- Automated retention for Mira transcripts.
--
-- WHY 90 DAYS, AND WHY AUTOMATIC
--   Mira's history stores what the user typed verbatim, and in
--   practice reps paste customer PII straight into it (emails, phone
--   numbers, deal terms). Guidance for raw conversational AI logs
--   converges on 30–90 days for operational use, with anything longer
--   reserved for deliberate audit records — and on the retention
--   being enforced by a timer rather than by someone remembering to
--   clean up. Microsoft 365 Copilot is the cautionary case: it ships
--   with NO default retention, so interaction history accumulates
--   indefinitely until an admin configures Purview.
--
--   90 days is the upper end of that operational window: long enough
--   that "what did I ask Mira last quarter" still works, short enough
--   that the standing pool of customer PII stays bounded. The cutoff
--   is `last_message_at`, not `created_at`, so a thread someone keeps
--   returning to is never deleted out from under them — the clock
--   restarts on each turn.
--
--   This is data minimisation, not a backup policy. Deletion is hard:
--   messages cascade from the session, so no orphans remain.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- Single source of truth for the window. Changing the default here
-- changes the policy everywhere it is enforced.
CREATE OR REPLACE FUNCTION public.purge_expired_assistant_sessions(
  retain_days integer DEFAULT 90
)
RETURNS integer
LANGUAGE plpgsql
-- SECURITY DEFINER: this runs from a scheduler with no auth.uid(), so
-- it must be able to bypass the owner-scoped RLS policies on these
-- tables. search_path is pinned so a mutable search_path cannot be
-- used to resolve `assistant_sessions` to an attacker-controlled table.
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  removed integer;
BEGIN
  IF retain_days IS NULL OR retain_days < 1 THEN
    RAISE EXCEPTION 'retain_days must be >= 1 (got %)', retain_days;
  END IF;

  -- assistant_messages has ON DELETE CASCADE from session_id, so
  -- deleting the session removes its transcript in the same statement.
  DELETE FROM assistant_sessions
  WHERE last_message_at < now() - make_interval(days => retain_days);

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

-- Not callable by end users: retention is a platform concern, and the
-- function bypasses RLS by design.
REVOKE ALL ON FUNCTION public.purge_expired_assistant_sessions(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_expired_assistant_sessions(integer) FROM anon;
REVOKE ALL ON FUNCTION public.purge_expired_assistant_sessions(integer) FROM authenticated;

COMMENT ON FUNCTION public.purge_expired_assistant_sessions(integer) IS
  'Deletes Mira chat sessions (and cascaded messages) whose last_message_at is older than retain_days. Default 90 days. Intended to run daily from pg_cron.';

-- ------------------------------------------------------------------
-- Schedule it, when the platform offers a scheduler.
--
-- pg_cron is not present on every Postgres/Supabase plan, so this is
-- conditional rather than a hard dependency: without it the function
-- still exists and can be driven by an external cron hitting an admin
-- route. Guarding on the extension keeps this migration runnable on
-- any environment.
-- ------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Re-running the migration must not stack duplicate jobs.
    PERFORM cron.unschedule('purge-expired-assistant-sessions')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'purge-expired-assistant-sessions'
    );

    PERFORM cron.schedule(
      'purge-expired-assistant-sessions',
      '30 3 * * *', -- daily, off-peak
      $cron$SELECT public.purge_expired_assistant_sessions(90);$cron$
    );
    RAISE NOTICE 'Scheduled daily Mira history purge (90-day retention).';
  ELSE
    RAISE NOTICE 'pg_cron not installed - purge_expired_assistant_sessions() created but not scheduled.';
  END IF;
END;
$$;
