-- ============================================================
-- Platform provider policies — which channel providers are
-- offered to workspaces, controlled by the platform operator.
--
-- Security model (same as platform_settings): RLS enabled with NO
-- policies, so the table is invisible to anon/authenticated. Only
-- the service-role client behind /api/admin/providers (super-admin
-- gated) reads or writes it. Workspace-facing routes read it
-- through the service role to filter provider offerings.
-- ============================================================

create table if not exists public.platform_provider_policies (
  provider text not null,
  channel text not null,
  is_enabled boolean not null default true,
  -- Operator-facing note, e.g. "Sunsetting — migrate tenants to X".
  notes text,
  updated_at timestamptz not null default now(),
  primary key (provider, channel),
  constraint platform_provider_policies_provider_check check (
    provider in ('meta', 'twilio', 'google', 'microsoft', 'resend', 'smtp', 'mailtrap')
  ),
  constraint platform_provider_policies_channel_check check (
    channel in ('whatsapp', 'sms', 'email')
  )
);

alter table public.platform_provider_policies enable row level security;

comment on table public.platform_provider_policies is
  'Platform-wide provider availability switches. RLS with no policies: service-role access only via the super-admin gated /api/admin/providers route.';
