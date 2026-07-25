-- Daily message traffic per channel for the platform providers page.
-- SECURITY DEFINER because it aggregates across every tenant; execute
-- is revoked from client roles and granted only to service_role — the
-- API route behind it verifies the caller is a platform super admin.
-- Returns counts only: no message content, no identities.
create or replace function public.admin_provider_activity(p_days integer default 14)
returns table (
  day date,
  channel text,
  total bigint,
  failed bigint
)
language sql
security definer
set search_path = public
as $$
  select
    (m.created_at at time zone 'utc')::date as day,
    coalesce(c.channel, 'whatsapp') as channel,
    count(*) as total,
    count(*) filter (where m.status = 'failed') as failed
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where m.created_at >= now() - make_interval(days => least(greatest(p_days, 1), 90))
  group by 1, 2
  order by 1;
$$;

revoke execute on function public.admin_provider_activity(integer)
  from public, anon, authenticated;
grant execute on function public.admin_provider_activity(integer)
  to service_role;
