# Product Requirements Document (PRD)

## 1. Product Overview

- **Project Name**: DealRadar PT (working title)
- **Platform**: Android App + Backend Service
- **Primary Function**: Detect undervalued property purchase opportunities in Portugal based on Price-to-Rent Ratio distribution within user-defined geographic zones.
- **Core Insight**: Listings in the bottom 10% (P10) of Price-to-Rent Ratio within a zone are considered “Good Deals”.
- **Daily Update Time**: 05:00 Europe/Lisbon

---

## 2. Problem Statement

Finding high-value real estate opportunities requires manually comparing buy prices to rent potential across multiple websites. This process is time-consuming and inconsistent. There is no automated system that monitors defined geographic areas daily and surfaces statistically undervalued properties.

---

## 3. Goals & Objectives

### Business Goals
- Deliver reliable daily deal detection with ≥95% successful job execution.
- Maintain duplicate alert rate below 5%.
- Ensure users receive actionable alerts within minutes of daily processing.

### User Goals
- Define geographic search zones easily.
- Automatically detect undervalued properties.
- Receive alerts only for statistically strong opportunities.
- Take immediate action (call or email).

---

## 4. Core Deal Definition

### Primary Metric: Price-to-Rent Ratio (Years)

Formula:
purchase_price / (monthly_rent * 12)

Lower ratio = better value.

### Deal Rule (MVP)

A listing is a “Good Deal” if:

listing_ratio ≤ P10_ratio_for_zone

Where:
- P10_ratio_for_zone = 10th percentile of all valid ratios within that zone.

---

## 5. Target Users

### Persona 1: Investor
- Evaluates yield-driven opportunities.
- Reacts quickly to undervalued listings.
- Wants data-driven decisions.

### Persona 2: Value Buyer
- Looking for a well-priced home.
- Prefers automated filtering.
- Wants immediate contact options.

---

## 6. Features & Requirements

## P0 – Must Have (MVP)

### 1. Zone Management
Users can define zones via:
- Radius around a pin
- Administrative boundary (district/municipality/parish)
- Drawn polygon on map

Each zone includes:
- Name
- Property type
- Price range
- Bedroom filter
- Alert preference (push/email/both)

Acceptance Criteria:
- User can create, edit, delete zones.
- Zones persist and are used in backend scoring.

---

### 2. Daily Data Ingestion
- API-first integration where available.
- Scraping fallback if API unavailable.
- Normalize listing data (price, size, rooms, geo, URL, contact).

Acceptance Criteria:
- Job runs daily at 05:00 Lisbon.
- Listings stored with:
  - source
  - external_id
  - first_seen
  - last_seen
  - last_price

---

### 3. Rent Estimation Logic

Priority:
1. Direct rent listing match
2. Zone rent model (median rent €/m² × size)
3. Exclude if insufficient data

Acceptance Criteria:
- Every buy listing has either:
  - valid ratio
  - marked “insufficient data”

---

### 4. P10 Computation

For each zone:
- Compute ratio distribution.
- Calculate 10th percentile.
- Flag listings ≤ P10.

Sample Size Rule:
- If listings < 30 → fallback to:
  - lowest 3 ratios OR
  - P20 threshold

Acceptance Criteria:
- P10 computed daily.
- Results stored historically.

---

### 5. Alerts & Actions

User-selectable:
- Push
- Email
- Both

Alert includes:
- Listing title
- Price
- Estimated rent
- Ratio
- Why it qualifies (≤ P10)
- Source link

Actions:
- Call (tel link)
- Send Offer Email (prefilled mailto)

Acceptance Criteria:
- No duplicate alerts unless significant price drop.
- Email template editable by user.

---

## P1 – Should Have

- Quiet hours
- Price-drop alerts
- User feedback (relevant/not relevant)
- Top 3 ranking per zone

---

## P2 – Nice to Have

- Investment calculator
- Comparable properties
- WhatsApp template

---

## 7. Out of Scope (MVP)

- Automatic bidding
- In-app transactions
- Full CRM system
- Guaranteed profitability claims

---

## 8. Non-Functional Requirements

- Daily job reliability ≥95%
- App load time <2 seconds
- Secure authentication
- No secrets stored client-side
- Rate-limited scraping/API calls
- Lisbon timezone scheduling

---

## 9. Risks

- API access limitations
- Scraping blocking
- Poor geolocation accuracy
- Small sample size in rural zones

Mitigation:
- API-first strategy
- Backoff + retry logic
- Sample size fallback rules
