# Live database structure — full reference

Introspected from the live Supabase Postgres (`information_schema` +
`pg_indexes` + `pg_policies`). **77 tables** in schema `public`.

This is the authoritative column-level reference: every table below
lists its columns with exact Postgres types, nullability, defaults,
foreign keys with their ON DELETE behaviour, every index with its
full `CREATE INDEX` statement, check constraints, and all RLS
policies with their USING / WITH CHECK expressions.

Read `database.md` first for the conceptual model (domains, tenancy
rules, key relationships). Come here when you need the exact shape
of a table before writing a query or a migration.

Regenerate after schema changes by introspecting the live database
again, then update `database.md` if the conceptual model changed.

## Enum types

- `account_role_enum`: owner, admin, agent, viewer
- `channel_connection_status`: draft, connected, degraded, disconnected
- `channel_kind`: whatsapp, email, sms
- `channel_provider`: meta, twilio, google, resend, smtp, microsoft

## Tables

### account_domains

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| account_id | uuid | no | — |
| domain | text | no | — |
| verified | boolean | no | `false` |
| verified_at | timestamp with time zone | yes | — |
| verification_token | text | no | `encode(gen_random_bytes(16), 'hex'::text)` |
| auto_join_enabled | boolean | no | `true` |
| default_workspace_profile_id | uuid | yes | — |
| default_workspace_role_id | uuid | yes | — |
| created_by_user_id | uuid | yes | — |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `default_workspace_profile_id` → `workspace_profiles.id` (on delete set null)
- `default_workspace_role_id` → `workspace_roles.id` (on delete set null)

Indexes:
- `account_domains_domain_key`: CREATE UNIQUE INDEX account_domains_domain_key ON public.account_domains USING btree (domain)
- `account_domains_pkey`: CREATE UNIQUE INDEX account_domains_pkey ON public.account_domains USING btree (id)
- `idx_account_domains_account`: CREATE INDEX idx_account_domains_account ON public.account_domains USING btree (account_id)
- `idx_account_domains_verified`: CREATE INDEX idx_account_domains_verified ON public.account_domains USING btree (domain) WHERE ((verified_at IS NOT NULL) AND auto_join_enabled)

Check constraints:
- `account_domains_domain_check`: CHECK (((domain = lower(domain)) AND (domain ~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$'::text)))

RLS policies:
- `account_domains_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `account_domains_insert` (INSERT, roles {public})
  - WITH CHECK: (is_account_member(account_id, 'admin'::account_role_enum) AND (domain <> ALL (ARRAY['gmail.com'::text, 'googlemail.com'::text, 'yahoo.com'::text, 'yahoo.co.in'::text, 'outlook.com'::text, 'hotmail.com'::text, 'live.com'::text, 'msn.com'::text, 'icloud.com'::text, 'me.com'::text, 'aol.com'::text, 'proton.me'::text, 'protonmail.com'::text, 'zoho.com'::text, 'zohomail.in'::text, 'gmx.com'::text, 'mail.com'::text, 'yandex.com'::text, 'rediffmail.com'::text])))
- `account_domains_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `account_domains_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
  - WITH CHECK: (is_account_member(account_id, 'admin'::account_role_enum) AND (verified = ( SELECT ad.verified
   FROM account_domains ad
  WHERE (ad.id = account_domains.id))))

### account_email_settings

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| account_id | uuid | no | — |
| provider | text | no | — |
| from_email | text | no | — |
| from_name | text | yes | — |
| credentials_encrypted | text | no | — |
| last_test_at | timestamp with time zone | yes | — |
| last_test_ok | boolean | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `account_email_settings_pkey`: CREATE UNIQUE INDEX account_email_settings_pkey ON public.account_email_settings USING btree (account_id)

Check constraints:
- `account_email_settings_provider_check`: CHECK ((provider = ANY (ARRAY['smtp'::text, 'resend'::text, 'msg91'::text])))

RLS policies:
- `account_email_settings_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `account_email_settings_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `account_email_settings_select` (SELECT, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `account_email_settings_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)

### account_invitations

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| account_id | uuid | no | — |
| token_hash | text | no | — |
| role | account_role_enum | no | — |
| created_by_user_id | uuid | yes | — |
| label | text | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| expires_at | timestamp with time zone | no | — |
| accepted_at | timestamp with time zone | yes | — |
| accepted_by_user_id | uuid | yes | — |
| invited_email | text | yes | — |
| invited_first_name | text | yes | — |
| invited_last_name | text | yes | — |
| workspace_role_id | uuid | yes | — |
| workspace_profile_id | uuid | yes | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `workspace_profile_id` → `workspace_profiles.id` (on delete set null)
- `workspace_role_id` → `workspace_roles.id` (on delete set null)

Indexes:
- `account_invitations_pkey`: CREATE UNIQUE INDEX account_invitations_pkey ON public.account_invitations USING btree (id)
- `account_invitations_token_hash_key`: CREATE UNIQUE INDEX account_invitations_token_hash_key ON public.account_invitations USING btree (token_hash)
- `idx_account_invitations_account_pending`: CREATE INDEX idx_account_invitations_account_pending ON public.account_invitations USING btree (account_id, expires_at) WHERE (accepted_at IS NULL)

Check constraints:
- `account_invitations_invited_email_check`: CHECK (((invited_email IS NULL) OR (char_length(invited_email) <= 320)))
- `account_invitations_invited_first_name_check`: CHECK (((invited_first_name IS NULL) OR (char_length(invited_first_name) <= 80)))
- `account_invitations_invited_last_name_check`: CHECK (((invited_last_name IS NULL) OR (char_length(invited_last_name) <= 80)))
- `account_invitations_role_check`: CHECK ((role <> 'owner'::account_role_enum))

RLS policies:
- `account_invitations_modify` (ALL, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `account_invitations_select` (SELECT, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

### account_provisioned_templates

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| account_id | uuid | no | — |
| template_id | uuid | no | — |
| version | integer | no | — |
| provisioned_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `template_id` → `workspace_templates.id` (on delete cascade)

Indexes:
- `account_provisioned_templates_pkey`: CREATE UNIQUE INDEX account_provisioned_templates_pkey ON public.account_provisioned_templates USING btree (account_id, template_id)

RLS policies:
- `account_provisioned_templates_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)

### accounts

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| name | text | no | — |
| owner_user_id | uuid | no | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |
| default_currency | text | no | `'USD'::text` |

Indexes:
- `accounts_pkey`: CREATE UNIQUE INDEX accounts_pkey ON public.accounts USING btree (id)
- `idx_accounts_one_per_owner`: CREATE UNIQUE INDEX idx_accounts_one_per_owner ON public.accounts USING btree (owner_user_id)

Check constraints:
- `accounts_default_currency_format`: CHECK ((default_currency ~ '^[A-Z]{3}$'::text))

RLS policies:
- `accounts_select` (SELECT, roles {public})
  - USING: is_account_member(id)
- `accounts_update` (UPDATE, roles {public})
  - USING: is_account_member(id, 'admin'::account_role_enum)
  - WITH CHECK: is_account_member(id, 'admin'::account_role_enum)

Triggers:
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### ai_agents

RLS: enabled · approx rows: 1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| created_by | uuid | yes | — |
| kind | text | no | — |
| display_name | text | no | — |
| provider | text | yes | — |
| model | text | yes | — |
| api_key | text | yes | — |
| base_url | text | yes | — |
| system_prompt | text | yes | — |
| is_enabled | boolean | no | `false` |
| settings | jsonb | no | `'{}'::jsonb` |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |
| suggestions_enabled | boolean | no | `false` |
| autoreply_enabled | boolean | no | `false` |
| route_description | text | yes | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `ai_agents_account_default_uniq`: CREATE UNIQUE INDEX ai_agents_account_default_uniq ON public.ai_agents USING btree (account_id) WHERE (kind = 'default'::text)
- `ai_agents_pkey`: CREATE UNIQUE INDEX ai_agents_pkey ON public.ai_agents USING btree (id)
- `idx_ai_agents_account_custom`: CREATE INDEX idx_ai_agents_account_custom ON public.ai_agents USING btree (account_id) WHERE (kind = 'custom'::text)

Check constraints:
- `ai_agents_kind_check`: CHECK ((kind = ANY (ARRAY['default'::text, 'custom'::text])))
- `ai_agents_provider_check`: CHECK ((provider = ANY (ARRAY['openai'::text, 'anthropic'::text, 'gemini'::text, 'nvidia'::text, 'groq'::text, 'openrouter'::text, 'together'::text, 'mistral'::text, 'deepseek'::text, 'xai'::text, 'ollama'::text, 'custom'::text])))

RLS policies:
- `ai_agents_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `ai_agents_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `ai_agents_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `ai_agents_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

Triggers:
- `ai_agents_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_ai_agents_updated_at()

### ai_bot_templates

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| key | text | no | — |
| name | text | no | — |
| description | text | yes | — |
| emoji | text | yes | — |
| category | text | no | `'general'::text` |
| system_prompt | text | no | — |
| tone | text | no | `'friendly'::text` |
| greeting_message | text | yes | — |
| sort_order | integer | no | `0` |
| is_published | boolean | no | `true` |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Indexes:
- `ai_bot_templates_key_key`: CREATE UNIQUE INDEX ai_bot_templates_key_key ON public.ai_bot_templates USING btree (key)
- `ai_bot_templates_pkey`: CREATE UNIQUE INDEX ai_bot_templates_pkey ON public.ai_bot_templates USING btree (id)

Check constraints:
- `ai_bot_templates_tone_check`: CHECK ((tone = ANY (ARRAY['professional'::text, 'friendly'::text, 'casual'::text, 'formal'::text, 'playful'::text])))

RLS policies:
- `ai_bot_templates_select` (SELECT, roles {public})
  - USING: ((auth.uid() IS NOT NULL) AND is_published)

Triggers:
- `ai_bot_templates_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_ai_bot_templates_updated_at()

### ai_bots

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| created_by | uuid | yes | — |
| name | text | no | — |
| description | text | yes | — |
| emoji | text | yes | — |
| system_prompt | text | no | — |
| tone | text | no | `'friendly'::text` |
| language | text | no | `'auto'::text` |
| greeting_message | text | yes | — |
| temperature | numeric | yes | — |
| model_override | text | yes | — |
| auto_reply_max_per_conversation | integer | yes | — |
| handoff_agent_id | uuid | yes | — |
| working_hours | jsonb | yes | — |
| outside_hours_behavior | text | no | `'silent'::text` |
| away_message | text | yes | — |
| use_knowledge_base | boolean | no | `true` |
| is_active | boolean | no | `false` |
| template_key | text | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `ai_bots_account_idx`: CREATE INDEX ai_bots_account_idx ON public.ai_bots USING btree (account_id)
- `ai_bots_one_active_per_account`: CREATE UNIQUE INDEX ai_bots_one_active_per_account ON public.ai_bots USING btree (account_id) WHERE is_active
- `ai_bots_pkey`: CREATE UNIQUE INDEX ai_bots_pkey ON public.ai_bots USING btree (id)

Check constraints:
- `ai_bots_auto_reply_max_per_conversation_check`: CHECK (((auto_reply_max_per_conversation IS NULL) OR ((auto_reply_max_per_conversation >= 1) AND (auto_reply_max_per_conversation <= 20))))
- `ai_bots_outside_hours_behavior_check`: CHECK ((outside_hours_behavior = ANY (ARRAY['silent'::text, 'away_message'::text])))
- `ai_bots_temperature_check`: CHECK (((temperature IS NULL) OR ((temperature >= (0)::numeric) AND (temperature <= (2)::numeric))))
- `ai_bots_tone_check`: CHECK ((tone = ANY (ARRAY['professional'::text, 'friendly'::text, 'casual'::text, 'formal'::text, 'playful'::text])))

RLS policies:
- `ai_bots_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `ai_bots_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `ai_bots_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `ai_bots_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

Triggers:
- `ai_bots_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_ai_bots_updated_at()

### ai_configs

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| created_by | uuid | yes | — |
| provider | text | no | — |
| model | text | no | — |
| api_key | text | no | — |
| system_prompt | text | yes | — |
| is_active | boolean | no | `false` |
| auto_reply_enabled | boolean | no | `false` |
| auto_reply_max_per_conversation | integer | no | `3` |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |
| embeddings_api_key | text | yes | — |
| handoff_agent_id | uuid | yes | — |
| base_url | text | yes | — |
| auto_reply_limit_mode | text | no | `'per_conversation'::text` |
| auto_reply_schedule_start | time without time zone | yes | — |
| auto_reply_schedule_end | time without time zone | yes | — |
| auto_reply_timezone | text | yes | — |
| autoreply_system_prompt | text | yes | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `ai_configs_account_id_key`: CREATE UNIQUE INDEX ai_configs_account_id_key ON public.ai_configs USING btree (account_id)
- `ai_configs_pkey`: CREATE UNIQUE INDEX ai_configs_pkey ON public.ai_configs USING btree (id)

Check constraints:
- `ai_configs_auto_reply_limit_mode_check`: CHECK ((auto_reply_limit_mode = ANY (ARRAY['per_conversation'::text, 'per_day'::text, 'never'::text])))
- `ai_configs_auto_reply_max_per_conversation_check`: CHECK (((auto_reply_max_per_conversation >= 1) AND (auto_reply_max_per_conversation <= 20)))
- `ai_configs_provider_check`: CHECK ((provider = ANY (ARRAY['openai'::text, 'anthropic'::text, 'gemini'::text, 'nvidia'::text, 'groq'::text, 'openrouter'::text, 'together'::text, 'mistral'::text, 'deepseek'::text, 'xai'::text, 'ollama'::text, 'custom'::text])))

RLS policies:
- `ai_configs_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `ai_configs_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `ai_configs_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `ai_configs_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

Triggers:
- `ai_configs_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_ai_configs_updated_at()

### ai_knowledge_chunks

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| document_id | uuid | no | — |
| account_id | uuid | no | — |
| chunk_index | integer | no | `0` |
| content | text | no | — |
| fts | tsvector | yes | — |
| embedding | vector | yes | — |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `document_id` → `ai_knowledge_documents.id` (on delete cascade)

Indexes:
- `ai_knowledge_chunks_account_id_idx`: CREATE INDEX ai_knowledge_chunks_account_id_idx ON public.ai_knowledge_chunks USING btree (account_id)
- `ai_knowledge_chunks_document_id_idx`: CREATE INDEX ai_knowledge_chunks_document_id_idx ON public.ai_knowledge_chunks USING btree (document_id)
- `ai_knowledge_chunks_embedding_idx`: CREATE INDEX ai_knowledge_chunks_embedding_idx ON public.ai_knowledge_chunks USING hnsw (embedding vector_cosine_ops)
- `ai_knowledge_chunks_fts_idx`: CREATE INDEX ai_knowledge_chunks_fts_idx ON public.ai_knowledge_chunks USING gin (fts)
- `ai_knowledge_chunks_pkey`: CREATE UNIQUE INDEX ai_knowledge_chunks_pkey ON public.ai_knowledge_chunks USING btree (id)

RLS policies:
- `ai_knowledge_chunks_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `ai_knowledge_chunks_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `ai_knowledge_chunks_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `ai_knowledge_chunks_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

### ai_knowledge_documents

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| created_by | uuid | yes | — |
| title | text | no | — |
| content | text | no | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `ai_knowledge_documents_account_id_idx`: CREATE INDEX ai_knowledge_documents_account_id_idx ON public.ai_knowledge_documents USING btree (account_id)
- `ai_knowledge_documents_pkey`: CREATE UNIQUE INDEX ai_knowledge_documents_pkey ON public.ai_knowledge_documents USING btree (id)

RLS policies:
- `ai_knowledge_documents_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `ai_knowledge_documents_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `ai_knowledge_documents_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `ai_knowledge_documents_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

Triggers:
- `ai_knowledge_documents_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_ai_knowledge_documents_updated_at()

### ai_support_requests

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| user_id | uuid | yes | — |
| topic | text | no | `'setup_help'::text` |
| message | text | no | — |
| contact_info | text | yes | — |
| status | text | no | `'pending'::text` |
| admin_notes | text | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `ai_support_requests_account_idx`: CREATE INDEX ai_support_requests_account_idx ON public.ai_support_requests USING btree (account_id)
- `ai_support_requests_pkey`: CREATE UNIQUE INDEX ai_support_requests_pkey ON public.ai_support_requests USING btree (id)
- `ai_support_requests_status_idx`: CREATE INDEX ai_support_requests_status_idx ON public.ai_support_requests USING btree (status)

Check constraints:
- `ai_support_requests_status_check`: CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'resolved'::text])))
- `ai_support_requests_topic_check`: CHECK ((topic = ANY (ARRAY['setup_help'::text, 'api_key'::text, 'prompt_tuning'::text, 'handoff'::text, 'other'::text])))

