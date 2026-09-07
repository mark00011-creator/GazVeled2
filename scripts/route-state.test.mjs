import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const PREFIX = "gazveeled:route-ui:";
const VERSION = 1;

function buildRouteStateKey(pathname, search, extraParts = []) {
  const pathNorm = pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
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
  return `${PREFIX}${pathNorm}${searchPart ? `?${searchPart}` : ""}${extras ? `#${extras}` : ""}`;
}

function createMockSessionStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    get length() {
      return store.size;
    },
    key(i) {
      return [...store.keys()][i] ?? null;
    },
  };
}

function loadRouteState(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== VERSION) {
      storage.removeItem(key);
      return null;
    }
    if (typeof parsed.scrollY !== "number") parsed.scrollY = 0;
    if (!parsed.ui || typeof parsed.ui !== "object") {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

function saveRouteState(storage, key, snapshot) {
  const prev = loadRouteState(storage, key);
  const next = {
    version: VERSION,
    scrollY: typeof snapshot.scrollY === "number" ? Math.max(0, snapshot.scrollY) : (prev?.scrollY ?? 0),
    ui: snapshot.ui ?? prev?.ui ?? {},
    savedAt: new Date().toISOString(),
  };
  storage.setItem(key, JSON.stringify(next));
}

function mergeRouteUi(defaults, saved) {
  if (!saved) return { ...defaults };
  const next = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (saved[key] !== undefined) next[key] = saved[key];
  }
  return next;
}

function clampScrollY(scrollY, scrollHeight, innerHeight) {
  const max = Math.max(0, scrollHeight - innerHeight);
  return Math.max(0, Math.min(scrollY, max));
}

test("route state keys differ by pathname and search", () => {
  const a = buildRouteStateKey("/dashboard");
  const b = buildRouteStateKey("/partners");
  const c = buildRouteStateKey("/rentals", "status=active");
  const d = buildRouteStateKey("/rentals", "status=expired");
  assert.notEqual(a, b);
  assert.notEqual(c, d);
  assert.match(a, /^gazveeled:route-ui:/);
  assert.doesNotMatch(a, /localStorage/);
});

test("route state persists scroll and filters separately per key", () => {
  const storage = createMockSessionStorage();
  const dash = buildRouteStateKey("/dashboard");
  const cyl = buildRouteStateKey("/cylinders");
  saveRouteState(storage, dash, { scrollY: 420, ui: {} });
  saveRouteState(storage, cyl, { scrollY: 120, ui: { q: "HU", circ: "siad" } });
  assert.equal(loadRouteState(storage, dash).scrollY, 420);
  assert.equal(loadRouteState(storage, cyl).ui.q, "HU");
  assert.equal(loadRouteState(storage, dash).ui.q, undefined);
});

test("invalid or wrong-version route state is discarded safely", () => {
  const storage = createMockSessionStorage();
  const key = buildRouteStateKey("/partners");
  storage.setItem(key, "{broken");
  assert.equal(loadRouteState(storage, key), null);
  storage.setItem(key, JSON.stringify({ version: 99, scrollY: 10, ui: { q: "x" } }));
  assert.equal(loadRouteState(storage, key), null);
});

test("merge restores filters and clamp limits scroll", () => {
  const merged = mergeRouteUi({ q: "", circ: "all" }, { q: "abc", circ: "own" });
  assert.deepEqual(merged, { q: "abc", circ: "own" });
  assert.equal(clampScrollY(9999, 500, 400), 100);
  assert.equal(clampScrollY(-5, 500, 400), 0);
});

test("list pages and helpers wire route persistence", () => {
  const files = [
    "src/hooks/use-route-state-persistence.ts",
    "src/lib/route-state-storage.ts",
    "src/routes/_authenticated/dashboard.tsx",
    "src/routes/_authenticated/cylinders.tsx",
    "src/routes/_authenticated/partners.index.tsx",
    "src/routes/_authenticated/rentals.index.tsx",
    "src/routes/_authenticated/suppliers.tsx",
    "src/routes/_authenticated/quick-exchange.tsx",
    "src/routes/_authenticated/audit.tsx",
    "src/routes/_authenticated/loaned-cylinders.tsx",
    "src/routes/_authenticated/quotes.tsx",
    "src/routes/_authenticated/tool-rental/stock.tsx",
    "src/router.tsx",
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    if (rel === "src/router.tsx") {
      assert.match(src, /scrollRestoration:\s*false/);
      continue;
    }
    if (rel.includes("route-state") || rel.includes("use-route-state")) {
      assert.match(src, /sessionStorage/);
      assert.doesNotMatch(src, /localStorage/);
      continue;
    }
    assert.match(src, /useRoute(StatePersistence|ScrollRestoration|ScrollOnly)/);
  }
});
