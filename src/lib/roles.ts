import { authDiag } from "@/lib/auth-diag";

/** Adatbázisban tárolt alkalmazás-szerepkör (profiles.role). */
export type AppRole = "admin" | "exchange_operator" | "viewer";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  exchange_operator: "Gyors csere kezelő",
  viewer: "Megtekintő (nincs hozzáférés)",
};

/** Admin-only útvonalak – exchange_operator közvetlen URL-ről tiltva. */
export const ADMIN_ROUTE_PREFIXES = [
  "/dashboard",
  "/cylinders",
  "/rentals",
  "/partners",
  "/price-list",
  "/audit",
  "/gas-order",
  "/loaned-cylinders",
  "/more",
  "/chinese-stock",
  "/flaga-pb-stock",
  "/prima-pb-stock",
  "/quotes",
  "/inventory",
  "/suppliers",
  "/rental-return",
  "/rental-import",
  "/users",
  "/organization-settings",
  "/gas-order-flaga",
  "/no-access",
  "/tool-rental",
] as const;

export function isAdminRole(role: AppRole | null | undefined): boolean {
  return role === "admin";
}

export function isExchangeOperatorRole(role: AppRole | null | undefined): boolean {
  return role === "exchange_operator";
}

export function canAccessApp(role: AppRole | null | undefined): boolean {
  const result = role === "admin" || role === "exchange_operator";
  authDiag({
    fn: "canAccessApp",
    inputRole: role ?? null,
    result,
  });
  return result;
}

export function defaultHomeForRole(role: AppRole | null | undefined): string {
  const out =
    role === "exchange_operator"
      ? "/quick-exchange"
      : role === "admin"
        ? "/dashboard"
        : "/no-access";
  authDiag({
    fn: "defaultHomeForRole",
    inputRole: role ?? null,
    output: out,
  });
  return out;
}

export function isAdminOnlyPath(pathname: string): boolean {
  if (pathname === "/quick-exchange" || pathname.startsWith("/quick-exchange/")) return false;
  return ADMIN_ROUTE_PREFIXES.some(
    (p) => pathname === p || (p !== "/dashboard" && pathname.startsWith(`${p}/`)),
  );
}
