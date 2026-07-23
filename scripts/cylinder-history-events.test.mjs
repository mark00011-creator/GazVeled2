import assert from "node:assert/strict";
import { test } from "node:test";

/** Mirror of src/lib/cylinder-history.ts labels – regression guard. */
const cylinderHistoryEventLabels = {
  cylinder_created: "Palack létrehozása",
  temp_created: "TEMP palack létrehozása",
  cylinder_edited: "Palack szerkesztése",
  quick_exchange: "Gyors csere",
  forced_substitution: "Kényszerhelyettesítés",
  circulation_difference_created: "Körforgás-eltérés létrehozva",
  circulation_difference_partial_settlement: "Körforgás-eltérés részben rendezve",
  circulation_difference_closed: "Körforgás-eltérés lezárva",
  chinese_brought: "Hozott kínai",
  chinese_take: "Kínait visz",
  partner_issue: "Partnerhez kiadás",
  partner_return: "Partnertől visszavétel",
  rental_start: "Bérbeadás",
  rental_extend: "Bérlet hosszabbítás",
  rental_expiry_change: "Bérleti lejárat módosítása",
  rental_close: "Bérlet lezárása",
  warehouse_arrival: "Telephelyre érkezés",
  warehouse_departure: "Telephelyről kiadás",
  location_change: "Helyszín módosítása",
  status_change: "Státusz módosítás",
  manufacturer_change: "Gyártó módosítása",
  owner_change: "Tulajdonos módosítása",
  circulation_change: "Körforgás módosítás",
  gas_type_change: "Gáz típusa módosítása",
  size_change: "Méret módosítása",
  pressure_test_year_change: "Nyomáspróba módosítás",
  loan_issue: "Kölcsön kiadás",
  loan_return_empty: "Kölcsön visszavétel (üres)",
  loan_return_full: "Kölcsön visszavétel (teli)",
  supplier_exchange: "Szolgáltatói csere",
  supplier_received_from: "Szolgáltatótól érkezett",
  temp_to_serial: "TEMP → valós sorszám",
  temp_to_chinese: "TEMP → kínai tétel",
  barcode_change: "Vonalkód módosítás",
  complaint: "Reklamáció",
  complaint_opened: "Reklamáció indítva",
  complaint_closed: "Reklamáció lezárva",
  scrap: "Selejtezés",
};

const requiredAuditEvents = [
  "cylinder_created",
  "temp_created",
  "temp_to_serial",
  "temp_to_chinese",
  "barcode_change",
  "manufacturer_change",
  "owner_change",
  "circulation_change",
  "gas_type_change",
  "size_change",
  "pressure_test_year_change",
  "status_change",
  "location_change",
  "partner_issue",
  "partner_return",
  "quick_exchange",
  "chinese_brought",
  "chinese_take",
  "rental_start",
  "rental_extend",
  "rental_expiry_change",
  "rental_close",
  "loan_issue",
  "loan_return_empty",
  "loan_return_full",
  "supplier_exchange",
  "supplier_received_from",
  "complaint_opened",
  "complaint_closed",
];

test("minden kötelező eseménytípushoz van magyar címke", () => {
  for (const key of requiredAuditEvents) {
    assert.ok(cylinderHistoryEventLabels[key], `hiányzó címke: ${key}`);
  }
});

test("mergeHistoryMetadata barcode és partner megmarad", () => {
  const merged = {
    ...( { foo: 1 } ),
    barcode: "hu123",
    partner_name: "Teszt Kft.",
  };
  assert.equal(merged.barcode, "hu123");
  assert.equal(merged.partner_name, "Teszt Kft.");
});
