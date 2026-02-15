export type AlertChannel = "push" | "email" | "both";
export type ZoneType = "radius" | "admin" | "polygon";
export type AdminLevel = "country" | "district" | "municipality" | "parish";
export type GeoJsonGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

export interface AdminSelection {
  country: string;
  district?: string;
  municipality?: string;
  parish?: string;
}

export interface AdminAreaOption {
  id: string;
  label: string;
  level: AdminLevel;
  country: string;
  district?: string;
  municipality?: string;
  parish?: string;
  lat: number | null;
  lng: number | null;
  sample_count: number;
}

export interface PortugalAdminDataset {
  districts: AdminAreaOption[];
  municipalities: AdminAreaOption[];
  parishes: AdminAreaOption[];
}

export interface PortugalAdminGeometryResponse {
  level: AdminLevel;
  geometry: GeoJsonGeometry | null;
}

export interface AdminAreaGeometryItem {
  id: string;
  label: string;
  level: AdminLevel;
  district?: string;
  municipality?: string;
  parish?: string;
  geometry: GeoJsonGeometry | null;
}

export interface PortugalAdminGeometryListResponse {
  level: AdminLevel;
  items: AdminAreaGeometryItem[];
}

export interface Zone {
  id: string;
  user_id: string;
  name: string;
  zone_type: ZoneType;
  center_lat: number | null;
  center_lng: number | null;
  radius_meters: number | null;
  admin_codes: Record<string, unknown> | null;
  polygon_geojson: Record<string, unknown> | null;
  filters: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ZoneDailyStats {
  zone_id: string;
  stats_date: string;
  eligible_buy_count: number;
  eligible_rent_count: number;
  p10_ratio_years: number | null;
  p50_ratio_years: number | null;
  p90_ratio_years: number | null;
  median_rent_eur_m2: number | null;
  min_sample_used: boolean;
  computed_at: string;
}

export interface ListingScoring {
  zone_id: string;
  listing_id: string;
  stats_date: string;
  estimated_monthly_rent_eur: number;
  rent_source: "direct_match" | "zone_model";
  ratio_years: number;
  is_deal_p10: boolean;
  rank_in_zone: number | null;
  created_at: string;
  listing?: {
    id: string;
    source: string;
    title: string | null;
    price_eur: number;
    url: string | null;
  } | null;
}

export interface ListingNormalized {
  id: string;
  source: string;
  title: string | null;
  price_eur: number;
  contact_phone: string | null;
  contact_email: string | null;
  url: string | null;
  listing_type?: "buy" | "rent";
  last_seen_at?: string;
}

export interface ZoneMembershipRow {
  listing_id: string;
  matched_at: string;
  listing?: {
    id: string;
    source: string;
    title: string | null;
    price_eur: number;
    url: string | null;
    listing_type: "buy" | "rent";
    last_seen_at: string;
  } | null;
}

export interface RawListingRow {
  id: string;
  source: string;
  fetched_at: string;
  external_id: string | null;
  url: string | null;
  status: "ok" | "failed" | "blocked";
  hash: string;
  raw_payload: Record<string, unknown>;
}

export interface Profile {
  user_id: string;
  name: string | null;
  default_alert_channel: AlertChannel;
  email_template_subject: string | null;
  email_template_body: string | null;
  created_at?: string;
}

export interface SourceImportMetrics {
  source: string;
  method: string;
  enabled: boolean;
  raw_total: number;
  raw_last_24h: number;
  normalized_total: number;
  last_raw_at: string | null;
  last_raw_status: "ok" | "failed" | "blocked" | null;
  last_normalized_at: string | null;
}

export interface RegionBreakdownRow {
  region: string;
  buy_count: number;
  rent_count: number;
  total_count: number;
}

export interface TypologyBreakdownRow {
  typology: string;
  buy_count: number;
  rent_count: number;
  total_count: number;
}

export interface DashboardListingRow {
  id: string;
  source: string;
  title: string | null;
  listing_type: "buy" | "rent" | null;
  price_eur: number;
  url: string | null;
  location_text: string | null;
  bedrooms: number | null;
  last_seen_at: string | null;
}

export interface ImportDashboardMetrics {
  sources: SourceImportMetrics[];
  total_raw: number;
  total_raw_last_24h: number;
  total_normalized: number;
  total_buy: number;
  total_rent: number;
  regions: {
    district: RegionBreakdownRow[];
    municipality: RegionBreakdownRow[];
    parish: RegionBreakdownRow[];
  };
  typologies: TypologyBreakdownRow[];
}
