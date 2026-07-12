-- ============================================================
-- 037_default_admin_account.sql — Create a default admin account
-- 
-- This migration creates a default admin account for initial setup.
-- Email: admin@wacrm.local
-- Password: AdminPass123!
-- 
-- This is idempotent — if the account already exists, it skips creation.
-- ============================================================

DO $$
DECLARE
  v_user_id UUID;
  v_account_id UUID;
BEGIN
  -- Check if admin user already exists
  SELECT id INTO v_user_id FROM auth.users 
  WHERE email = 'admin@wacrm.local' 
  LIMIT 1;

  -- If admin user doesn't exist, create it
  IF v_user_id IS NULL THEN
    -- Create the auth user with a hashed password
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_user_meta_data,
      created_at,
      updated_at,
      aud,
      role,
      is_super_admin
    )
    VALUES (
      gen_random_uuid(),
      '00000000-0000-0000-0000-000000000000',
      'admin@wacrm.local',
      crypt('AdminPass123!', gen_salt('bf')),
      NOW(),
      jsonb_build_object('full_name', 'Admin User'),
      NOW(),
      NOW(),
      'authenticated',
      'authenticated',
      false
    )
    RETURNING id INTO v_user_id;

    -- Get the newly created user's ID and check if profile exists
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = v_user_id) THEN
      -- Create profile for the new user
      INSERT INTO profiles (user_id, full_name, email)
      VALUES (v_user_id, 'Admin User', 'admin@wacrm.local');
    END IF;

    -- Get or create account for the admin user
    SELECT account_id INTO v_account_id FROM profiles WHERE user_id = v_user_id;
    
    IF v_account_id IS NULL THEN
      -- Create account if it doesn't exist
      INSERT INTO accounts (name, owner_user_id)
      VALUES ('Admin Account', v_user_id)
      RETURNING id INTO v_account_id;

      -- Update profile with account_id and role
      UPDATE profiles 
      SET account_id = v_account_id, 
          account_role = 'admin'::account_role_enum
      WHERE user_id = v_user_id;
    END IF;
  END IF;

END $$;
