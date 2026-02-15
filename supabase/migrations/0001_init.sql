-- Phase 0 + Phase 1.1
-- Source of truth: docs/PRD.md, docs/BACKEND_STRUCTURE.md, docs/IMPLEMENTATION_PLAN.md

begin;

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'alert_channel') then
    create type public.alert_channel as enum ('push', 'email', 'both');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'zone_type') then
    create type public.zone_type as enum ('radius', 'admin', 'polygon');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'source_method') then
    create type public.source_method as enum ('api', 'scrape');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'raw_fetch_status') then
    create type public.raw_fetch_status as enum ('ok', 'failed', 'blocked');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'listing_type') then
    create type public.listing_type as enum ('buy', 'rent');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'rent_source') then
    create type public.rent_source as enum ('direct_match', 'zone_model');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'deal_trigger_type') then
    create type public.deal_trigger_type as enum ('p10_deal', 'price_drop');
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2.2 profiles
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text,
  default_alert_channel public.alert_channel not null default 'both',
  email_template_subject text,
  email_template_body text,
  created_at timestamptz not null default now()
);

-- 2.3 zones
create table if not exists public.zones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  zone_type public.zone_type not null,
  center_lat numeric(9,6),
  center_lng numeric(9,6),
  radius_meters integer,
  admin_codes jsonb,
  polygon_geojson jsonb,
  filters jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zones_radius_positive check (radius_meters is null or radius_meters > 0),
  constraint zones_lat_range check (center_lat is null or (center_lat between -90 and 90)),
  constraint zones_lng_range check (center_lng is null or (center_lng between -180 and 180))
);

drop trigger if exists trg_zones_updated_at on public.zones;
create trigger trg_zones_updated_at
before update on public.zones
for each row execute function public.set_updated_at();

-- 2.4 sources
create table if not exists public.sources (
  id bigserial primary key,
  name text not null unique,
  method public.source_method not null,
  enabled boolean not null default true
);

insert into public.sources (name, method, enabled)
values
  ('idealista', 'api', true),
  ('imovirtual', 'api', true),
  ('casasapo', 'scrape', true),
  ('olx', 'scrape', true)
on conflict (name) do nothing;

-- 2.5 listings_raw
create table if not exists public.listings_raw (
  id uuid primary key default gen_random_uuid(),
  source text not null references public.sources(name),
  fetched_at timestamptz not null default now(),
  external_id text,
  url text,
  raw_payload jsonb not null,
  hash text not null,
  status public.raw_fetch_status not null default 'ok'
);

-- 2.6 listings_normalized
create table if not exists public.listings_normalized (
  id uuid primary key default gen_random_uuid(),
  source text not null references public.sources(name),
  external_id text,
  url text,
  listing_type public.listing_type not null,
  title text,
  price_eur numeric(12,2) not null check (price_eur >= 0),
  size_m2 numeric(10,2) check (size_m2 is null or size_m2 > 0),
  bedrooms integer check (bedrooms is null or bedrooms >= 0),
  bathrooms integer check (bathrooms is null or bathrooms >= 0),
  lat numeric(9,6),
  lng numeric(9,6),
  location_text text,
  contact_phone text,
  contact_email text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_price_eur numeric(12,2) not null check (last_price_eur >= 0),
  is_active boolean not null default true,
  quality_flags jsonb not null default '{}'::jsonb,
  constraint listings_normalized_lat_range check (lat is null or (lat between -90 and 90)),
  constraint listings_normalized_lng_range check (lng is null or (lng between -180 and 180))
);

-- 2.7 listing_zone_membership
create table if not exists public.listing_zone_membership (
  zone_id uuid not null references public.zones(id) on delete cascade,
  listing_id uuid not null references public.listings_normalized(id) on delete cascade,
  matched_at timestamptz not null default now(),
  match_confidence numeric(4,3) not null default 1.000 check (match_confidence >= 0 and match_confidence <= 1),
  primary key (zone_id, listing_id)
);

