/** Ideiglenes navigációs UI-állapot (sessionStorage) – nem üzleti draft. */

export const ROUTE_STATE_VERSION = 1;
const PREFIX = "gazveeled:route-ui:";

export type RouteUiSnapshot<T extends Record<string, unknown> = Record<string, unknown>> = {
  version: typeof ROUTE_STATE_VERSION;
  scrollY: number;
  ui: T;
  savedAt: string;
};

function canUseSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

export function buildRouteStateKey(
  pathname: string,
  search?: string | Record<string, unknown> | null,
  extraParts: Array<string | number | null | undefined> = [],
): string {
  const path = pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  let searchPart = "";
  if (typeof search === "string") {
    searchPart = search.startsWith("?") ? search.slice(1) : search;
  } else if (search && typeof search === "object") {
    searchPart = Object.entries(search)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${String(v)}`)
      .join("&");
  }
  const extras = extraParts.filter((p) => p !== null && p !== undefined && p !== "").join("|");
  return `${PREFIX}${path}${searchPart ? `?${searchPart}` : ""}${extras ? `#${extras}` : ""}`;
}

export function loadRouteState<T extends Record<string, unknown>>(
  key: string,
): RouteUiSnapshot<T> | null {
  if (!canUseSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      sessionStorage.removeItem(key);
      return null;
    }
    const snap = parsed as RouteUiSnapshot<T>;
    if (snap.version !== ROUTE_STATE_VERSION) {
      sessionStorage.removeItem(key);
      return null;
    }
    if (typeof snap.scrollY !== "number" || !Number.isFinite(snap.scrollY) || snap.scrollY < 0) {
      snap.scrollY = 0;
    }
    if (!snap.ui || typeof snap.ui !== "object") {
      sessionStorage.removeItem(key);
      return null;
    }
    return snap;
  } catch {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
    return null;
  }
}

export function saveRouteState<T extends Record<string, unknown>>(
  key: string,
  snapshot: { scrollY?: number; ui?: T },
): void {
  if (!canUseSessionStorage()) return;
  try {
    const prev = loadRouteState<T>(key);
    const next: RouteUiSnapshot<T> = {
      version: ROUTE_STATE_VERSION,
      scrollY: typeof snapshot.scrollY === "number" ? Math.max(0, snapshot.scrollY) : (prev?.scrollY ?? 0),
      ui: (snapshot.ui ?? prev?.ui ?? ({} as T)) as T,
      savedAt: new Date().toISOString(),
    };
    sessionStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Quota / private mode – nem blokkoló.
  }
}

export function clearRouteState(key: string): void {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function clearAllRouteStates(): void {
  if (!canUseSessionStorage()) return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) sessionStorage.removeItem(k);
  } catch {
    // ignore
  }
}

export function clearRouteStatesByPrefix(pathnamePrefix: string): void {
  if (!canUseSessionStorage()) return;
  try {
    const needle = `${PREFIX}${pathnamePrefix}`;
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(needle)) toRemove.push(k);
    }
    for (const k of toRemove) sessionStorage.removeItem(k);
  } catch {
    // ignore
  }
}

export function clampScrollY(scrollY: number): number {
  if (typeof window === "undefined") return 0;
  const max =
    Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
    ) - window.innerHeight;
  return Math.max(0, Math.min(scrollY, Math.max(0, max)));
}

export function mergeRouteUi<T extends Record<string, unknown>>(
  defaults: T,
  saved: Partial<T> | null | undefined,
): T {
  if (!saved) return { ...defaults };
  const next = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    if (saved[key] !== undefined) next[key] = saved[key] as T[keyof T];
  }
  return next;
}
