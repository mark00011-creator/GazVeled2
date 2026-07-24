import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const migration = readFileSync(
  join(root, "supabase/migrations/20260724120000_event_integrity_check.sql"),
  "utf8",
);
const diagnosticSql = readFileSync(join(root, "supabase/check_event_engine.sql"), "utf8");

test("event integrity migráció tartalmazza a RPC-ket", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.event_engine_diagnostic\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.event_engine_health\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.event_statistics\(\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.event_engine_health\(\) TO authenticated/);
});

test("check_event_engine.sql idempotens és összesít", () => {
  assert.match(diagnosticSql, /event_engine_diagnostic\(\)/);
  assert.match(diagnosticSql, /GROUP BY level/);
  assert.match(diagnosticSql, /event_engine_health\(\)/);
  assert.match(diagnosticSql, /event_statistics\(\)/);
  assert.doesNotMatch(diagnosticSql, /DROP TABLE public\.events/i);
  assert.doesNotMatch(diagnosticSql, /DELETE FROM public\.events/i);
});

test("health JSON mezők dokumentálva a migrációban", () => {
  assert.match(migration, /'healthy'/);
  assert.match(migration, /'missing_links'/);
  assert.match(migration, /'orphan_events'/);
  assert.match(migration, /'duplicate_groups'/);
  assert.match(migration, /'warnings'/);
});

test("statistics JSON mezők dokumentálva a migrációban", () => {
  assert.match(migration, /'by_event_type'/);
  assert.match(migration, /'by_entity_type'/);
  assert.match(migration, /'by_source'/);
  assert.match(migration, /'by_severity'/);
  assert.match(migration, /'daily_last_30_days'/);
});
