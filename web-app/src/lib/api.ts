import type { Session, User } from "@supabase/supabase-js";

import { getSupabaseClient } from "@/lib/supabase";
import type {
  AdminAreaGeometryItem,
  AdminLevel,
  AdminSelection,
  DashboardListingRow,
  GeoJsonGeometry,
  ListingNormalized,
  ListingScoring,
  PortugalAdminDataset,
  PortugalAdminGeometryResponse,
  PortugalAdminGeometryListResponse,
  Profile,
  RegionBreakdownRow,
  RawListingRow,
  TypologyBreakdownRow,
  Zone,
  ZoneDailyStats,
  ZoneMembershipRow,
  ImportDashboardMetrics,
  SourceImportMetrics,
} from "@/lib/types";

export async function getSession(): Promise<Session | null> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) {
    throw new Error(error.message);
  }
  return data.session;
}

export async function getUser(): Promise<User | null> {
  const { data, error } = await getSupabaseClient().auth.getUser();
  if (error) {
    throw new Error(error.message);
  }
  return data.user;
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(error.message);
  }
}

export async function signUpWithPassword(email: string, password: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.signUp({ email, password });
  if (error) {
    throw new Error(error.message);
  }
}

export async function sendMagicLink(email: string, origin: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function completeAuthFromCallback(url: URL): Promise<void> {
  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await getSupabaseClient().auth.exchangeCodeForSession(code);
    if (error) {
      throw new Error(error.message);
    }
    return;
  }

  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (tokenHash && type) {
    const { error } = await getSupabaseClient().auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "magiclink" | "recovery" | "invite" | "email",
    });
    if (error) {
      throw new Error(error.message);
    }
  }
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) {
    throw new Error(error.message);
  }
}

export async function listZones(): Promise<Zone[]> {
  const { data, error } = await getSupabaseClient()
    .from("zones")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as Zone[];
}

export async function listPortugalParishes(limit = 1200): Promise<string[]> {
  const { data, error } = await getSupabaseClient()
    .from("listings_normalized")
    .select("location_text")
    .eq("is_active", true)
    .not("location_text", "is", null)
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }

  const unique = new Set<string>();
  for (const row of data ?? []) {
    const location = typeof row.location_text === "string" ? row.location_text : "";
    if (!location.trim()) continue;
    const parish = location.split(",")[0]?.trim();
    if (parish) unique.add(parish);
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b, "pt"));
}

export async function listPortugalAdminDataset(): Promise<PortugalAdminDataset> {
  const response = await fetch("/api/pt-admin", { method: "GET" });
  if (!response.ok) {
    throw new Error("Failed to load Portugal administrative database.");
  }
  const payload = (await response.json()) as PortugalAdminDataset;
  return payload;
}

export async function getPortugalAdminGeometry(
  selection: AdminSelection,
): Promise<{ level: AdminLevel; geometry: GeoJsonGeometry | null }> {
  const level: AdminLevel = selection.parish
    ? "parish"
    : selection.municipality
      ? "municipality"
      : selection.district
        ? "district"
        : "country";
  if (level === "country") {
    return { level, geometry: null };
  }
  const params = new URLSearchParams({
    level,
    district: selection.district ?? "",
    municipality: selection.municipality ?? "",
    parish: selection.parish ?? "",
  });
  const response = await fetch(`/api/pt-admin/geometry?${params.toString()}`, { method: "GET" });
  if (!response.ok) {
    throw new Error("Failed to load area geometry.");
  }
  const payload = (await response.json()) as PortugalAdminGeometryResponse;
  return { level: payload.level, geometry: payload.geometry };
}

export async function listPortugalAdminGeometries(params: {
  level: AdminLevel;
  district?: string;
  municipality?: string;
}): Promise<AdminAreaGeometryItem[]> {
  const query = new URLSearchParams({
    level: params.level,
    district: params.district ?? "",
    municipality: params.municipality ?? "",
  });
  const response = await fetch(`/api/pt-admin/geometry-list?${query.toString()}`, { method: "GET" });
  if (!response.ok) {
    throw new Error("Failed to load area polygons.");
  }
  const payload = (await response.json()) as PortugalAdminGeometryListResponse;
  return payload.items ?? [];
}

