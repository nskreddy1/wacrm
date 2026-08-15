-- ============================================================
-- Invite delivery health / auto-disable circuit breaker
--
-- Problem: `invite_delivery_mode = 'email'` is an operator promise
-- that mail CAN be delivered. If the workspace's SMTP credentials
-- rot (expired app password, revoked API key, blocked sender), every
-- subsequent invite silently fails while the UI keeps telling admins
-- "invitation emailed". The invitee never gets it and nobody notices.
--
-- Fix: count consecutive delivery failures. After `p_threshold` in a
-- row, flip `invite_delivery_mode` back to 'link_only' so the product
-- degrades to the path that always works — the admin copies the
-- /join/<token> link and sends it themselves. Recording WHY it
-- tripped is what makes this debuggable instead of mysterious.
--
-- Why this lives in SQL rather than the Node layer:
--   * Read-modify-write of a counter from several concurrent
--     serverless invocations is a lost-update race. `INSERT … ON
--     CONFLICT DO UPDATE` increments atomically in one statement.
--   * platform_settings is super-admin-only under RLS. SECURITY
--     DEFINER lets server code record health without handing the
--     mailer broad write access to the settings table.
--
-- Idempotent: CREATE OR REPLACE + guarded grants.
-- ============================================================

-- Records one failed invite delivery. Returns the resulting state so
-- the caller can log/surface it:
--   { tripped: bool, consecutive_failures: int, threshold: int }
CREATE OR REPLACE FUNCTION public.record_invite_delivery_failure(
  p_error     text DEFAULT NULL,
  p_threshold int  DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_failures int;
  v_tripped  boolean := false;
BEGIN
  -- A threshold below 1 would disable email on the first hiccup.
  IF p_threshold IS NULL OR p_threshold < 1 THEN
    p_threshold := 1;
  END IF;

  -- Atomic increment. No SELECT-then-UPDATE, so two invites failing
  -- at the same moment cannot both read "0" and both write "1".
  INSERT INTO platform_settings (key, value, updated_at)
  VALUES (
    'invite_delivery_health',
    jsonb_build_object(
      'consecutive_failures', 1,
      'last_error',           to_jsonb(p_error),
      'last_failure_at',      to_jsonb(now())
    ),
    now()
  )
  ON CONFLICT (key) DO UPDATE
    SET value = platform_settings.value
                || jsonb_build_object(
                     'consecutive_failures',
                     COALESCE(
                       (platform_settings.value ->> 'consecutive_failures')::int,
                       0
                     ) + 1,
                     'last_error',      to_jsonb(p_error),
                     'last_failure_at', to_jsonb(now())
                   ),
        updated_at = now()
  RETURNING COALESCE((value ->> 'consecutive_failures')::int, 1)
  INTO v_failures;

  IF v_failures >= p_threshold THEN
    -- Degrade to the always-works path. Written as a jsonb string to
    -- match how the app reads this key ('"link_only"'::jsonb).
    INSERT INTO platform_settings (key, value, updated_at)
    VALUES ('invite_delivery_mode', '"link_only"'::jsonb, now())
    ON CONFLICT (key) DO UPDATE
      SET value = '"link_only"'::jsonb, updated_at = now();

    -- Reset the counter and leave a breadcrumb explaining the flip,
    -- so the admin UI can say why sending turned itself off.
    UPDATE platform_settings
       SET value = value
                   || jsonb_build_object(
                        'consecutive_failures', 0,
                        'auto_disabled_at',     to_jsonb(now()),
                        'auto_disabled_reason', to_jsonb(p_error)
                      ),
           updated_at = now()
     WHERE key = 'invite_delivery_health';

    v_tripped := true;
  END IF;

  RETURN jsonb_build_object(
    'tripped',              v_tripped,
    'consecutive_failures', CASE WHEN v_tripped THEN 0 ELSE v_failures END,
    'threshold',            p_threshold
  );
END;
$$;

-- Clears the failure streak after a successful delivery, so three
-- failures spread across months never add up to a trip.
CREATE OR REPLACE FUNCTION public.reset_invite_delivery_failures()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE platform_settings
     SET value = value || jsonb_build_object('consecutive_failures', 0),
         updated_at = now()
   WHERE key = 'invite_delivery_health'
     AND COALESCE((value ->> 'consecutive_failures')::int, 0) <> 0;
END;
$$;

-- Server-side only. These mutate a platform-wide switch, so no
-- browser-facing role may call them.
REVOKE ALL ON FUNCTION public.record_invite_delivery_failure(text, int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_invite_delivery_failures()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_invite_delivery_failure(text, int)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_invite_delivery_failures()
  TO service_role;

COMMENT ON FUNCTION public.record_invite_delivery_failure(text, int) IS
  'Counts consecutive invite-email failures; flips invite_delivery_mode to link_only once the threshold is reached. Service-role only.';
