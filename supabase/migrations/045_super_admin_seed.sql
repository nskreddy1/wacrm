-- ============================================================
-- 045_super_admin_seed.sql — platform_role on profiles + seeded
-- super-admin account.
--
-- 1. Adds `platform_role` to profiles ('user' | 'super_admin').
--    This is the platform-level (cross-account) role axis — distinct
--    from `account_role`, which is scoped to one workspace. Future
--    phases can extend the CHECK with more platform roles.
--
-- 2. Seeds one hardcoded super-admin auth user so `npm run db:push`
--    always leaves the platform with a working operator login:
--
--      email:    admin@wacrm.app
--      password: Admin@12345   (change it after first login!)
--
--    The INSERT into auth.users fires the existing
--    `on_auth_user_created` trigger, which bootstraps the personal
--    account + profiles row; we then promote that profile to
--    platform_role = 'super_admin'.
--
-- Idempotent — safe to run multiple times (skips the seed when the
-- email already exists, and re-promotion is a no-op UPDATE).
-- ============================================================

-- ------------------------------------------------------------
-- 1. platform_role column
-- ------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS platform_role TEXT NOT NULL DEFAULT 'user';

DO $$
BEGIN
  ALTER TABLE profiles
    ADD CONSTRAINT profiles_platform_role_check
    CHECK (platform_role IN ('user', 'super_admin'));
EXCEPTION WHEN duplicate_object THEN
  NULL; -- constraint already exists
END $$;

-- Partial index: platform-role lookups only ever filter on the rare
-- non-default values, so don't index the millions of 'user' rows.
CREATE INDEX IF NOT EXISTS idx_profiles_platform_role
  ON profiles (platform_role)
  WHERE platform_role <> 'user';

-- ------------------------------------------------------------
-- 2. Seed the super-admin auth user
-- ------------------------------------------------------------
DO $$
DECLARE
  v_email TEXT := 'admin@wacrm.app';
  v_password TEXT := 'Admin@12345';
  v_user_id UUID;
BEGIN
  -- pgcrypto's crypt()/gen_salt() live in the `extensions` schema on
  -- hosted Supabase; make them resolvable for this block only.
  PERFORM set_config('search_path', 'public, extensions', true);

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = v_email;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    -- Mirrors what GoTrue writes on email/password signup. The empty-
    -- string token columns matter: GoTrue scans them as non-null text
    -- and NULLs break login with "converting NULL to string" errors.
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token,
      email_change, email_change_token_new, email_change_token_current
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      crypt(v_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Platform Admin"}'::jsonb,
      now(), now(),
      '', '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, provider, identity_data,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_user_id::text,
      'email',
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_email,
        'email_verified', true,
        'phone_verified', false
      ),
      now(), now(), now()
    );
  END IF;

  -- Promote the (trigger-created) profile. Runs on every push so a
  -- demoted-by-accident admin is restored by re-running db:push.
  UPDATE public.profiles
  SET platform_role = 'super_admin'
  WHERE user_id = v_user_id;
END $$;
