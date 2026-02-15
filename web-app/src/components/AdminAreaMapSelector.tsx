"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, Polygon, TileLayer, useMap } from "react-leaflet";

import {
  dedupeAdminSelections,
  getPortugalAdminGeometry,
  listPortugalAdminDataset,
  listPortugalAdminGeometries,
} from "@/lib/api";
import type {
  AdminAreaGeometryItem,
  AdminLevel,
  AdminSelection,
  GeoJsonGeometry,
  PortugalAdminDataset,
} from "@/lib/types";

type Props = {
  value: AdminSelection[];
  onChange: (next: AdminSelection[]) => void;
};

const PORTUGAL_CENTER: [number, number] = [39.55, -8.0];
type LeafletPolygonPositions = [number, number][][] | [number, number][][][];

export default function AdminAreaMapSelector({ value, onChange }: Props) {
  const [dataset, setDataset] = useState<PortugalAdminDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [district, setDistrict] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [parish, setParish] = useState("");
  const [polygonItems, setPolygonItems] = useState<AdminAreaGeometryItem[]>([]);
  const [activeGeometry, setActiveGeometry] = useState<GeoJsonGeometry | null>(null);
  const [hoveredPolygonId, setHoveredPolygonId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await listPortugalAdminDataset();
        setDataset(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load admin map data.");
      } finally {
        setLoading(false);
      }
    }
    load().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (value.length === 0) {
      onChange([{ country: "PT" }]);
    }
  }, [onChange, value.length]);

  const districtOptions = useMemo(() => dataset?.districts ?? [], [dataset]);
  const municipalityOptions = useMemo(
    () => (dataset?.municipalities ?? []).filter((item) => item.district === district),
    [dataset, district],
  );
  const parishOptions = useMemo(
    () =>
      (dataset?.parishes ?? []).filter((item) => item.district === district && item.municipality === municipality),
    [dataset, district, municipality],
  );

  const currentLevel: AdminLevel = useMemo(() => {
    if (!district) return "district";
    if (!municipality) return "municipality";
    return "parish";
  }, [district, municipality]);

  useEffect(() => {
    async function loadLevelPolygons() {
      try {
        const items = await listPortugalAdminGeometries({
          level: currentLevel,
          district: district || undefined,
          municipality: municipality || undefined,
        });
        setPolygonItems(items);
      } catch {
        setPolygonItems([]);
      }
    }
    loadLevelPolygons().catch(() => undefined);
  }, [currentLevel, district, municipality]);

  useEffect(() => {
    async function syncActiveGeometry() {
      const selection = getDeepestSelection({ district, municipality, parish });
      if (!selection) {
        setActiveGeometry(null);
        return;
      }
      try {
        const res = await getPortugalAdminGeometry(selection);
        setActiveGeometry(res.geometry);
      } catch {
        setActiveGeometry(null);
      }
    }
    syncActiveGeometry().catch(() => undefined);
  }, [district, municipality, parish]);

  function addSelection(level: "country" | "district" | "municipality" | "parish") {
    let nextItem: AdminSelection | null = null;
    if (level === "country") {
      nextItem = { country: "PT" };
    }
    if (level === "district" && district) {
      nextItem = { country: "PT", district };
    }
    if (level === "municipality" && district && municipality) {
      nextItem = { country: "PT", district, municipality };
    }
    if (level === "parish" && district && municipality && parish) {
      nextItem = { country: "PT", district, municipality, parish };
    }
    if (!nextItem) return;
    onChange(dedupeAdminSelections([...value, nextItem]));
  }

  function removeSelection(item: AdminSelection) {
    const key = [
      item.country.toUpperCase(),
      (item.district || "").toLowerCase(),
      (item.municipality || "").toLowerCase(),
      (item.parish || "").toLowerCase(),
    ].join("|");
    const next = value.filter((candidate) => {
      const candidateKey = [
        candidate.country.toUpperCase(),
        (candidate.district || "").toLowerCase(),
        (candidate.municipality || "").toLowerCase(),
        (candidate.parish || "").toLowerCase(),
      ].join("|");
      return candidateKey !== key;
    });
    onChange(next);
  }

  function optionLabel(item: AdminSelection): string {
    if (item.parish) return `Parish: ${item.parish} (${item.municipality}, ${item.district})`;
    if (item.municipality) return `Municipality: ${item.municipality} (${item.district})`;
    if (item.district) return `District: ${item.district}`;
    return "Country: Portugal";
  }

  function levelLabel(level: AdminLevel): string {
    if (level === "district") return "district";
    if (level === "municipality") return "municipality";
    if (level === "parish") return "parish";
    return "country";
  }

  function selectionFromArea(area: { level: AdminLevel; district?: string; municipality?: string; parish?: string }): AdminSelection {
    if (area.level === "district") {
      return { country: "PT", district: area.district };
    }
    if (area.level === "municipality") {
      return { country: "PT", district: area.district, municipality: area.municipality };
    }
    return {
      country: "PT",
      district: area.district,
      municipality: area.municipality,
      parish: area.parish,
    };
  }

  function markerKey(item: AdminSelection): string {
    return [
      (item.country || "PT").toUpperCase(),
      (item.district || "").toLowerCase(),
      (item.municipality || "").toLowerCase(),
      (item.parish || "").toLowerCase(),
    ].join("|");
  }

  function areaIsSelected(area: { level: AdminLevel; district?: string; municipality?: string; parish?: string }): boolean {
    const selected = selectionFromArea(area);
    const selectedKey = markerKey(selected);
    return value.some((item) => markerKey(item) === selectedKey);
  }

  function onAreaClick(area: AdminAreaGeometryItem) {
    if (area.level === "district") {
      setDistrict(area.district ?? area.label);
      setMunicipality("");
      setParish("");
    } else if (area.level === "municipality") {
      setDistrict(area.district ?? district);
      setMunicipality(area.municipality ?? area.label);
      setParish("");
    } else if (area.level === "parish") {
      setDistrict(area.district ?? district);
      setMunicipality(area.municipality ?? municipality);
      setParish(area.parish ?? area.label);
    }
    setActiveGeometry(area.geometry ?? null);
    const nextSelection = selectionFromArea(area);
    onChange(dedupeAdminSelections([...value, nextSelection]));
  }

  return (
    <div className="stack">
      <p className="muted-text">Select by polygons. Default starts at country level and drills down by click.</p>
      <p className="muted-text">Current map layer: {levelLabel(currentLevel)} polygons.</p>

      <div className="admin-picker-grid">
        <label className="field">
          <span className="field-label">Country</span>
          <select value="PT" disabled>
            <option value="PT">Portugal</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">District</span>
          <select
            value={district}
            onChange={(event) => {
              setDistrict(event.target.value);
              setMunicipality("");
              setParish("");
            }}
            disabled={loading || !!error}
          >
            <option value="">Select district</option>
            {districtOptions.map((item) => (
              <option key={item.id} value={item.district ?? ""}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Municipality</span>
          <select
            value={municipality}
            onChange={(event) => {
              setMunicipality(event.target.value);
              setParish("");
            }}
            disabled={!district || loading || !!error}
          >
            <option value="">Select municipality</option>
            {municipalityOptions.map((item) => (
              <option key={item.id} value={item.municipality ?? ""}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Parish</span>
          <select value={parish} onChange={(event) => setParish(event.target.value)} disabled={!municipality || loading || !!error}>
            <option value="">Select parish</option>
            {parishOptions.map((item) => (
              <option key={item.id} value={item.parish ?? ""}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="row">
        <button className="btn" type="button" onClick={() => addSelection("country")}>
          Add country
        </button>
        <button className="btn" type="button" onClick={() => addSelection("district")} disabled={!district}>
          Add district
        </button>
        <button className="btn" type="button" onClick={() => addSelection("municipality")} disabled={!district || !municipality}>
          Add municipality
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => addSelection("parish")}
          disabled={!district || !municipality || !parish}
        >
          Add parish
        </button>
      </div>

      {loading && <p className="muted-text">Loading map data...</p>}
      {error && <p className="error-text">{error}</p>}

      <div className="admin-map-frame">
        <MapContainer center={PORTUGAL_CENTER} zoom={6} scrollWheelZoom style={{ width: "100%", height: "340px" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapFocusController activeGeometry={activeGeometry} />
          {polygonItems.map((item) => {
            if (!item.geometry) return null;
            const polygonPositions = geometryToLeafletPositions(item.geometry);
            const isCurrent =
              (item.level === "district" && (item.district ?? item.label) === district) ||
              (item.level === "municipality" && (item.municipality ?? item.label) === municipality) ||
              (item.level === "parish" && (item.parish ?? item.label) === parish);
            const isSelected = areaIsSelected(item);
            const isHovered = hoveredPolygonId === item.id;
            return (
              <Polygon
                key={item.id}
                positions={polygonPositions}
                pathOptions={{
                  color: isCurrent ? "#14532d" : isSelected ? "#15803d" : isHovered ? "#1d4ed8" : "#d97706",
                  fillColor: isCurrent ? "#22c55e" : isSelected ? "#4ade80" : isHovered ? "#60a5fa" : "#fbbf24",
                  fillOpacity: isCurrent ? 0.3 : isSelected ? 0.24 : isHovered ? 0.24 : 0.18,
                  weight: isHovered || isCurrent ? 3 : 2,
                }}
                eventHandlers={{
                  mouseover: () => setHoveredPolygonId(item.id),
                  mouseout: () => setHoveredPolygonId(null),
                  click: () => onAreaClick(item),
                }}
              />
            );
          })}
          {activeGeometry ? (
            <Polygon
              positions={geometryToLeafletPositions(activeGeometry)}
              pathOptions={{
                color: "#14532d",
                fillColor: "#22c55e",
                fillOpacity: 0.12,
                weight: 3,
              }}
            />
          ) : null}
        </MapContainer>
      </div>

      <div className="stack">
        <strong>Selected areas</strong>
        {value.length === 0 ? (
          <p className="muted-text">No areas selected yet.</p>
        ) : (
          <div className="row">
            {value.map((item, index) => (
              <button
                key={`${item.country}-${item.district ?? ""}-${item.municipality ?? ""}-${item.parish ?? ""}-${index}`}
                type="button"
                className="badge admin-selection-chip"
                onClick={() => removeSelection(item)}
                title="Remove selection"
              >
                {optionLabel(item)} x
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MapFocusController({
  activeGeometry,
}: {
  activeGeometry: GeoJsonGeometry | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (activeGeometry) {
      const bounds = getGeometryBounds(activeGeometry);
      if (bounds) {
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
      }
    }
  }, [activeGeometry, map]);
  return null;
}

function getDeepestSelection(input: {
  district: string;
  municipality: string;
  parish: string;
}): AdminSelection | null {
  if (input.parish) {
    return { country: "PT", district: input.district, municipality: input.municipality, parish: input.parish };
  }
  if (input.municipality) {
    return { country: "PT", district: input.district, municipality: input.municipality };
  }
  if (input.district) {
    return { country: "PT", district: input.district };
  }
  return null;
}

function geometryToLeafletPositions(geometry: GeoJsonGeometry): LeafletPolygonPositions {
  if (geometry.type === "Polygon") {
    const polygon = geometry.coordinates as number[][][];
    return polygon.map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number]));
  }
  const multiPolygon = geometry.coordinates as number[][][][];
  return multiPolygon.map((polygon) =>
    polygon.map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number])),
  );
}

function getGeometryBounds(geometry: GeoJsonGeometry): [[number, number], [number, number]] | null {
  let minLat = Number.POSITIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;

  const pushPoint = (lng: number, lat: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    minLat = Math.min(minLat, lat);
    minLng = Math.min(minLng, lng);
    maxLat = Math.max(maxLat, lat);
    maxLng = Math.max(maxLng, lng);
  };

  if (geometry.type === "Polygon") {
    const polygon = geometry.coordinates as number[][][];
    for (const ring of polygon) {
      for (const [lng, lat] of ring) pushPoint(lng, lat);
    }
  } else {
    const multiPolygon = geometry.coordinates as number[][][][];
    for (const polygon of multiPolygon) {
      for (const ring of polygon) {
        for (const [lng, lat] of ring) pushPoint(lng, lat);
      }
    }
  }

  if (!Number.isFinite(minLat) || !Number.isFinite(minLng) || !Number.isFinite(maxLat) || !Number.isFinite(maxLng)) {
    return null;
  }
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}
