-- ============================================================
-- Roles go back to generic "Level 1".."Level 5" names.
--
-- WHY
-- 20260814120000 renamed the seeded roles to job titles (CEO, Head of
-- Sales, ...). That was the wrong call for this product: a CRM is sold
-- to agencies, clinics, dealerships and brokers, and "Head of Sales"
-- is meaningless to most of them. Generic level names travel across
-- every industry and make the LADDER the thing you read — Level 2 is
-- obviously above Level 3, whereas "Head of Sales" vs "Sales Manager"
-- is guesswork.
--
-- What is NOT reverted:
--   * system_key stays. It is the real fix from that migration — code
--     keys off it, so an admin renaming a role can no longer break
--     signup bootstrap.
--   * description stays, and is now the load-bearing part of the UI:
--     it is what tells an admin WHICH RECORDS the level can see, which
--     is the one thing a Profile cannot express.
--
-- Descriptions are phrased in terms of the ladder ("levels below
-- them"), not job titles, so they stay accurate no matter what an
-- admin renames the roles to.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Rename job titles back to generic levels
--
-- Keyed on system_key, so this is exact and does not depend on the
-- current display name. Only rows that still carry the job title this
-- codebase set are touched: if an admin has since renamed a role to
-- something of their own, that label is theirs and is left alone.
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  target_name TEXT;
  target_desc TEXT;
  prior_name  TEXT;
BEGIN
  FOR r IN
    SELECT id, account_id, system_key, name
      FROM workspace_roles
     WHERE is_system
       AND system_key IS NOT NULL
  LOOP
    SELECT n, d, p INTO target_name, target_desc, prior_name
      FROM (VALUES
        ('level_1', 'Level 1',
         'Highest level. Sees and manages records owned by every user in the workspace.',
         'CEO'),
        ('level_2', 'Level 2',
         'Sees records owned by users at Level 3, 4 and 5, plus their own.',
         'Head of Sales'),
        ('level_3', 'Level 3',
         'Sees records owned by users at Level 4 and 5, plus their own.',
         'Sales Manager'),
        ('level_4', 'Level 4',
         'Sees records owned by users at Level 5 who report to them, plus their own.',
         'Team Lead'),
        ('level_5', 'Level 5',
         'Lowest level. Sees only the records they own.',
         'Sales Rep')
      ) AS m(k, n, d, p)
     WHERE m.k = r.system_key;

    CONTINUE WHEN target_name IS NULL;

    -- Only revert our own job title, never an admin's custom label.
    CONTINUE WHEN r.name <> prior_name;

    -- (account_id, name) is unique: skip if that level name is taken.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM workspace_roles w
       WHERE w.account_id = r.account_id
         AND w.name = target_name
         AND w.id <> r.id
    );

    UPDATE workspace_roles
       SET name = target_name,
           description = target_desc
     WHERE id = r.id;
  END LOOP;
END $$;

-- Refresh descriptions even where the name was customised: the text
-- describes the VISIBILITY RULE, which is a property of the level and
-- stays true regardless of what the role is called.
UPDATE workspace_roles w
   SET description = m.d
  FROM (VALUES
    ('level_1', 'Highest level. Sees and manages records owned by every user in the workspace.'),
    ('level_2', 'Sees records owned by users at Level 3, 4 and 5, plus their own.'),
    ('level_3', 'Sees records owned by users at Level 4 and 5, plus their own.'),
    ('level_4', 'Sees records owned by users at Level 5 who report to them, plus their own.'),
    ('level_5', 'Lowest level. Sees only the records they own.')
  ) AS m(k, d)
 WHERE w.is_system
   AND w.system_key = m.k
   AND COALESCE(w.description, '') <> m.d;

-- ------------------------------------------------------------
-- 2. Seed new accounts with generic level names
--
-- Same shape as 20260814120000 (still keyed on system_key, still
-- idempotent, still returns the leaf role id) — only the labels and
-- descriptions change.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_default_role_hierarchy(target_account_id UUID)
RETURNS UUID  -- the leaf (level_5) role id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  spec        RECORD;
  parent      UUID := NULL;
  current_id  UUID;
  leaf_id     UUID := NULL;
BEGIN
  FOR spec IN
    SELECT *
      FROM (VALUES
        ('level_1', 'Level 1',
         'Highest level. Sees and manages records owned by every user in the workspace.',
         FALSE, 1),
        ('level_2', 'Level 2',
         'Sees records owned by users at Level 3, 4 and 5, plus their own.',
         FALSE, 2),
        ('level_3', 'Level 3',
         'Sees records owned by users at Level 4 and 5, plus their own.',
         FALSE, 3),
        ('level_4', 'Level 4',
         'Sees records owned by users at Level 5 who report to them, plus their own.',
         FALSE, 4),
        ('level_5', 'Level 5',
         'Lowest level. Sees only the records they own.',
         FALSE, 5)
      ) AS t(system_key, name, description, peer_visibility, depth)
     ORDER BY depth
  LOOP
    -- Match on system_key: survives an admin rename.
    SELECT id INTO current_id
      FROM workspace_roles
     WHERE account_id = target_account_id
       AND system_key = spec.system_key;

    IF current_id IS NULL THEN
      INSERT INTO workspace_roles (
        account_id, name, description, parent_role_id,
        peer_visibility, is_system, system_key
      )
      VALUES (
        target_account_id, spec.name, spec.description, parent,
        spec.peer_visibility, TRUE, spec.system_key
      )
      RETURNING id INTO current_id;
    ELSE
      -- Keep the tree wired up; leave name/description alone so an
      -- admin's edits are never clobbered by a re-run.
      UPDATE workspace_roles
         SET parent_role_id = parent
       WHERE id = current_id
         AND parent_role_id IS DISTINCT FROM parent;
    END IF;

    parent  := current_id;
    leaf_id := current_id;
  END LOOP;

  RETURN leaf_id;
END $$;

ALTER FUNCTION seed_default_role_hierarchy(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION seed_default_role_hierarchy(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION seed_default_role_hierarchy(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION seed_default_role_hierarchy(UUID) TO service_role;

COMMENT ON FUNCTION seed_default_role_hierarchy(UUID) IS
  'Seeds the 5-level generic role ladder (Level 1..Level 5) for an '
  'account. Idempotent; matches existing rows on system_key so admin '
  'renames survive a re-run. Returns the Level 5 (leaf) role id.';
