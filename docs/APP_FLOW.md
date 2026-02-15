# Application Flow Documentation

## 1. Entry Points

Primary:
- App launch → Home (Zones)
- Push notification → Deal Detail
- Email link → Deal Detail
- First install → Onboarding

Secondary:
- Deep link from notification
- Manual refresh (future)

---

## 2. Core User Flows

---

## Flow A: Onboarding & First Zone

Goal: User creates first monitoring zone.

Happy Path:
1. Welcome screen
2. Tap "Create Zone"
3. Choose zone method:
   - Radius
   - Admin boundary
   - Polygon
4. Configure filters:
   - Property type
   - Price range
   - Bedrooms
5. Choose alert type
6. Save zone
7. Navigate to Zone Dashboard

Error States:
- Location permission denied → allow manual map use
- Invalid polygon → show correction hint
- No internet → show retry

Exit:
- Zone successfully saved

---

## Flow B: Daily Backend Processing

Triggered automatically at 05:00 Lisbon.

Steps:
1. Fetch listings from each source.
2. Normalize data.
3. Deduplicate.
4. Estimate rent.
5. Compute ratios.
6. Calculate P10 per zone.
7. Flag listings ≤ P10.
8. Send alerts.

Error Handling:
- Source fails → partial success allowed.
- No sample size → fallback rule.
- Duplicate listing → ignore.

---

## Flow C: View Zone Dashboard

Goal: User reviews daily results.

Screen: Zone Dashboard

Displays:
- P10 ratio
- Total listings analyzed
- New deals count
- Deals list

User Actions:
- Tap listing → Deal Detail
- Edit zone
- Refresh (future)

States:
- Loading
- Empty (no deals)
- Error (retry)

---

## Flow D: Deal Detail

Goal: User evaluates listing and acts.

Displays:
- Title
- Source
- Price
- Estimated Rent
- Ratio
- Zone P10
- Map preview
- Listing link

Actions:
- Open Source Website
- Call Now (tel:)
- Send Offer Email (mailto)
- Mark Not Relevant (future)

Edge Cases:
- No phone available → hide call
- No email app → copy offer text

---

## Flow E: Manage Alerts

Screen: Alert Settings

Options:
- Push
- Email
- Both
- Edit email template

States:
- Saved confirmation
- Invalid email format error

---

## 3. Navigation Structure

Onboarding
Home (Zones List)
  ├── Create/Edit Zone
  ├── Zone Dashboard
  │     └── Deal Detail
Alert Settings
Account (future)

---

## 4. Decision Logic

### P10 Rule

IF valid_ratios_count ≥ 30
THEN compute P10
ELSE use fallback

---

### Alert Rule

IF listing_ratio ≤ zone_P10
AND not previously alerted
THEN send alert

---

### Price Drop Rule

IF previously alerted
AND price_drop ≥ threshold
THEN re-alert

---

### Rent Estimation Rule

IF direct_rent_match_exists
THEN use direct rent
ELSE IF zone_median_available
THEN estimate rent
ELSE exclude from P10 set

---

## 5. Responsive Behavior (Android)

- Map interactions support pinch/drag.
- Alert deep link opens directly into Deal Detail.
- Offline state shows cached deals.
- Back navigation preserves state.

---

## 6. Error Handling

404 Listing Removed:
- Show "Listing no longer available"

Network Offline:
- Show offline banner
- Retry button

Backend Job Failure:
- Show last successful run timestamp
