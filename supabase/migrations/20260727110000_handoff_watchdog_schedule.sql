-- Handoff watchdog schedule (pg_cron + pg_net).
--
-- Why this exists rather than a Vercel Cron entry: the Hobby plan allows
-- only ONE cron invocation per day, which cannot serve a 10-minute reply
-- SLA. Supabase's pg_cron runs at 1-minute granularity on the free tier,
-- and pg_net lets Postgres call our endpoint, so the scheduler moves into
-- the database and the plan limit stops being on the critical path.
--
-- Secrets are NOT hardcoded here. They are read at call time from Vault
-- (`vault.decrypted_secrets`), so this migration is safe to commit and
-- the secret can be rotated without a redeploy.
--
-- Operator setup (once per environment, values differ per project):
--   select vault.create_secret('https://app.example.com', 'app_base_url');
--   select vault.create_secret('<AUTOMATION_CRON_SECRET>', 'automation_cron_secret');
--
-- If either secret is absent the job logs a notice and exits quietly, so
-- an un-provisioned environment produces no failing-job noise.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

/*
 * Fire one watchdog tick.
 *
 * Wrapped in a function rather than inlining the http_post into the
 * cron command so the secret lookup, the missing-config guard, and the
 * timeout all live in one testable place (`select ai.tick_handoff_watchdog()`).
 */
CREATE SCHEMA IF NOT EXISTS ai;

CREATE OR REPLACE FUNCTION ai.tick_handoff_watchdog()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
-- Pin the search path: this is SECURITY DEFINER, so an attacker-controlled
-- search_path could otherwise shadow the functions we call.
SET search_path = pg_catalog, public, vault
AS $$
DECLARE
  v_base_url TEXT;
  v_secret   TEXT;
BEGIN
  SELECT decrypted_secret INTO v_base_url
    FROM vault.decrypted_secrets WHERE name = 'app_base_url';
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'automation_cron_secret';

  IF v_base_url IS NULL OR v_secret IS NULL THEN
    RAISE NOTICE 'handoff watchdog not configured (missing vault secrets); skipping';
    RETURN;
  END IF;

  -- Fire-and-forget: pg_net queues the request and returns immediately,
  -- so a slow endpoint can never hold a cron worker open.
  PERFORM net.http_post(
    url     := v_base_url || '/api/ai/handoff-watchdog',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', v_secret
    ),
    body          := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
END;
$$;

-- Not callable by tenants: this is infrastructure, and it is
-- SECURITY DEFINER. Postgres grants EXECUTE to PUBLIC by default, so the
-- revoke is required, not decorative.
REVOKE ALL ON FUNCTION ai.tick_handoff_watchdog() FROM PUBLIC;
REVOKE ALL ON SCHEMA ai FROM PUBLIC;

-- Re-running this migration must not stack duplicate schedules.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-handoff-watchdog') THEN
    PERFORM cron.unschedule('ai-handoff-watchdog');
  END IF;
END $$;

-- Every minute. The endpoint is idempotent (SQL-side re-notify cool-off),
-- so frequent ticks cost a no-op query rather than duplicate pings.
SELECT cron.schedule(
  'ai-handoff-watchdog',
  '* * * * *',
  $$SELECT ai.tick_handoff_watchdog();$$
);
