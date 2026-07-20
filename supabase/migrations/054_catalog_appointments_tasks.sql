-- ============================================================
-- 054_catalog_appointments_tasks.sql — Dashboard operations backbone
--
-- Adds the three account-scoped tables that back the redesigned
-- dashboard's operational widgets, plus one column on deals:
--
--   - `catalog_items`  — generic products/services catalog. For a
--     school this is courses/programs; for a clinic, treatments; for
--     an agency, service packages. Deals and appointments can
--     reference an item (SET NULL on delete so history survives).
--   - `appointments`   — scheduled meetings with a contact
--     (admission counseling, product demo, consultation). Powers the
--     "Upcoming appointments" dashboard widget.
--   - `tasks`          — lightweight follow-ups ("call back", "send
--     fee details") assignable to a member, optionally linked to a
--     contact/deal. Powers the dashboard task list + overdue alerts.
--   - `deals.closed_at` — set when a deal transitions to won/lost so
--     the dashboard can compute "won in the last 30 days" correctly
--     (updated_at is overwritten by any edit and can't be trusted).
--
-- All three tables follow the account-sharing model from 017:
-- account_id ownership + is_account_member() RLS. Members can read
-- everything in their account; writes require 'agent' or above.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- catalog_items
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  name        text NOT NULL,
  description text,
  -- Free-form grouping label ("Programs", "Consulting", "Add-ons").
  category    text,
  price       numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  currency    text NOT NULL DEFAULT 'USD',
  is_active   boolean NOT NULL DEFAULT true,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_items_account
  ON catalog_items (account_id, is_active, name);

ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_items_select ON catalog_items;
CREATE POLICY catalog_items_select ON catalog_items FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS catalog_items_insert ON catalog_items;
CREATE POLICY catalog_items_insert ON catalog_items FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS catalog_items_update ON catalog_items;
CREATE POLICY catalog_items_update ON catalog_items FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS catalog_items_delete ON catalog_items;
CREATE POLICY catalog_items_delete ON catalog_items FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON catalog_items;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON catalog_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- appointments
-- ============================================================
CREATE TABLE IF NOT EXISTS appointments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  contact_id       uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- Optional links: what the appointment is about and who runs it.
  catalog_item_id  uuid REFERENCES catalog_items(id) ON DELETE SET NULL,
  assigned_to      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deal_id          uuid REFERENCES deals(id) ON DELETE SET NULL,

  title            text NOT NULL,
  notes            text,
  location         text,

  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz,
  CHECK (ends_at IS NULL OR ends_at > starts_at),

  status           text NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Dashboard hot path: "next scheduled appointments for my account".
CREATE INDEX IF NOT EXISTS idx_appointments_account_upcoming
  ON appointments (account_id, starts_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_appointments_contact
  ON appointments (contact_id);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointments_select ON appointments;
CREATE POLICY appointments_select ON appointments FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS appointments_insert ON appointments;
CREATE POLICY appointments_insert ON appointments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS appointments_update ON appointments;
CREATE POLICY appointments_update ON appointments FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS appointments_delete ON appointments;
CREATE POLICY appointments_delete ON appointments FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON appointments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Optional links; a task can be free-standing.
  contact_id   uuid REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id      uuid REFERENCES deals(id) ON DELETE CASCADE,
  assigned_to  uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  title        text NOT NULL,
  notes        text,

  due_at       timestamptz,
  priority     text NOT NULL DEFAULT 'medium'
                 CHECK (priority IN ('low', 'medium', 'high')),
  status       text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'done', 'cancelled')),
  completed_at timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Dashboard hot paths: "my account's open tasks by due date" and
-- "overdue count" both hit this partial index.
CREATE INDEX IF NOT EXISTS idx_tasks_account_open
  ON tasks (account_id, due_at)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_tasks_contact
  ON tasks (contact_id)
  WHERE contact_id IS NOT NULL;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_select ON tasks;
CREATE POLICY tasks_select ON tasks FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS tasks_insert ON tasks;
CREATE POLICY tasks_insert ON tasks FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS tasks_update ON tasks;
CREATE POLICY tasks_update ON tasks FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS tasks_delete ON tasks;
CREATE POLICY tasks_delete ON tasks FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- deals: optional catalog link + closed_at for won/lost windows
-- ============================================================
ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  catalog_item_id uuid REFERENCES catalog_items(id) ON DELETE SET NULL;

ALTER TABLE deals ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- Backfill: for already-closed deals the best available approximation
-- is updated_at (the close was usually the last edit).
UPDATE deals SET closed_at = updated_at
  WHERE closed_at IS NULL AND status IN ('won', 'lost');

-- Keep closed_at in sync automatically so every write path (UI, API,
-- automations) gets it for free.
CREATE OR REPLACE FUNCTION set_deal_closed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('won', 'lost') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    NEW.closed_at := now();
  ELSIF NEW.status NOT IN ('won', 'lost') THEN
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_set_closed_at ON deals;
CREATE TRIGGER deals_set_closed_at BEFORE UPDATE OF status ON deals
  FOR EACH ROW EXECUTE FUNCTION set_deal_closed_at();

-- Partial index for the dashboard's "won/lost last 30 days" KPI.
CREATE INDEX IF NOT EXISTS idx_deals_account_closed
  ON deals (account_id, closed_at)
  WHERE status IN ('won', 'lost');
