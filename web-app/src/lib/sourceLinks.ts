export function normalizeExternalUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  const value = rawUrl.trim();
  if (!value) return null;

  let normalized: string | null = null;
  if (/^https?:\/\//i.test(value)) normalized = value;
  else if (value.startsWith("//")) normalized = `https:${value}`;
  else if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(value)) normalized = `https://${value}`;

  if (!normalized) return null;

  // Imovirtual canonical public listing route uses /anuncio/.
  if (normalized.includes("imovirtual.com/pt/comprar/")) {
    normalized = normalized.replace("/pt/comprar/", "/pt/anuncio/");
  }
  if (normalized.includes("imovirtual.com/pt/arrendar/")) {
    normalized = normalized.replace("/pt/arrendar/", "/pt/anuncio/");
  }
  return normalized;
}

const SOURCE_SEARCH_URLS: Record<string, string> = {
  imovirtual: "https://www.imovirtual.com/pt/resultados?search%5Bfilter_enum_type%5D=buy",
  idealista: "https://www.idealista.pt/comprar-casas/",
  olx: "https://www.olx.pt/imoveis/",
  casasapo: "https://casa.sapo.pt/",
};

export function buildSourceSearchUrl(source: string | null | undefined, title: string | null | undefined): string | null {
  const key = (source ?? "").toLowerCase().trim();
  const base = SOURCE_SEARCH_URLS[key];
  if (!base) return null;
  if (!title) return base;

  const q = encodeURIComponent(title);
  if (base.includes("?")) return `${base}&q=${q}`;
  return `${base}?q=${q}`;
}
