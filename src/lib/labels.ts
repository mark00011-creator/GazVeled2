export const locationLabels: Record<string, string> = {
  warehouse_full: "Telephely – teli",
  warehouse_empty: "Telephely – üres",
  customer: "Partnernél",
  siad: "SIAD-nál",
  own_supplier: "Saját szolgáltatónál",
};

export const circulationLabels: Record<string, string> = {
  siad: "SIAD",
  own: "Saját",
};

export const statusLabels: Record<string, string> = {
  full: "Teli",
  empty: "Üres",
  service: "Szervízben",
};

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("hu-HU");
}

export function fmtDateTime(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("hu-HU");
}
