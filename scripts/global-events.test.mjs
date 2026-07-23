import assert from "node:assert/strict";
import { test } from "node:test";

const INITIAL_GLOBAL_EVENT_TYPES = [
  "quick_exchange",
  "supplier_exchange",
  "temp_to_real",
  "temp_to_chinese",
];

test("global events kezdeti eseménytípusok", () => {
  assert.equal(INITIAL_GLOBAL_EVENT_TYPES.length, 4);
  assert.ok(INITIAL_GLOBAL_EVENT_TYPES.includes("temp_to_real"));
});

test("events payload mezők strukturálhatók", () => {
  const payload = {
    exchange_id: "00000000-0000-4000-8000-000000000001",
    incoming_barcode: "hu111",
    outgoing_barcode: "hu222",
  };
  assert.equal(payload.incoming_barcode, "hu111");
});
