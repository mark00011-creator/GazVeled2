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
  "/gas-order-flaga",
  "/no-access",
] as const;

export function isAdminRole(role: AppRole | null | undefined): boolean {
  return role === "admin";
}

export function isExchangeOperatorRole(role: AppRole | null | undefined): boolean {
  return role === "exchange_operator";
}

export function canAccessApp(role: AppRole | null | undefined): boolean {
  return role === "admin" || role === "exchange_operator";
}

export function defaultHomeForRole(role: AppRole | null | undefined): string {
  if (role === "exchange_operator") return "/quick-exchange";
  if (role === "admin") return "/dashboard";
  return "/no-access";
}

export function isAdminOnlyPath(pathname: string): boolean {
  if (pathname === "/quick-exchange" || pathname.startsWith("/quick-exchange/")) return false;
  return ADMIN_ROUTE_PREFIXES.some(
    (p) => pathname === p || (p !== "/dashboard" && pathname.startsWith(`${p}/`)),
  );
}
