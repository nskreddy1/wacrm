-- ADR-006 (D3, D8, D11): outbound window truth + WhatsApp consent.
--
-- WHY THIS SHIPS BEFORE THE GUARD (ADR-006 F3):
-- The 24-hour-window guard reads conversations.last_inbound_at and treats
-- NULL as "window closed" (fail-closed). If the guard shipped first, every
-- live conversation would read NULL and every free-form reply in the product
-- would start 409-ing. So the column lands and is backfilled here, the
-- backfill is verified against live data, and only then does the guard ship.
--
-- last_inbound_at is a denormalised cache of "newest inbound customer
-- message in this conversation". It is deliberately NOT a view or a
-- subquery: the guard runs on every single outbound send, and a
-- max(created_at) over messages on each send is the wrong cost. The write
-- side is two inbound code paths (channels/lib/inbound.ts and the Meta
-- webhook route), both of which already update last_message_at on the same
-- row in the same statement, so the denormalisation adds no extra write.

-- ADD COLUMN with no DEFAULT is a catalog-only change (no table rewrite),
-- so this is safe on a large conversations table.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;

COMMENT ON COLUMN public.conversations.last_inbound_at IS
  'Newest inbound (sender_type=customer) message time. Opens the WhatsApp 24h free-form window (ADR-006 D3). NULL = no inbound ever = window closed.';

-- One-time backfill. Grouped aggregate then a single joined UPDATE rather
-- than a correlated subquery per row. Guarded by "IS NULL" so re-running
-- this migration cannot clobber values that the live inbound paths have
-- since written (idempotency, AGENTS.md).
UPDATE public.conversations c
SET last_inbound_at = m.max_inbound
FROM (
  SELECT conversation_id, max(created_at) AS max_inbound
  FROM public.messages
  WHERE sender_type = 'customer'
  GROUP BY conversation_id
) m
WHERE m.conversation_id = c.id
  AND c.last_inbound_at IS NULL;

-- WhatsApp consent. Mirrors 051_sms_opt_out.sql and
-- 20260726090000_email_opt_out.sql exactly — same column shape, same
-- partial-index shape — so all three channels stay legible as one pattern.
-- Separate from sms_opted_out on purpose (ADR-006 D8): consent is
-- per-channel, and a STOP sent over SMS must not silently mute WhatsApp.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS whatsapp_opted_out boolean NOT NULL DEFAULT false;
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS whatsapp_opted_out_at timestamptz;

COMMENT ON COLUMN public.contacts.whatsapp_opted_out IS
  'Contact sent a WhatsApp STOP/UNSUBSCRIBE keyword (ADR-006 D8/D19). Blocks all outbound WhatsApp including templates.';

-- Partial index: only opted-out rows are indexed, because the "true" set is
-- the small one and the guard's own read is by conversation/contact id. This
-- index serves compliance reporting ("who opted out in this account"), which
-- is the query that would otherwise seq-scan contacts.
CREATE INDEX IF NOT EXISTS contacts_whatsapp_opted_out_idx
  ON public.contacts (account_id, whatsapp_opted_out)
  WHERE whatsapp_opted_out = true;
