# TECH_STACK.md

## 1) High-level Architecture

- **Android app (client)**: UI + zone setup + alerts preferences + deal browsing + “call/email” actions
- **Backend (free-tier MVP)**:
  - **Supabase** for Postgres DB + Auth + Storage + Row Level Security
  - **Scheduled ingestion job** running daily (05:00 Lisbon target)
  - Optional lightweight API (can be Supabase REST/RPC first; add FastAPI later if needed)

Why this stack:
- Supabase covers 80% of backend needs quickly (DB, auth, APIs).
- A scheduled job can run scraping/API fetching and write results to Supabase.
- Client stays clean: no scraping, no secrets.

Supabase platform overview. :contentReference[oaicite:0]{index=0}

---

## 2) Android App

### Language & Build
- **Kotlin**: `2.3.0` :contentReference[oaicite:1]{index=1}
- **Android Gradle Plugin (AGP)**: `9.0.1` :contentReference[oaicite:2]{index=2}

### UI
- **Jetpack Compose** with BOM: `androidx.compose:compose-bom:2026.01.01` :contentReference[oaicite:3]{index=3}
- Material 3 (via BOM)
- Navigation Compose (via BOM or explicit)

### Networking
- **Retrofit**: `3.0.0` :contentReference[oaicite:4]{index=4}
- **OkHttp**: `5.3.2` :contentReference[oaicite:5]{index=5}

### Maps & Geo
- Google Maps SDK for Android (polygon drawing, radius, pin)
- Geometry utilities (for point-in-polygon, distance)

### Push Notifications
- **Firebase Cloud Messaging (FCM)** :contentReference[oaicite:6]{index=6}

### Auth
- Supabase Auth (email magic link OR email+password for MVP)

---

## 3) Backend (MVP)

### Storage & APIs
- **Supabase Postgres** + Supabase REST + optional RPC functions

### Scheduled Ingestion (Daily)
Preferred MVP: **GitHub Actions scheduled workflow**
- Pros: Free for public repos (and limited free for private), easy to run Python + Playwright
- Cons: Cron is UTC; DST needs handling (see Scheduling section)

Alternative: Cloud functions / cron providers (can be added later)

### Scraping / Fetching
- **Python**: `3.14.3` :contentReference[oaicite:7]{index=7}
- **Playwright (Python)**: `1.58.0` :contentReference[oaicite:8]{index=8}
- HTTP fallback: requests/httpx (for APIs, RSS, JSON endpoints)

### Supabase Python Client
- `supabase==2.28.0` :contentReference[oaicite:9]{index=9}

### Optional API Layer (if needed)
- **FastAPI**: `0.129.0` :contentReference[oaicite:10]{index=10}

---

## 4) Scheduling (05:00 Lisbon)

Constraint: most free cron runners use UTC-based cron.

MVP strategy:
- Run job at **04:00 UTC and 05:00 UTC**
- Inside the job, compute current time in `Europe/Lisbon` and only execute the “full run” when local time is ~05:00.
- If it’s not 05:00 local, exit early.

This avoids DST headaches while staying free.

---

## 5) Secrets & Config

Client (Android):
- Supabase URL + anon key (safe to embed)
- Never embed service role key

Backend (GitHub Actions secrets):
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- FCM_SERVER_KEY or OAuth service account (if sending pushes from backend)
- Email provider key (later; MVP can use push only)

---

## 6) Repo Structure (Recommended)

repo/
  android-app/
  backend/
    collectors/
      idealista/
      imovirtual/
      casasapo/
      olx/
    core/
      normalize.py
      dedupe.py
      scoring.py
      alerts.py
      timezone_guard.py
    jobs/
      daily_run.py
    tests/
  supabase/
    migrations/
    functions/
  .github/
    workflows/
      daily_ingestion.yml
  docs/
    PRD.md
    APP_FLOW.md
    TECH_STACK.md
    BACKEND_STRUCTURE.md
    IMPLEMENTATION_PLAN.md
