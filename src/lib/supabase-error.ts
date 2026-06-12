import type { PostgrestError } from "@supabase/supabase-js";

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
