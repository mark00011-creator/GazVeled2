/**
 * Szimulálja a saveBarcode szinkron belépési guardot (React state késleltetés nélkül).
 * Run: node scripts/repro-barcode-busy-guard.mjs
 */
import assert from "node:assert/strict";

function simulateOldGuard({ busyId, busyKey, calls }) {
  const results = [];
  for (let i = 0; i < calls; i++) {
    if (busyId === busyKey) {
      results.push("silent-return");
      continue;
    }
    busyId = busyKey;
    results.push("proceed");
  }
  return results;
}

function simulateNewGuard({ inFlightId, cylinderId, calls }) {
  const results = [];
  for (let i = 0; i < calls; i++) {
    if (inFlightId === cylinderId) {
      results.push("blocked-ref");
      continue;
    }
    inFlightId = cylinderId;
    results.push("proceed");
  }
  return results;
}

// Egyetlen kattintás mindkét modellben proceed
assert.deepEqual(
  simulateOldGuard({ busyId: null, busyKey: "barcode-x", calls: 1 }),
  ["proceed"],
);
assert.deepEqual(
  simulateNewGuard({ inFlightId: null, cylinderId: "x", calls: 1 }),
  ["proceed"],
);

// Dupla szinkron hívás: ref azonnal blokkol; busyId state a másodiknál már silent-return
const oldDouble = simulateOldGuard({ busyId: null, busyKey: "barcode-x", calls: 2 });
assert.deepEqual(oldDouble, ["proceed", "silent-return"], "busyId: 2. hívás csendes return (nincs toast/hálózat)");

const newDouble = simulateNewGuard({ inFlightId: null, cylinderId: "x", calls: 2 });
assert.deepEqual(newDouble, ["proceed", "blocked-ref"], "ref: második hívás blokkolva");

console.log("[repro-barcode-busy-guard] OK");
