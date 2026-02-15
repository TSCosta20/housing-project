# DealRadar PT MVP

Documentation-first implementation using:
- `docs/PRD.md`
- `docs/APP_FLOW.md`
- `docs/TECH_STACK.md`
- `docs/BACKEND_STRUCTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`

## Prerequisites

- Python 3.12+ installed
- Node.js 20+ and npm installed
- Supabase project created
- Firebase project created (for push)

## 1) Database setup

Run migrations in order:
1. `supabase/migrations/0001_init.sql`
2. `supabase/migrations/0002_notifications.sql`

## 2) Environment variables

Copy `.env.example` and fill values:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FCM_SERVICE_ACCOUNT_JSON_PATH` (recommended)
- `FCM_PROJECT_ID` (optional if present in service account JSON)
- `FCM_SERVER_KEY` (legacy fallback only)

For web frontend copy `web-app/.env.example` to `web-app/.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 3) Backend setup and tests

From repo root:

```powershell
python -m pip install -r backend/requirements.txt
python -m pytest backend/tests
python -m backend.jobs.daily_run
```

## 4) Web app setup (primary client)

From `web-app`:

```powershell
npm install
npm run dev
```

Routes:
- `/auth`
- `/zones`
- `/zones/new`
- `/zones/[zoneId]`
- `/deals/[zoneId]/[listingId]`
- `/settings/alerts`

## 5) Android setup (kept in parallel, optional)

1. Add Firebase config file:
   - place `google-services.json` at `android-app/app/google-services.json`
2. Open `android-app` in Android Studio.
3. Sync project and run app.

## Security note

- Never commit Firebase service account JSON or Supabase service role key to source control.

## 6) Gradle wrapper

This repository currently does not include wrapper binaries.
Generate from Android Studio:
- Open `android-app`
- Use terminal in that folder and run wrapper task
- Commit generated files:
  - `android-app/gradlew`
  - `android-app/gradlew.bat`
  - `android-app/gradle/wrapper/gradle-wrapper.properties`
  - `android-app/gradle/wrapper/gradle-wrapper.jar`

## Known MVP doc-gap TODOs

- Admin boundary matching logic (backend scoring)
- Casa Sapo response parser contract
- Idealista/Imovirtual API integration
- Full magic-link deep-link schema finalization
- Owner-scoped RLS for analytics read tables
