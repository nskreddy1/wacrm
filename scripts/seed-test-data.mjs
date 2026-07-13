import pg from 'pg'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

const { Client } = pg
const connectionString =
  process.env.SUPABASE_DB_URL ??
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.zepo_SUPABASE_SERVICE_ROLE_KEY ??
  process.env.zepo_SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Supabase URL and service-role credentials are required to seed an authenticated user')
}

const client = new Client({ connectionString })
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function run() {
  await client.connect()
  console.log('Connected!')

  console.log('Seeding authenticated test user through Supabase Auth...')
  const user_id = 'e3bfb053-4f5b-4439-8093-7092b5c0909d'
  const email = 'admin@example.com'
  const password = 'password123'

  // Auth users must be created through GoTrue. Writing auth.users directly omits
  // provider identities and other Auth-managed fields, which makes password login fail.
  const existingAuthUser = await client.query(
    'SELECT id FROM auth.users WHERE id = $1 OR lower(email) = $2 LIMIT 1',
    [user_id, email],
  )

  if (existingAuthUser.rows.length > 0) {
    // Older versions wrote auth.users directly. Remove the malformed user and its
    // generated application profile so GoTrue can recreate both consistently.
    await client.query('DELETE FROM public.profiles WHERE user_id = $1', [user_id])
    await client.query('DELETE FROM public.accounts WHERE owner_user_id = $1', [user_id])
    await client.query('DELETE FROM auth.users WHERE id = $1', [user_id])
  }

  const { data: createdUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
    id: user_id,
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Test Administrator' },
  })
  if (createUserError) throw createUserError
  if (createdUser.user.id !== user_id) throw new Error('Supabase Auth created an unexpected user ID')

  console.log('Retrieving account_id from profiles...')
  // Wait a short bit or query immediately because trigger runs synchronously in the transaction
  const profileRes = await client.query('SELECT account_id FROM public.profiles WHERE user_id = $1', [user_id])
  if (profileRes.rows.length === 0) {
    throw new Error('Trigger handle_new_user failed to create a profile')
  }
  const account_id = profileRes.rows[0].account_id
  console.log(`Associated Account ID: ${account_id}`)

  console.log('Updating Account Name to "Test Company"...')
  await client.query('UPDATE public.accounts SET name = $1 WHERE id = $2', ['Test Company', account_id])

  // Clean old operational records for this account to allow re-run
  console.log('Cleaning existing operational data for this account...')
  await client.query('DELETE FROM public.notifications WHERE account_id = $1', [account_id])
  await client.query('DELETE FROM public.deals WHERE user_id = $1', [user_id])
  await client.query('DELETE FROM public.pipeline_stages WHERE pipeline_id IN (SELECT id FROM public.pipelines WHERE user_id = $1)', [user_id])
  await client.query('DELETE FROM public.pipelines WHERE user_id = $1', [user_id])
  await client.query('DELETE FROM public.messages WHERE conversation_id IN (SELECT id FROM public.conversations WHERE account_id = $1)', [account_id])
  await client.query('DELETE FROM public.conversations WHERE account_id = $1', [account_id])
  await client.query('DELETE FROM public.contact_custom_values WHERE contact_id IN (SELECT id FROM public.contacts WHERE account_id = $1)', [account_id])
  await client.query('DELETE FROM public.contact_tags WHERE contact_id IN (SELECT id FROM public.contacts WHERE account_id = $1)', [account_id])
  await client.query('DELETE FROM public.contact_notes WHERE contact_id IN (SELECT id FROM public.contacts WHERE account_id = $1)', [account_id])
  await client.query('DELETE FROM public.contact_identities WHERE account_id = $1', [account_id])
  await client.query('DELETE FROM public.contacts WHERE account_id = $1', [account_id])
  await client.query('DELETE FROM public.tags WHERE account_id = $1', [account_id])
  await client.query('DELETE FROM public.custom_fields WHERE account_id = $1', [account_id])
  await client.query('DELETE FROM public.channel_connections WHERE account_id = $1', [account_id])
  await client.query('DELETE FROM public.message_templates WHERE account_id = $1', [account_id])
  await client.query('DELETE FROM public.broadcasts WHERE account_id = $1', [account_id])
  await client.query('DELETE FROM public.automations WHERE account_id = $1', [account_id])
  await client.query('DELETE FROM public.flows WHERE account_id = $1', [account_id])
  await client.query('DELETE FROM public.ai_configs WHERE account_id = $1', [account_id])
  await client.query('DELETE FROM public.ai_knowledge_documents WHERE account_id = $1', [account_id])

  console.log('Seeding channel_connections...')
  const waConnId = 'a1111111-1111-4111-8111-111111111111'
  const emailConnId = 'e2222222-2222-4222-8222-222222222222'

  await client.query(`
    INSERT INTO public.channel_connections (
      id, account_id, created_by_user_id, channel, provider, display_name,
      external_identity, status, is_enabled, is_primary
    ) VALUES 
    ($1, $2, $3, 'whatsapp', 'meta', 'Primary WhatsApp', '+15550199', 'connected', TRUE, TRUE),
    ($4, $2, $3, 'email', 'resend', 'Company Support Email', 'support@testcompany.com', 'connected', TRUE, TRUE)
  `, [waConnId, account_id, user_id, emailConnId])

  console.log('Seeding tags...')
  const tagWarmId = '33333333-3333-4333-8333-333333333333'
  const tagVIPId = '44444444-4444-4444-8444-444444444444'
  const tagUnsubId = '55555555-5555-4555-8555-555555555555'

  await client.query(`
    INSERT INTO public.tags (id, account_id, user_id, name, color) VALUES
    ($1, $2, $3, 'Warm Lead', '#f97316'),
    ($4, $2, $3, 'VIP Client', '#a855f7'),
    ($5, $2, $3, 'Unsubscribed', '#ef4444')
  `, [tagWarmId, account_id, user_id, tagVIPId, tagUnsubId])

  console.log('Seeding custom fields...')
  const customFieldIndustryId = '66666666-6666-4666-8666-666666666666'
  await client.query(`
    INSERT INTO public.custom_fields (id, account_id, user_id, field_name, field_type)
    VALUES ($1, $2, $3, 'Industry', 'text')
  `, [customFieldIndustryId, account_id, user_id])

  console.log('Seeding contacts...')
  const contactJohnId = '77777777-7777-4777-8777-777777777777'
  const contactJaneId = '88888888-8888-4888-8888-888888888888'

  await client.query(`
    INSERT INTO public.contacts (id, account_id, user_id, name, email, phone, company) VALUES
    ($1, $2, $3, 'John Doe', 'john@example.com', '+15551234', 'Acme Corp'),
    ($4, $2, $3, 'Jane Smith', 'jane@example.com', '+15555678', 'Global Industries')
  `, [contactJohnId, account_id, user_id, contactJaneId])

  console.log('Seeding contact identities...')
  await client.query(`
    INSERT INTO public.contact_identities (account_id, contact_id, channel, identity, normalized_identity, is_primary) VALUES
    ($1, $2, 'whatsapp', '+15551234', '+15551234', TRUE),
    ($1, $2, 'email', 'john@example.com', 'john@example.com', FALSE),
    ($1, $3, 'whatsapp', '+15555678', '+15555678', TRUE),
    ($1, $3, 'email', 'jane@example.com', 'jane@example.com', FALSE)
  `, [account_id, contactJohnId, contactJaneId])

  console.log('Seeding contact custom values and notes...')
  await client.query(`
    INSERT INTO public.contact_custom_values (contact_id, custom_field_id, value) VALUES
    ($1, $2, 'Manufacturing'),
    ($3, $2, 'Retail')
  `, [contactJohnId, customFieldIndustryId, contactJaneId])

  await client.query(`
    INSERT INTO public.contact_notes (contact_id, user_id, account_id, note_text) VALUES
    ($1, $2, $3, 'Met John at the Trade Fair 2026. Very interested in our visual automation tools.'),
    ($4, $2, $3, 'Jane prefers updates via email. She handles retail operations globally.')
  `, [contactJohnId, user_id, account_id, contactJaneId])

  console.log('Seeding contact tags mapping...')
  await client.query(`
    INSERT INTO public.contact_tags (contact_id, tag_id) VALUES
    ($1, $2),
    ($3, $4)
  `, [contactJohnId, tagWarmId, contactJaneId, tagVIPId])

  console.log('Seeding conversations...')
  const convJohnId = '99999999-9999-4999-8999-999999999999'
  const convJaneId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'

  await client.query(`
    INSERT INTO public.conversations (
      id, account_id, user_id, contact_id, status, assigned_agent_id, 
      last_message_text, last_message_at, unread_count, channel, channel_connection_id
    ) VALUES
    ($1, $2, $3, $4, 'open', $3, 'I would love to get a demo tomorrow.', NOW() - INTERVAL '1 hour', 1, 'whatsapp', $5),
    ($6, $2, $3, $7, 'open', $3, 'Thank you! The proposal looks perfect.', NOW(), 0, 'email', $8)
  `, [convJohnId, account_id, user_id, contactJohnId, waConnId, convJaneId, contactJaneId, emailConnId])

  console.log('Seeding messages...')
  await client.query(`
    INSERT INTO public.messages (
      conversation_id, sender_type, sender_id, content_type, content_text, 
      status, created_at, channel_connection_id
    ) VALUES
    ($1, 'customer', NULL, 'text', 'Hello, interested in your services.', 'read', NOW() - INTERVAL '2 hours', $3),
    ($1, 'agent', $2, 'text', 'Hi John! Glad to connect. What kind of crm services do you need?', 'delivered', NOW() - INTERVAL '1.5 hours', $3),
    ($1, 'customer', NULL, 'text', 'I would love to get a demo tomorrow.', 'sent', NOW() - INTERVAL '1 hour', $3),
    ($4, 'agent', $2, 'text', 'Hi Jane, sending over our customized proposal for Global Industries.', 'delivered', NOW() - INTERVAL '30 minutes', $5),
    ($4, 'customer', NULL, 'text', 'Thank you! The proposal looks perfect.', 'read', NOW(), $5)
  `, [convJohnId, user_id, waConnId, convJaneId, emailConnId])

  console.log('Seeding pipelines...')
  const pipelineId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
  await client.query(`
    INSERT INTO public.pipelines (id, account_id, user_id, name)
    VALUES ($1, $2, $3, 'Sales Pipeline')
  `, [pipelineId, account_id, user_id])

  console.log('Seeding pipeline stages...')
  const stageLeadInId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const stageContactedId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const stageProposalId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const stageWonId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

  await client.query(`
    INSERT INTO public.pipeline_stages (id, pipeline_id, name, position, color) VALUES
    ($1, $2, 'Lead In', 0, '#3b82f6'),
    ($3, $2, 'Contacted', 1, '#10b981'),
    ($4, $2, 'Proposal Sent', 2, '#f59e0b'),
    ($5, $2, 'Closed Won', 3, '#10b981')
  `, [stageLeadInId, pipelineId, stageContactedId, stageProposalId, stageWonId])

  console.log('Seeding deals...')
  await client.query(`
    INSERT INTO public.deals (
      account_id, user_id, pipeline_id, stage_id, contact_id, 
      conversation_id, title, value, currency, status, expected_close_date
    ) VALUES
    ($1, $2, $3, $4, $5, $6, 'Acme Corp Partnership', 15000.00, 'USD', 'open', CURRENT_DATE + 30),
    ($1, $2, $3, $7, $8, $9, 'Global Industries Contract', 45000.00, 'USD', 'open', CURRENT_DATE + 15)
  `, [
    account_id, user_id, pipelineId, stageContactedId, contactJohnId, convJohnId,
    stageProposalId, contactJaneId, convJaneId
  ])

  console.log('Seeding message templates...')
  await client.query(`
    INSERT INTO public.message_templates (
      account_id, user_id, name, category, language, body_text, status
    ) VALUES
    ($1, $2, 'welcome_message', 'Utility', 'en_US', 'Hi {{1}}, welcome to Test Company! Let us know how we can help.', 'APPROVED'),
    ($1, $2, 'promo_offer', 'Marketing', 'en_US', 'Super summer deals are here! Enjoy 20% off all plans today only.', 'APPROVED')
  `, [account_id, user_id])

  console.log('Seeding broadcasts...')
  const broadcastId = 'd1111111-1111-4111-8111-111111111111'
  await client.query(`
    INSERT INTO public.broadcasts (
      id, account_id, user_id, name, template_name, scheduled_at, status,
      total_recipients, sent_count, delivered_count, read_count
    ) VALUES
    ($1, $2, $3, 'Summer Campaign', 'promo_offer', NOW() - INTERVAL '1 day', 'sent', 2, 2, 2, 1)
  `, [broadcastId, account_id, user_id])

  await client.query(`
    INSERT INTO public.broadcast_recipients (broadcast_id, contact_id, status, sent_at, delivered_at, read_at) VALUES
    ($1, $2, 'read', NOW() - INTERVAL '23 hours', NOW() - INTERVAL '23 hours', NOW() - INTERVAL '22 hours'),
    ($1, $3, 'delivered', NOW() - INTERVAL '23 hours', NOW() - INTERVAL '23 hours', NULL)
  `, [broadcastId, contactJohnId, contactJaneId])

  console.log('Seeding automations...')
  const autoId = 'd2222222-2222-4222-8222-222222222222'
  await client.query(`
    INSERT INTO public.automations (id, account_id, user_id, name, trigger_type, is_active)
    VALUES ($1, $2, $3, 'Inbound Auto-Reply', 'message_received', TRUE)
  `, [autoId, account_id, user_id])

  await client.query(`
    INSERT INTO public.automation_steps (automation_id, step_type, position, step_config) VALUES
    ($1, 'condition', 0, '{"field": "sender", "operator": "equals", "value": "customer"}'::jsonb),
    ($1, 'send_message', 1, '{"message_text": "Thank you for reaching out! A representative will connect with you shortly."}'::jsonb)
  `, [autoId])

  console.log('Seeding flows...')
  const flowId = 'f1111111-1111-4111-8111-111111111111'
  await client.query(`
    INSERT INTO public.flows (id, account_id, user_id, name, trigger_type, status)
    VALUES ($1, $2, $3, 'Customer Onboarding Flow', 'manual', 'active')
  `, [flowId, account_id, user_id])

  await client.query(`
    INSERT INTO public.flow_nodes (flow_id, node_key, node_type, position_x, position_y, config) VALUES
    ($1, 'start-1', 'start', 100, 100, '{}'::jsonb),
    ($1, 'message-1', 'send_message', 100, 250, '{"text": "Welcome to our onboarding flow!"}'::jsonb),
    ($1, 'end-1', 'end', 100, 400, '{}'::jsonb)
  `, [flowId])

  console.log('Seeding AI config...')
  await client.query(`
    INSERT INTO public.ai_configs (account_id, is_active, provider, model, api_key, auto_reply_max_per_conversation)
    VALUES ($1, TRUE, 'openai', 'gpt-4o', 'dummy-openai-key-value', 10)
    ON CONFLICT (account_id) DO UPDATE SET is_active = TRUE
  `, [account_id])

  console.log('Seeding AI knowledge...')
  await client.query(`
    INSERT INTO public.ai_knowledge_documents (account_id, title, content)
    VALUES ($1, 'Company FAQs', 'We are open 9am to 6pm. We build advanced sales CRM tools. Support is at support@testcompany.com.')
  `, [account_id])

  console.log('Seeding notifications...')
  await client.query(`
    INSERT INTO public.notifications (account_id, user_id, title, body, type, read_at)
    VALUES 
    ($1, $2, 'New Deal Created', 'Acme Corp Partnership deal has been added to sales pipeline.', 'conversation_assigned', NULL),
    ($1, $2, 'Message Received', 'Jane Smith replied to Company Support Email.', 'customer_replied', NOW())
  `, [account_id, user_id])

  console.log('Seeding completed successfully!')
}

run()
  .catch((err) => {
    console.error('Seeding failed with error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    client.end().catch(() => undefined)
  })
