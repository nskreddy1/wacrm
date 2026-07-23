-- Platform-managed connection controls:
--
-- 1. client_can_toggle — permission gate. When false, workspace users
--    cannot enable/disable a platform-managed connection themselves;
--    only the platform team (admin console) can. Defaults to true so
--    existing rows keep their current behavior.
--
-- 2. platform_notice — a short message the support/founder team can
--    attach to a connection (e.g. "This number is under carrier
--    review with Twilio — SMS is paused until approved"). Shown to
--    the workspace in the settings UI and returned by the API when a
--    blocked toggle is attempted.
--
-- Pattern reference: Twilio Console number-incident banners and
-- Stripe restricted-account notices — resource-level notices set by
-- the operator, enforced at the API, and displayed inline in the UI.

alter table public.channel_connections
  add column if not exists client_can_toggle boolean not null default true;

alter table public.channel_connections
  add column if not exists platform_notice text;

comment on column public.channel_connections.client_can_toggle is
  'When false, workspace members cannot enable/disable this connection; only the platform team can (admin console).';

comment on column public.channel_connections.platform_notice is
  'Operator-set message shown to the workspace (e.g. carrier review, number incident). Null when no notice.';
