import type { Circulation } from "@/lib/labels";

type LocType = "warehouse_full" | "warehouse_empty" | "customer" | "siad" | "own_supplier";

export type InventoryPlace = "warehouse" | "partner" | "supplier";

export type InventoryEntry = {
  barcode: string;
  gas_type: string;
  size: string;
  owner: Circulation;
  status: "full" | "empty";
  place: InventoryPlace;
  partner_id?: string | null;
  supplier_id?: string | null;
};

export const INVENTORY_PLACE_OPTIONS: { value: InventoryPlace; label: string }[] = [
  { value: "warehouse", label: "Telephely" },
  { value: "partner", label: "Partnernél" },
  { value: "supplier", label: "Beszállítónál" },
];

export const INVENTORY_STATUS_OPTIONS: { value: "full" | "empty"; label: string }[] = [
  { value: "full", label: "Teli" },
  { value: "empty", label: "Üres" },
];

export function resolveInventoryLocation(
  entry: Pick<InventoryEntry, "status" | "place" | "partner_id" | "supplier_id">,
  supplierKind?: LocType,
): {
  location_type: LocType;
  location_partner_id: string | null;
  location_supplier_id: string | null;
} {
  if (entry.place === "warehouse") {
    return {
      location_type: entry.status === "full" ? "warehouse_full" : "warehouse_empty",
      location_partner_id: null,
      location_supplier_id: null,
    };
  }
  if (entry.place === "partner") {
    return {
      location_type: "customer",
      location_partner_id: entry.partner_id ?? null,
      location_supplier_id: null,
    };
  }
  return {
    location_type: supplierKind ?? "siad",
    location_partner_id: null,
    location_supplier_id: entry.supplier_id ?? null,
  };
}

export function validateInventoryEntry(entry: InventoryEntry): string | null {
  if (!entry.barcode.trim()) return "Vonalkód kötelező";
  if (!entry.gas_type.trim()) return "Gáz típusa kötelező";
  if (!entry.size.trim()) return "Méret kötelező";
  if (entry.place === "partner" && !entry.partner_id) return "Partner választása kötelező";
  if (entry.place === "supplier" && !entry.supplier_id) return "Beszállító választása kötelező";
  return null;
}

export function parseBulkBarcodes(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