export function normalizeAdminSelections(value: unknown): AdminSelection[] {
  if (!Array.isArray(value)) return [];
  const out: AdminSelection[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const country = typeof row.country === "string" ? row.country.trim().toUpperCase() : "PT";
    const district = typeof row.district === "string" ? row.district.trim() : "";
    const municipality = typeof row.municipality === "string" ? row.municipality.trim() : "";
    const parish =
      typeof row.parish === "string"
        ? row.parish.trim()
        : typeof row.freguesia === "string"
          ? row.freguesia.trim()
          : "";
    if (!district && !municipality && !parish && country !== "PT") continue;
    out.push({
      country: country || "PT",
      ...(district ? { district } : {}),
      ...(municipality ? { municipality } : {}),
      ...(parish ? { parish } : {}),
    });
  }
  return dedupeAdminSelections(out);
}

export function dedupeAdminSelections(selections: AdminSelection[]): AdminSelection[] {
  const byKey = new Map<string, AdminSelection>();
  for (const item of selections) {
    const key = [
      (item.country || "PT").toUpperCase(),
      (item.district || "").toLowerCase(),
      (item.municipality || "").toLowerCase(),
      (item.parish || "").toLowerCase(),
    ].join("|");
    byKey.set(key, {
      country: (item.country || "PT").toUpperCase(),
      ...(item.district ? { district: item.district } : {}),
      ...(item.municipality ? { municipality: item.municipality } : {}),
      ...(item.parish ? { parish: item.parish } : {}),
    });
  }
  return Array.from(byKey.values());
}


