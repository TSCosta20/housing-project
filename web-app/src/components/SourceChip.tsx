"use client";

const SOURCE_STYLES: Record<string, { mark: string; bg: string; fg: string }> = {
  imovirtual: { mark: "IM", bg: "#eff6ff", fg: "#1d4ed8" },
  idealista: { mark: "ID", bg: "#f7fee7", fg: "#3f6212" },
  olx: { mark: "OL", bg: "#f5f3ff", fg: "#6d28d9" },
  casasapo: { mark: "CS", bg: "#fff7ed", fg: "#9a3412" },
};

type SourceChipProps = {
  source: string | null | undefined;
};

export default function SourceChip({ source }: SourceChipProps) {
  const key = (source ?? "").trim().toLowerCase();
  const label = key || "unknown";
  const style = SOURCE_STYLES[key] ?? { mark: label.slice(0, 2).toUpperCase(), bg: "#e8eefc", fg: "#1d4ed8" };

  return (
    <span className="source-chip" title={label}>
      <span className="source-logo-fallback" style={{ background: style.bg, color: style.fg }}>
        {style.mark}
      </span>
      <span>{label}</span>
    </span>
  );
}
