/**
 * Finalize authority / tampering resistance tests (no production DB).
 * Proves client-supplied ADR/business values cannot become FINALIZED authority.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ADR_VERIFIED_SEEDS, ADR_UNVERIFIED_STARGON_C18 } from "../src/lib/adr/types-and-calc.ts";
import { computeServerFinalizeAuthority } from "../src/lib/delivery-notes/server-finalize-authority.ts";

const root = path.resolve(import.meta.dirname, "..");
const migPath = path.join(
  root,
  "supabase/migrations/20260924120000_delivery_notes_server_side_finalize.sql",
);
const opsPath = path.join(root, "src/lib/delivery-notes/ops.ts");
const hardeningMig = path.join(
  root,
  "supabase/migrations/20260923140000_delivery_notes_hardening.sql",
);

function oxygenMaster(overrides = {}) {
  const o = ADR_VERIFIED_SEEDS.OXYGEN_COMPRESSED;
  return {
    organization_id: null,
    gas_type_key: "oxigén",
    ruleset_version: "ADR-2025",
    un_number: o.unNumber,
    proper_shipping_name_hu: o.properShippingNameHu,
    technical_name_hu: o.technicalNameHu,
    adr_class: o.adrClass,
    classification_code: o.classificationCode,
    hazard_labels: o.hazardLabels,
    packing_group: o.packingGroup,
    tunnel_restriction_code: o.tunnelRestrictionCode,
    transport_category: o.transportCategory,
    multiplier: o.multiplier,
    quantity_basis: o.quantityBasis,
    transport_document_text: o.transportDocumentText ?? null,
    verified: o.verified,
    verified_at: o.verifiedAt,
    source: o.source,
    ...overrides,
  };
}

function baseNote(overrides = {}) {
  return {
    id: "note-1",
    organization_id: "org-1",
    partner_id: "partner-1",
    supplier_id: null,
    shipper_name: "Kliens Shipper HAMIS",
    shipper_address: "Hamis cím",
    consignee_name: "Hamis Partner Kft.",
    consignee_address: "Hamis partner cím",
    delivery_address: "Telephely 1",
    vehicle_plate: "ABC-123",
    driver_name: "Sofőr",
    adr_ruleset_version: "ADR-2025",
    ...overrides,
  };
}

function o2Item(overrides = {}) {
  return {
    id: "item-1",
    line_role: "outgoing_full",
    cylinder_state: "FULL",
    gas_type: "Oxigén",
    size: "50 L",
    quantity: 3,
    barcode: "OX-001",
    cylinder_id: null,
    water_capacity_l: 50,
    net_gas_mass_kg: null,
    adr_product_key: "oxigén",
    note: null,
    sort_order: 0,
    ...overrides,
  };
}

test("migration drops client-snapshot finalize overload and creates uuid-only RPC", () => {
  const sql = fs.readFileSync(migPath, "utf8");
  assert.match(
    sql,
    /DROP FUNCTION IF EXISTS public\.finalize_delivery_note\(uuid, jsonb, jsonb, numeric, boolean, text\)/,
  );
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.finalize_delivery_note\(p_delivery_note_id uuid\)/,
  );
  assert.doesNotMatch(sql, /adr_snapshot\s*=\s*p_adr_snapshot/);
  assert.doesNotMatch(sql, /business_snapshot\s*=\s*p_business_snapshot/);
  assert.match(sql, /build_delivery_note_finalize_snapshots/);
  assert.match(sql, /FOR UPDATE/);
});

test("ops.ts finalize RPC does not send p_adr_snapshot / p_business_snapshot", () => {
  const ops = fs.readFileSync(opsPath, "utf8");
  assert.match(ops, /p_delivery_note_id:\s*noteId/);
  assert.doesNotMatch(ops, /p_adr_snapshot\s*:/);
  assert.doesNotMatch(ops, /p_business_snapshot\s*:/);
  assert.doesNotMatch(ops, /p_adr_total_points\s*:/);
  assert.doesNotMatch(ops, /p_adr_within_116\s*:/);
});

test("repo search: finalize authority no longer uses client p_adr_snapshot", () => {
  const ops = fs.readFileSync(opsPath, "utf8");
  const newMig = fs.readFileSync(migPath, "utf8");
  // Historical hardening migration still documents old signature — OK as history.
  assert.ok(fs.existsSync(hardeningMig));
  // Live call path + new migration must not accept client snapshots as authority.
  assert.equal(ops.includes("p_adr_snapshot"), false);
  assert.equal(newMig.includes("p_adr_snapshot"), false);
  assert.equal(newMig.includes("p_business_snapshot"), false);
});

test("UN manipuláció: DB UN 1072, kliens UN 9999 → snapshot UN 1072", () => {
  const result = computeServerFinalizeAuthority({
    note: baseNote(),
    items: [o2Item()],
    masters: [oxygenMaster({ un_number: "1072" })],
    organization: { id: "org-1", name: "Gáz Veled Kft." },
    partner: { id: "partner-1", name: "Valódi Partner Kft.", address: "Valódi út 1." },
    supplier: null,
    clientAttempt: {
      p_adr_snapshot: { lines: [{ unNumber: "9999" }] },
      unNumber: "9999",
    },
  });
  assert.ok(result.ignoredClientAuthority.includes("unNumber"));
  assert.equal(result.business_snapshot.items[0].adrProduct?.unNumber, "1072");
  assert.match(result.adr_snapshot.lines[0].documentLineText ?? "", /UN 1072/);
  assert.doesNotMatch(result.adr_snapshot.lines[0].documentLineText ?? "", /9999/);
});

test("ADR total manipuláció: DB 150, kliens 0 → 150", () => {
  const result = computeServerFinalizeAuthority({
    note: baseNote(),
    items: [o2Item({ quantity: 3, water_capacity_l: 50 })],
    masters: [oxygenMaster()],
    organization: { id: "org-1", name: "Gáz Veled Kft." },
    partner: { id: "partner-1", name: "Valódi Partner Kft.", address: null },
    supplier: null,
    clientAttempt: {
      p_adr_total_points: 0,
      p_adr_within_116: true,
    },
  });
  assert.equal(result.adr_total_points, 150);
  assert.equal(result.adr_snapshot.totalPoints, 150);
  assert.ok(result.ignoredClientAuthority.includes("p_adr_total_points"));
});

test("Verified manipuláció: DB false, kliens true → false", () => {
  const stargon = ADR_UNVERIFIED_STARGON_C18;
  const master = {
    organization_id: null,
    gas_type_key: "stargon",
    ruleset_version: "ADR-2025",
    un_number: stargon.unNumber,
    proper_shipping_name_hu: stargon.properShippingNameHu,
    technical_name_hu: stargon.technicalNameHu,
    adr_class: stargon.adrClass,
    classification_code: stargon.classificationCode,
    hazard_labels: stargon.hazardLabels,
    packing_group: stargon.packingGroup,
    tunnel_restriction_code: stargon.tunnelRestrictionCode,
    transport_category: stargon.transportCategory,
    multiplier: stargon.multiplier,
    quantity_basis: stargon.quantityBasis,
    transport_document_text: null,
    verified: false,
    verified_at: null,
    source: stargon.source,
  };
  const result = computeServerFinalizeAuthority({
    note: baseNote(),
    items: [
      o2Item({
        gas_type: "Stargon",
        adr_product_key: "stargon",
        quantity: 1,
        water_capacity_l: 50,
      }),
    ],
    masters: [master],
    organization: { id: "org-1", name: "Gáz Veled Kft." },
    partner: { id: "partner-1", name: "Valódi Partner Kft.", address: null },
    supplier: null,
    clientAttempt: { verified: true, p_adr_snapshot: { verified: true } },
  });
  assert.equal(result.business_snapshot.items[0].adrProduct?.verified, false);
  assert.ok(result.adr_snapshot.blockingWarnings.some((w) => /nincs hitelesítve/i.test(w)));
});

test("Partner manipuláció: DB Valódi Partner, kliens más név → DB partner", () => {
  const result = computeServerFinalizeAuthority({
    note: baseNote({ consignee_name: "Hamis Partner Kft." }),
    items: [o2Item()],
    masters: [oxygenMaster()],
    organization: { id: "org-1", name: "Gáz Veled Kft." },
    partner: { id: "partner-1", name: "Valódi Partner Kft.", address: "Valódi út 1." },
    supplier: null,
    clientAttempt: {
      partnerName: "Betörő Bt.",
      consigneeName: "Betörő Bt.",
      p_business_snapshot: { consigneeName: "Betörő Bt." },
    },
  });
  assert.equal(result.business_snapshot.consigneeName, "Valódi Partner Kft.");
  assert.equal(result.business_snapshot.consigneeAddress, "Valódi út 1.");
  assert.equal(result.business_snapshot.shipperName, "Gáz Veled Kft.");
});

test("Szállítási kategória manipuláció: teli O2 cat3, kliens cat4/0 pont → cat3 + 150", () => {
  const result = computeServerFinalizeAuthority({
    note: baseNote(),
    items: [o2Item({ quantity: 3, water_capacity_l: 50 })],
    masters: [oxygenMaster({ transport_category: 3, multiplier: 1 })],
    organization: { id: "org-1", name: "Gáz Veled Kft." },
    partner: { id: "partner-1", name: "Valódi Partner Kft.", address: null },
    supplier: null,
    clientAttempt: {
      transportCategory: 4,
      p_adr_total_points: 0,
      p_adr_snapshot: {
        lines: [{ transportCategory: 4, points: 0 }],
        totalPoints: 0,
      },
    },
  });
  assert.equal(result.adr_snapshot.lines[0].transportCategory, 3);
  assert.equal(result.adr_snapshot.lines[0].points, 150);
  assert.equal(result.adr_total_points, 150);
});

test("EMPTY_UNCLEANED: points 0, category 4, ÜRES TARTÁLY, 2", () => {
  const result = computeServerFinalizeAuthority({
    note: baseNote(),
    items: [
      o2Item({
        cylinder_state: "EMPTY_UNCLEANED",
        line_role: "incoming_empty",
        quantity: 2,
      }),
    ],
    masters: [oxygenMaster()],
    organization: { id: "org-1", name: "Gáz Veled Kft." },
    partner: null,
    supplier: null,
  });
  assert.equal(result.adr_total_points, 0);
  assert.equal(result.adr_snapshot.lines[0].transportCategory, 4);
  assert.equal(result.adr_snapshot.lines[0].documentLineText, "ÜRES TARTÁLY, 2");
  assert.equal(result.adr_snapshot.emptyUncleanedCount, 2);
});
