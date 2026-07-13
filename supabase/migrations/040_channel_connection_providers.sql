-- Add independently selectable SMTP and Microsoft email providers.
--
-- PostgreSQL does not allow a newly-added enum value to be referenced by a
-- constraint in the same transaction. Supabase runs each migration in a
-- transaction, so the provider-pair constraint is deliberately applied in
-- migration 041 after these enum values have committed.
ALTER TYPE channel_provider ADD VALUE IF NOT EXISTS 'smtp';
ALTER TYPE channel_provider ADD VALUE IF NOT EXISTS 'microsoft';
