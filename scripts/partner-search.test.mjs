import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function foldForPartnerSearch(value) {
  return value
    .toLocaleLowerCase("hu-HU")
    .replace(/[áàâäå]/g, "a")
    .replace(/[éèêë]/g, "e")
    .replace(/[íìîï]/g, "i")
    .replace(/[óòôöő]/g, "o")
    .replace(/[úùûüű]/g, "u")
    .replace(/[ýÿ]/g, "y")
    .replace(/[ç]/g, "c")
    .replace(/[ñ]/g, "n");
}

function partnerSearchHaystack(partner) {
  return foldForPartnerSearch(`${partner.name} ${partner.company_name ?? ""}`.trim());
}

function filterPartners(partners, query) {
  const trimmed = query.trim();
  if (!trimmed) return partners;
  const foldedQuery = foldForPartnerSearch(trimmed);
  return partners.filter((partner) => partnerSearchHaystack(partner).includes(foldedQuery));
}

const samplePartners = [
  { id: "1", name: "ATIS 2008 Kft.", company_name: null },
  { id: "2", name: "Csikár-Vill Kft.", company_name: "Villanyszerelés" },
  { id: "3", name: "Alfa Partner", company_name: "Béta Kft." },
  { id: "4", name: "Zöld Gáz", company_name: "Építő Kft." },
];

test("quick exchange uses shared PartnerSelector", () => {
  const quick = fs.readFileSync(path.join(root, "src/routes/_authenticated/quick-exchange.tsx"), "utf8");
  const selector = fs.readFileSync(path.join(root, "src/components/PartnerSelector.tsx"), "utf8");
  assert.match(quick, /PartnerSelector/);
  assert.match(selector, /Partner keresése/);
  assert.match(selector, /filterPartners/);
});

test("mobile partner drawer pins search above keyboard via visualViewport", () => {
  const selector = fs.readFileSync(path.join(root, "src/components/PartnerSelector.tsx"), "utf8");
  assert.match(selector, /visualViewport/);
  assert.match(selector, /repositionInputs=\{false\}/);
  assert.match(selector, /stickySearch/);
  assert.match(selector, /overflow-hidden/);
  assert.match(selector, /overflow-y-auto/);
});

test("successful quick exchange clears partner via resetWorkflow", () => {
  const quick = fs.readFileSync(path.join(root, "src/routes/_authenticated/quick-exchange.tsx"), "utf8");
  assert.match(quick, /markCompleted\(\);\s*resetWorkflow\(\);/s);
  assert.match(quick, /setPartnerId\(""\)/);
  assert.match(quick, /function discardDraft\(\)[\s\S]*resetWorkflow\(\)/);
  assert.doesNotMatch(
    quick,
    /markCompleted\(\);\s*resetCylinders\(\);\s*setNote\(""\);/,
  );
});

test("partner search filters from one character with substring match", () => {
  const byA = filterPartners(samplePartners, "a");
  assert.ok(byA.some((p) => p.name.includes("ATIS")));
  assert.ok(byA.some((p) => p.name.includes("Alfa")));
  assert.ok(byA.some((p) => p.name.includes("Csikár")));

  assert.deepEqual(
    filterPartners(samplePartners, "ati").map((p) => p.id),
    ["1"],
  );
  assert.deepEqual(
    filterPartners(samplePartners, "csik").map((p) => p.id),
    ["2"],
  );
});

test("partner search is case-insensitive and accent-insensitive", () => {
  assert.deepEqual(
    filterPartners(samplePartners, "ATIS").map((p) => p.id),
    ["1"],
  );
  assert.deepEqual(
    filterPartners(samplePartners, "csikar").map((p) => p.id),
    ["2"],
  );
  assert.deepEqual(
    filterPartners(samplePartners, "epito").map((p) => p.id),
    ["4"],
  );
});

test("empty query returns full list and unknown query returns empty", () => {
  assert.equal(filterPartners(samplePartners, "").length, samplePartners.length);
  assert.equal(filterPartners(samplePartners, "   ").length, samplePartners.length);
  assert.equal(filterPartners(samplePartners, "nincsilyen").length, 0);
});
