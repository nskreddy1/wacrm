-- ============================================================
-- channel_connections.managed_by — who administers a connection.
--
--   'workspace' (default) — the client connected their own
--                           provider account (BYO credentials).
--   'platform'            — provisioned by the platform (founder)
--                           team from the /admin console. Workspace
--                           admins can enable/disable but cannot
--                           edit credentials or delete the row.
--
-- Enforcement lives in the API layer (workspace route rejects
-- save/delete on platform rows; admin routes use the service
-- role). RLS is unchanged: rows remain account-scoped.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'channel_connections'
      and column_name = 'managed_by'
  ) then
    alter table public.channel_connections
      add column managed_by text not null default 'workspace';

    alter table public.channel_connections
      add constraint channel_connections_managed_by_check
      check (managed_by in ('workspace', 'platform'));
  end if;
end $$;

comment on column public.channel_connections.managed_by is
  'workspace = client-connected (BYO); platform = provisioned by the founder team via /admin';
