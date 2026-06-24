/**
 * Applies rental_cylinder_rental_dates migration via Supabase Management API.
 * Usage: SUPABASE_ACCESS_TOKEN=... node scripts/apply-rental-cylinder-dates-migration.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRef = "snmiwsgtnokvqlnwvfwf";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("Missing SUPABASE_ACCESS_TOKEN");
  process.exit(1);
}

const dir = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(dir, "../supabase/migrations/20260624120000_rental_cylinder_rental_dates.sql"),
  "utf8",
);

const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: sql }),
});

const body = await res.text();
console.log(res.status, body);
if (!res.ok) process.exit(1);
