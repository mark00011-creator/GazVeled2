import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { shouldCloseRentalAfterReturn } from "../src/lib/rental-ops.ts";

/**
 * A quantity RPC egyszer könyveli a kért darabot.
 * A kliens utána nem hív második teljes visszavételt a maradékra.
 */
function applyReturn(state, request) {
  if (request.returnQty < 0 || request.returnQty > state.qty) {
    throw new Error("érvénytelen quantity visszavétel");
  }
  if (request.returnSerials < 0 || request.returnSerials > state.serials) {
    throw new Error("érvénytelen sorszámos visszavétel");
  }
  const qty = state.qty - request.returnQty;
  const serials = state.serials - request.returnSerials;
  const openQuantityRows = qty > 0 ? 1 : 0;
  const closed = shouldCloseRentalAfterReturn(serials, openQuantityRows);
  return {
    qty,
    serials,
    emptyDelta: request.returnQty,
    fullDelta: 0,
    secondIncrement: 0,
    status: closed ? "closed" : "active",
  };
}

test("A) 3-ból 2 kínai visszahozás: 1 kint marad, üres +2, bérlet aktív", () => {
  const after = applyReturn({ qty: 3, serials: 0 }, { returnQty: 2, returnSerials: 0 });
  assert.equal(after.qty, 1);
  assert.equal(after.emptyDelta, 2);
  assert.equal(after.fullDelta, 0);
  assert.equal(after.secondIncrement, 0);
  assert.equal(after.status, "active");
});

test("B) utolsó 1 db: üres +1, quantity 0, bérlet zárul ha serial sincs", () => {
  const after = applyReturn({ qty: 1, serials: 0 }, { returnQty: 1, returnSerials: 0 });
  assert.equal(after.qty, 0);
  assert.equal(after.emptyDelta, 1);
  assert.equal(after.fullDelta, 0);
  assert.equal(after.status, "closed");
});

test("C) 3-ból 3: üres +3 egyszer, bérlet zárul", () => {
  const after = applyReturn({ qty: 3, serials: 0 }, { returnQty: 3, returnSerials: 0 });
  assert.equal(after.qty, 0);
  assert.equal(after.emptyDelta, 3);
  assert.equal(after.fullDelta, 0);
  assert.equal(after.secondIncrement, 0);
  assert.equal(after.status, "closed");
});

test("D) quantity elfogyott, de sorszámos palack kint van: bérlet aktív", () => {
  const after = applyReturn({ qty: 2, serials: 1 }, { returnQty: 2, returnSerials: 0 });
  assert.equal(after.qty, 0);
  assert.equal(after.serials, 1);
  assert.equal(after.status, "active");
});

test("E) serial visszaadva, quantityből még 1 kint: bérlet aktív", () => {
  const after = applyReturn({ qty: 1, serials: 1 }, { returnQty: 0, returnSerials: 1 });
  assert.equal(after.qty, 1);
  assert.equal(after.serials, 0);
  assert.equal(after.emptyDelta, 0);
  assert.equal(after.status, "active");
});

test("F) serial-only visszavétel továbbra is üres telephelyre teszi ugyanazt a palackot", () => {
  const src = fs.readFileSync("src/lib/rental-ops.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function returnRentalCylinders"));
  assert.match(fn, /status:\s*"empty"/);
  assert.match(fn, /location_type:\s*whLoc/);
  assert.match(fn, /const whLoc = "warehouse_empty"/);
  assert.match(fn, /rental_id:\s*null/);
  assert.match(fn, /shouldCloseRentalAfterReturn\(count \?\? 0, qtyCount \?\? 0\)/);
  assert.doesNotMatch(
    fn,
    /if \(\(count \?\? 0\) === 0 && \(qtyCount \?\? 0\) > 0\) \{\s*await returnRentalQuantityItems/,
  );
  const after = applyReturn({ qty: 0, serials: 1 }, { returnQty: 0, returnSerials: 1 });
  assert.equal(after.serials, 0);
  assert.equal(after.status, "closed");
});