RLS policies:
- `ai_support_requests_insert` (INSERT, roles {public})
  - WITH CHECK: (is_account_member(account_id) AND (user_id = auth.uid()))
- `ai_support_requests_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)

Triggers:
- `ai_support_requests_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_ai_support_requests_updated_at()

### ai_usage_log

RLS: enabled · approx rows: 6

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| conversation_id | uuid | yes | — |
| mode | text | no | — |
| provider | text | no | — |
| model | text | no | — |
| prompt_tokens | integer | no | `0` |
| completion_tokens | integer | no | `0` |
| total_tokens | integer | no | `0` |
| created_at | timestamp with time zone | no | `now()` |
| key_source | text | no | `'account'::text` |
| cached_tokens | integer | yes | — |
| cache_write_tokens | integer | yes | — |
| agent_id | uuid | yes | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `agent_id` → `ai_agents.id` (on delete set null)
- `conversation_id` → `conversations.id` (on delete set null)

Indexes:
- `ai_usage_log_pkey`: CREATE UNIQUE INDEX ai_usage_log_pkey ON public.ai_usage_log USING btree (id)
- `idx_ai_usage_log_account_created`: CREATE INDEX idx_ai_usage_log_account_created ON public.ai_usage_log USING btree (account_id, created_at DESC)
- `idx_ai_usage_log_agent_created`: CREATE INDEX idx_ai_usage_log_agent_created ON public.ai_usage_log USING btree (agent_id, created_at DESC) WHERE (agent_id IS NOT NULL)

Check constraints:
- `ai_usage_log_key_source_check`: CHECK ((key_source = ANY (ARRAY['account'::text, 'env'::text])))
- `ai_usage_log_mode_check`: CHECK ((mode = ANY (ARRAY['auto_reply'::text, 'draft'::text])))
- `ai_usage_log_provider_check`: CHECK ((provider = ANY (ARRAY['openai'::text, 'anthropic'::text, 'gemini'::text, 'nvidia'::text, 'groq'::text, 'openrouter'::text, 'together'::text, 'mistral'::text, 'deepseek'::text, 'xai'::text, 'ollama'::text, 'custom'::text])))

RLS policies:
- `ai_usage_log_select` (SELECT, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

### api_keys

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| created_by | uuid | yes | — |
| name | text | no | — |
| key_prefix | text | no | — |
| key_hash | text | no | — |
| scopes | text[] | no | `'{}'::text[]` |
| last_used_at | timestamp with time zone | yes | — |
| expires_at | timestamp with time zone | yes | — |
| revoked_at | timestamp with time zone | yes | — |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `api_keys_account_id_idx`: CREATE INDEX api_keys_account_id_idx ON public.api_keys USING btree (account_id)
- `api_keys_key_hash_idx`: CREATE INDEX api_keys_key_hash_idx ON public.api_keys USING btree (key_hash)
- `api_keys_key_hash_key`: CREATE UNIQUE INDEX api_keys_key_hash_key ON public.api_keys USING btree (key_hash)
- `api_keys_pkey`: CREATE UNIQUE INDEX api_keys_pkey ON public.api_keys USING btree (id)

RLS policies:
- `api_keys_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `api_keys_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `api_keys_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `api_keys_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

### appointments

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| created_by | uuid | yes | — |
| contact_id | uuid | no | — |
| catalog_item_id | uuid | yes | — |
| assigned_to | uuid | yes | — |
| deal_id | uuid | yes | — |
| title | text | no | — |
| notes | text | yes | — |
| location | text | yes | — |
| starts_at | timestamp with time zone | no | — |
| ends_at | timestamp with time zone | yes | — |
| status | text | no | `'scheduled'::text` |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |
| custom_values | jsonb | no | `'{}'::jsonb` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `catalog_item_id` → `catalog_items.id` (on delete set null)
- `contact_id` → `contacts.id` (on delete cascade)
- `deal_id` → `deals.id` (on delete set null)

Indexes:
- `appointments_pkey`: CREATE UNIQUE INDEX appointments_pkey ON public.appointments USING btree (id)
- `idx_appointments_account_upcoming`: CREATE INDEX idx_appointments_account_upcoming ON public.appointments USING btree (account_id, starts_at) WHERE (status = 'scheduled'::text)
- `idx_appointments_contact`: CREATE INDEX idx_appointments_contact ON public.appointments USING btree (contact_id)

Check constraints:
- `appointments_check`: CHECK (((ends_at IS NULL) OR (ends_at > starts_at)))
- `appointments_status_check`: CHECK ((status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text])))

RLS policies:
- `appointments_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `appointments_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)
- `appointments_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `appointments_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)

Triggers:
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### audit_events

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| actor_id | uuid | yes | — |
| actor_label | text | yes | — |
| action | text | no | — |
| entity | text | no | — |
| meta | jsonb | yes | — |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `audit_events_account_action_idx`: CREATE INDEX audit_events_account_action_idx ON public.audit_events USING btree (account_id, action)
- `audit_events_account_created_idx`: CREATE INDEX audit_events_account_created_idx ON public.audit_events USING btree (account_id, created_at DESC)
- `audit_events_pkey`: CREATE UNIQUE INDEX audit_events_pkey ON public.audit_events USING btree (id)

RLS policies:
- `audit_events_insert` (INSERT, roles {public})
  - WITH CHECK: (is_account_member(account_id) AND (actor_id = auth.uid()))
- `audit_events_select` (SELECT, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

### auth_devices

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| user_id | uuid | no | — |
| session_id | uuid | no | — |
| user_agent | text | yes | — |
| ip_address | text | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| last_seen_at | timestamp with time zone | no | `now()` |
| revoked_at | timestamp with time zone | yes | — |
| city | text | yes | — |
| region | text | yes | — |
| country | text | yes | — |

Indexes:
- `auth_devices_pkey`: CREATE UNIQUE INDEX auth_devices_pkey ON public.auth_devices USING btree (id)
- `auth_devices_session_id_key`: CREATE UNIQUE INDEX auth_devices_session_id_key ON public.auth_devices USING btree (session_id)
- `auth_devices_user_idx`: CREATE INDEX auth_devices_user_idx ON public.auth_devices USING btree (user_id, last_seen_at DESC)

RLS policies:
- `auth_devices_select_own` (SELECT, roles {authenticated})
  - USING: (( SELECT auth.uid() AS uid) = user_id)

### auth_login_attempts

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| email | text | no | — |
| user_id | uuid | yes | — |
| success | boolean | no | `false` |
| ip_address | text | yes | — |
| user_agent | text | yes | — |
| city | text | yes | — |
| region | text | yes | — |
| country | text | yes | — |
| latitude | double precision | yes | — |
| longitude | double precision | yes | — |
| created_at | timestamp with time zone | no | `now()` |

Indexes:
- `auth_login_attempts_email_created_idx`: CREATE INDEX auth_login_attempts_email_created_idx ON public.auth_login_attempts USING btree (email, created_at DESC)
- `auth_login_attempts_pkey`: CREATE UNIQUE INDEX auth_login_attempts_pkey ON public.auth_login_attempts USING btree (id)
- `auth_login_attempts_user_created_idx`: CREATE INDEX auth_login_attempts_user_created_idx ON public.auth_login_attempts USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL)

RLS policies:
- `auth_login_attempts_select_own` (SELECT, roles {authenticated})
  - USING: (( SELECT auth.uid() AS uid) = user_id)

### automation_logs

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| automation_id | uuid | no | — |
| user_id | uuid | no | — |
| contact_id | uuid | yes | — |
| trigger_event | text | no | — |
| steps_executed | jsonb | no | `'[]'::jsonb` |
| status | text | no | — |
| error_message | text | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| account_id | uuid | no | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `automation_id` → `automations.id` (on delete cascade)
- `contact_id` → `contacts.id` (on delete set null)

Indexes:
- `automation_logs_pkey`: CREATE UNIQUE INDEX automation_logs_pkey ON public.automation_logs USING btree (id)
- `idx_automation_logs_account`: CREATE INDEX idx_automation_logs_account ON public.automation_logs USING btree (account_id)
- `idx_automation_logs_automation`: CREATE INDEX idx_automation_logs_automation ON public.automation_logs USING btree (automation_id, created_at DESC)
- `idx_automation_logs_user`: CREATE INDEX idx_automation_logs_user ON public.automation_logs USING btree (user_id)

Check constraints:
- `automation_logs_status_check`: CHECK ((status = ANY (ARRAY['success'::text, 'partial'::text, 'failed'::text])))

