import type { PostgrestError } from "@supabase/supabase-js";

/** rental_cylinders columns added by rental_cylinder_rental_dates migration. */
export const RENTAL_CYLINDER_DATE_COLUMNS = [
  "rental_start_date",
  "rental_end_date",
  "rental_deposit",
] as const;

export type RentalCylinderDateColumn = (typeof RENTAL_CYLINDER_DATE_COLUMNS)[number];

type PostgrestLikeError = Pick<PostgrestError, "message"> | { message?: string } | null | undefined;

/** True when PostgREST failed because a rental_cylinders date/deposit column is not in the schema yet. */
export function isMissingRentalCylinderColumnError(error: PostgrestLikeError): boolean {
  return getMissingRentalCylinderColumn(error) !== null;
}

export function getMissingRentalCylinderColumn(
  error: PostgrestLikeError,
): RentalCylinderDateColumn | null {
  const msg = error?.message?.toLowerCase() ?? "";
  if (!msg) return null;
  for (const col of RENTAL_CYLINDER_DATE_COLUMNS) {
    if (msg.includes(col)) return col;
  }
  return null;
}

export function formatSupabaseError(
  error: PostgrestError | null | undefined,
  context?: string,
): string {
  if (!error) return context ? `${context}: ismeretlen hiba` : "Ismeretlen Supabase hiba";

  const parts = [
    context,
    error.message,
    error.details ? `Részlet: ${error.details}` : null,
    error.hint ? `Tipp: ${error.hint}` : null,
    error.code ? `Kód: ${error.code}` : null,
  ].filter(Boolean);

  return parts.join(" · ");
}

export function logSupabaseError(
  label: string,
  error: PostgrestError | null | undefined,
  extra?: Record<string, unknown>,
): void {
  console.error(`[Supabase] ${label}`, {
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
    code: error?.code,
    ...extra,
  });
}

export function throwSupabaseError(
  label: string,
  error: PostgrestError | null | undefined,
  extra?: Record<string, unknown>,
): never {
  logSupabaseError(label, error, extra);
  throw new Error(formatSupabaseError(error, label));
}
