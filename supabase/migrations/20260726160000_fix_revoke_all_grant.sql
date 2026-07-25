-- Security-review fix: admin_revoke_all_auth_sessions was created
-- with EXECUTE revoked from public/anon/authenticated but no grant to
-- service_role — so the "sign out everywhere" PATCH endpoint would
-- fail with permission denied. Grant it explicitly (mirrors
-- admin_revoke_auth_session).

grant execute on function public.admin_revoke_all_auth_sessions(uuid, uuid)
  to service_role;