RLS policies:
- `automation_logs_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)

### automation_pending_executions

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| automation_id | uuid | no | — |
| user_id | uuid | no | — |
| contact_id | uuid | yes | — |
| log_id | uuid | yes | — |
| parent_step_id | uuid | yes | — |
| branch | text | yes | — |
| next_step_position | integer | no | — |
| context | jsonb | no | `'{}'::jsonb` |
| status | text | no | `'pending'::text` |
| run_at | timestamp with time zone | no | — |
| created_at | timestamp with time zone | no | `now()` |
| account_id | uuid | no | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `automation_id` → `automations.id` (on delete cascade)
- `contact_id` → `contacts.id` (on delete set null)
- `log_id` → `automation_logs.id` (on delete cascade)
- `parent_step_id` → `automation_steps.id` (on delete set null)

Indexes:
- `automation_pending_executions_pkey`: CREATE UNIQUE INDEX automation_pending_executions_pkey ON public.automation_pending_executions USING btree (id)
- `idx_automation_pending_account`: CREATE INDEX idx_automation_pending_account ON public.automation_pending_executions USING btree (account_id)
- `idx_automation_pending_due`: CREATE INDEX idx_automation_pending_due ON public.automation_pending_executions USING btree (run_at) WHERE (status = 'pending'::text)

Check constraints:
- `automation_pending_executions_branch_check`: CHECK ((branch = ANY (ARRAY['yes'::text, 'no'::text])))
- `automation_pending_executions_status_check`: CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text])))

### automation_steps

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| automation_id | uuid | no | — |
| parent_step_id | uuid | yes | — |
| branch | text | yes | — |
| step_type | text | no | — |
| step_config | jsonb | no | `'{}'::jsonb` |
| position | integer | no | — |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `automation_id` → `automations.id` (on delete cascade)
- `parent_step_id` → `automation_steps.id` (on delete cascade)

Indexes:
- `automation_steps_pkey`: CREATE UNIQUE INDEX automation_steps_pkey ON public.automation_steps USING btree (id)
- `idx_automation_steps_automation_id`: CREATE INDEX idx_automation_steps_automation_id ON public.automation_steps USING btree (automation_id, "position")
- `idx_automation_steps_parent`: CREATE INDEX idx_automation_steps_parent ON public.automation_steps USING btree (parent_step_id) WHERE (parent_step_id IS NOT NULL)

Check constraints:
- `automation_steps_branch_check`: CHECK ((branch = ANY (ARRAY['yes'::text, 'no'::text])))

RLS policies:
- `automation_steps_modify` (ALL, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM automations a
  WHERE ((a.id = automation_steps.automation_id) AND is_account_member(a.account_id, 'agent'::account_role_enum))))
  - WITH CHECK: (EXISTS ( SELECT 1
   FROM automations a
  WHERE ((a.id = automation_steps.automation_id) AND is_account_member(a.account_id, 'agent'::account_role_enum))))
- `automation_steps_select` (SELECT, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM automations a
  WHERE ((a.id = automation_steps.automation_id) AND is_account_member(a.account_id))))

### automations

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| user_id | uuid | no | — |
| name | text | no | — |
| description | text | yes | — |
| trigger_type | text | no | — |
| trigger_config | jsonb | no | `'{}'::jsonb` |
| is_active | boolean | no | `false` |
| execution_count | integer | no | `0` |
| last_executed_at | timestamp with time zone | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |
| account_id | uuid | no | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `automations_pkey`: CREATE UNIQUE INDEX automations_pkey ON public.automations USING btree (id)
- `idx_automations_account`: CREATE INDEX idx_automations_account ON public.automations USING btree (account_id)
- `idx_automations_account_active_trigger`: CREATE INDEX idx_automations_account_active_trigger ON public.automations USING btree (account_id, trigger_type) WHERE (is_active = true)
- `idx_automations_active_trigger`: CREATE INDEX idx_automations_active_trigger ON public.automations USING btree (trigger_type) WHERE (is_active = true)
- `idx_automations_user_id`: CREATE INDEX idx_automations_user_id ON public.automations USING btree (user_id)

RLS policies:
- `automations_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `automations_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)
- `automations_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `automations_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)

Triggers:
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### broadcast_recipients

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| broadcast_id | uuid | no | — |
| contact_id | uuid | yes | — |
| status | text | no | `'pending'::text` |
| sent_at | timestamp with time zone | yes | — |
| delivered_at | timestamp with time zone | yes | — |
| read_at | timestamp with time zone | yes | — |
| replied_at | timestamp with time zone | yes | — |
| error_message | text | yes | — |
| created_at | timestamp with time zone | yes | `now()` |
| whatsapp_message_id | text | yes | — |

Foreign keys:
- `broadcast_id` → `broadcasts.id` (on delete cascade)
- `contact_id` → `contacts.id` (on delete set null)

Indexes:
- `broadcast_recipients_pkey`: CREATE UNIQUE INDEX broadcast_recipients_pkey ON public.broadcast_recipients USING btree (id)
- `idx_broadcast_recipients_broadcast`: CREATE INDEX idx_broadcast_recipients_broadcast ON public.broadcast_recipients USING btree (broadcast_id)
- `idx_broadcast_recipients_broadcast_status`: CREATE INDEX idx_broadcast_recipients_broadcast_status ON public.broadcast_recipients USING btree (broadcast_id, status)
- `idx_broadcast_recipients_wamid`: CREATE UNIQUE INDEX idx_broadcast_recipients_wamid ON public.broadcast_recipients USING btree (whatsapp_message_id) WHERE (whatsapp_message_id IS NOT NULL)

Check constraints:
- `broadcast_recipients_status_check`: CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'replied'::text, 'failed'::text])))

RLS policies:
- `broadcast_recipients_modify` (ALL, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND is_account_member(b.account_id, 'agent'::account_role_enum))))
  - WITH CHECK: (EXISTS ( SELECT 1
   FROM broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND is_account_member(b.account_id, 'agent'::account_role_enum))))
- `broadcast_recipients_select` (SELECT, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND is_account_member(b.account_id))))

Triggers:
- `broadcast_recipients_aggregate`: AFTER UPDATE → EXECUTE FUNCTION broadcast_recipient_aggregate_trigger()
- `broadcast_recipients_aggregate`: AFTER DELETE → EXECUTE FUNCTION broadcast_recipient_aggregate_trigger()
- `broadcast_recipients_aggregate`: AFTER INSERT → EXECUTE FUNCTION broadcast_recipient_aggregate_trigger()

### broadcasts

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| user_id | uuid | no | — |
| name | text | no | — |
| template_name | text | no | — |
| template_language | text | no | `'en_US'::text` |
| template_variables | jsonb | yes | — |
| audience_filter | jsonb | yes | — |
| scheduled_at | timestamp with time zone | yes | — |
| status | text | no | `'draft'::text` |
| total_recipients | integer | yes | `0` |
| sent_count | integer | yes | `0` |
| delivered_count | integer | yes | `0` |
| read_count | integer | yes | `0` |
| replied_count | integer | yes | `0` |
| failed_count | integer | yes | `0` |
| created_at | timestamp with time zone | yes | `now()` |
| updated_at | timestamp with time zone | yes | `now()` |
| account_id | uuid | no | — |
| channel | text | no | `'whatsapp'::text` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `broadcasts_channel_idx`: CREATE INDEX broadcasts_channel_idx ON public.broadcasts USING btree (account_id, channel, created_at DESC)
- `broadcasts_pkey`: CREATE UNIQUE INDEX broadcasts_pkey ON public.broadcasts USING btree (id)
- `idx_broadcasts_account`: CREATE INDEX idx_broadcasts_account ON public.broadcasts USING btree (account_id)

Check constraints:
- `broadcasts_channel_check`: CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'sms'::text])))
- `broadcasts_status_check`: CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'sending'::text, 'sent'::text, 'failed'::text])))

RLS policies:
- `broadcasts_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `broadcasts_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)
- `broadcasts_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `broadcasts_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)

Triggers:
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### catalog_items

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| created_by | uuid | yes | — |
| name | text | no | — |
| description | text | yes | — |
| category | text | yes | — |
| price | numeric | no | `0` |
| currency | text | no | `'USD'::text` |
| is_active | boolean | no | `true` |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |
| custom_values | jsonb | no | `'{}'::jsonb` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `catalog_items_pkey`: CREATE UNIQUE INDEX catalog_items_pkey ON public.catalog_items USING btree (id)
- `idx_catalog_items_account`: CREATE INDEX idx_catalog_items_account ON public.catalog_items USING btree (account_id, is_active, name)

Check constraints:
- `catalog_items_price_check`: CHECK ((price >= (0)::numeric))

RLS policies:
- `catalog_items_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `catalog_items_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)
- `catalog_items_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `catalog_items_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)

Triggers:
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### channel_configurations

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| channel | text | no | — |
| provider | text | no | — |
| encrypted_credentials | bytea | yes | — |
| masked_preview | text | yes | — |
| is_active | boolean | no | `false` |
| verified_at | timestamp with time zone | yes | — |
| configured_by | uuid | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `channel_configurations_account_id_channel_key`: CREATE UNIQUE INDEX channel_configurations_account_id_channel_key ON public.channel_configurations USING btree (account_id, channel)
- `channel_configurations_pkey`: CREATE UNIQUE INDEX channel_configurations_pkey ON public.channel_configurations USING btree (id)
- `idx_channel_configurations_account`: CREATE INDEX idx_channel_configurations_account ON public.channel_configurations USING btree (account_id)

Check constraints:
- `channel_configurations_channel_check`: CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text, 'voice'::text])))

RLS policies:
- `Super admins manage channel configurations` (ALL, roles {public})
  - USING: is_platform_super_admin()
  - WITH CHECK: is_platform_super_admin()

Triggers:
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### channel_connections

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| account_id | uuid | no | — |
| created_by_user_id | uuid | yes | — |
| channel | channel_kind | no | — |
| provider | channel_provider | no | — |
| display_name | text | no | — |
| external_account_id | text | yes | — |
| external_identity | text | yes | — |
| credentials_encrypted | text | yes | — |
| webhook_secret_encrypted | text | yes | — |
| configuration | jsonb | no | `'{}'::jsonb` |
| sync_cursor | text | yes | — |
| sync_expires_at | timestamp with time zone | yes | — |
| status | channel_connection_status | no | `'draft'::channel_connection_status` |
| is_enabled | boolean | no | `false` |
| is_primary | boolean | no | `false` |
| last_connected_at | timestamp with time zone | yes | — |
| last_synced_at | timestamp with time zone | yes | — |
| last_error | text | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |
| managed_by | text | no | `'workspace'::text` |
| client_can_toggle | boolean | no | `true` |
| platform_notice | text | yes | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `channel_connections_pkey`: CREATE UNIQUE INDEX channel_connections_pkey ON public.channel_connections USING btree (id)
- `idx_channel_connections_account_enabled`: CREATE INDEX idx_channel_connections_account_enabled ON public.channel_connections USING btree (account_id, channel, is_enabled)
- `idx_channel_connections_external`: CREATE UNIQUE INDEX idx_channel_connections_external ON public.channel_connections USING btree (account_id, provider, external_identity) WHERE (external_identity IS NOT NULL)
- `idx_channel_connections_primary`: CREATE UNIQUE INDEX idx_channel_connections_primary ON public.channel_connections USING btree (account_id, channel) WHERE is_primary

Check constraints:
- `channel_connections_managed_by_check`: CHECK ((managed_by = ANY (ARRAY['workspace'::text, 'platform'::text])))
- `channel_enabled_connected`: CHECK (((NOT is_enabled) OR (status = ANY (ARRAY['connected'::channel_connection_status, 'degraded'::channel_connection_status]))))
- `channel_provider_compatible`: CHECK ((((channel = 'whatsapp'::channel_kind) AND (provider = ANY (ARRAY['meta'::channel_provider, 'twilio'::channel_provider]))) OR ((channel = 'email'::channel_kind) AND (provider = ANY (ARRAY['google'::channel_provider, 'microsoft'::channel_provider, 'resend'::channel_provider, 'smtp'::channel_provider]))) OR ((channel = 'sms'::channel_kind) AND (provider = 'twilio'::channel_provider))))

RLS policies:
- `channel_connections_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `channel_connections_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `channel_connections_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `channel_connections_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)

Triggers:
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### channel_webhook_events

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| account_id | uuid | yes | — |
| connection_id | uuid | yes | — |
| provider | channel_provider | no | — |
| external_event_id | text | no | — |
| event_type | text | no | — |
| payload | jsonb | no | `'{}'::jsonb` |
| status | text | no | `'pending'::text` |
| attempts | integer | no | `0` |
| last_error | text | yes | — |
| received_at | timestamp with time zone | no | `now()` |
| processed_at | timestamp with time zone | yes | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `connection_id` → `channel_connections.id` (on delete cascade)

Indexes:
- `channel_webhook_events_pkey`: CREATE UNIQUE INDEX channel_webhook_events_pkey ON public.channel_webhook_events USING btree (id)
- `channel_webhook_events_provider_external_event_id_key`: CREATE UNIQUE INDEX channel_webhook_events_provider_external_event_id_key ON public.channel_webhook_events USING btree (provider, external_event_id)
- `idx_channel_webhook_events_pending`: CREATE INDEX idx_channel_webhook_events_pending ON public.channel_webhook_events USING btree (provider, status, received_at) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]))

Check constraints:
- `channel_webhook_events_status_check`: CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'processed'::text, 'failed'::text, 'ignored'::text])))

RLS policies:
- `channel_webhook_events_select` (SELECT, roles {public})
  - USING: ((account_id IS NOT NULL) AND is_account_member(account_id, 'admin'::account_role_enum))

### contact_custom_values

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| contact_id | uuid | no | — |
| custom_field_id | uuid | no | — |
| value | text | yes | — |
| created_at | timestamp with time zone | yes | `now()` |

Foreign keys:
- `contact_id` → `contacts.id` (on delete cascade)
- `custom_field_id` → `custom_fields.id` (on delete cascade)

Indexes:
- `contact_custom_values_contact_id_custom_field_id_key`: CREATE UNIQUE INDEX contact_custom_values_contact_id_custom_field_id_key ON public.contact_custom_values USING btree (contact_id, custom_field_id)
- `contact_custom_values_pkey`: CREATE UNIQUE INDEX contact_custom_values_pkey ON public.contact_custom_values USING btree (id)

RLS policies:
- `contact_custom_values_modify` (ALL, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_custom_values.contact_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
  - WITH CHECK: (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_custom_values.contact_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
- `contact_custom_values_select` (SELECT, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_custom_values.contact_id) AND is_account_member(c.account_id))))

### contact_identities

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| account_id | uuid | no | — |
| contact_id | uuid | no | — |
| channel | channel_kind | no | — |
| identity | text | no | — |
| normalized_identity | text | no | — |
| label | text | yes | — |
| is_primary | boolean | no | `false` |
| verified_at | timestamp with time zone | yes | — |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `contact_id` → `contacts.id` (on delete cascade)

Indexes:
- `contact_identities_account_id_channel_normalized_identity_key`: CREATE UNIQUE INDEX contact_identities_account_id_channel_normalized_identity_key ON public.contact_identities USING btree (account_id, channel, normalized_identity)
- `contact_identities_pkey`: CREATE UNIQUE INDEX contact_identities_pkey ON public.contact_identities USING btree (id)
- `idx_contact_identities_contact`: CREATE INDEX idx_contact_identities_contact ON public.contact_identities USING btree (contact_id)

RLS policies:
- `contact_identities_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `contact_identities_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)
- `contact_identities_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `contact_identities_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)

### contact_notes

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| contact_id | uuid | no | — |
| user_id | uuid | no | — |
| note_text | text | no | — |
| created_at | timestamp with time zone | yes | `now()` |
| account_id | uuid | no | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `contact_id` → `contacts.id` (on delete cascade)

Indexes:
- `contact_notes_pkey`: CREATE UNIQUE INDEX contact_notes_pkey ON public.contact_notes USING btree (id)
- `idx_contact_notes_account`: CREATE INDEX idx_contact_notes_account ON public.contact_notes USING btree (account_id)

RLS policies:
- `contact_notes_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `contact_notes_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)
- `contact_notes_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `contact_notes_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)

### contact_tags

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| contact_id | uuid | no | — |
| tag_id | uuid | no | — |
| created_at | timestamp with time zone | yes | `now()` |

Foreign keys:
- `contact_id` → `contacts.id` (on delete cascade)
- `tag_id` → `tags.id` (on delete cascade)

Indexes:
- `contact_tags_contact_id_tag_id_key`: CREATE UNIQUE INDEX contact_tags_contact_id_tag_id_key ON public.contact_tags USING btree (contact_id, tag_id)
- `contact_tags_pkey`: CREATE UNIQUE INDEX contact_tags_pkey ON public.contact_tags USING btree (id)
- `idx_contact_tags_contact`: CREATE INDEX idx_contact_tags_contact ON public.contact_tags USING btree (contact_id)
- `idx_contact_tags_tag`: CREATE INDEX idx_contact_tags_tag ON public.contact_tags USING btree (tag_id)

RLS policies:
- `contact_tags_modify` (ALL, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_tags.contact_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
  - WITH CHECK: (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_tags.contact_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
- `contact_tags_select` (SELECT, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_tags.contact_id) AND is_account_member(c.account_id))))

### contacts

RLS: enabled · approx rows: 1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| user_id | uuid | no | — |
| phone | text | yes | — |
| name | text | yes | — |
| email | text | yes | — |
| company | text | yes | — |
| avatar_url | text | yes | — |
| created_at | timestamp with time zone | yes | `now()` |
| updated_at | timestamp with time zone | yes | `now()` |
| account_id | uuid | no | — |
| phone_normalized | text | yes | — |
| sms_opted_out | boolean | no | `false` |
| sms_opted_out_at | timestamp with time zone | yes | — |
| source | text | yes | — |
| source_detail | text | yes | — |
| campaign | text | yes | — |
| email_opted_out | boolean | no | `false` |
| email_opted_out_at | timestamp with time zone | yes | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `contacts_pkey`: CREATE UNIQUE INDEX contacts_pkey ON public.contacts USING btree (id)
- `contacts_sms_opted_out_idx`: CREATE INDEX contacts_sms_opted_out_idx ON public.contacts USING btree (account_id, sms_opted_out) WHERE (sms_opted_out = true)
- `idx_contacts_account`: CREATE INDEX idx_contacts_account ON public.contacts USING btree (account_id)
- `idx_contacts_account_campaign`: CREATE INDEX idx_contacts_account_campaign ON public.contacts USING btree (account_id, campaign) WHERE (campaign IS NOT NULL)
- `idx_contacts_account_phone_normalized`: CREATE UNIQUE INDEX idx_contacts_account_phone_normalized ON public.contacts USING btree (account_id, phone_normalized) WHERE (phone_normalized <> ''::text)
- `idx_contacts_account_source`: CREATE INDEX idx_contacts_account_source ON public.contacts USING btree (account_id, source) WHERE (source IS NOT NULL)
- `idx_contacts_email_opted_out`: CREATE INDEX idx_contacts_email_opted_out ON public.contacts USING btree (account_id) WHERE (email_opted_out = true)
- `idx_contacts_phone`: CREATE INDEX idx_contacts_phone ON public.contacts USING btree (phone)
- `idx_contacts_user_id`: CREATE INDEX idx_contacts_user_id ON public.contacts USING btree (user_id)

Check constraints:
- `contacts_phone_or_email_check`: CHECK (((NULLIF(btrim(phone), ''::text) IS NOT NULL) OR (NULLIF(btrim(email), ''::text) IS NOT NULL)))

RLS policies:
- `contacts_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `contacts_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)
- `contacts_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `contacts_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)

Triggers:
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### conversations

RLS: enabled · approx rows: 1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| user_id | uuid | no | — |
| contact_id | uuid | no | — |
| status | text | no | `'open'::text` |
| assigned_agent_id | uuid | yes | — |
| last_message_text | text | yes | — |
| last_message_at | timestamp with time zone | yes | — |
| unread_count | integer | yes | `0` |
| created_at | timestamp with time zone | yes | `now()` |
| updated_at | timestamp with time zone | yes | `now()` |
| account_id | uuid | no | — |
| ai_autoreply_disabled | boolean | no | `false` |
| ai_reply_count | integer | no | `0` |
| ai_handoff_summary | text | yes | — |
| channel | channel_kind | no | `'whatsapp'::channel_kind` |
| channel_connection_id | uuid | yes | — |
| external_thread_id | text | yes | — |
| ai_sentiment | text | yes | — |
| ai_escalation_reason | text | yes | — |
| ai_escalated_at | timestamp with time zone | yes | — |
| ai_away_message_sent | boolean | no | `false` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `channel_connection_id` → `channel_connections.id` (on delete set null)
- `contact_id` → `contacts.id` (on delete cascade)

Indexes:
- `conversations_pkey`: CREATE UNIQUE INDEX conversations_pkey ON public.conversations USING btree (id)
- `idx_conversations_account`: CREATE INDEX idx_conversations_account ON public.conversations USING btree (account_id)
- `idx_conversations_account_channel`: CREATE INDEX idx_conversations_account_channel ON public.conversations USING btree (account_id, channel, last_message_at DESC)
- `idx_conversations_connection_contact_thread`: CREATE UNIQUE INDEX idx_conversations_connection_contact_thread ON public.conversations USING btree (channel_connection_id, contact_id, external_thread_id) WHERE ((channel_connection_id IS NOT NULL) AND (external_thread_id IS NOT NULL))
- `idx_conversations_contact_id`: CREATE INDEX idx_conversations_contact_id ON public.conversations USING btree (contact_id)
- `idx_conversations_external_thread`: CREATE UNIQUE INDEX idx_conversations_external_thread ON public.conversations USING btree (channel_connection_id, external_thread_id) WHERE ((channel_connection_id IS NOT NULL) AND (external_thread_id IS NOT NULL))
- `idx_conversations_legacy_account_contact`: CREATE UNIQUE INDEX idx_conversations_legacy_account_contact ON public.conversations USING btree (account_id, contact_id) WHERE (channel_connection_id IS NULL)
- `idx_conversations_user_id`: CREATE INDEX idx_conversations_user_id ON public.conversations USING btree (user_id)

Check constraints:
- `conversations_ai_escalation_reason_check`: CHECK (((ai_escalation_reason IS NULL) OR (ai_escalation_reason = ANY (ARRAY['human_requested'::text, 'angry_customer'::text, 'out_of_scope'::text, 'needs_account_data'::text, 'purchase_ready'::text]))))
- `conversations_ai_sentiment_check`: CHECK (((ai_sentiment IS NULL) OR (ai_sentiment = ANY (ARRAY['angry'::text, 'frustrated'::text, 'neutral'::text, 'happy'::text]))))
- `conversations_status_check`: CHECK ((status = ANY (ARRAY['open'::text, 'pending'::text, 'closed'::text])))

RLS policies:
- `conversations_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `conversations_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)
- `conversations_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `conversations_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)

Triggers:
- `on_conversation_assigned`: AFTER INSERT → EXECUTE FUNCTION notify_conversation_assigned()
- `on_conversation_assigned`: AFTER UPDATE → EXECUTE FUNCTION notify_conversation_assigned()
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### custom_fields

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| user_id | uuid | no | — |
| field_name | text | no | — |
| field_type | text | no | `'text'::text` |
| field_options | jsonb | yes | — |
| created_at | timestamp with time zone | yes | `now()` |
| account_id | uuid | no | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `custom_fields_pkey`: CREATE UNIQUE INDEX custom_fields_pkey ON public.custom_fields USING btree (id)
- `idx_custom_fields_account`: CREATE INDEX idx_custom_fields_account ON public.custom_fields USING btree (account_id)

RLS policies:
- `custom_fields_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `custom_fields_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `custom_fields_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `custom_fields_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

### deal_field_settings

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| account_id | uuid | no | — |
| pipeline_id | uuid | no | — |
| layout | jsonb | no | `'{}'::jsonb` |
| updated_by | uuid | yes | — |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `pipeline_id` → `pipelines.id` (on delete cascade)

Indexes:
- `deal_field_settings_pkey`: CREATE UNIQUE INDEX deal_field_settings_pkey ON public.deal_field_settings USING btree (account_id, pipeline_id)

RLS policies:
- `deal_field_settings_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `deal_field_settings_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `deal_field_settings_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `deal_field_settings_upsert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)

### deal_items

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| deal_id | uuid | no | — |
| catalog_item_id | uuid | yes | — |
| name | text | no | — |
| list_price | numeric | no | `0` |
| quantity | numeric | no | `1` |
| discount_pct | numeric | no | `0` |
| position | integer | no | `0` |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `catalog_item_id` → `catalog_items.id` (on delete set null)
- `deal_id` → `deals.id` (on delete cascade)

Indexes:
- `deal_items_pkey`: CREATE UNIQUE INDEX deal_items_pkey ON public.deal_items USING btree (id)
- `idx_deal_items_account`: CREATE INDEX idx_deal_items_account ON public.deal_items USING btree (account_id)
- `idx_deal_items_deal`: CREATE INDEX idx_deal_items_deal ON public.deal_items USING btree (deal_id, "position")

Check constraints:
- `deal_items_discount_pct_check`: CHECK (((discount_pct >= (0)::numeric) AND (discount_pct <= (100)::numeric)))
- `deal_items_list_price_check`: CHECK ((list_price >= (0)::numeric))
- `deal_items_quantity_check`: CHECK ((quantity > (0)::numeric))

RLS policies:
- `deal_items_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `deal_items_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)
- `deal_items_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `deal_items_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)

### deals

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| user_id | uuid | no | — |
| pipeline_id | uuid | no | — |
| stage_id | uuid | no | — |
| contact_id | uuid | yes | — |
| conversation_id | uuid | yes | — |
| title | text | no | — |
| value | numeric | no | `0` |
| currency | text | yes | `'USD'::text` |
| notes | text | yes | — |
| expected_close_date | date | yes | — |
| status | text | yes | `'open'::text` |
| created_at | timestamp with time zone | yes | `now()` |
| updated_at | timestamp with time zone | yes | `now()` |
| assigned_to | uuid | yes | — |
| account_id | uuid | no | — |
| company | text | yes | — |
| priority | text | no | `'normal'::text` |
| probability | integer | no | `0` |
| lead_source | text | yes | — |
| last_activity | text | yes | — |
| next_step | text | yes | — |
| description | text | yes | — |
| position | integer | no | `0` |
| catalog_item_id | uuid | yes | — |
| closed_at | timestamp with time zone | yes | — |
| custom_values | jsonb | no | `'{}'::jsonb` |
| campaign | text | yes | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `assigned_to` → `profiles.id` (on delete set null)
- `catalog_item_id` → `catalog_items.id` (on delete set null)
- `contact_id` → `contacts.id` (on delete set null)
- `conversation_id` → `conversations.id` (on delete no action)
- `pipeline_id` → `pipelines.id` (on delete cascade)
- `stage_id` → `pipeline_stages.id` (on delete no action)

Indexes:
- `deals_pkey`: CREATE UNIQUE INDEX deals_pkey ON public.deals USING btree (id)
- `idx_deals_account`: CREATE INDEX idx_deals_account ON public.deals USING btree (account_id)
- `idx_deals_account_campaign`: CREATE INDEX idx_deals_account_campaign ON public.deals USING btree (account_id, campaign) WHERE (campaign IS NOT NULL)
- `idx_deals_account_closed`: CREATE INDEX idx_deals_account_closed ON public.deals USING btree (account_id, closed_at) WHERE (status = ANY (ARRAY['won'::text, 'lost'::text]))
- `idx_deals_assigned_to`: CREATE INDEX idx_deals_assigned_to ON public.deals USING btree (assigned_to)
- `idx_deals_pipeline`: CREATE INDEX idx_deals_pipeline ON public.deals USING btree (pipeline_id)
- `idx_deals_pipeline_stage_position`: CREATE INDEX idx_deals_pipeline_stage_position ON public.deals USING btree (account_id, pipeline_id, stage_id, "position")
- `idx_deals_stage`: CREATE INDEX idx_deals_stage ON public.deals USING btree (stage_id)

Check constraints:
- `deals_priority_check`: CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'hot'::text])))
- `deals_probability_check`: CHECK (((probability >= 0) AND (probability <= 100)))
- `deals_status_check`: CHECK ((status = ANY (ARRAY['open'::text, 'won'::text, 'lost'::text])))

RLS policies:
- `deals_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `deals_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)
- `deals_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `deals_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)

Triggers:
- `deals_set_closed_at`: BEFORE UPDATE → EXECUTE FUNCTION set_deal_closed_at()
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### external_sources

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| created_by | uuid | yes | — |
| name | text | no | — |
| type | text | no | — |
| config | jsonb | no | `'{}'::jsonb` |
| encrypted_secret | text | yes | — |
| field_map | jsonb | no | `'{}'::jsonb` |
| last_tested_at | timestamp with time zone | yes | — |
| last_row_count | integer | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `external_sources_account_id_idx`: CREATE INDEX external_sources_account_id_idx ON public.external_sources USING btree (account_id)
- `external_sources_pkey`: CREATE UNIQUE INDEX external_sources_pkey ON public.external_sources USING btree (id)

Check constraints:
- `external_sources_type_check`: CHECK ((type = ANY (ARRAY['rest'::text, 'postgres'::text, 'google_sheet'::text])))

RLS policies:
- `external_sources_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `external_sources_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `external_sources_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `external_sources_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

### flow_nodes

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| flow_id | uuid | no | — |
| node_key | text | no | — |
| node_type | text | no | — |
| config | jsonb | no | `'{}'::jsonb` |
| position_x | integer | no | `0` |
| position_y | integer | no | `0` |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `flow_id` → `flows.id` (on delete cascade)

Indexes:
- `flow_nodes_flow_id_node_key_key`: CREATE UNIQUE INDEX flow_nodes_flow_id_node_key_key ON public.flow_nodes USING btree (flow_id, node_key)
- `flow_nodes_pkey`: CREATE UNIQUE INDEX flow_nodes_pkey ON public.flow_nodes USING btree (id)
- `idx_flow_nodes_flow`: CREATE INDEX idx_flow_nodes_flow ON public.flow_nodes USING btree (flow_id)

Check constraints:
- `flow_nodes_node_type_check`: CHECK ((node_type = ANY (ARRAY['start'::text, 'send_buttons'::text, 'send_list'::text, 'send_message'::text, 'send_media'::text, 'collect_input'::text, 'condition'::text, 'set_tag'::text, 'handoff'::text, 'end'::text, 'send_template'::text, 'update_contact_field'::text, 'assign_conversation'::text, 'create_deal'::text, 'send_webhook'::text, 'close_conversation'::text, 'wait'::text])))

RLS policies:
- `flow_nodes_modify` (ALL, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM flows f
  WHERE ((f.id = flow_nodes.flow_id) AND is_account_member(f.account_id, 'agent'::account_role_enum))))
  - WITH CHECK: (EXISTS ( SELECT 1
   FROM flows f
  WHERE ((f.id = flow_nodes.flow_id) AND is_account_member(f.account_id, 'agent'::account_role_enum))))
- `flow_nodes_select` (SELECT, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM flows f
  WHERE ((f.id = flow_nodes.flow_id) AND is_account_member(f.account_id))))

### flow_run_events

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| flow_run_id | uuid | no | — |
| event_type | text | no | — |
| node_key | text | yes | — |
| payload | jsonb | no | `'{}'::jsonb` |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `flow_run_id` → `flow_runs.id` (on delete cascade)

Indexes:
- `flow_run_events_pkey`: CREATE UNIQUE INDEX flow_run_events_pkey ON public.flow_run_events USING btree (id)
- `idx_flow_run_events_run_time`: CREATE INDEX idx_flow_run_events_run_time ON public.flow_run_events USING btree (flow_run_id, created_at DESC)
- `idx_flow_run_events_run_type`: CREATE INDEX idx_flow_run_events_run_type ON public.flow_run_events USING btree (flow_run_id, event_type)

Check constraints:
- `flow_run_events_event_type_check`: CHECK ((event_type = ANY (ARRAY['started'::text, 'node_entered'::text, 'message_sent'::text, 'reply_received'::text, 'fallback_fired'::text, 'handoff'::text, 'timeout'::text, 'error'::text, 'completed'::text])))

RLS policies:
- `flow_run_events_select` (SELECT, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM flow_runs r
  WHERE ((r.id = flow_run_events.flow_run_id) AND is_account_member(r.account_id))))

### flow_runs

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| flow_id | uuid | no | — |
| user_id | uuid | no | — |
| contact_id | uuid | yes | — |
| conversation_id | uuid | yes | — |
| status | text | no | `'active'::text` |
| current_node_key | text | yes | — |
| last_prompt_message_id | uuid | yes | — |
| vars | jsonb | no | `'{}'::jsonb` |
| reprompt_count | integer | no | `0` |
| started_at | timestamp with time zone | no | `now()` |
| last_advanced_at | timestamp with time zone | no | `now()` |
| ended_at | timestamp with time zone | yes | — |
| end_reason | text | yes | — |
| account_id | uuid | no | — |
| wake_at | timestamp with time zone | yes | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `contact_id` → `contacts.id` (on delete set null)
- `conversation_id` → `conversations.id` (on delete set null)
- `flow_id` → `flows.id` (on delete cascade)
- `last_prompt_message_id` → `messages.id` (on delete set null)

Indexes:
- `flow_runs_pkey`: CREATE UNIQUE INDEX flow_runs_pkey ON public.flow_runs USING btree (id)
- `idx_flow_runs_account`: CREATE INDEX idx_flow_runs_account ON public.flow_runs USING btree (account_id)
- `idx_flow_runs_active_advanced`: CREATE INDEX idx_flow_runs_active_advanced ON public.flow_runs USING btree (last_advanced_at) WHERE (status = 'active'::text)
- `idx_flow_runs_flow_started`: CREATE INDEX idx_flow_runs_flow_started ON public.flow_runs USING btree (flow_id, started_at DESC)
- `idx_flow_runs_wake_due`: CREATE INDEX idx_flow_runs_wake_due ON public.flow_runs USING btree (wake_at) WHERE (status = 'waiting'::text)
- `idx_one_active_run_per_contact`: CREATE UNIQUE INDEX idx_one_active_run_per_contact ON public.flow_runs USING btree (account_id, contact_id) WHERE (status = 'active'::text)

Check constraints:
- `flow_runs_status_check`: CHECK ((status = ANY (ARRAY['active'::text, 'waiting'::text, 'completed'::text, 'handed_off'::text, 'timed_out'::text, 'paused_by_agent'::text, 'failed'::text])))

RLS policies:
- `flow_runs_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)

