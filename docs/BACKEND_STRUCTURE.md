# BACKEND_STRUCTURE.md

## 1) Backend Responsibilities

1. Collect listings daily (API-first, scraping fallback)
2. Normalize and deduplicate listings across sources
3. Compute rent estimates when missing
4. Compute Price-to-Rent Ratio for eligible listings
5. Compute P10 threshold per zone (per day)
6. Create “deal events” and send notifications (push/email)
7. Store historical snapshots for trend + debugging

---

## 2) Data Model (Supabase / Postgres)

### 2.1 users
- managed by Supabase Auth
- store app-level preferences in `profiles`

### 2.2 profiles
- user_id (PK, FK auth.users)
- name
- default_alert_channel (push/email/both)
- email_template_subject
- email_template_body
- created_at

### 2.3 zones
- id (UUID PK)
- user_id (FK)
- name
- zone_type: `radius | admin | polygon`
- center_lat, center_lng (nullable)
- radius_meters (nullable)
- admin_codes (jsonb, nullable)  // district/municipality/parish identifiers
- polygon_geojson (jsonb, nullable)
- filters (jsonb)  // min_price, max_price, bedrooms, property_type, min_size, etc.
- is_active (bool)
- created_at, updated_at

### 2.4 sources
- id
- name (idealista, imovirtual, casasapo, olx)
- method (api/scrape)
- enabled

### 2.5 listings_raw
Stores raw fetched payloads for traceability (optional but recommended for debugging).
- id (UUID)
- source
- fetched_at
- external_id (nullable)
- url
- raw_payload (jsonb)
- hash (text) // stable hash of key fields
- status (ok/failed/blocked)

### 2.6 listings_normalized
Canonical listing representation (buy or rent).
- id (UUID PK)
- source
- external_id (nullable)
- url (unique-ish)
- listing_type: `buy | rent`
- title
- price_eur
- size_m2 (nullable)
- bedrooms (nullable)
- bathrooms (nullable)
- lat, lng (nullable)
- location_text (nullable)
- contact_phone (nullable)
- contact_email (nullable)
- first_seen_at
- last_seen_at
- last_price_eur
- is_active (bool)
- quality_flags (jsonb) // missing_geo, suspicious_price, etc.

### 2.7 listing_zone_membership
Materialized relationship between listing and zones to avoid recomputing geo checks.
- zone_id
- listing_id
- matched_at
- match_confidence (0-1)
- PK(zone_id, listing_id)

### 2.8 zone_daily_stats
Daily computed distribution stats for each zone.
- zone_id
- stats_date (date, PK with zone_id)
- eligible_buy_count
- eligible_rent_count
- p10_ratio_years (nullable)
- p50_ratio_years (nullable)
- p90_ratio_years (nullable)
- median_rent_eur_m2 (nullable)
- min_sample_used (bool)
- computed_at

### 2.9 listing_scoring_daily
Per-day scoring results for buy listings in a zone.
- zone_id
- listing_id
- stats_date
- estimated_monthly_rent_eur
- rent_source: `direct_match | zone_model`
- ratio_years
- is_deal_p10 (bool)
- rank_in_zone (int)
- created_at
- PK(zone_id, listing_id, stats_date)

### 2.10 deal_events
Tracks alerts to prevent duplicates and support re-alert on price drop.
- id (UUID)
- zone_id
- listing_id
- triggered_at
- trigger_type: `p10_deal | price_drop`
- ratio_years
- price_eur
- was_notified_push (bool)
- was_notified_email (bool)

---

## 3) Core Algorithms

### 3.1 Normalization
- Parse and standardize:
  - currency (EUR)
  - numeric fields (price, m2)
  - location + lat/lng (when available)
  - listing type (buy/rent)
- Derive:
  - hash signature for dedupe

### 3.2 Deduplication
- Primary key: (source, external_id) if available
- Else dedupe via:
  - url
  - title similarity + geo proximity + price band

### 3.3 Rent estimation
Priority:
1. Direct rent comp:
   - same zone
   - same typology (bedrooms ±1)
   - size band ±20%
   - use median rent among comps
2. Zone model:
   - estimate = median_rent_eur_m2 * listing.size_m2

Exclude from ratio if:
- no rent estimation possible
- size missing and zone model requires size

### 3.4 Ratio & P10
- ratio_years = purchase_price / (estimated_monthly_rent * 12)
- Eligible set: filtered by quality checks
- P10:
  - If eligible_buy_count >= MIN_SAMPLE (default 30): compute P10
  - Else fallback:
    - compute P20 OR pick lowest N deals (N=3) with warning flag

### 3.5 Alerting rules
- Trigger P10 deal:
  - is_deal_p10 == true
  - not previously alerted in last X days (default 30)
- Trigger price drop re-alert:
  - previously alerted
  - price_drop >= 5% since last alert (config)

---

## 4) Job Orchestration

### 4.1 Daily Job (05:00 Lisbon target)
Steps:
1. Timezone guard (only run if local time ~05:00)
2. Fetch from each source (API or scrape)
3. Save raw + normalized
4. Update memb
