import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function createMockStorage() {
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
    clear() {
      store.clear();
    },
  };
}

const COMPLETED_IDS_KEY = "gazveeled:workflow-draft:completed-ids";
const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;

function readCompletedIds(storage) {
  try {
    const raw = storage.getItem(COMPLETED_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(
      (e) =>
        e &&
        typeof e.id === "string" &&
        typeof e.at === "number" &&
        now - e.at < COMPLETED_TTL_MS,
    );
  } catch {
    return [];
  }
}

function markCompleted(storage, draftId) {
  const entries = readCompletedIds(storage).filter((e) => e.id !== draftId);
  entries.push({ id: draftId, at: Date.now() });
  storage.setItem(COMPLETED_IDS_KEY, JSON.stringify(entries));
}

function isAlreadyCompleted(storage, draftId) {
  return readCompletedIds(storage).some((e) => e.id === draftId);
}

function loadDraft(storage, key, version, validate) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!validate(parsed) || parsed.version !== version) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

const sampleCylinder = {
  id: "cyl-1",
  barcode: "GV-001",
  gas_type: "Propán",
  size: "11 kg",
  circulation: "own",
  owner: "warehouse",
  status: "empty",
  location_type: "warehouse_empty",
};

function isSupplierDraft(value) {
  if (!value || typeof value !== "object") return false;
  const d = value;
  if (d.version !== 1) return false;
  if (typeof d.draftId !== "string") return false;
  if (typeof d.supplierId !== "string") return false;
  if (!Array.isArray(d.returned) || !Array.isArray(d.received)) return false;
  const cylOk = (c) => c && typeof c.id === "string" && typeof c.barcode === "string";
  return d.returned.every(cylOk) && d.received.every(cylOk);
}

function isQuickDraft(value) {
  if (!value || typeof value !== "object") return false;
  const d = value;
  if (d.version !== 1) return false;
  if (typeof d.draftId !== "string") return false;
  if (typeof d.partnerId !== "string") return false;
  if (d.incoming !== null && (!d.incoming.id || !d.incoming.barcode)) return false;
  if (d.outgoing !== null && (!d.outgoing.id || !d.outgoing.barcode)) return false;
  return true;
}

test("supplier and quick exchange use separate draft storage keys", () => {
  const supplierSrc = fs.readFileSync(
    path.join(root, "src/lib/supplier-exchange-draft.ts"),
    "utf8",
  );
  const quickSrc = fs.readFileSync(path.join(root, "src/lib/quick-exchange-draft.ts"), "utf8");
  assert.match(supplierSrc, /gazveeled:workflow-draft:supplier-exchange/);
  assert.match(quickSrc, /gazveeled:workflow-draft:quick-exchange/);
  assert.doesNotMatch(supplierSrc, /quick-exchange/);
});

test("workflow draft storage scopes keys per user and clears on sign-out", () => {
  const storageSrc = fs.readFileSync(path.join(root, "src/lib/workflow-draft-storage.ts"), "utf8");
  const authSrc = fs.readFileSync(path.join(root, "src/lib/auth.ts"), "utf8");
  const hookSrc = fs.readFileSync(path.join(root, "src/hooks/use-workflow-draft.ts"), "utf8");
  assert.match(storageSrc, /localStorage/);
  assert.doesNotMatch(storageSrc, /sessionStorage/);
  assert.match(storageSrc, /workflowDraftStorageKey/);
  assert.match(storageSrc, /clearUserWorkflowDrafts/);
  assert.match(authSrc, /clearUserWorkflowDrafts/);
  assert.match(hookSrc, /userId/);
  assert.match(hookSrc, /markCompleted/);
  assert.match(hookSrc, /beginSubmit/);
  assert.match(hookSrc, /isWorkflowDraftAlreadyCompleted/);
});

test("routes wire draft persistence and explicit clear actions", () => {
  const suppliers = fs.readFileSync(path.join(root, "src/routes/_authenticated/suppliers.tsx"), "utf8");
  const quick = fs.readFileSync(path.join(root, "src/routes/_authenticated/quick-exchange.tsx"), "utf8");
  assert.match(suppliers, /useWorkflowDraft/);
  assert.match(suppliers, /markCompleted\(\)/);
  assert.match(suppliers, /Piszkozat törlése/);
  assert.match(quick, /useWorkflowDraft/);
  assert.match(quick, /markCompleted\(\)/);
  assert.match(quick, /Piszkozat törlése/);
  assert.match(quick, /beginSubmit/);
});

test("mock storage restores supplier draft and clears invalid JSON safely", () => {
  const storage = createMockStorage();
  const key = "gazveeled:workflow-draft:supplier-exchange";
  const draft = {
    version: 1,
    draftId: "draft-a",
    supplierId: "sup-1",
    returnBc: "",
    receiveBc: "",
    returned: [sampleCylinder],
    received: [],
    note: "teszt",
    workflowStep: "add_received",
  };
  storage.setItem(key, JSON.stringify(draft));
  const loaded = loadDraft(storage, key, 1, isSupplierDraft);
  assert.equal(loaded.supplierId, "sup-1");
  assert.equal(loaded.returned.length, 1);

  storage.setItem(key, "{not-json");
  assert.equal(loadDraft(storage, key, 1, isSupplierDraft), null);
  assert.equal(storage.getItem(key), null);
});

test("completed draft id blocks duplicate submit and allows draft clear on success", () => {
  const storage = createMockStorage();
  const key = "gazveeled:workflow-draft:quick-exchange";
  const draftId = "draft-success-1";
  const draft = {
    version: 1,
    draftId,
    partnerId: "p-1",
    operation: "exchange",
    exchangeMode: "barcode",
    saleMode: "barcode",
    incomingBc: "",
    outgoingBc: "",
    incoming: sampleCylinder,
    incomingCreated: false,
    outgoing: null,
    outgoingCreated: false,
    chineseGas: "Széndioxid",
    chineseSize: "10 kg",
    chineseQty: "1",
    chineseBroughtOutKind: "",
    chineseOutGas: "Széndioxid",
    chineseOutSize: "10 kg",
    chineseOutQty: "1",
    flagaPbKey: "x",
    flagaPbQty: "1",
    primaPbKey: "y",
    primaPbQty: "1",
    reassign: null,
    note: "",
    workflowStep: "scan_outgoing",
  };
  storage.setItem(key, JSON.stringify(draft));
  assert.equal(isAlreadyCompleted(storage, draftId), false);

  markCompleted(storage, draftId);
  storage.removeItem(key);
  assert.equal(isAlreadyCompleted(storage, draftId), true);
  assert.equal(storage.getItem(key), null);

  const restored = loadDraft(storage, key, 1, isQuickDraft);
  assert.equal(restored, null);
});

test("failed submit path keeps draft data in storage", () => {
  const storage = createMockStorage();
  const key = "gazveeled:workflow-draft:supplier-exchange";
  const draft = {
    version: 1,
    draftId: "draft-fail-1",
    supplierId: "sup-2",
    returnBc: "BC1",
    receiveBc: "",
    returned: [sampleCylinder],
    received: [],
    note: "",
    workflowStep: "add_received",
  };
  storage.setItem(key, JSON.stringify(draft));
  assert.equal(isAlreadyCompleted(storage, draft.draftId), false);
  assert.ok(loadDraft(storage, key, 1, isSupplierDraft));
  assert.equal(storage.getItem(key) != null, true);
});
