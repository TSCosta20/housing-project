import { NextRequest, NextResponse } from "next/server";

import type { AdminLevel, GeoJsonGeometry, PortugalAdminGeometryResponse } from "@/lib/types";

const BASE_URL = "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const level = (request.nextUrl.searchParams.get("level") || "") as AdminLevel;
  const district = request.nextUrl.searchParams.get("district") || "";
  const municipality = request.nextUrl.searchParams.get("municipality") || "";
  const parish = request.nextUrl.searchParams.get("parish") || "";

  if (!["district", "municipality", "parish"].includes(level)) {
    return NextResponse.json({ message: "Invalid geometry level" }, { status: 400 });
  }

  try {
    const geometry = await fetchGeometry({ level, district, municipality, parish });
    const payload: PortugalAdminGeometryResponse = { level, geometry };
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load area geometry";
    return NextResponse.json({ message }, { status: 502 });
  }
}

async function fetchGeometry(params: {
  level: AdminLevel;
  district: string;
  municipality: string;
  parish: string;
}): Promise<GeoJsonGeometry | null> {
  const { level, district, municipality, parish } = params;
  const whereParts: string[] = [];
  let dataset = "";
  let select = "";

  if (level === "district") {
    dataset = "georef-portugal-distrito";
    select = "dis_name,geo_shape";
    if (district) whereParts.push(buildWhereEquals("dis_name", district));
  }
  if (level === "municipality") {
    dataset = "georef-portugal-concelho";
    select = "dis_name,con_name,geo_shape";
    if (district) whereParts.push(buildWhereEquals("dis_name", district));
    if (municipality) whereParts.push(buildWhereEquals("con_name", municipality));
  }
  if (level === "parish") {
    dataset = "georef-portugal-freguesia";
    select = "dis_name,con_name,fre_name,geo_shape";
    if (district) whereParts.push(buildWhereEquals("dis_name", district));
    if (municipality) whereParts.push(buildWhereEquals("con_name", municipality));
    if (parish) whereParts.push(buildWhereEquals("fre_name", parish));
  }

  const query = new URLSearchParams({
    select,
    limit: "1",
  });
  if (whereParts.length > 0) {
    query.set("where", whereParts.join(" and "));
  }

  const response = await fetch(`${BASE_URL}/${dataset}/records?${query.toString()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Geometry request failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    results?: Array<{
      geo_shape?: { type?: string; geometry?: GeoJsonGeometry };
    }>;
  };
  const row = payload.results?.[0];
  const geometry = row?.geo_shape?.geometry;
  if (!geometry) return null;
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return null;
  return geometry;
}

function buildWhereEquals(field: string, value: string): string {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `${field}="${escaped}"`;
}
