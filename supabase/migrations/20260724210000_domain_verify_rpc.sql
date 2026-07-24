-- ============================================================
-- mark_account_domain_verified — the ONLY path that can flip
-- account_domains.verified to TRUE.
--
-- RLS on account_domains deliberately prevents clients from
-- self-verifying (see 20260724200000). The server route
-- (/api/account/domains/[id]/verify) performs the real DNS TXT
-- lookup, and only on success calls this RPC. The function is
-- SECURITY DEFINER so it can bypass that RLS guard, but it
-- re-checks that the caller is an admin of the owning account,
-- so it cannot be abused cross-tenant.
-- ============================================================
CREATE OR REPLACE FUNCTION mark_account_domain_verified(p_domain_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  SELECT account_id INTO v_account_id
    FROM account_domains WHERE id = p_domain_id;
  IF v_account_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF NOT is_account_member(v_account_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE account_domains
    SET verified = TRUE, verified_at = NOW()
    WHERE id = p_domain_id AND NOT verified;
  RETURN TRUE;
END;
$$;

ALTER FUNCTION mark_account_domain_verified(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION mark_account_domain_verified(UUID) TO authenticated;
