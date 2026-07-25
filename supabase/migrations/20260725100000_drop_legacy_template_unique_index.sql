-- ============================================================
-- Drop the legacy per-user unique index on message_templates.
--
-- Migration 014 created:
--   message_templates_user_name_language_key ON (user_id, name, language)
--
-- Migration 046 meant to replace it with the account-scoped index,
-- but its DROP targeted the wrong name
-- (message_templates_user_id_name_language_key — note the extra
-- "_id" — which never existed). The stale (user_id, name, language)
-- index therefore survived and keeps rejecting valid saves with:
--
--   23505 duplicate key value violates unique constraint
--   "message_templates_user_name_language_key"
--
-- This migration drops it under its REAL name and guarantees the
-- intended account-scoped replacement exists.
-- ============================================================

DROP INDEX IF EXISTS public.message_templates_user_name_language_key;

-- Belt-and-braces: also drop it if it was ever created as a table
-- constraint rather than a bare index.
ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_user_name_language_key;

-- Ensure the intended replacement (from migration 046) is in place.
CREATE UNIQUE INDEX IF NOT EXISTS message_templates_account_provider_name_language_key
  ON public.message_templates (account_id, provider, name, language);
