import { NextResponse } from "next/server";

import type { AdminAreaOption, PortugalAdminDataset } from "@/lib/types";

const BASE_URL = "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets";
const LIMIT = 100;
const CACHE_MS = 12 * 60 * 60 * 1000;

let cached: { at: number; data: PortugalAdminDataset } | null = null;

export async function GET(): Promise<NextResponse> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) {
    return NextResponse.json(cached.data);
  }

  try {
    const [districtRows, municipalitiesRows, parishesRows] = await Promise.all([
      fetchDistricts(),
      fetchMunicipalities(),
      fetchParishes(),
    ]);
    const districtMap = new Map<string, AdminAreaOption>();
    const municipalityMap = new Map<string, AdminAreaOption>();
    const parishMap = new Map<string, AdminAreaOption>();

    for (const row of districtRows) {
      const district = (row.dis_name || "").trim();
      if (!district) continue;
      const districtId = `district:${district.toLowerCase()}`;
      upsertAreaOption(districtMap, districtId, {
        id: districtId,
        label: district,
        level: "district",
        country: "PT",
        district,
        lat: row.geo_point_2d?.lat ?? null,
        lng: row.geo_point_2d?.lon ?? null,
        sample_count: 1,
      });
    }

    for (const row of municipalitiesRows) {
      const district = (row.dis_name || "").trim();
      const municipality = (row.con_name || "").trim();
      if (!district || !municipality) continue;

      const municipalityId = `municipality:${district.toLowerCase()}:${municipality.toLowerCase()}`;
      upsertAreaOption(municipalityMap, municipalityId, {
        id: municipalityId,
        label: municipality,
        level: "municipality",
        country: "PT",
        district,
        municipality,
        lat: row.geo_point_2d?.lat ?? null,
        lng: row.geo_point_2d?.lon ?? null,
        sample_count: 1,
      });
    }

    for (const row of parishesRows) {
      const district = (row.dis_name || "").trim();
      const municipality = (row.con_name || "").trim();
      const parish = (row.fre_name || "").trim();
      if (!district || !municipality || !parish) continue;
      const parishId = `parish:${district.toLowerCase()}:${municipality.toLowerCase()}:${parish.toLowerCase()}`;
      upsertAreaOption(parishMap, parishId, {
        id: parishId,
        label: parish,
        level: "parish",
        country: "PT",
        district,
        municipality,
        parish,
        lat: row.geo_point_2d?.lat ?? null,
        lng: row.geo_point_2d?.lon ?? null,
        sample_count: 1,
      });
    }

    const sorter = (a: AdminAreaOption, b: AdminAreaOption) => a.label.localeCompare(b.label, "pt");
    const response: PortugalAdminDataset = {
      districts: Array.from(districtMap.values()).sort(sorter),
      municipalities: Array.from(municipalityMap.values()).sort(sorter),
      parishes: Array.from(parishMap.values()).sort(sorter),
    };

    cached = { at: now, data: response };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Portugal admin dataset";
    return NextResponse.json({ message }, { status: 502 });
  }
}

type MunicipalityRow = {
  con_name: string;
  dis_name: string;
  geo_point_2d?: { lat?: number; lon?: number };
};

type DistrictRow = {
  dis_name: string;
  geo_point_2d?: { lat?: number; lon?: number };
};

type ParishRow = {
  fre_name: string;
  con_name: string;
  dis_name: string;
  geo_point_2d?: { lat?: number; lon?: number };
};

async function fetchMunicipalities(): Promise<MunicipalityRow[]> {
  const select = "con_name,dis_name,geo_point_2d";
  return fetchAllPages<MunicipalityRow>("georef-portugal-concelho", select);
}

async function fetchDistricts(): Promise<DistrictRow[]> {
  const select = "dis_name,geo_point_2d";
  return fetchAllPages<DistrictRow>("georef-portugal-distrito", select);
}

async function fetchParishes(): Promise<ParishRow[]> {
  const select = "fre_name,con_name,dis_name,geo_point_2d";
  return fetchAllPages<ParishRow>("georef-portugal-freguesia", select);
}

async function fetchAllPages<T>(dataset: string, select: string): Promise<T[]> {
  let offset = 0;
  const out: T[] = [];

  while (true) {
    const url = `${BASE_URL}/${dataset}/records?select=${encodeURIComponent(select)}&limit=${LIMIT}&offset=${offset}`;
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Public dataset request failed (${response.status})`);
    }
    const payload = (await response.json()) as { total_count?: number; results?: T[] };
    const rows = payload.results ?? [];
    out.push(...rows);
    offset += rows.length;
    if (rows.length < LIMIT) break;
    if (typeof payload.total_count === "number" && offset >= payload.total_count) break;
  }

  return out;
}

function upsertAreaOption(map: Map<string, AdminAreaOption>, key: string, item: AdminAreaOption): void {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, item);
    return;
  }
  const total = existing.sample_count + 1;
  const nextLat =
    existing.lat !== null && item.lat !== null
      ? (existing.lat * existing.sample_count + item.lat) / total
      : existing.lat ?? item.lat;
  const nextLng =
    existing.lng !== null && item.lng !== null
      ? (existing.lng * existing.sample_count + item.lng) / total
      : existing.lng ?? item.lng;
  map.set(key, {
    ...existing,
    lat: nextLat,
    lng: nextLng,
    sample_count: total,
  });
}
