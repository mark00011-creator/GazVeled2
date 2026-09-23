/** Partner cím mező → Számlázz.hu irsz / település / utca. */

export type ParsedPartnerAddress = {
  zip: string;
  city: string;
  street: string;
};

/**
 * Egyszerű magyar címparse:
 * - "1234 Budapest, Példa utca 1."
 * - "1234 Budapest Példa utca 1"
 * - ha nincs irányítószám: zip=0000, city=Ismeretlen, street=teljes szöveg
 */
export function parsePartnerAddress(address: string | null | undefined): ParsedPartnerAddress {
  const raw = (address ?? "").trim();
  if (!raw) {
    return { zip: "0000", city: "Ismeretlen", street: "Nincs megadva" };
  }

  const m = raw.match(/^(\d{4})\s+([^,]+?)(?:,\s*|\s+)(.+)$/);
  if (m) {
    return {
      zip: m[1],
      city: m[2].trim() || "Ismeretlen",
      street: m[3].trim() || raw,
    };
  }

  const zipOnly = raw.match(/^(\d{4})\s+(.+)$/);
  if (zipOnly) {
    return {
      zip: zipOnly[1],
      city: zipOnly[2].trim() || "Ismeretlen",
      street: zipOnly[2].trim() || raw,
    };
  }

  return { zip: "0000", city: "Ismeretlen", street: raw };
}
