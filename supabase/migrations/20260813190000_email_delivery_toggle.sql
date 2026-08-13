-- ============================================================
-- Email delivery: explicit per-workspace send toggle
--
-- Before this migration, "should we email?" was inferred from the
-- mere EXISTENCE of an account_email_settings row, and when no row
-- existed the app fell back to platform-level credentials
-- (RESEND_API_KEY / MAILTRAP_API_TOKEN) and to
-- supabase.auth.admin.inviteUserByEmail. Net effect: a workspace
-- that had never configured email still sent mail, through the
-- PLATFORM operator's sender, to addresses the operator was never
-- asked to process.
--
-- That is wrong on three counts:
--   1. Consent — the tenant never opted in to outbound email.
--   2. Attribution — invitee addresses and bounce/spam reputation
--      land on the platform's shared sender, not the tenant's.
--   3. Least surprise — an admin who saves SMTP details to TEST
--      them should not thereby start mailing real invitees.
--
-- So delivery now requires POSITIVE, EXPLICIT proof of intent:
-- a row, credentials, AND email_enabled = true. Anything else
-- means "don't send" and the admin shares the invite link
-- directly. Fail closed: the default is false, including for any
-- row that already exists, so applying this migration cannot
-- start (or silently continue) sending on anyone's behalf.
--
-- Idempotent: safe to re-run.
-- ============================================================

alter table public.account_email_settings
  add column if not exists email_enabled boolean not null default false;

comment on column public.account_email_settings.email_enabled is
  'Master switch for outbound email from this workspace. When false, the app never sends -- invitations fall back to a copyable link. Defaults to false so saving credentials (e.g. to run a test send) does not by itself start emailing real recipients.';

-- Backfill is deliberately a NO-OP.
--
-- `add column ... default false` already set every existing row to
-- false, and that is the intended outcome: we cannot infer consent
-- to send from a row that predates the toggle. Operators who were
-- relying on the old implicit behaviour re-enable it explicitly in
-- Settings -> Email delivery, which is exactly the confirmation
-- step that was missing.

-- Only a workspace that has actually verified its provider should
-- be able to flip this on. `last_test_ok` is set by the test-send
-- endpoint; requiring it here would block enabling before a test,
-- which is a product decision rather than a data-integrity one, so
-- it is enforced in the API instead of as a CHECK constraint.
-- (A CHECK would also make an unrelated credential rotation fail.)
