-- Lead source & campaign attribution (EspoCRM-style conversion trail).
-- Every contact records WHERE it came from (source), free-form detail
-- (source_detail, e.g. form name or portal), and which campaign/
-- broadcast produced it (campaign). Deals already carry lead_source;
-- we add campaign there too so revenue can be traced back to the
-- campaign that created it — the foundation for source/campaign ROI
-- analytics (pipeline by source, broadcast ROAS).

alter table public.contacts
  add column if not exists source text,
  add column if not exists source_detail text,
  add column if not exists campaign text;

alter table public.deals
  add column if not exists campaign text;

-- Analytics filter by source/campaign per account; partial indexes
-- keep them small (most historical rows stay null after backfill).
create index if not exists idx_contacts_account_source
  on public.contacts (account_id, source)
  where source is not null;

create index if not exists idx_contacts_account_campaign
  on public.contacts (account_id, campaign)
  where campaign is not null;

create index if not exists idx_deals_account_campaign
  on public.deals (account_id, campaign)
  where campaign is not null;

-- ---------------------------------------------------------------
-- Backfill: infer source for existing contacts.
-- 1) Contact has at least one conversation -> "<channel>_inbound"
--    from its EARLIEST conversation (first touch wins, matching how
--    live attribution will behave from now on).
-- 2) No conversation -> 'manual' (created via UI/import before
--    attribution existed; safest neutral value).
-- Only rows where source is null are touched, so re-running is safe.
-- ---------------------------------------------------------------

with first_conv as (
  select distinct on (contact_id)
    contact_id,
    channel
  from public.conversations
  order by contact_id, created_at asc
)
update public.contacts c
set source = fc.channel || '_inbound'
from first_conv fc
where fc.contact_id = c.id
  and c.source is null;

update public.contacts
set source = 'manual'
where source is null;
