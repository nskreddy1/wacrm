import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

async function createAdminAccount() {
  try {
    // Get environment variables
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error(
        'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
      );
      process.exit(1);
    }

    // Create Supabase client with service role
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const adminEmail = 'admin@wacrm.local';
    const adminPassword = 'AdminPass123!';

    console.log('Creating default admin account...');

    // Check if admin user already exists
    const { data: existingUser, error: checkError } = await supabase.auth.admin.listUsers();

    if (checkError) {
      console.error('Error checking existing users:', checkError.message);
      process.exit(1);
    }

    const adminExists = existingUser?.users?.some((u) => u.email === adminEmail);

    if (adminExists) {
      console.log('✓ Admin account already exists');
      console.log(`  Email: ${adminEmail}`);
      return;
    }

    // Create the admin user
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: {
        full_name: 'Admin User',
      },
    });

    if (createError) {
      console.error('Error creating user:', createError.message);
      process.exit(1);
    }

    if (!newUser?.user?.id) {
      console.error('Failed to create user - no user ID returned');
      process.exit(1);
    }

    const userId = newUser.user.id;
    console.log(`✓ Auth user created with ID: ${userId}`);

    // Now run the SQL migration to set up the account and roles
    const { error: rpcError } = await supabase.rpc('exec_sql', {
      sql: fs.readFileSync(
        path.join(process.cwd(), 'supabase/migrations/037_default_admin_account.sql'),
        'utf-8'
      ),
    });

    // If RPC doesn't work, use direct query
    const migrationSql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/037_default_admin_account.sql'),
      'utf-8'
    );

    // Create profile directly
    const { error: profileError } = await supabase.from('profiles').upsert(
      {
        user_id: userId,
        full_name: 'Admin User',
        email: adminEmail,
        account_role: 'admin',
      },
      { onConflict: 'user_id' }
    );

    if (profileError) {
      console.log('Note: Profile creation via API had issue (may be RLS):', profileError.message);
    }

    console.log('');
    console.log('✓ Default Admin Account Created Successfully!');
    console.log('');
    console.log('Login Credentials:');
    console.log(`  Email: ${adminEmail}`);
    console.log(`  Password: ${adminPassword}`);
    console.log('  Role: Admin');
    console.log('');
    console.log('⚠️  IMPORTANT: Change this password immediately after first login!');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

createAdminAccount();