-- 2.8 zone_daily_stats
create table if not exists public.zone_daily_stats (
  zone_id uuid not null references public.zones(id) on delete cascade,
  stats_date date not null,
  eligible_buy_count integer not null default 0 check (eligible_buy_count >= 0),
  eligible_rent_count integer not null default 0 check (eligible_rent_count >= 0),
  p10_ratio_years numeric(10,4),
  p50_ratio_years numeric(10,4),
  p90_ratio_years numeric(10,4),
  median_rent_eur_m2 numeric(10,2),
  min_sample_used boolean not null default false,
  computed_at timestamptz not null default now(),
  primary key (zone_id, stats_date)
);

-- 2.9 listing_scoring_daily
create table if not exists public.listing_scoring_daily (
  zone_id uuid not null references public.zones(id) on delete cascade,
  listing_id uuid not null references public.listings_normalized(id) on delete cascade,
  stats_date date not null,
  estimated_monthly_rent_eur numeric(12,2) not null check (estimated_monthly_rent_eur > 0),
  rent_source public.rent_source not null,
  ratio_years numeric(10,4) not null check (ratio_years >= 0),
  is_deal_p10 boolean not null default false,
  rank_in_zone integer,
  created_at timestamptz not null default now(),
  primary key (zone_id, listing_id, stats_date)
);

-- 2.10 deal_events
create table if not exists public.deal_events (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.zones(id) on delete cascade,
  listing_id uuid not null references public.listings_normalized(id) on delete cascade,
  triggered_at timestamptz not null default now(),
  trigger_type public.deal_trigger_type not null,
  ratio_years numeric(10,4),
  price_eur numeric(12,2),
  was_notified_push boolean not null default false,
  was_notified_email boolean not null default false
);

-- Indexes
create index if not exists idx_zones_user_id on public.zones(user_id);
create index if not exists idx_zones_user_active on public.zones(user_id, is_active);

create index if not exists idx_listings_raw_source_fetched_at on public.listings_raw(source, fetched_at desc);
create index if not exists idx_listings_raw_external_id on public.listings_raw(source, external_id) where external_id is not null;
create index if not exists idx_listings_raw_hash on public.listings_raw(hash);

create unique index if not exists uq_listings_normalized_source_external
  on public.listings_normalized(source, external_id)
  where external_id is not null;

create unique index if not exists uq_listings_normalized_url_lower
  on public.listings_normalized(lower(url))
  where url is not null;

create index if not exists idx_listings_normalized_type_active
  on public.listings_normalized(listing_type, is_active);
create index if not exists idx_listings_normalized_last_seen
  on public.listings_normalized(last_seen_at desc);
create index if not exists idx_listings_normalized_price
  on public.listings_normalized(price_eur);

create index if not exists idx_membership_listing_id on public.listing_zone_membership(listing_id);
create index if not exists idx_zone_daily_stats_date on public.zone_daily_stats(stats_date desc);

create index if not exists idx_listing_scoring_daily_zone_date
  on public.listing_scoring_daily(zone_id, stats_date desc);
create index if not exists idx_listing_scoring_daily_deals
  on public.listing_scoring_daily(zone_id, stats_date desc, is_deal_p10, rank_in_zone);

create index if not exists idx_deal_events_zone_listing_time
  on public.deal_events(zone_id, listing_id, triggered_at desc);
create index if not exists idx_deal_events_triggered_at
  on public.deal_events(triggered_at desc);

-- Minimal user-owned RLS
alter table public.profiles enable row level security;
alter table public.zones enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
on public.profiles
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "zones_select_own" on public.zones;
create policy "zones_select_own"
on public.zones
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "zones_insert_own" on public.zones;
create policy "zones_insert_own"
on public.zones
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "zones_update_own" on public.zones;
create policy "zones_update_own"
on public.zones
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "zones_delete_own" on public.zones;
create policy "zones_delete_own"
on public.zones
for delete
to authenticated
using (auth.uid() = user_id);

-- TODO(MVP assumption): access rules for zone analytics and deal tables are left service-role only for now.
-- When client-side reads are added, create owner-scoped policies through zones.user_id joins.

commit;