### flows

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| user_id | uuid | no | — |
| name | text | no | — |
| description | text | yes | — |
| status | text | no | `'draft'::text` |
| trigger_type | text | no | — |
| trigger_config | jsonb | no | `'{}'::jsonb` |
| entry_node_id | text | yes | — |
| fallback_policy | jsonb | no | `'{"on_exhaust": "handoff", "max_reprompts": 2, "on_timeout_hours": 24, "on_unknown_reply": "reprompt"}'::jsonb` |
| execution_count | integer | no | `0` |
| last_executed_at | timestamp with time zone | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |
| account_id | uuid | no | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `flows_pkey`: CREATE UNIQUE INDEX flows_pkey ON public.flows USING btree (id)
- `idx_flows_account`: CREATE INDEX idx_flows_account ON public.flows USING btree (account_id)
- `idx_flows_account_active`: CREATE INDEX idx_flows_account_active ON public.flows USING btree (account_id) WHERE (status = 'active'::text)
- `idx_flows_account_trigger_active`: CREATE INDEX idx_flows_account_trigger_active ON public.flows USING btree (account_id, trigger_type) WHERE (status = 'active'::text)
- `idx_flows_active_trigger`: CREATE INDEX idx_flows_active_trigger ON public.flows USING btree (user_id, trigger_type) WHERE (status = 'active'::text)

