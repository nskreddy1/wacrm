-- True round-robin agent picker for the assign_conversation workflow
-- node: the active account member with the fewest open assigned
-- conversations wins; ties break on user_id for determinism.
-- SECURITY DEFINER not needed — called via service role only.
CREATE OR REPLACE FUNCTION pick_round_robin_agent(p_account_id UUID)
RETURNS TABLE (user_id UUID)
LANGUAGE sql
STABLE
AS $$
  SELECT p.user_id
  FROM profiles p
  LEFT JOIN conversations c
    ON c.assigned_agent_id = p.user_id
   AND c.account_id = p_account_id
   AND c.status IN ('open', 'pending')
  WHERE p.account_id = p_account_id
    AND p.status = 'active'
  GROUP BY p.user_id
  ORDER BY COUNT(c.id) ASC, p.user_id ASC
  LIMIT 1;
$$;
