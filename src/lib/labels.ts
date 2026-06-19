export const locationLabels: Record<string, string> = {
  warehouse_full: "Telephely – teli",
  warehouse_empty: "Telephely – üres",
  customer: "Partnernél",
  siad: "SIAD-nál",
  own_supplier: "Saját szolgáltatónál",
};

/** DB enum values: own | siad | berpalack */
export type Circulation = "own" | "siad" | "berpalack";

export const circulationLabels: Record<Circulation, string> = {
  own: "Saját",
  siad: "SIAD",
  berpalack: "Egyéb",
};

export const CIRCULATION_OPTIONS: { value: Circulation; label: string }[] = [
  { value: "own", label: "Saját" },
  { value: "siad", label: "SIAD" },
  { value: "berpalack", label: "Egyéb" },
];

/** DB enum: siad | messer | linde | chinese | other */
export type Manufacturer = "siad" | "messer" | "linde" | "chinese" | "other";

export const manufacturerLabels: Record<Manufacturer, string> = {
  siad: "SIAD",
  messer: "Messer",
  linde: "Linde",
  chinese: "Kínai",
  other: "Egyéb",
};

/** Egyedi sorszámos palackokhoz (kínai → készlet modul) */
export const SERIALIZED_MANUFACTURER_OPTIONS: { value: Manufacturer; label: string }[] = [
  { value: "siad", label: "SIAD" },
  { value: "messer", label: "Messer" },
  { value: "linde", label: "Linde" },
  { value: "other", label: "Egyéb" },
];

export const MANUFACTURER_OPTIONS: { value: Manufacturer; label: string }[] = [
  { value: "siad", label: "SIAD" },
  { value: "messer", label: "Messer" },
  { value: "linde", label: "Linde" },
  { value: "chinese", label: "Kínai" },
  { value: "other", label: "Egyéb" },
];

export const statusLabels: Record<string, string> = {
  full: "Teli",
  empty: "Üres",
  service: "Szervízben",
};

export type RentalStatus = "active" | "expired" | "cancelled" | "closed";

export const rentalStatusLabels: Record<string, string> = {
  active: "Aktív",
  expired: "Lejárt",
  cancelled: "Felmondott",
  closed: "Lezárt",
  returned: "Visszavéve",
  problematic: "Problémás",
};

export const RENTAL_STATUS_OPTIONS: { value: RentalStatus; label: string }[] = [
  { value: "active", label: "Aktív" },
  { value: "expired", label: "Lejárt" },
  { value: "cancelled", label: "Felmondott" },
];

export type RentalType = "yearly" | "monthly" | "free";

export const rentalTypeLabels: Record<RentalType, string> = {
  yearly: "Éves",
  monthly: "Havi",
  free: "Díjmentes kölcsön",
};

export const RENTAL_TYPE_OPTIONS: { value: RentalType; label: string }[] = [
  { value: "yearly", label: "Éves" },
  { value: "monthly", label: "Havi" },
  { value: "free", label: "Díjmentes kölcsön" },
];

/** "Nitrogén 20L (2 db)" style lines from cylinder list. */
export function summarizeRentalCylinders(
  cylinders: { gas_type: string; size: string }[],
): string[] {
  const counts = new Map<string, number>();
  for (const c of cylinders) {
    const key = `${c.gas_type} ${c.size}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => `${k} (${n} db)`);
}

export function isRentalExpired(expiryDate: string | null | undefined): boolean {
  if (!expiryDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = expiryDate.split("-").map(Number);
  const exp = new Date(y, m - 1, d);
  return exp < today;
}

/** Fallback when rentals.expiry_date is missing (legacy rows). */
export function effectiveRentalExpiry(
  startDate: string,
  expiryDate: string | null | undefined,
): string {
  if (expiryDate) return expiryDate;
  const [y, m, d] = startDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setFullYear(dt.getFullYear() + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function daysRented(addedAt: string): number {
  const start = new Date(addedAt);
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86400000));
}

export function formatRentalDuration(addedAt: string): string {
  const days = daysRented(addedAt);
  if (days < 30) return `${days} napja`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} hónapja`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years} év ${rem} hónapja` : `${years} éve`;
}

export function rentalDisplayStatus(status: string, expiryDate: string | null | undefined): string {
  if (status === "closed") return "closed";
  if (status === "cancelled") return "cancelled";
  if (isRentalExpired(expiryDate)) return "expired";
  return status;
}

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString("hu-HU");
  }
  return new Date(d).toLocaleDateString("hu-HU");
}

export function fmtDateTime(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("hu-HU");
}

/** Display: "Teli · Partnernél · Dreska András" or "Üres · SIAD · Messer". */
export function formatCylinderLocation(
  status: string,
  locationType: string,
  supplierName?: string | null,
  partnerName?: string | null,
): string {
  const st = statusLabels[status] ?? status;
  const parts: string[] = [st];

  if (locationType === "warehouse_full" || locationType === "warehouse_empty") {
    parts.push("Telephely");
  } else if (locationType === "customer") {
    parts.push("Partnernél");
    if (partnerName) parts.push(partnerName);
  } else if (locationType === "siad") {
    parts.push("SIAD");
    if (supplierName) parts.push(supplierName);
  } else if (locationType === "own_supplier") {
    parts.push("Saját szolgáltató");
    if (supplierName) parts.push(supplierName);
  } else {
    parts.push(locationLabels[locationType] ?? locationType);
  }

  return parts.join(" · ");
}