Check constraints:
- `flows_status_check`: CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text])))
- `flows_trigger_type_check`: CHECK ((trigger_type = ANY (ARRAY['keyword'::text, 'first_inbound_message'::text, 'manual'::text, 'new_message_received'::text, 'new_contact_created'::text, 'tag_added'::text, 'conversation_assigned'::text, 'interactive_reply'::text, 'scheduled'::text])))

RLS policies:
- `flows_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `flows_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)
- `flows_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `flows_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)

Triggers:
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### member_presence

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| user_id | uuid | no | — |
| account_id | uuid | no | — |
| status | text | no | `'online'::text` |
| last_seen_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `member_presence_account_idx`: CREATE INDEX member_presence_account_idx ON public.member_presence USING btree (account_id)
- `member_presence_pkey`: CREATE UNIQUE INDEX member_presence_pkey ON public.member_presence USING btree (user_id)

Check constraints:
- `member_presence_status_check`: CHECK ((status = ANY (ARRAY['online'::text, 'away'::text])))

RLS policies:
- `member_presence_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)

### message_reactions

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| message_id | uuid | no | — |
| conversation_id | uuid | no | — |
| actor_type | text | no | — |
| actor_id | uuid | yes | — |
| emoji | text | no | — |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `conversation_id` → `conversations.id` (on delete cascade)
- `message_id` → `messages.id` (on delete cascade)

Indexes:
- `idx_message_reactions_conversation`: CREATE INDEX idx_message_reactions_conversation ON public.message_reactions USING btree (conversation_id)
- `idx_message_reactions_message`: CREATE INDEX idx_message_reactions_message ON public.message_reactions USING btree (message_id)
- `message_reactions_message_id_actor_type_actor_id_key`: CREATE UNIQUE INDEX message_reactions_message_id_actor_type_actor_id_key ON public.message_reactions USING btree (message_id, actor_type, actor_id)
- `message_reactions_pkey`: CREATE UNIQUE INDEX message_reactions_pkey ON public.message_reactions USING btree (id)

Check constraints:
- `message_reactions_actor_type_check`: CHECK ((actor_type = ANY (ARRAY['customer'::text, 'agent'::text])))

RLS policies:
- `message_reactions_modify` (ALL, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM (messages m
     JOIN conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = message_reactions.message_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
  - WITH CHECK: (EXISTS ( SELECT 1
   FROM (messages m
     JOIN conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = message_reactions.message_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
- `message_reactions_select` (SELECT, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM (messages m
     JOIN conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = message_reactions.message_id) AND is_account_member(c.account_id))))

### message_templates

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| user_id | uuid | no | — |
| name | text | no | — |
| category | text | no | `'Marketing'::text` |
| language | text | yes | `'en_US'::text` |
| header_type | text | yes | — |
| header_content | text | yes | — |
| body_text | text | no | — |
| footer_text | text | yes | — |
| buttons | jsonb | yes | — |
| status | text | yes | `'DRAFT'::text` |
| created_at | timestamp with time zone | yes | `now()` |
| updated_at | timestamp with time zone | yes | `now()` |
| sample_values | jsonb | yes | — |
| meta_template_id | text | yes | — |
| rejection_reason | text | yes | — |
| quality_score | text | yes | — |
| header_handle | text | yes | — |
| header_media_url | text | yes | — |
| submission_error | text | yes | — |
| last_submitted_at | timestamp with time zone | yes | — |
| account_id | uuid | no | — |
| provider | text | no | `'meta'::text` |
| twilio_content_sid | text | yes | — |
| channel | text | no | `'whatsapp'::text` |
| compliance | jsonb | yes | — |
| subject_text | text | yes | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `idx_message_templates_account`: CREATE INDEX idx_message_templates_account ON public.message_templates USING btree (account_id)
- `idx_message_templates_meta_template_id`: CREATE INDEX idx_message_templates_meta_template_id ON public.message_templates USING btree (meta_template_id) WHERE (meta_template_id IS NOT NULL)
- `message_templates_account_provider_name_language_key`: CREATE UNIQUE INDEX message_templates_account_provider_name_language_key ON public.message_templates USING btree (account_id, provider, name, language)
- `message_templates_channel_idx`: CREATE INDEX message_templates_channel_idx ON public.message_templates USING btree (account_id, channel, status)
- `message_templates_pkey`: CREATE UNIQUE INDEX message_templates_pkey ON public.message_templates USING btree (id)
- `message_templates_provider_status_idx`: CREATE INDEX message_templates_provider_status_idx ON public.message_templates USING btree (account_id, provider, status)
- `message_templates_twilio_content_sid_key`: CREATE UNIQUE INDEX message_templates_twilio_content_sid_key ON public.message_templates USING btree (account_id, twilio_content_sid) WHERE (twilio_content_sid IS NOT NULL)

Check constraints:
- `message_templates_buttons_shape_check`: CHECK (((buttons IS NULL) OR ((jsonb_typeof(buttons) = 'array'::text) AND (jsonb_array_length(buttons) <= 10))))
- `message_templates_category_check`: CHECK ((((channel = 'whatsapp'::text) AND (category = ANY (ARRAY['Marketing'::text, 'Utility'::text, 'Authentication'::text]))) OR ((channel = 'sms'::text) AND (category = ANY (ARRAY['marketing'::text, 'transactional'::text, 'otp'::text]))) OR ((channel = 'email'::text) AND (category = ANY (ARRAY['newsletter'::text, 'promotional'::text, 'transactional'::text, 'onboarding'::text, 'otp'::text])))))
- `message_templates_channel_check`: CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text])))
- `message_templates_header_type_check`: CHECK ((header_type = ANY (ARRAY['text'::text, 'image'::text, 'video'::text, 'document'::text])))
- `message_templates_provider_check`: CHECK ((provider = ANY (ARRAY['meta'::text, 'twilio'::text, 'none'::text])))
- `message_templates_provider_identifier_check`: CHECK ((((channel = 'whatsapp'::text) AND (provider = 'meta'::text) AND (twilio_content_sid IS NULL)) OR ((channel = 'whatsapp'::text) AND (provider = 'twilio'::text) AND (meta_template_id IS NULL)) OR ((channel = 'sms'::text) AND (meta_template_id IS NULL)) OR ((channel = 'email'::text) AND (meta_template_id IS NULL) AND (twilio_content_sid IS NULL))))
- `message_templates_quality_score_check`: CHECK (((quality_score IS NULL) OR (quality_score = ANY (ARRAY['GREEN'::text, 'YELLOW'::text, 'RED'::text]))))
- `message_templates_status_meta_check`: CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'PAUSED'::text, 'DISABLED'::text, 'IN_APPEAL'::text, 'PENDING_DELETION'::text])))
- `message_templates_subject_text_check`: CHECK (((subject_text IS NULL) OR (char_length(subject_text) <= 300)))

RLS policies:
- `message_templates_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `message_templates_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `message_templates_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `message_templates_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

Triggers:
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### messages

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| conversation_id | uuid | no | — |
| sender_type | text | no | — |
| sender_id | uuid | yes | — |
| content_type | text | no | `'text'::text` |
| content_text | text | yes | — |
| media_url | text | yes | — |
| template_name | text | yes | — |
| message_id | text | yes | — |
| status | text | no | `'sent'::text` |
| created_at | timestamp with time zone | yes | `now()` |
| reply_to_message_id | uuid | yes | — |
| interactive_reply_id | text | yes | — |
| ai_generated | boolean | no | `false` |
| interactive_payload | jsonb | yes | — |
| channel_connection_id | uuid | yes | — |
| external_message_id | text | yes | — |
| external_thread_id | text | yes | — |
| subject | text | yes | — |
| content_html | text | yes | — |
| provider_payload | jsonb | no | `'{}'::jsonb` |
| error_message | text | yes | — |

Foreign keys:
- `channel_connection_id` → `channel_connections.id` (on delete set null)
- `conversation_id` → `conversations.id` (on delete cascade)
- `reply_to_message_id` → `messages.id` (on delete set null)

Indexes:
- `idx_messages_connection_external`: CREATE UNIQUE INDEX idx_messages_connection_external ON public.messages USING btree (channel_connection_id, external_message_id) WHERE ((channel_connection_id IS NOT NULL) AND (external_message_id IS NOT NULL))
- `idx_messages_conversation`: CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id)
- `idx_messages_message_id`: CREATE INDEX idx_messages_message_id ON public.messages USING btree (message_id)
- `idx_messages_reply_to`: CREATE INDEX idx_messages_reply_to ON public.messages USING btree (reply_to_message_id) WHERE (reply_to_message_id IS NOT NULL)
- `messages_pkey`: CREATE UNIQUE INDEX messages_pkey ON public.messages USING btree (id)

Check constraints:
- `messages_content_type_check`: CHECK ((content_type = ANY (ARRAY['text'::text, 'image'::text, 'document'::text, 'audio'::text, 'video'::text, 'location'::text, 'template'::text, 'interactive'::text])))
- `messages_sender_type_check`: CHECK ((sender_type = ANY (ARRAY['customer'::text, 'agent'::text, 'bot'::text])))
- `messages_status_check`: CHECK ((status = ANY (ARRAY['sending'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'failed'::text])))

RLS policies:
- `messages_modify` (ALL, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
  - WITH CHECK: (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND is_account_member(c.account_id, 'agent'::account_role_enum))))
- `messages_select` (SELECT, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND is_account_member(c.account_id))))

### module_field_settings

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| account_id | uuid | no | — |
| module | text | no | — |
| layout | jsonb | no | `'{}'::jsonb` |
| updated_by | uuid | yes | — |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `module_field_settings_pkey`: CREATE UNIQUE INDEX module_field_settings_pkey ON public.module_field_settings USING btree (account_id, module)

Check constraints:
- `module_field_settings_module_check`: CHECK ((module = ANY (ARRAY['appointments'::text, 'catalog'::text])))

RLS policies:
- `module_field_settings_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `module_field_settings_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)
- `module_field_settings_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `module_field_settings_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)

### notification_preferences

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| account_id | uuid | no | — |
| user_id | uuid | no | — |
| in_app_enabled | boolean | no | `true` |
| email_enabled | boolean | no | `true` |
| event_preferences | jsonb | no | `'{}'::jsonb` |
| quiet_hours | jsonb | no | `'{}'::jsonb` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `notification_preferences_pkey`: CREATE UNIQUE INDEX notification_preferences_pkey ON public.notification_preferences USING btree (account_id, user_id)

RLS policies:
- `notification_preferences_insert` (INSERT, roles {public})
  - WITH CHECK: ((auth.uid() = user_id) AND is_account_member(account_id))
- `notification_preferences_select` (SELECT, roles {public})
  - USING: ((auth.uid() = user_id) AND is_account_member(account_id))
- `notification_preferences_update` (UPDATE, roles {public})
  - USING: ((auth.uid() = user_id) AND is_account_member(account_id))
  - WITH CHECK: ((auth.uid() = user_id) AND is_account_member(account_id))

### notifications

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| account_id | uuid | no | — |
| user_id | uuid | no | — |
| type | text | no | `'conversation_assigned'::text` |
| conversation_id | uuid | yes | — |
| contact_id | uuid | yes | — |
| actor_user_id | uuid | yes | — |
| title | text | no | — |
| body | text | yes | — |
| read_at | timestamp with time zone | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| metadata | jsonb | no | `'{}'::jsonb` |
| email_status | text | no | `'not_requested'::text` |
| email_sent_at | timestamp with time zone | yes | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `contact_id` → `contacts.id` (on delete set null)
- `conversation_id` → `conversations.id` (on delete cascade)

Indexes:
- `idx_notifications_user_created`: CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC)
- `idx_notifications_user_unread`: CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id) WHERE (read_at IS NULL)
- `notifications_pkey`: CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id)

Check constraints:
- `notifications_email_status_check`: CHECK ((email_status = ANY (ARRAY['not_requested'::text, 'pending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
- `notifications_type_check`: CHECK ((type = ANY (ARRAY['conversation_assigned'::text, 'ai_escalation'::text])))

RLS policies:
- `notifications_select` (SELECT, roles {public})
  - USING: (auth.uid() = user_id)
- `notifications_update` (UPDATE, roles {public})
  - USING: (auth.uid() = user_id)
  - WITH CHECK: (auth.uid() = user_id)

### oauth_connection_states

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| account_id | uuid | no | — |
| user_id | uuid | no | — |
| provider | channel_provider | no | — |
| state_hash | text | no | — |
| code_verifier_encrypted | text | yes | — |
| redirect_path | text | no | `'/settings'::text` |
| expires_at | timestamp with time zone | no | — |
| consumed_at | timestamp with time zone | yes | — |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `oauth_connection_states_pkey`: CREATE UNIQUE INDEX oauth_connection_states_pkey ON public.oauth_connection_states USING btree (id)
- `oauth_connection_states_state_hash_key`: CREATE UNIQUE INDEX oauth_connection_states_state_hash_key ON public.oauth_connection_states USING btree (state_hash)

Check constraints:
- `oauth_connection_states_provider_check`: CHECK ((provider = 'google'::channel_provider))

RLS policies:
- `oauth_states_insert` (INSERT, roles {public})
  - WITH CHECK: ((auth.uid() = user_id) AND is_account_member(account_id, 'admin'::account_role_enum))
- `oauth_states_select` (SELECT, roles {public})
  - USING: ((auth.uid() = user_id) AND is_account_member(account_id, 'admin'::account_role_enum))

### pipeline_saved_views

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| account_id | uuid | no | — |
| pipeline_id | uuid | no | — |
| created_by | uuid | no | — |
| name | text | no | — |
| filters | jsonb | no | `'{}'::jsonb` |
| sort | jsonb | no | `'{}'::jsonb` |
| visible_fields | text[] | no | `'{}'::text[]` |
| is_favorite | boolean | no | `false` |
| position | integer | no | `0` |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `pipeline_id` → `pipelines.id` (on delete cascade)

Indexes:
- `idx_pipeline_saved_views_scope`: CREATE INDEX idx_pipeline_saved_views_scope ON public.pipeline_saved_views USING btree (account_id, pipeline_id, "position")
- `pipeline_saved_views_account_id_pipeline_id_name_key`: CREATE UNIQUE INDEX pipeline_saved_views_account_id_pipeline_id_name_key ON public.pipeline_saved_views USING btree (account_id, pipeline_id, name)
- `pipeline_saved_views_pkey`: CREATE UNIQUE INDEX pipeline_saved_views_pkey ON public.pipeline_saved_views USING btree (id)

RLS policies:
- `pipeline_saved_views_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `pipeline_saved_views_insert` (INSERT, roles {public})
  - WITH CHECK: (is_account_member(account_id, 'agent'::account_role_enum) AND (created_by = auth.uid()))
