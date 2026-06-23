import type { PostgrestError } from "@supabase/supabase-js";

/** PostgREST / Postgres hiba, ha a tábla vagy RPC még nincs a production DB-ben. */
export function isSchemaMissingError(error: PostgrestError | null | undefined): boolean {
  if (!error) return false;
  const msg = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST202" ||
    error.code === "42703" ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table") ||
    msg.includes("could not find the column") ||
    msg.includes("schema cache")
  );
}
