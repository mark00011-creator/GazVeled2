/**
 * Palackméret → ADR fizikai mennyiség.
 * Marketing m³ NEM használható; csak L / kg méretmezőből parse.
 */

export function parseWaterCapacityLitres(size: string | null | undefined): number | null {
  if (!size) return null;
  const s = size.trim().toLowerCase().replace(",", ".");
  const m = s.match(/^(\d+(?:\.\d+)?)\s*l(?:iter)?$/i);
  if (m) return Number(m[1]);
  return null;
}

export function parseNetGasMassKg(size: string | null | undefined): number | null {
  if (!size) return null;
  const s = size.trim().toLowerCase().replace(",", ".");
  if (/^1-5\s*kg$/.test(s)) return null; // tartomány – ne tippeljünk
  const m = s.match(/^(\d+(?:\.\d+)?)\s*kg$/i);
  if (m) return Number(m[1]);
  return null;
}

export function gasTypeToAdrKey(gasType: string | null | undefined): string {
  const g = (gasType ?? "").trim().toLowerCase();
  if (!g) return "";
  if (g.includes("stargon")) return "stargon";
  if (g.includes("argon")) return "argon";
  if (g.includes("oxig") || g.includes("oxygen") || g === "o2") return "oxigén";
  if (g.includes("nitro") || g === "n2") return "nitrogén";
  if (g.includes("héli") || g.includes("heli") || g === "he") return "hélium";
  if (g.includes("szén") || g.includes("co2") || g.includes("dioxid")) return "szén-dioxid";
  if (g.includes("propán") || g.includes("bután") || g.includes("pb") || g.includes("flaga")) return "pb";
  return g;
}