- `pipeline_saved_views_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `pipeline_saved_views_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)

### pipeline_stages

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| pipeline_id | uuid | no | — |
| name | text | no | — |
| position | integer | no | `0` |
| color | text | no | `'#3b82f6'::text` |
| created_at | timestamp with time zone | yes | `now()` |

Foreign keys:
- `pipeline_id` → `pipelines.id` (on delete cascade)

Indexes:
- `idx_pipeline_stages_pipeline`: CREATE INDEX idx_pipeline_stages_pipeline ON public.pipeline_stages USING btree (pipeline_id)
- `pipeline_stages_pkey`: CREATE UNIQUE INDEX pipeline_stages_pkey ON public.pipeline_stages USING btree (id)

RLS policies:
- `pipeline_stages_modify` (ALL, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM pipelines p
  WHERE ((p.id = pipeline_stages.pipeline_id) AND is_account_member(p.account_id, 'admin'::account_role_enum))))
  - WITH CHECK: (EXISTS ( SELECT 1
   FROM pipelines p
  WHERE ((p.id = pipeline_stages.pipeline_id) AND is_account_member(p.account_id, 'admin'::account_role_enum))))
- `pipeline_stages_select` (SELECT, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM pipelines p
  WHERE ((p.id = pipeline_stages.pipeline_id) AND is_account_member(p.account_id))))

### pipelines

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| user_id | uuid | no | — |
| name | text | no | — |
| created_at | timestamp with time zone | yes | `now()` |
| account_id | uuid | no | — |
| position | integer | no | `0` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `idx_pipelines_account`: CREATE INDEX idx_pipelines_account ON public.pipelines USING btree (account_id)
- `idx_pipelines_account_position`: CREATE INDEX idx_pipelines_account_position ON public.pipelines USING btree (account_id, "position")
- `pipelines_pkey`: CREATE UNIQUE INDEX pipelines_pkey ON public.pipelines USING btree (id)

RLS policies:
- `pipelines_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `pipelines_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `pipelines_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `pipelines_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

### platform_audit_log

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| actor_id | uuid | no | — |
| account_id | uuid | yes | — |
| action | text | no | — |
| entity | text | no | — |
| before | jsonb | yes | — |
| after | jsonb | yes | — |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete set null)

Indexes:
- `idx_platform_audit_log_account`: CREATE INDEX idx_platform_audit_log_account ON public.platform_audit_log USING btree (account_id, created_at DESC)
- `idx_platform_audit_log_recency`: CREATE INDEX idx_platform_audit_log_recency ON public.platform_audit_log USING btree (created_at DESC)
- `platform_audit_log_pkey`: CREATE UNIQUE INDEX platform_audit_log_pkey ON public.platform_audit_log USING btree (id)

RLS policies:
- `Super admins can insert audit entries` (INSERT, roles {public})
  - WITH CHECK: (is_platform_super_admin() AND (actor_id = auth.uid()))
- `Super admins can read audit entries` (SELECT, roles {public})
  - USING: is_platform_super_admin()

### platform_provider_policies

RLS: enabled · approx rows: -1

Platform-wide provider availability switches. RLS with no policies: service-role access only via the super-admin gated /api/admin/providers route.

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| provider | text | no | — |
| channel | text | no | — |
| is_enabled | boolean | no | `true` |
| notes | text | yes | — |
| updated_at | timestamp with time zone | no | `now()` |
| display_label | text | yes | — |
| icon | text | yes | — |

Indexes:
- `platform_provider_policies_pkey`: CREATE UNIQUE INDEX platform_provider_policies_pkey ON public.platform_provider_policies USING btree (provider, channel)

Check constraints:
- `platform_provider_policies_channel_check`: CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text])))
- `platform_provider_policies_provider_check`: CHECK ((provider = ANY (ARRAY['meta'::text, 'twilio'::text, 'google'::text, 'microsoft'::text, 'resend'::text, 'smtp'::text, 'mailtrap'::text])))

### platform_settings

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| key | text | no | — |
| value | jsonb | no | — |
| updated_at | timestamp with time zone | no | `now()` |

Indexes:
- `platform_settings_pkey`: CREATE UNIQUE INDEX platform_settings_pkey ON public.platform_settings USING btree (key)

### profiles

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| user_id | uuid | no | — |
| full_name | text | no | — |
| email | text | no | — |
| avatar_url | text | yes | — |
| role | text | yes | `'user'::text` |
| created_at | timestamp with time zone | yes | `now()` |
| updated_at | timestamp with time zone | yes | `now()` |
| beta_features | text[] | no | `ARRAY[]::text[]` |
| account_id | uuid | no | — |
| account_role | account_role_enum | no | — |
| last_ai_assignment_at | timestamp with time zone | yes | — |
| is_super_admin | boolean | no | `false` |
| workspace_role_id | uuid | yes | — |
| workspace_profile_id | uuid | yes | — |
| status | text | no | `'active'::text` |
| status_changed_at | timestamp with time zone | yes | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `workspace_profile_id` → `workspace_profiles.id` (on delete restrict)
- `workspace_role_id` → `workspace_roles.id` (on delete set null)

Indexes:
- `idx_profiles_account_role`: CREATE INDEX idx_profiles_account_role ON public.profiles USING btree (account_id, account_role)
- `idx_profiles_account_status`: CREATE INDEX idx_profiles_account_status ON public.profiles USING btree (account_id, status)
- `idx_profiles_super_admin`: CREATE INDEX idx_profiles_super_admin ON public.profiles USING btree (user_id) WHERE is_super_admin
- `idx_profiles_workspace_profile`: CREATE INDEX idx_profiles_workspace_profile ON public.profiles USING btree (workspace_profile_id) WHERE (workspace_profile_id IS NOT NULL)
- `idx_profiles_workspace_role`: CREATE INDEX idx_profiles_workspace_role ON public.profiles USING btree (workspace_role_id)
- `profiles_pkey`: CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id)
- `profiles_user_id_key`: CREATE UNIQUE INDEX profiles_user_id_key ON public.profiles USING btree (user_id)

Check constraints:
- `profiles_status_check`: CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'deleted'::text])))

RLS policies:
- `profiles_insert` (INSERT, roles {public})
  - WITH CHECK: (auth.uid() = user_id)
- `profiles_select` (SELECT, roles {public})
  - USING: ((auth.uid() = user_id) OR is_account_member(account_id))
- `profiles_update` (UPDATE, roles {public})
  - USING: (auth.uid() = user_id)
  - WITH CHECK: (auth.uid() = user_id)

Triggers:
- `enforce_profile_privilege_columns`: BEFORE UPDATE → EXECUTE FUNCTION enforce_profile_privilege_columns()
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### quick_replies

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| account_id | uuid | no | — |
| user_id | uuid | no | — |
| title | text | no | — |
| kind | text | no | `'text'::text` |
| content_text | text | yes | — |
| interactive_payload | jsonb | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `idx_quick_replies_account`: CREATE INDEX idx_quick_replies_account ON public.quick_replies USING btree (account_id)
- `quick_replies_pkey`: CREATE UNIQUE INDEX quick_replies_pkey ON public.quick_replies USING btree (id)

Check constraints:
- `quick_replies_kind_check`: CHECK ((kind = ANY (ARRAY['text'::text, 'interactive'::text])))

RLS policies:
- `quick_replies_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `quick_replies_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)
- `quick_replies_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `quick_replies_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)

Triggers:
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### sub_pipeline_deals

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| account_id | uuid | no | — |
| sub_pipeline_id | uuid | no | — |
| deal_id | uuid | no | — |
| position | integer | no | `0` |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `deal_id` → `deals.id` (on delete cascade)
- `sub_pipeline_id` → `sub_pipelines.id` (on delete cascade)

Indexes:
- `idx_sub_pipeline_deals_scope`: CREATE INDEX idx_sub_pipeline_deals_scope ON public.sub_pipeline_deals USING btree (account_id, sub_pipeline_id, "position")
- `sub_pipeline_deals_pkey`: CREATE UNIQUE INDEX sub_pipeline_deals_pkey ON public.sub_pipeline_deals USING btree (sub_pipeline_id, deal_id)

RLS policies:
- `sub_pipeline_deals_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `sub_pipeline_deals_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)
- `sub_pipeline_deals_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `sub_pipeline_deals_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)

### sub_pipelines

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| account_id | uuid | no | — |
| pipeline_id | uuid | no | — |
| name | text | no | — |
| position | integer | no | `0` |
| created_by | uuid | no | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `pipeline_id` → `pipelines.id` (on delete cascade)

Indexes:
- `idx_sub_pipelines_scope`: CREATE INDEX idx_sub_pipelines_scope ON public.sub_pipelines USING btree (account_id, pipeline_id, "position")
- `sub_pipelines_account_id_pipeline_id_name_key`: CREATE UNIQUE INDEX sub_pipelines_account_id_pipeline_id_name_key ON public.sub_pipelines USING btree (account_id, pipeline_id, name)
- `sub_pipelines_pkey`: CREATE UNIQUE INDEX sub_pipelines_pkey ON public.sub_pipelines USING btree (id)

