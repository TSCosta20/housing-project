import { NextRequest, NextResponse } from "next/server";

import type { AdminAreaGeometryItem, AdminLevel, GeoJsonGeometry, PortugalAdminGeometryListResponse } from "@/lib/types";

const BASE_URL = "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets";
const LIMIT = 100;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const level = (request.nextUrl.searchParams.get("level") || "") as AdminLevel;
  const district = request.nextUrl.searchParams.get("district") || "";
  const municipality = request.nextUrl.searchParams.get("municipality") || "";

  if (!["district", "municipality", "parish"].includes(level)) {
    return NextResponse.json({ message: "Invalid geometry list level" }, { status: 400 });
  }

  try {
    const items = await fetchGeometryList({ level, district, municipality });
    const payload: PortugalAdminGeometryListResponse = { level, items };
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load area polygons";
    return NextResponse.json({ message }, { status: 502 });
  }
}

async function fetchGeometryList(params: {
  level: AdminLevel;
  district: string;
  municipality: string;
}): Promise<AdminAreaGeometryItem[]> {
  const { level, district, municipality } = params;
  let dataset = "";
  let select = "";
  const whereParts: string[] = [];

  if (level === "district") {
    dataset = "georef-portugal-distrito";
    select = "dis_name,geo_shape";
  } else if (level === "municipality") {
    dataset = "georef-portugal-concelho";
    select = "dis_name,con_name,geo_shape";
    if (district) whereParts.push(buildWhereEquals("dis_name", district));
  } else {
    dataset = "georef-portugal-freguesia";
    select = "dis_name,con_name,fre_name,geo_shape";
    if (district) whereParts.push(buildWhereEquals("dis_name", district));
    if (municipality) whereParts.push(buildWhereEquals("con_name", municipality));
  }

  const out: AdminAreaGeometryItem[] = [];
  let offset = 0;
  while (true) {
    const query = new URLSearchParams({
      select,
      limit: String(LIMIT),
      offset: String(offset),
    });
    if (whereParts.length > 0) {
      query.set("where", whereParts.join(" and "));
    }
    const response = await fetch(`${BASE_URL}/${dataset}/records?${query.toString()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Geometry list request failed (${response.status})`);
    }
    const payload = (await response.json()) as {
      total_count?: number;
      results?: Array<{
        dis_name?: string;
        con_name?: string;
        fre_name?: string;
        geo_shape?: { geometry?: GeoJsonGeometry };
      }>;
    };
    const rows = payload.results ?? [];
    for (const row of rows) {
      const rowDistrict = row.dis_name?.trim() || undefined;
      const rowMunicipality = row.con_name?.trim() || undefined;
      const rowParish = row.fre_name?.trim() || undefined;
      const geometry = row.geo_shape?.geometry;
      if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
        continue;
      }
      const id = [
        level,
        (rowDistrict || "").toLowerCase(),
        (rowMunicipality || "").toLowerCase(),
        (rowParish || "").toLowerCase(),
      ].join(":");
      out.push({
        id,
        label: rowParish || rowMunicipality || rowDistrict || "Area",
        level,
        district: rowDistrict,
        municipality: rowMunicipality,
        parish: rowParish,
        geometry,
      });
    }
    offset += rows.length;
    if (rows.length < LIMIT) break;
    if (typeof payload.total_count === "number" && offset >= payload.total_count) break;
  }

  return out.sort((a, b) => a.label.localeCompare(b.label, "pt"));
}

function buildWhereEquals(field: string, value: string): string {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `${field}="${escaped}"`;
}
