-- Account-scoped custom template variables for the Template Studio.
-- Members define a key ({{token}}), a friendly label, and a sample
-- value used only for the live preview; at send time each token is
-- mapped to real contact data in the broadcast personalize step.
CREATE TABLE IF NOT EXISTS public.template_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z0-9_]{1,40}$'),
  label text NOT NULL DEFAULT '',
  sample_value text NOT NULL DEFAULT '',
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, key)
);

CREATE INDEX IF NOT EXISTS template_variables_account_idx
  ON public.template_variables (account_id, created_at);

ALTER TABLE public.template_variables ENABLE ROW LEVEL SECURITY;

-- Shared library: any account member can read and contribute;
-- deletes are member-level too (variables are low-risk metadata).
DROP POLICY IF EXISTS template_variables_select ON public.template_variables;
CREATE POLICY template_variables_select ON public.template_variables FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS template_variables_insert ON public.template_variables;
CREATE POLICY template_variables_insert ON public.template_variables FOR INSERT
  WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS template_variables_update ON public.template_variables;
CREATE POLICY template_variables_update ON public.template_variables FOR UPDATE
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS template_variables_delete ON public.template_variables;
CREATE POLICY template_variables_delete ON public.template_variables FOR DELETE
  USING (is_account_member(account_id));
