import type { Manufacturer } from "@/lib/labels";

function normalizeBarcode(barcode: string): string {
  return barcode.trim().toLowerCase();
}

/**
 * Gyártó felismerése vonalkód alapján (alapértelmezés – a felhasználó felülírhatja).
 *
 * 1. hu előtag → SIAD
 * 2. csak számjegy, 14–16 karakter → LINDE
 * 3. csak számjegy, 8 karakter → MESSER
 * 4. egyéb → OTHER
 */
export function detectManufacturerFromBarcode(barcode: string): Manufacturer {
  const bc = normalizeBarcode(barcode);
  if (!bc) return "other";

  if (bc.startsWith("hu")) return "siad";

  if (/^\d+$/.test(bc)) {
    if (bc.length >= 14 && bc.length <= 16) return "linde";
    if (bc.length === 8) return "messer";
  }

  return "other";
}

/** Backfill: csak other / null értékeket írunk felül. */
export function shouldBackfillManufacturer(current: Manufacturer | null | undefined): boolean {
  return current == null || current === "other";
}
