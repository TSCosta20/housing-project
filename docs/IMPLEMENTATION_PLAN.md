# IMPLEMENTATION_PLAN.md

## Assumptions (explicit)
- MVP includes both:
  1) “Deals” view (P10 flagged)
  2) Basic “Market view” per zone (P10/P50/P90 + counts)
- API keys may not exist initially; scraping fallback will be used for MVP.
- Daily run target is 05:00 Lisbon; DST handled via timezone guard.

---

## Phase 0 — Repo Setup (Today, 60–90 min)

1) Create repo structure:
- android-app/
- backend/
- supabase/
- .github/workflows/
- docs/

2) Add docs:
- PRD.md, APP_FLOW.md, TECH_STACK.md, BACKEND_STRUCTURE.md, IMPLEMENTATION_PLAN.md

3) Create Supabase project:
- create DB + auth enabled
- set up tables (SQL migration)
- set RLS policies

Deliverables:
- Supabase project created
- Initial schema migration committed

---

## Phase 1 — Backend Core (Today, 3–5 hours)

### 1.1 Implement DB schema
- Write SQL migrations for:
  - profiles
  - zones
  - listings_raw
  - listings_normalized
  - membership
  - zone_daily_stats
  - scoring
  - deal_events

### 1.2 Implement collectors (start with 1–2 sources)
- Build “collector interface”:
  - fetch() -> raw_items
  - normalize() -> normalized_listing
- Implement:
  - OLX (scrape)
  - Casa Sapo (scrape)
  - Keep Idealista/Imovirtual as stubs if blocked until API keys exist

### 1.3 Implement scoring pipeline
- zone matching:
  - radius check
  - polygon point-in-polygon
  - admin match (by normalized admin code; can be “P1” if mapping isn’t ready today)
- rent estimation
- compute ratios
- compute P10 and store zone stats
- identify deals and store deal_events

### 1.4 Implement GitHub Actions scheduled job
- daily_ingestion.yml
- run at 04:00 and 05:00 UTC
- timezone_guard: only proceed if Europe/Lisbon hour == 5

Deliverables:
- backend/daily_run.py runs locally and on GitHub Actions
- results written into Supabase

---

## Phase 2 — Android MVP (Today + Tomorrow)

### 2.1 Auth + Zone CRUD (P0)
Screens:
- Onboarding
- Home (Zones list)
- Create Zone (choose method)
- Map zone creator:
  - radius
  - polygon draw
  - admin selector (P1 if time is tight)
- Alert preference settings

### 2.2 Zone Dashboard (P0)
- show:
  - last run timestamp
  - P10/P50/P90 ratios
  - deal count
  - list of deals (sorted by lowest ratio)

### 2.3 Deal Detail (P0)
- show:
  - price, est rent, ratio, why flagged
  - source link
- actions:
  - Call now (tel:)
  - Send offer email (mailto: prefilled template)

Deliverables:
- Functional end-to-end app using Supabase data

---

## Phase 3 — Alerting (Tomorrow)

### 3.1 Push (FCM)
- Register device token
- Store token in Supabase (profiles or separate table)
- Backend sends push for new deal_events

### 3.2 Email (P1)
Two options:
1) Keep “mailto only” (no backend provider needed)
2) Add email provider later (requires API key)

Deliverables:
- Push alerts delivered
- Deep-link to Deal Detail

---

## Phase 4 — Data Quality & Scaling (Later)

- Improve dedupe across sources
- Admin boundary mapping completeness (district/municipality/parish)
- Better rent model (€/m² by typology + regression)
- Anti-bot resilience (rotating user agents, request pacing)
- UI: saved searches, quiet hours, feedback loop

---

## Definition of Done (MVP)

Backend:
- Daily job runs reliably
- Zone stats computed
- Deals flagged by P10
- Deal events created without duplicates

Android:
- User can create zones (radius + polygon)
- User can browse deals and see market stats
- User can call or email from deal detail

---

## Immediate Cursor Prompts (practical)

### Prompt A — Create Supabase migrations
"Create SQL migrations for the tables in BACKEND_STRUCTURE.md, including primary keys, indexes, and basic RLS policies."

### Prompt B — Implement backend daily job
"Implement backend/jobs/daily_run.py that: fetches from enabled collectors, normalizes, dedupes, matches listings to zones, computes rent estimate, computes ratios, computes P10 per zone, writes zone_daily_stats and listing_scoring_daily, and creates deal_events."

### Prompt C — Android skeleton
"Create an Android app with Kotlin + Jetpack Compose using the versions in TECH_STACK.md. Implement: login, zones list, create zone (radius + polygon), zone dashboard, and deal detail with call/email actions."