export async function listListings(listingType?: "buy" | "rent"): Promise<ListingNormalized[]> {
  let query = getSupabaseClient()
    .from("listings_normalized")
    .select("id,source,title,price_eur,contact_phone,contact_email,url,listing_type,last_seen_at")
    .eq("is_active", true)
    .order("last_seen_at", { ascending: false })
    .limit(200);
  if (listingType) {
    query = query.eq("listing_type", listingType);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as ListingNormalized[];
}

export async function getImportDashboardMetrics(): Promise<ImportDashboardMetrics> {
  const { data: sources, error: sourcesError } = await getSupabaseClient()
    .from("sources")
    .select("name,method,enabled")
    .order("name", { ascending: true });
  if (sourcesError) {
    throw new Error(sourcesError.message);
  }

  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await Promise.all(
    (sources ?? []).map(async (sourceRow) => {
      const source = String(sourceRow.name ?? "");
      const method = String(sourceRow.method ?? "");
      const enabled = Boolean(sourceRow.enabled);

      const [rawTotal, raw24h, normalizedTotal, lastRaw, lastNormalized] = await Promise.all([
        getSupabaseClient()
          .from("listings_raw")
          .select("*", { count: "exact", head: true })
          .eq("source", source),
        getSupabaseClient()
          .from("listings_raw")
          .select("*", { count: "exact", head: true })
          .eq("source", source)
          .gte("fetched_at", sinceIso),
        getSupabaseClient()
          .from("listings_normalized")
          .select("*", { count: "exact", head: true })
          .eq("source", source),
        getSupabaseClient()
          .from("listings_raw")
          .select("fetched_at,status")
          .eq("source", source)
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        getSupabaseClient()
          .from("listings_normalized")
          .select("last_seen_at")
          .eq("source", source)
          .order("last_seen_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const errors = [rawTotal.error, raw24h.error, normalizedTotal.error, lastRaw.error, lastNormalized.error].filter(
        Boolean,
      );
      if (errors.length > 0) {
        throw new Error(errors[0]?.message ?? "Failed to compute import metrics.");
      }

      const item: SourceImportMetrics = {
        source,
        method,
        enabled,
        raw_total: rawTotal.count ?? 0,
        raw_last_24h: raw24h.count ?? 0,
        normalized_total: normalizedTotal.count ?? 0,
        last_raw_at: (lastRaw.data?.fetched_at as string | undefined) ?? null,
        last_raw_status: (lastRaw.data?.status as "ok" | "failed" | "blocked" | undefined) ?? null,
        last_normalized_at: (lastNormalized.data?.last_seen_at as string | undefined) ?? null,
      };
      return item;
    }),
  );

  const regionMaps = {
    district: new Map<string, RegionBreakdownRow>(),
    municipality: new Map<string, RegionBreakdownRow>(),
    parish: new Map<string, RegionBreakdownRow>(),
  };
  const typologyMap = new Map<string, TypologyBreakdownRow>();
  let totalBuy = 0;
  let totalRent = 0;

  const pageSize = 5000;
  const adminIndex = await getPortugalAdminIndex();
  let offset = 0;
  while (true) {
    const { data: listingsPage, error: listingsError } = await getSupabaseClient()
      .from("listings_normalized")
      .select("listing_type,bedrooms,title,location_text")
      .eq("is_active", true)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (listingsError) {
      throw new Error(listingsError.message);
    }
    const rowsPage = listingsPage ?? [];
    if (rowsPage.length === 0) {
      break;
    }

    for (const row of rowsPage) {
      const listingType = row.listing_type === "rent" ? "rent" : "buy";
      if (listingType === "buy") totalBuy += 1;
      if (listingType === "rent") totalRent += 1;

      const resolvedRegion = resolveAdminHierarchy((row.location_text as string | undefined) ?? null, adminIndex);
      const parish = resolvedRegion.parish ?? "Unknown";
      const municipality = resolvedRegion.municipality ?? "Unknown";
      const district = resolvedRegion.district ?? "Unknown";

      for (const [level, region] of [
        ["district", district],
        ["municipality", municipality],
        ["parish", parish],
      ] as const) {
        const current = regionMaps[level].get(region) ?? {
          region,
          buy_count: 0,
          rent_count: 0,
          total_count: 0,
        };
        if (listingType === "buy") current.buy_count += 1;
        if (listingType === "rent") current.rent_count += 1;
        current.total_count += 1;
        regionMaps[level].set(region, current);
      }

      const typology = inferTypologyLabel(
        typeof row.bedrooms === "number" ? row.bedrooms : null,
        typeof row.title === "string" ? row.title : null,
      );
      const typologyCurrent = typologyMap.get(typology) ?? {
        typology,
        buy_count: 0,
        rent_count: 0,
        total_count: 0,
      };
      if (listingType === "buy") typologyCurrent.buy_count += 1;
      if (listingType === "rent") typologyCurrent.rent_count += 1;
      typologyCurrent.total_count += 1;
      typologyMap.set(typology, typologyCurrent);
    }

    if (rowsPage.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  const sortRegions = (entries: Iterable<RegionBreakdownRow>): RegionBreakdownRow[] =>
    Array.from(entries).sort((a, b) => b.total_count - a.total_count || a.region.localeCompare(b.region, "pt"));
  const sortTypologies = (entries: Iterable<TypologyBreakdownRow>): TypologyBreakdownRow[] =>
    Array.from(entries).sort((a, b) => {
      if (a.typology === "Unknown") return 1;
      if (b.typology === "Unknown") return -1;
      return b.total_count - a.total_count || a.typology.localeCompare(b.typology, "pt");
    });

  return {
    sources: rows,
    total_raw: rows.reduce((acc, row) => acc + row.raw_total, 0),
    total_raw_last_24h: rows.reduce((acc, row) => acc + row.raw_last_24h, 0),
    total_normalized: rows.reduce((acc, row) => acc + row.normalized_total, 0),
    total_buy: totalBuy,
    total_rent: totalRent,
    regions: {
      district: sortRegions(regionMaps.district.values()),
      municipality: sortRegions(regionMaps.municipality.values()),
      parish: sortRegions(regionMaps.parish.values()),
    },
    typologies: sortTypologies(typologyMap.values()),
  };
}

type DashboardRegionLevel = "district" | "municipality" | "parish";

type AdminNameRecord = {
  district: string;
  municipality: string;
  parish: string;
};

type PortugalAdminIndex = {
  districtByKey: Map<string, string>;
  municipalityByKey: Map<string, { municipality: string; district: string }>;
  parishByKey: Map<string, AdminNameRecord>;
};

let cachedPortugalAdminIndex: PortugalAdminIndex | null = null;

function normalizeLocationPart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function inferTypologyLabel(bedrooms: number | null, title: string | null): string {
  const rawTitle = String(title ?? "");
  // Detect typology token in title: T2, t3, T2+1, t 4 + 1.
  const titleMatch = rawTitle.match(/\b[tT]\s*([0-9]{1,2})(?:\s*\+\s*([0-9]{1,2}))?\b/);
  if (titleMatch) {
    const base = titleMatch[1];
    const extra = titleMatch[2];
    return extra ? `T${base}+${extra}` : `T${base}`;
  }
  if (typeof bedrooms === "number" && Number.isFinite(bedrooms) && bedrooms >= 0) {
    return `T${Math.round(bedrooms)}`;
  }
  return "Unknown";
}

function buildPortugalAdminIndex(dataset: PortugalAdminDataset): PortugalAdminIndex {
  const districtByKey = new Map<string, string>();
  const municipalityByKey = new Map<string, { municipality: string; district: string }>();
  const parishByKey = new Map<string, AdminNameRecord>();

  for (const district of dataset.districts) {
    const label = district.label?.trim();
    if (!label) continue;
    districtByKey.set(normalizeLocationPart(label), label);
  }

  for (const municipality of dataset.municipalities) {
    const municipalityName = municipality.label?.trim();
    const districtName = municipality.district?.trim();
    if (!municipalityName || !districtName) continue;
    municipalityByKey.set(normalizeLocationPart(municipalityName), {
      municipality: municipalityName,
      district: districtName,
    });
  }

  for (const parish of dataset.parishes) {
    const parishName = parish.label?.trim();
    const municipalityName = parish.municipality?.trim();
    const districtName = parish.district?.trim();
    if (!parishName || !municipalityName || !districtName) continue;
    parishByKey.set(normalizeLocationPart(parishName), {
      parish: parishName,
      municipality: municipalityName,
      district: districtName,
    });
  }

  return { districtByKey, municipalityByKey, parishByKey };
}

async function getPortugalAdminIndex(): Promise<PortugalAdminIndex> {
  if (cachedPortugalAdminIndex) {
    return cachedPortugalAdminIndex;
  }
  const dataset = await listPortugalAdminDataset();
  cachedPortugalAdminIndex = buildPortugalAdminIndex(dataset);
  return cachedPortugalAdminIndex;
}

function extractLocationCandidates(locationText: string | null | undefined): string[] {
  const raw = String(locationText ?? "").trim();
  if (!raw) return [];
  const split = raw
    .split(/[,\-|/;()]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (split.length === 0) return [];
  return split;
}

function resolveAdminHierarchy(
  locationText: string | null | undefined,
  index: PortugalAdminIndex,
): { district: string | null; municipality: string | null; parish: string | null } {
  const candidates = extractLocationCandidates(locationText);
  let district: string | null = null;
  let municipality: string | null = null;
  let parish: string | null = null;

  for (const part of candidates) {
    const key = normalizeLocationPart(part);
    const parishHit = index.parishByKey.get(key);
    if (parishHit) {
      parish = parishHit.parish;
      municipality = parishHit.municipality;
      district = parishHit.district;
      break;
    }
  }

  if (!municipality || !district) {
    for (const part of candidates) {
      const key = normalizeLocationPart(part);
      const municipalityHit = index.municipalityByKey.get(key);
      if (municipalityHit) {
        municipality = municipalityHit.municipality;
        district = municipalityHit.district;
        break;
      }
    }
  }

  if (!district) {
    for (const part of candidates) {
      const key = normalizeLocationPart(part);
      const districtHit = index.districtByKey.get(key);
      if (districtHit) {
        district = districtHit;
        break;
      }
    }
  }

  return { district, municipality, parish };
}

function locationPartByLevel(
  locationText: string | null | undefined,
  level: DashboardRegionLevel,
  index: PortugalAdminIndex,
): string {
  const resolved = resolveAdminHierarchy(locationText, index);
  if (level === "parish") return normalizeLocationPart(resolved.parish ?? "Unknown");
  if (level === "municipality") return normalizeLocationPart(resolved.municipality ?? "Unknown");
  return normalizeLocationPart(resolved.district ?? "Unknown");
}

function normalizeDashboardRow(row: Record<string, unknown>): DashboardListingRow {
  return {
    id: String(row.id ?? ""),
    source: String(row.source ?? ""),
    title: typeof row.title === "string" ? row.title : null,
    listing_type:
      row.listing_type === "buy" || row.listing_type === "rent" ? (row.listing_type as "buy" | "rent") : null,
    price_eur: Number(row.price_eur ?? 0),
    url: typeof row.url === "string" ? row.url : null,
    location_text: typeof row.location_text === "string" ? row.location_text : null,
    bedrooms: typeof row.bedrooms === "number" ? row.bedrooms : null,
    last_seen_at: typeof row.last_seen_at === "string" ? row.last_seen_at : null,
  };
}

export async function getDashboardListingsBySource(source: string): Promise<DashboardListingRow[]> {
  const out: DashboardListingRow[] = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await getSupabaseClient()
      .from("listings_normalized")
      .select("id,source,title,listing_type,price_eur,url,location_text,bedrooms,last_seen_at")
      .eq("is_active", true)
      .eq("source", source)
      .order("last_seen_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    out.push(...rows.map(normalizeDashboardRow));
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

export async function getDashboardListingsByTypology(typology: string): Promise<DashboardListingRow[]> {
  const out: DashboardListingRow[] = [];
  const pageSize = 1000;
  let offset = 0;
  const target = typology.trim().toUpperCase();
  while (true) {
    const { data, error } = await getSupabaseClient()
      .from("listings_normalized")
      .select("id,source,title,listing_type,price_eur,url,location_text,bedrooms,last_seen_at")
      .eq("is_active", true)
      .order("last_seen_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    for (const row of rows) {
      const inferred = inferTypologyLabel(
        typeof row.bedrooms === "number" ? row.bedrooms : null,
        typeof row.title === "string" ? row.title : null,
      );
      if (inferred.toUpperCase() === target) {
        out.push(normalizeDashboardRow(row));
      }
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

export async function getDashboardListingsByRegion(
  level: DashboardRegionLevel,
  regionLabel: string,
): Promise<DashboardListingRow[]> {
  const out: DashboardListingRow[] = [];
  const adminIndex = await getPortugalAdminIndex();
  const target = normalizeLocationPart(regionLabel || "Unknown");
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await getSupabaseClient()
      .from("listings_normalized")
      .select("id,source,title,listing_type,price_eur,url,location_text,bedrooms,last_seen_at")
      .eq("is_active", true)
      .order("last_seen_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    for (const row of rows) {
      const part = locationPartByLevel((row.location_text as string | undefined) ?? null, level, adminIndex);
      if (part === target) {
        out.push(normalizeDashboardRow(row));
      }
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

export async function createZone(input: Partial<Zone>): Promise<Zone> {
  const { data, error } = await getSupabaseClient().from("zones").insert(input).select("*").single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create zone.");
  }
  return data as Zone;
}

export async function updateZone(zoneId: string, patch: Partial<Zone>): Promise<Zone> {
  const { data, error } = await getSupabaseClient()
    .from("zones")
    .update(patch)
    .eq("id", zoneId)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to update zone.");
  }
  return data as Zone;
}

export async function deactivateZone(zoneId: string): Promise<void> {
  const { error } = await getSupabaseClient().from("zones").update({ is_active: false }).eq("id", zoneId);
  if (error) {
    throw new Error(error.message);
  }
}

export async function getZone(zoneId: string): Promise<Zone | null> {
  const { data, error } = await getSupabaseClient().from("zones").select("*").eq("id", zoneId).single();
  if (error) {
    return null;
  }
  return data as Zone;
}

export async function getLatestZoneStats(zoneId: string): Promise<ZoneDailyStats | null> {
  const { data, error } = await getSupabaseClient()
    .from("zone_daily_stats")
    .select("*")
    .eq("zone_id", zoneId)
    .order("stats_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as ZoneDailyStats | null) ?? null;
}

export async function getZoneDeals(zoneId: string): Promise<ListingScoring[]> {
  const { data, error } = await getSupabaseClient()
    .from("listing_scoring_daily")
    .select(
      "zone_id,listing_id,stats_date,estimated_monthly_rent_eur,rent_source,ratio_years,is_deal_p10,rank_in_zone,created_at,listing:listings_normalized(id,source,title,price_eur,url)",
    )
    .eq("zone_id", zoneId)
    .eq("is_deal_p10", true)
    .order("rank_in_zone", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as Array<
    ListingScoring & {
      listing?: ListingScoring["listing"] | ListingScoring["listing"][];
    }
  >;
  return rows.map((row) => ({
    ...row,
    listing: Array.isArray(row.listing) ? (row.listing[0] ?? null) : (row.listing ?? null),
  }));
}

export async function getZoneScoringRows(zoneId: string): Promise<ListingScoring[]> {
  const { data, error } = await getSupabaseClient()
    .from("listing_scoring_daily")
    .select(
      "zone_id,listing_id,stats_date,estimated_monthly_rent_eur,rent_source,ratio_years,is_deal_p10,rank_in_zone,created_at,listing:listings_normalized(id,source,title,price_eur,url)",
    )
    .eq("zone_id", zoneId)
    .order("ratio_years", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as Array<
    ListingScoring & {
      listing?: ListingScoring["listing"] | ListingScoring["listing"][];
    }
  >;
  return rows.map((row) => ({
    ...row,
    listing: Array.isArray(row.listing) ? (row.listing[0] ?? null) : (row.listing ?? null),
  }));
}

export async function getZoneMembershipRows(zoneId: string): Promise<ZoneMembershipRow[]> {
  const { data, error } = await getSupabaseClient()
    .from("listing_zone_membership")
    .select(
      "listing_id,matched_at,listing:listings_normalized(id,source,title,price_eur,url,listing_type,last_seen_at)",
    )
    .eq("zone_id", zoneId)
    .order("matched_at", { ascending: false })
    .limit(200);
  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Array<
    ZoneMembershipRow & {
      listing?: ZoneMembershipRow["listing"] | ZoneMembershipRow["listing"][];
    }
  >;
  return rows.map((row) => ({
    ...row,
    listing: Array.isArray(row.listing) ? (row.listing[0] ?? null) : (row.listing ?? null),
  }));
}

export async function getRawListingsForSources(sources: string[], limit = 60): Promise<RawListingRow[]> {
  const normalizedSources = Array.from(new Set(sources.map((x) => x.trim().toLowerCase()).filter(Boolean)));
  if (normalizedSources.length === 0) {
    return [];
  }
  const { data, error } = await getSupabaseClient()
    .from("listings_raw")
    .select("id,source,fetched_at,external_id,url,status,hash,raw_payload")
    .in("source", normalizedSources)
    .order("fetched_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as RawListingRow[];
}

export async function getListingById(listingId: string): Promise<ListingNormalized | null> {
  const { data, error } = await getSupabaseClient()
    .from("listings_normalized")
    .select("id,source,title,price_eur,contact_phone,contact_email,url")
    .eq("id", listingId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as ListingNormalized | null) ?? null;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as Profile | null) ?? null;
}

export async function upsertProfile(profile: Profile): Promise<Profile> {
  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .upsert(profile, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to save profile.");
  }
  return data as Profile;
}