RLS policies:
- `sub_pipelines_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `sub_pipelines_insert` (INSERT, roles {public})
  - WITH CHECK: (is_account_member(account_id, 'agent'::account_role_enum) AND (created_by = auth.uid()))
- `sub_pipelines_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `sub_pipelines_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)

### support_ticket_messages

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| ticket_id | uuid | no | — |
| author_id | uuid | no | — |
| is_admin_reply | boolean | no | `false` |
| body | text | no | — |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `ticket_id` → `support_tickets.id` (on delete cascade)

Indexes:
- `idx_support_ticket_messages_thread`: CREATE INDEX idx_support_ticket_messages_thread ON public.support_ticket_messages USING btree (ticket_id, created_at)
- `support_ticket_messages_pkey`: CREATE UNIQUE INDEX support_ticket_messages_pkey ON public.support_ticket_messages USING btree (id)

Check constraints:
- `support_ticket_messages_body_check`: CHECK (((char_length(body) >= 1) AND (char_length(body) <= 10000)))

RLS policies:
- `Participants post messages` (INSERT, roles {public})
  - WITH CHECK: ((author_id = auth.uid()) AND ((is_admin_reply AND is_platform_super_admin()) OR ((NOT is_admin_reply) AND (EXISTS ( SELECT 1
   FROM support_tickets t
  WHERE ((t.id = support_ticket_messages.ticket_id) AND is_account_member(t.account_id, 'viewer'::account_role_enum)))))))
- `Ticket participants read messages` (SELECT, roles {public})
  - USING: (EXISTS ( SELECT 1
   FROM support_tickets t
  WHERE ((t.id = support_ticket_messages.ticket_id) AND (is_account_member(t.account_id, 'viewer'::account_role_enum) OR is_platform_super_admin()))))

### support_tickets

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| created_by | uuid | no | — |
| subject | text | no | — |
| category | text | no | `'other'::text` |
| priority | text | no | `'normal'::text` |
| status | text | no | `'open'::text` |
| assigned_admin | uuid | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `idx_support_tickets_account`: CREATE INDEX idx_support_tickets_account ON public.support_tickets USING btree (account_id, created_at DESC)
- `idx_support_tickets_queue`: CREATE INDEX idx_support_tickets_queue ON public.support_tickets USING btree (status, priority, updated_at DESC)
- `support_tickets_pkey`: CREATE UNIQUE INDEX support_tickets_pkey ON public.support_tickets USING btree (id)

Check constraints:
- `support_tickets_category_check`: CHECK ((category = ANY (ARRAY['billing'::text, 'technical'::text, 'channel_setup'::text, 'agent_help'::text, 'other'::text])))
- `support_tickets_priority_check`: CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])))
- `support_tickets_status_check`: CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'waiting_on_user'::text, 'resolved'::text, 'closed'::text])))
- `support_tickets_subject_check`: CHECK (((char_length(subject) >= 3) AND (char_length(subject) <= 200)))

RLS policies:
- `Creator or super admin updates tickets` (UPDATE, roles {public})
  - USING: ((created_by = auth.uid()) OR is_platform_super_admin())
- `Members create tickets for own account` (INSERT, roles {public})
  - WITH CHECK: (is_account_member(account_id, 'viewer'::account_role_enum) AND (created_by = auth.uid()))
- `Members read own account tickets` (SELECT, roles {public})
  - USING: (is_account_member(account_id, 'viewer'::account_role_enum) OR is_platform_super_admin())

Triggers:
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### tags

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| user_id | uuid | no | — |
| name | text | no | — |
| color | text | no | `'#3b82f6'::text` |
| created_at | timestamp with time zone | yes | `now()` |
| account_id | uuid | no | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `idx_tags_account`: CREATE INDEX idx_tags_account ON public.tags USING btree (account_id)
- `tags_pkey`: CREATE UNIQUE INDEX tags_pkey ON public.tags USING btree (id)

RLS policies:
- `tags_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `tags_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `tags_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `tags_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

### tasks

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| created_by | uuid | yes | — |
| contact_id | uuid | yes | — |
| deal_id | uuid | yes | — |
| assigned_to | uuid | yes | — |
| title | text | no | — |
| notes | text | yes | — |
| due_at | timestamp with time zone | yes | — |
| priority | text | no | `'medium'::text` |
| status | text | no | `'open'::text` |
| completed_at | timestamp with time zone | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `contact_id` → `contacts.id` (on delete cascade)
- `deal_id` → `deals.id` (on delete cascade)

Indexes:
- `idx_tasks_account_open`: CREATE INDEX idx_tasks_account_open ON public.tasks USING btree (account_id, due_at) WHERE (status = 'open'::text)
- `idx_tasks_contact`: CREATE INDEX idx_tasks_contact ON public.tasks USING btree (contact_id) WHERE (contact_id IS NOT NULL)
- `tasks_pkey`: CREATE UNIQUE INDEX tasks_pkey ON public.tasks USING btree (id)

Check constraints:
- `tasks_priority_check`: CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))
- `tasks_status_check`: CHECK ((status = ANY (ARRAY['open'::text, 'done'::text, 'cancelled'::text])))

RLS policies:
- `tasks_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)
- `tasks_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'agent'::account_role_enum)
- `tasks_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `tasks_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'agent'::account_role_enum)

Triggers:
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### team_conversation_members

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| conversation_id | uuid | no | — |
| user_id | uuid | no | — |
| joined_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `conversation_id` → `team_conversations.id` (on delete cascade)

Indexes:
- `idx_team_conversation_members_user`: CREATE INDEX idx_team_conversation_members_user ON public.team_conversation_members USING btree (user_id)
- `team_conversation_members_pkey`: CREATE UNIQUE INDEX team_conversation_members_pkey ON public.team_conversation_members USING btree (conversation_id, user_id)

RLS policies:
- `team_conversation_members_delete` (DELETE, roles {public})
  - USING: ((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM team_conversations c
  WHERE ((c.id = team_conversation_members.conversation_id) AND ((c.created_by = auth.uid()) OR is_account_member(c.account_id, 'admin'::account_role_enum))))))
- `team_conversation_members_insert` (INSERT, roles {public})
  - WITH CHECK: (EXISTS ( SELECT 1
   FROM team_conversations c
  WHERE ((c.id = team_conversation_members.conversation_id) AND ((c.created_by = auth.uid()) OR is_account_member(c.account_id, 'admin'::account_role_enum)) AND (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.user_id = team_conversation_members.user_id) AND (p.account_id = c.account_id)))))))
- `team_conversation_members_select` (SELECT, roles {public})
  - USING: is_team_conversation_member(conversation_id)

### team_conversations

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| kind | text | no | — |
| name | text | yes | — |
| dm_key | text | yes | — |
| created_by | uuid | no | — |
| last_message_at | timestamp with time zone | yes | — |
| last_message_text | text | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `idx_team_conversations_account`: CREATE INDEX idx_team_conversations_account ON public.team_conversations USING btree (account_id, last_message_at DESC NULLS LAST)
- `idx_team_conversations_dm_key`: CREATE UNIQUE INDEX idx_team_conversations_dm_key ON public.team_conversations USING btree (account_id, dm_key) WHERE (dm_key IS NOT NULL)
- `team_conversations_pkey`: CREATE UNIQUE INDEX team_conversations_pkey ON public.team_conversations USING btree (id)

Check constraints:
- `team_conversations_check`: CHECK (((kind <> 'channel'::text) OR ((name IS NOT NULL) AND (length(TRIM(BOTH FROM name)) > 0))))
- `team_conversations_kind_check`: CHECK ((kind = ANY (ARRAY['dm'::text, 'channel'::text])))

RLS policies:
- `team_conversations_delete` (DELETE, roles {public})
  - USING: ((created_by = auth.uid()) OR is_account_member(account_id, 'admin'::account_role_enum))
- `team_conversations_insert` (INSERT, roles {public})
  - WITH CHECK: ((created_by = auth.uid()) AND
CASE kind
    WHEN 'channel'::text THEN is_account_member(account_id, 'admin'::account_role_enum)
    ELSE is_account_member(account_id, 'agent'::account_role_enum)
END)
- `team_conversations_select` (SELECT, roles {public})
  - USING: ((created_by = auth.uid()) OR is_team_conversation_member(id))
- `team_conversations_update` (UPDATE, roles {public})
  - USING: (is_team_conversation_member(id) AND ((created_by = auth.uid()) OR is_account_member(account_id, 'admin'::account_role_enum)))

### team_messages

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| conversation_id | uuid | no | — |
| account_id | uuid | no | — |
| sender_id | uuid | no | — |
| body | text | no | — |
| parent_id | uuid | yes | — |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `conversation_id` → `team_conversations.id` (on delete cascade)
- `parent_id` → `team_messages.id` (on delete set null)

Indexes:
- `idx_team_messages_conversation`: CREATE INDEX idx_team_messages_conversation ON public.team_messages USING btree (conversation_id, created_at DESC)
- `team_messages_pkey`: CREATE UNIQUE INDEX team_messages_pkey ON public.team_messages USING btree (id)

Check constraints:
- `team_messages_body_check`: CHECK ((length(TRIM(BOTH FROM body)) > 0))

RLS policies:
- `team_messages_insert` (INSERT, roles {public})
  - WITH CHECK: ((sender_id = auth.uid()) AND is_team_conversation_member(conversation_id) AND is_account_member(account_id, 'agent'::account_role_enum))
- `team_messages_select` (SELECT, roles {public})
  - USING: is_team_conversation_member(conversation_id)

Triggers:
- `trg_team_messages_touch`: AFTER INSERT → EXECUTE FUNCTION team_messages_touch_conversation()

### team_read_cursors

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| conversation_id | uuid | no | — |
| user_id | uuid | no | — |
| last_read_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `conversation_id` → `team_conversations.id` (on delete cascade)

Indexes:
- `team_read_cursors_pkey`: CREATE UNIQUE INDEX team_read_cursors_pkey ON public.team_read_cursors USING btree (conversation_id, user_id)

RLS policies:
- `team_read_cursors_select` (SELECT, roles {public})
  - USING: (user_id = auth.uid())
- `team_read_cursors_update` (UPDATE, roles {public})
  - USING: (user_id = auth.uid())
- `team_read_cursors_upsert` (INSERT, roles {public})
  - WITH CHECK: ((user_id = auth.uid()) AND is_team_conversation_member(conversation_id))

### template_variables

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| key | text | no | — |
| label | text | no | `''::text` |
| sample_value | text | no | `''::text` |
| created_by_user_id | uuid | yes | — |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `template_variables_account_id_key_key`: CREATE UNIQUE INDEX template_variables_account_id_key_key ON public.template_variables USING btree (account_id, key)
- `template_variables_account_idx`: CREATE INDEX template_variables_account_idx ON public.template_variables USING btree (account_id, created_at)
- `template_variables_pkey`: CREATE UNIQUE INDEX template_variables_pkey ON public.template_variables USING btree (id)

Check constraints:
- `template_variables_key_check`: CHECK ((key ~ '^[a-z0-9_]{1,40}$'::text))

RLS policies:
- `template_variables_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id)
- `template_variables_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id)
- `template_variables_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `template_variables_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id)

### user_dashboards

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| user_id | uuid | no | — |
| name | text | no | — |
| widgets | jsonb | no | `'[]'::jsonb` |
| position | integer | no | `0` |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `idx_user_dashboards_user`: CREATE INDEX idx_user_dashboards_user ON public.user_dashboards USING btree (user_id, account_id, "position")
- `user_dashboards_pkey`: CREATE UNIQUE INDEX user_dashboards_pkey ON public.user_dashboards USING btree (id)

Check constraints:
- `user_dashboards_name_check`: CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60)))

RLS policies:
- `user_dashboards_delete` (DELETE, roles {public})
  - USING: (user_id = auth.uid())
- `user_dashboards_insert` (INSERT, roles {public})
  - WITH CHECK: (user_id = auth.uid())
- `user_dashboards_select` (SELECT, roles {public})
  - USING: (user_id = auth.uid())
- `user_dashboards_update` (UPDATE, roles {public})
  - USING: (user_id = auth.uid())

### webhook_endpoints

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| created_by | uuid | yes | — |
| url | text | no | — |
| secret | text | no | — |
| events | text[] | no | `'{}'::text[]` |
| is_active | boolean | no | `true` |
| last_delivery_at | timestamp with time zone | yes | — |
| failure_count | integer | no | `0` |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `webhook_endpoints_account_id_idx`: CREATE INDEX webhook_endpoints_account_id_idx ON public.webhook_endpoints USING btree (account_id)
- `webhook_endpoints_pkey`: CREATE UNIQUE INDEX webhook_endpoints_pkey ON public.webhook_endpoints USING btree (id)

RLS policies:
- `webhook_endpoints_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `webhook_endpoints_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `webhook_endpoints_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `webhook_endpoints_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

### whatsapp_config

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| user_id | uuid | no | — |
| phone_number_id | text | no | — |
| waba_id | text | yes | — |
| access_token | text | no | — |
| verify_token | text | yes | — |
| status | text | no | `'disconnected'::text` |
| connected_at | timestamp with time zone | yes | — |
| created_at | timestamp with time zone | yes | `now()` |
| updated_at | timestamp with time zone | yes | `now()` |
| registered_at | timestamp with time zone | yes | — |
| subscribed_apps_at | timestamp with time zone | yes | — |
| last_registration_error | text | yes | — |
| account_id | uuid | no | — |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `idx_whatsapp_config_account`: CREATE INDEX idx_whatsapp_config_account ON public.whatsapp_config USING btree (account_id)
- `idx_whatsapp_config_registered_at`: CREATE INDEX idx_whatsapp_config_registered_at ON public.whatsapp_config USING btree (registered_at) WHERE (registered_at IS NULL)
- `whatsapp_config_account_id_key`: CREATE UNIQUE INDEX whatsapp_config_account_id_key ON public.whatsapp_config USING btree (account_id)
- `whatsapp_config_phone_number_id_key`: CREATE UNIQUE INDEX whatsapp_config_phone_number_id_key ON public.whatsapp_config USING btree (phone_number_id)
- `whatsapp_config_pkey`: CREATE UNIQUE INDEX whatsapp_config_pkey ON public.whatsapp_config USING btree (id)

Check constraints:
- `whatsapp_config_status_check`: CHECK ((status = ANY (ARRAY['connected'::text, 'disconnected'::text])))

RLS policies:
- `whatsapp_config_delete` (DELETE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)
- `whatsapp_config_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `whatsapp_config_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `whatsapp_config_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

Triggers:
- `set_updated_at`: BEFORE UPDATE → EXECUTE FUNCTION update_updated_at_column()

### workflow_connections

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `gen_random_uuid()` |
| account_id | uuid | no | — |
| created_by | uuid | no | — |
| name | text | no | — |
| auth_type | text | no | `'bearer'::text` |
| header_name | text | yes | — |
| secret | text | no | — |
| base_url | text | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `idx_workflow_connections_account`: CREATE INDEX idx_workflow_connections_account ON public.workflow_connections USING btree (account_id)
- `workflow_connections_account_id_name_key`: CREATE UNIQUE INDEX workflow_connections_account_id_name_key ON public.workflow_connections USING btree (account_id, name)
- `workflow_connections_pkey`: CREATE UNIQUE INDEX workflow_connections_pkey ON public.workflow_connections USING btree (id)

Check constraints:
- `workflow_connections_auth_type_check`: CHECK ((auth_type = ANY (ARRAY['bearer'::text, 'header'::text, 'basic'::text])))

RLS policies:
- `workflow_connections_delete` (DELETE, roles {public})
  - USING: (account_id IN ( SELECT p.account_id
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum])))))
- `workflow_connections_insert` (INSERT, roles {public})
  - WITH CHECK: (account_id IN ( SELECT p.account_id
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum])))))
- `workflow_connections_select` (SELECT, roles {public})
  - USING: (account_id IN ( SELECT p.account_id
   FROM profiles p
  WHERE (p.user_id = auth.uid())))
- `workflow_connections_update` (UPDATE, roles {public})
  - USING: (account_id IN ( SELECT p.account_id
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum])))))

### workspace_profiles

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| account_id | uuid | no | — |
| name | text | no | — |
| description | text | yes | — |
| permissions | text[] | no | `'{}'::text[]` |
| is_system | boolean | no | `false` |
| created_by_user_id | uuid | yes | — |
| created_at | timestamp with time zone | no | `now()` |
| updated_by_user_id | uuid | yes | — |
| updated_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)

Indexes:
- `idx_workspace_profiles_account`: CREATE INDEX idx_workspace_profiles_account ON public.workspace_profiles USING btree (account_id)
- `workspace_profiles_account_id_name_key`: CREATE UNIQUE INDEX workspace_profiles_account_id_name_key ON public.workspace_profiles USING btree (account_id, name)
- `workspace_profiles_pkey`: CREATE UNIQUE INDEX workspace_profiles_pkey ON public.workspace_profiles USING btree (id)

Check constraints:
- `workspace_profiles_description_check`: CHECK ((char_length(description) <= 500))
- `workspace_profiles_name_check`: CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)))

RLS policies:
- `workspace_profiles_delete` (DELETE, roles {public})
  - USING: ((NOT is_system) AND is_account_member(account_id, 'admin'::account_role_enum) AND (NOT (EXISTS ( SELECT 1
   FROM profiles p
  WHERE (p.workspace_profile_id = workspace_profiles.id)))))
- `workspace_profiles_insert` (INSERT, roles {public})
  - WITH CHECK: ((NOT is_system) AND is_account_member(account_id, 'admin'::account_role_enum))
