-- ============================================================
-- 056_support_tickets.sql — Two-way support ticketing
--
-- Account members raise tickets from Settings → Support; platform
-- super admins triage them across all tenants from /admin/tickets.
--
--   - `support_tickets` — one row per ticket, account-scoped.
--     Status lifecycle: open → in_progress → waiting_on_user →
--     resolved → closed (enforced by CHECK, transitions by app).
--   - `support_ticket_messages` — threaded replies. `is_admin_reply`
--     distinguishes platform-support responses from user messages.
--
-- RLS model (defense in depth — layer 2 of 3):
--   - Members (any workspace role) can read + create tickets and
--     messages for their OWN account only.
--   - Super admins can read + write ALL tickets (cross-tenant),
--     via is_platform_super_admin() from 055.
--   - Nobody can delete tickets or messages through PostgREST.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_tickets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject        TEXT NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 200),
  category       TEXT NOT NULL DEFAULT 'other'
                 CHECK (category IN ('billing','technical','channel_setup','agent_help','other')),
  priority       TEXT NOT NULL DEFAULT 'normal'
                 CHECK (priority IN ('low','normal','high','urgent')),
  status         TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','in_progress','waiting_on_user','resolved','closed')),
  -- Platform-side owner of the ticket (a super admin), not a
  -- workspace member. SET NULL keeps history if the admin leaves.
  assigned_admin UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Queue scans: admin filters by status/priority ordered by recency.
CREATE INDEX IF NOT EXISTS idx_support_tickets_queue
  ON support_tickets(status, priority, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_account
  ON support_tickets(account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON support_tickets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read own account tickets" ON support_tickets;
CREATE POLICY "Members read own account tickets" ON support_tickets
  FOR SELECT USING (
    is_account_member(account_id, 'viewer') OR is_platform_super_admin()
  );

DROP POLICY IF EXISTS "Members create tickets for own account" ON support_tickets;
CREATE POLICY "Members create tickets for own account" ON support_tickets
  FOR INSERT WITH CHECK (
    is_account_member(account_id, 'viewer') AND created_by = auth.uid()
  );

-- Updates: ticket creator may close/resolve their own ticket;
-- super admins may perform any transition (assign, status, etc).
DROP POLICY IF EXISTS "Creator or super admin updates tickets" ON support_tickets;
CREATE POLICY "Creator or super admin updates tickets" ON support_tickets
  FOR UPDATE USING (
    created_by = auth.uid() OR is_platform_super_admin()
  );

-- ============================================================
-- Ticket messages (thread)
-- ============================================================
CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_admin_reply BOOLEAN NOT NULL DEFAULT FALSE,
  body           TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_thread
  ON support_ticket_messages(ticket_id, created_at);

ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;

-- Read: anyone who can read the parent ticket.
DROP POLICY IF EXISTS "Ticket participants read messages" ON support_ticket_messages;
CREATE POLICY "Ticket participants read messages" ON support_ticket_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM support_tickets t
      WHERE t.id = ticket_id
        AND (is_account_member(t.account_id, 'viewer') OR is_platform_super_admin())
    )
  );

-- Write: account members post user messages on their own tickets;
-- super admins post admin replies on any ticket. is_admin_reply is
-- constrained to match the author's actual privilege so a regular
-- user can never forge a "support team" message.
DROP POLICY IF EXISTS "Participants post messages" ON support_ticket_messages;
CREATE POLICY "Participants post messages" ON support_ticket_messages
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND (
      (is_admin_reply AND is_platform_super_admin())
      OR (
        NOT is_admin_reply
        AND EXISTS (
          SELECT 1 FROM support_tickets t
          WHERE t.id = ticket_id
            AND is_account_member(t.account_id, 'viewer')
        )
      )
    )
  );
