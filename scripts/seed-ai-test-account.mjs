// ============================================================
// Hardcoded end-to-end test account for the multi-bot AI feature.
//
// TEMPORARY — delete this script (and the account) once the feature
// ships. Idempotent: safe to re-run; it upserts rather than duplicates.
//
// Run with:
//   node --env-file-if-exists=/vercel/share/.env.project scripts/seed-ai-test-account.mjs
//
// Credentials (hardcoded on purpose, per feature-testing plan):
//   email:    ai-tester@wacrm.test
//   password: TestAI!2345
// ============================================================

import { createClient } from '@supabase/supabase-js';

const EMAIL = 'ai-tester@wacrm.test';
const PASSWORD = 'TestAI!2345';
const FULL_NAME = 'AI Feature Tester';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email) {
  // listUsers is paginated; the test project is small so page 1 suffices,
  // but loop anyway to be safe.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const hit = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  // ---- 1. Auth user (signup trigger provisions account + profile) ----
  let user = await findUserByEmail(EMAIL);
  if (user) {
    console.log(`[seed] user exists: ${user.id}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: FULL_NAME },
    });
    if (error) throw error;
    user = data.user;
    console.log(`[seed] created user: ${user.id}`);
  }

  // ---- 2. Resolve the account the trigger created ----
  const { data: profile, error: profErr } = await admin
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profErr) throw profErr;
  if (!profile?.account_id) {
    throw new Error(
      'Profile has no account_id — signup trigger may have failed. Check DB logs.',
    );
  }
  const accountId = profile.account_id;
  console.log(`[seed] account: ${accountId}`);

  // ---- 3. Bots: one active concierge + one inactive after-hours bot ----
  const bots = [
    {
      name: 'Concierge',
      emoji: '🛎️',
      description: 'Friendly general-purpose assistant (active bot).',
      system_prompt:
        'You are the virtual concierge for our business. Answer customer questions helpfully and concisely. If you do not know the answer, say so and offer to connect the customer with a human teammate.',
      tone: 'friendly',
      greeting_message: 'Hi! I am the automated concierge — happy to help.',
      is_active: true,
      use_knowledge_base: true,
      template_key: null,
    },
    {
      name: 'After-hours',
      emoji: '🌙',
      description: 'Night-shift bot with working hours + away message.',
      system_prompt:
        'You are the after-hours assistant. Keep answers short. Collect the customer name and question so the day team can follow up.',
      tone: 'professional',
      greeting_message: null,
      is_active: false,
      use_knowledge_base: false,
      outside_hours_behavior: 'away_message',
      away_message:
        'Thanks for reaching out! We are currently closed — we will reply first thing tomorrow.',
      working_hours: {
        timezone: 'UTC',
        days: {
          mon: { start: '09:00', end: '17:00' },
          tue: { start: '09:00', end: '17:00' },
          wed: { start: '09:00', end: '17:00' },
          thu: { start: '09:00', end: '17:00' },
          fri: { start: '09:00', end: '17:00' },
          sat: null,
          sun: null,
        },
      },
      template_key: null,
    },
  ];

  for (const bot of bots) {
    const { data: existing } = await admin
      .from('ai_bots')
      .select('id')
      .eq('account_id', accountId)
      .eq('name', bot.name)
      .maybeSingle();
    if (existing) {
      console.log(`[seed] bot "${bot.name}" exists: ${existing.id}`);
      continue;
    }
    const { data, error } = await admin
      .from('ai_bots')
      .insert({ ...bot, account_id: accountId, created_by: user.id })
      .select('id')
      .single();
    if (error) throw error;
    console.log(`[seed] created bot "${bot.name}": ${data.id}`);
  }

  // ---- 4. A pending support request so the admin page has data ----
  const { data: existingReq } = await admin
    .from('ai_support_requests')
    .select('id')
    .eq('account_id', accountId)
    .limit(1)
    .maybeSingle();
  if (existingReq) {
    console.log(`[seed] support request exists: ${existingReq.id}`);
  } else {
    const { data, error } = await admin
      .from('ai_support_requests')
      .insert({
        account_id: accountId,
        user_id: user.id,
        topic: 'setup_bot',
        message:
          'Seeded test request: please help us configure a booking bot for our salon. We want it to answer pricing questions and collect appointment requests.',
        contact_info: EMAIL,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw error;
    console.log(`[seed] created support request: ${data.id}`);
  }

  console.log('\n[seed] done. Log in with:');
  console.log(`  email:    ${EMAIL}`);
  console.log(`  password: ${PASSWORD}`);
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
