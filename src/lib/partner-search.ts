export type PartnerSearchable = {
  name: string;
  company_name?: string | null;
};

/** Ékezet- és kis/nagybetű-független kereséshez normalizálás. */
export function foldForPartnerSearch(value: string): string {
  return value
    .toLocaleLowerCase("hu-HU")
    .replace(/[áàâäå]/g, "a")
    .replace(/[éèêë]/g, "e")
    .replace(/[íìîï]/g, "i")
    .replace(/[óòôöő]/g, "o")
    .replace(/[úùûüű]/g, "u")
    .replace(/[ýÿ]/g, "y")
    .replace(/[ç]/g, "c")
    .replace(/[ñ]/g, "n");
}

export function partnerSearchHaystack(partner: PartnerSearchable): string {
  return foldForPartnerSearch(`${partner.name} ${partner.company_name ?? ""}`.trim());
}

export function partnerDisplayLabel(partner: PartnerSearchable): string {
  return partner.company_name ? `${partner.name} · ${partner.company_name}` : partner.name;
}

export function filterPartners<T extends PartnerSearchable & { id: string }>(
  partners: T[],
  query: string,
): T[] {
  const trimmed = query.trim();
  if (!trimmed) return partners;
  const foldedQuery = foldForPartnerSearch(trimmed);
  return partners.filter((partner) => partnerSearchHaystack(partner).includes(foldedQuery));
}
