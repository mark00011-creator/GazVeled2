import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function groupUninvoicedRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.batchId ?? row.exchangeId;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        id: key,
        batchId: row.batchId,
        exchangeIds: [row.exchangeId],
        eladasi_ar: row.eladasi_ar,
        items: [row],
        pairCount: 1,
      });
      continue;
    }
    existing.exchangeIds.push(row.exchangeId);
    existing.eladasi_ar += row.eladasi_ar;
    existing.items.push(row);
    existing.pairCount = existing.items.length;
  }
  return [...groups.values()];
}

test("exchange batch migration adds batch_id and mark_exchange_batch_invoiced", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260918050716_exchange_batch_id.sql"),
    "utf8",
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS batch_id uuid/);
  assert.match(sql, /p_batch_id uuid DEFAULT NULL/);
  assert.match(sql, /mark_exchange_batch_invoiced/);
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.record_exchange\(uuid, uuid, uuid, text, text, uuid, boolean\)/);
});

test("uninvoiced rows with same batch_id collapse to one reminder group", () => {
  const grouped = groupUninvoicedRows([
    { exchangeId: "e1", batchId: "b1", eladasi_ar: 1000 },
    { exchangeId: "e2", batchId: "b1", eladasi_ar: 2000 },
    { exchangeId: "e3", batchId: null, eladasi_ar: 500 },
  ]);
  assert.equal(grouped.length, 2);
  const batch = grouped.find((g) => g.id === "b1");
  assert.equal(batch.pairCount, 2);
  assert.equal(batch.eladasi_ar, 3000);
  assert.deepEqual(batch.exchangeIds, ["e1", "e2"]);
});

test("quick exchange multi-pair wiring", () => {
  const quick = fs.readFileSync(path.join(root, "src/routes/_authenticated/quick-exchange.tsx"), "utf8");
  const draft = fs.readFileSync(path.join(root, "src/lib/quick-exchange-draft.ts"), "utf8");
  const card = fs.readFileSync(path.join(root, "src/components/UninvoicedExchangesCard.tsx"), "utf8");
  const ops = fs.readFileSync(path.join(root, "src/lib/cylinder-ops.ts"), "utf8");
  assert.match(draft, /QUICK_EXCHANGE_DRAFT_VERSION = 3/);
  assert.match(draft, /incomingList: QuickExchangeListItem\[\]/);
  assert.match(draft, /outgoingList: QuickExchangeListItem\[\]/);
  assert.match(draft, /zipExchangeLists/);
  assert.match(quick, /addIncomingToList/);
  assert.match(quick, /addOutgoingToList/);
  assert.match(quick, /Hozzáad/);
  assert.doesNotMatch(quick, /addCurrentPairToList/);
  assert.match(quick, /batch_id: batchId/);
  assert.match(ops, /p_batch_id/);
  assert.match(card, /createInvoiceDraft|Számlázás/);
  assert.match(card, /pairCount/);
});