- `workspace_profiles_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `workspace_profiles_update` (UPDATE, roles {public})
  - USING: ((NOT is_system) AND is_account_member(account_id, 'admin'::account_role_enum))

### workspace_roles

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| account_id | uuid | no | — |
| name | text | no | — |
| description | text | yes | — |
| parent_role_id | uuid | yes | — |
| peer_visibility | boolean | no | `true` |
| is_system | boolean | no | `false` |
| created_by_user_id | uuid | yes | — |
| created_at | timestamp with time zone | no | `now()` |

Foreign keys:
- `account_id` → `accounts.id` (on delete cascade)
- `parent_role_id` → `workspace_roles.id` (on delete set null)

Indexes:
- `idx_workspace_roles_account`: CREATE INDEX idx_workspace_roles_account ON public.workspace_roles USING btree (account_id)
- `idx_workspace_roles_parent`: CREATE INDEX idx_workspace_roles_parent ON public.workspace_roles USING btree (parent_role_id) WHERE (parent_role_id IS NOT NULL)
- `workspace_roles_account_id_name_key`: CREATE UNIQUE INDEX workspace_roles_account_id_name_key ON public.workspace_roles USING btree (account_id, name)
- `workspace_roles_pkey`: CREATE UNIQUE INDEX workspace_roles_pkey ON public.workspace_roles USING btree (id)

Check constraints:
- `workspace_roles_description_check`: CHECK ((char_length(description) <= 500))
- `workspace_roles_name_check`: CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)))

RLS policies:
- `workspace_roles_delete` (DELETE, roles {public})
  - USING: ((NOT is_system) AND is_account_member(account_id, 'admin'::account_role_enum))
- `workspace_roles_insert` (INSERT, roles {public})
  - WITH CHECK: is_account_member(account_id, 'admin'::account_role_enum)
- `workspace_roles_select` (SELECT, roles {public})
  - USING: is_account_member(account_id)
- `workspace_roles_update` (UPDATE, roles {public})
  - USING: is_account_member(account_id, 'admin'::account_role_enum)

### workspace_templates

RLS: enabled · approx rows: -1

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | no | `uuid_generate_v4()` |
| slug | text | no | — |
| kind | text | no | — |
| name | text | no | — |
| description | text | yes | — |
| definition | jsonb | no | — |
| version | integer | no | `1` |
| is_default | boolean | no | `false` |
| is_active | boolean | no | `true` |
| created_at | timestamp with time zone | no | `now()` |
| updated_at | timestamp with time zone | no | `now()` |

Indexes:
- `workspace_templates_pkey`: CREATE UNIQUE INDEX workspace_templates_pkey ON public.workspace_templates USING btree (id)
- `workspace_templates_slug_key`: CREATE UNIQUE INDEX workspace_templates_slug_key ON public.workspace_templates USING btree (slug)

Check constraints:
- `workspace_templates_kind_check`: CHECK ((kind = ANY (ARRAY['pipeline'::text, 'tags'::text, 'quick_replies'::text])))

RLS policies:
- `workspace_templates_select` (SELECT, roles {authenticated})
  - USING: is_active

## Functions

- `_bcast_bump(bid uuid, col text, delta integer)` → void **SECURITY DEFINER**
- `_bcast_cols_for_status(s text)` → text[]
- `activate_ai_bot(p_account_id uuid, p_bot_id uuid)` → boolean **SECURITY DEFINER**
- `admin_provider_activity(p_days integer)` → TABLE(day date, channel text, total bigint, failed bigint) **SECURITY DEFINER**
- `admin_revoke_all_auth_sessions(p_user_id uuid, p_keep_session_id uuid)` → integer **SECURITY DEFINER**
- `admin_revoke_auth_session(p_session_id uuid, p_user_id uuid)` → boolean **SECURITY DEFINER**
- `array_to_halfvec(integer[], integer, boolean)` → halfvec
- `array_to_halfvec(numeric[], integer, boolean)` → halfvec
- `array_to_halfvec(double precision[], integer, boolean)` → halfvec
- `array_to_halfvec(real[], integer, boolean)` → halfvec
- `array_to_sparsevec(real[], integer, boolean)` → sparsevec
- `array_to_sparsevec(double precision[], integer, boolean)` → sparsevec
- `array_to_sparsevec(numeric[], integer, boolean)` → sparsevec
- `array_to_sparsevec(integer[], integer, boolean)` → sparsevec
- `array_to_vector(double precision[], integer, boolean)` → vector
- `array_to_vector(integer[], integer, boolean)` → vector
- `array_to_vector(real[], integer, boolean)` → vector
- `array_to_vector(numeric[], integer, boolean)` → vector
- `avg(halfvec)` → halfvec
- `avg(vector)` → vector
- `binary_quantize(halfvec)` → bit
- `binary_quantize(vector)` → bit
- `broadcast_recipient_aggregate_trigger()` → trigger **SECURITY DEFINER**
- `claim_ai_reply_slot(conversation_id uuid, max_replies integer)` → boolean **SECURITY DEFINER**
- `claim_round_robin_agent(p_account_id uuid)` → uuid **SECURITY DEFINER**
- `cosine_distance(sparsevec, sparsevec)` → double precision
- `cosine_distance(vector, vector)` → double precision
- `cosine_distance(halfvec, halfvec)` → double precision
- `enforce_profile_privilege_columns()` → trigger
- `filter_contacts_by_tags(p_tag_ids uuid[], p_search text, p_limit integer, p_offset integer)` → TABLE(contact contacts, total_count bigint)
- `get_account_context()` → TABLE(user_id uuid, account_id uuid, account_role text, account_name text, status text, is_owner boolean, permissions text[], workspace_profile_id uuid, workspace_profile_name text)
- `halfvec(halfvec, integer, boolean)` → halfvec
- `halfvec_accum(double precision[], halfvec)` → double precision[]
- `halfvec_add(halfvec, halfvec)` → halfvec
- `halfvec_avg(double precision[])` → halfvec
- `halfvec_cmp(halfvec, halfvec)` → integer
- `halfvec_combine(double precision[], double precision[])` → double precision[]
- `halfvec_concat(halfvec, halfvec)` → halfvec
- `halfvec_eq(halfvec, halfvec)` → boolean
- `halfvec_ge(halfvec, halfvec)` → boolean
- `halfvec_gt(halfvec, halfvec)` → boolean
- `halfvec_in(cstring, oid, integer)` → halfvec
- `halfvec_l2_squared_distance(halfvec, halfvec)` → double precision
- `halfvec_le(halfvec, halfvec)` → boolean
- `halfvec_lt(halfvec, halfvec)` → boolean
- `halfvec_mul(halfvec, halfvec)` → halfvec
- `halfvec_ne(halfvec, halfvec)` → boolean
- `halfvec_negative_inner_product(halfvec, halfvec)` → double precision
- `halfvec_out(halfvec)` → cstring
- `halfvec_recv(internal, oid, integer)` → halfvec
- `halfvec_send(halfvec)` → bytea
- `halfvec_spherical_distance(halfvec, halfvec)` → double precision
- `halfvec_sub(halfvec, halfvec)` → halfvec
- `halfvec_to_float4(halfvec, integer, boolean)` → real[]
- `halfvec_to_sparsevec(halfvec, integer, boolean)` → sparsevec
- `halfvec_to_vector(halfvec, integer, boolean)` → vector
- `halfvec_typmod_in(cstring[])` → integer
- `hamming_distance(bit, bit)` → double precision
- `handle_new_user()` → trigger **SECURITY DEFINER**
- `has_permission(target_account_id uuid, permission_slug text)` → boolean **SECURITY DEFINER**
- `hnsw_bit_support(internal)` → internal
- `hnsw_halfvec_support(internal)` → internal
- `hnsw_sparsevec_support(internal)` → internal
- `hnswhandler(internal)` → index_am_handler
- `increment_automation_execution_count(p_automation_id uuid)` → void **SECURITY DEFINER**
- `increment_flow_execution_count(p_flow_id uuid)` → void **SECURITY DEFINER**
- `inner_product(halfvec, halfvec)` → double precision
- `inner_product(sparsevec, sparsevec)` → double precision
- `inner_product(vector, vector)` → double precision
- `is_account_member(target_account_id uuid, min_role account_role_enum)` → boolean **SECURITY DEFINER**
- `is_platform_super_admin()` → boolean **SECURITY DEFINER**
- `is_team_conversation_member(p_conversation_id uuid)` → boolean **SECURITY DEFINER**
- `ivfflat_bit_support(internal)` → internal
- `ivfflat_halfvec_support(internal)` → internal
- `ivfflathandler(internal)` → index_am_handler
- `jaccard_distance(bit, bit)` → double precision
- `l1_distance(sparsevec, sparsevec)` → double precision
- `l1_distance(halfvec, halfvec)` → double precision
- `l1_distance(vector, vector)` → double precision
- `l2_distance(halfvec, halfvec)` → double precision
- `l2_distance(vector, vector)` → double precision
- `l2_distance(sparsevec, sparsevec)` → double precision
- `l2_norm(sparsevec)` → double precision
- `l2_norm(halfvec)` → double precision
- `l2_normalize(sparsevec)` → sparsevec
- `l2_normalize(halfvec)` → halfvec
- `l2_normalize(vector)` → vector
- `mark_account_domain_verified(p_domain_id uuid)` → boolean **SECURITY DEFINER**
- `match_ai_knowledge_fts(p_account_id uuid, p_query text, p_match_count integer)` → TABLE(id uuid, content text, rank real)
- `match_ai_knowledge_semantic(p_account_id uuid, p_query_embedding text, p_match_count integer)` → TABLE(id uuid, content text, distance real)
- `merge_duplicate_contacts()` → integer **SECURITY DEFINER**
- `merge_duplicate_conversations()` → integer **SECURITY DEFINER**
- `notify_conversation_assigned()` → trigger **SECURITY DEFINER**
- `peek_invitation(p_token_hash text)` → json **SECURITY DEFINER**
- `pick_round_robin_agent(p_account_id uuid)` → TABLE(user_id uuid)
- `provision_account_defaults(p_account_id uuid, p_owner_user_id uuid)` → integer **SECURITY DEFINER**
- `recompute_broadcast_counts(bid uuid)` → void **SECURITY DEFINER**
- `record_webhook_failure(endpoint_id uuid, max_failures integer)` → void **SECURITY DEFINER**
- `redeem_invitation(p_token_hash text)` → uuid **SECURITY DEFINER**
- `release_ai_reply_slot(conversation_id uuid)` → void **SECURITY DEFINER**
- `remove_account_member(p_user_id uuid)` → uuid **SECURITY DEFINER**
- `replace_automation_steps_atomic(p_automation_id uuid, p_account_id uuid, p_steps jsonb)` → void
- `save_flow_graph_atomic(p_flow_id uuid, p_account_id uuid, p_patch jsonb, p_nodes jsonb)` → void
- `seed_default_role_hierarchy(target_account_id uuid)` → uuid **SECURITY DEFINER**
- `set_deal_closed_at()` → trigger
- `set_member_profile(p_user_id uuid, p_profile_id uuid)` → void **SECURITY DEFINER**
- `set_member_role(p_user_id uuid, p_new_role account_role_enum)` → void **SECURITY DEFINER**
- `set_member_status(p_user_id uuid, p_status text)` → void **SECURITY DEFINER**
- `sparsevec(sparsevec, integer, boolean)` → sparsevec
- `sparsevec_cmp(sparsevec, sparsevec)` → integer
- `sparsevec_eq(sparsevec, sparsevec)` → boolean
- `sparsevec_ge(sparsevec, sparsevec)` → boolean
- `sparsevec_gt(sparsevec, sparsevec)` → boolean
- `sparsevec_in(cstring, oid, integer)` → sparsevec
- `sparsevec_l2_squared_distance(sparsevec, sparsevec)` → double precision
- `sparsevec_le(sparsevec, sparsevec)` → boolean
- `sparsevec_lt(sparsevec, sparsevec)` → boolean
- `sparsevec_ne(sparsevec, sparsevec)` → boolean
- `sparsevec_negative_inner_product(sparsevec, sparsevec)` → double precision
- `sparsevec_out(sparsevec)` → cstring
- `sparsevec_recv(internal, oid, integer)` → sparsevec
- `sparsevec_send(sparsevec)` → bytea
- `sparsevec_to_halfvec(sparsevec, integer, boolean)` → halfvec
- `sparsevec_to_vector(sparsevec, integer, boolean)` → vector
- `sparsevec_typmod_in(cstring[])` → integer
- `subvector(halfvec, integer, integer)` → halfvec
- `subvector(vector, integer, integer)` → vector
- `sum(vector)` → vector
- `sum(halfvec)` → halfvec
- `team_messages_touch_conversation()` → trigger **SECURITY DEFINER**
- `touch_presence(p_status text)` → void **SECURITY DEFINER**
- `transfer_account_ownership(p_new_owner_user_id uuid)` → void **SECURITY DEFINER**
- `update_ai_agents_updated_at()` → trigger
- `update_ai_bot_templates_updated_at()` → trigger
- `update_ai_bots_updated_at()` → trigger
- `update_ai_configs_updated_at()` → trigger
- `update_ai_knowledge_documents_updated_at()` → trigger
- `update_ai_support_requests_updated_at()` → trigger
- `update_updated_at_column()` ��� trigger
- `vector(vector, integer, boolean)` → vector
- `vector_accum(double precision[], vector)` → double precision[]
- `vector_add(vector, vector)` → vector
- `vector_avg(double precision[])` → vector
- `vector_cmp(vector, vector)` → integer
- `vector_combine(double precision[], double precision[])` → double precision[]
- `vector_concat(vector, vector)` → vector
- `vector_dims(halfvec)` → integer
- `vector_dims(vector)` → integer
- `vector_eq(vector, vector)` → boolean
- `vector_ge(vector, vector)` → boolean
- `vector_gt(vector, vector)` → boolean
- `vector_in(cstring, oid, integer)` → vector
- `vector_l2_squared_distance(vector, vector)` → double precision
- `vector_le(vector, vector)` → boolean
- `vector_lt(vector, vector)` → boolean
- `vector_mul(vector, vector)` → vector
- `vector_ne(vector, vector)` → boolean
- `vector_negative_inner_product(vector, vector)` → double precision
- `vector_norm(vector)` → double precision
- `vector_out(vector)` → cstring
- `vector_recv(internal, oid, integer)` → vector
- `vector_send(vector)` → bytea
- `vector_spherical_distance(vector, vector)` → double precision
- `vector_sub(vector, vector)` → vector
- `vector_to_float4(vector, integer, boolean)` → real[]
- `vector_to_halfvec(vector, integer, boolean)` → halfvec
- `vector_to_sparsevec(vector, integer, boolean)` → sparsevec
- `vector_typmod_in(cstring[])` → integer

