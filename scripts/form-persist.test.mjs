import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("auth: token refresh nem takarja el az UI-t (formállapot megmarad)", () => {
  const src = read("src/lib/auth.ts");
  assert.match(src, /shouldBlockUiForAuthEvent/);
  assert.match(src, /TOKEN_REFRESHED/);
  assert.match(src, /USER_UPDATED/);
  assert.match(src, /return false/);
});

test("query: nincs refetchOnWindowFocus (űrlap flicker elkerülés)", () => {
  const src = read("src/router.tsx");
  assert.match(src, /refetchOnWindowFocus:\s*false/);
});

test("usePersistedFormState hook létezik és sessionStorage-t használ", () => {
  const src = read("src/hooks/use-persisted-form-state.ts");
  assert.match(src, /export function usePersistedFormState/);
  assert.match(src, /saveRouteState/);
  assert.match(src, /visibilitychange/);
  assert.match(src, /pagehide/);
});

test("űrlapos modulok usePersistedFormState-et vagy workflow draftot használnak", () => {
  const mustPersist = [
    "src/routes/_authenticated/platform-organizations.tsx",
    "src/routes/_authenticated/users.tsx",
    "src/routes/_authenticated/price-list.tsx",
    "src/routes/_authenticated/organization-settings.tsx",
    "src/routes/_authenticated/inventory.tsx",
    "src/routes/_authenticated/quotes.tsx",
    "src/routes/_authenticated/chinese-stock.tsx",
    "src/routes/_authenticated/flaga-pb-stock.tsx",
    "src/routes/_authenticated/prima-pb-stock.tsx",
    "src/routes/_authenticated/gas-order.tsx",
    "src/routes/_authenticated/tool-rental/stock.tsx",
    "src/routes/_authenticated/rental-return.tsx",
    "src/routes/_authenticated/partners.$id.tsx",
  ];
  for (const rel of mustPersist) {
    const src = read(rel);
    assert.match(
      src,
      /usePersistedFormState/,
      `${rel} hiányzó usePersistedFormState`,
    );
  }

  const workflowDraft = [
    "src/routes/_authenticated/quick-exchange.tsx",
    "src/routes/_authenticated/suppliers.tsx",
  ];
  for (const rel of workflowDraft) {
    const src = read(rel);
    assert.match(src, /useWorkflowDraft/, `${rel} hiányzó useWorkflowDraft`);
  }
});
