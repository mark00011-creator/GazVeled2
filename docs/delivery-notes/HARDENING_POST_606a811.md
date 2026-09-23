# POST — delivery notes / ADR CRITICAL+HIGH hardening

**Date:** 2026-09-23  
**Base audit:** `606a811` PRE-PRODUCTION (NOT READY)  
**Production apply:** **NOT RUN** (`snmiwsgtnokvqlnwvfwf`)

## Scope note

Only delivery notes / ADR / PDF / DB-RLS-RPC touched.  
Számlázz, csere-korrekció, bérlet, scanner, éves nyereség: **nem módosítva** (korábbi scope-keverés érintetlenül maradt a history-ban).

`quick-exchange.tsx` / `suppliers.tsx` továbbra is a frissített `finalizeDeliveryNote` ops API-t hívják (ugyanaz a SZL modul) — nincs üzleti logika-változás azokban a fájlokban ebben a körben.

## Corrective migration

`supabase/migrations/20260923140000_delivery_notes_hardening.sql`

(Does not rewrite `20260923120000_…`; additive + policy/trigger/RPC hardening.)

## Fixes mapped to audit

| Audit issue | Fix |
|-------------|-----|
| Finalized mutability | Triggers + per-op RLS; DELETE only draft |
| MAX()+1 race | `delivery_note_sequences` atomic UPSERT |
| Finalize 0-row success | `finalize_delivery_note` RPC `ROW_COUNT=1` or RAISE |
| No cancel workflow | `cancel_delivery_note` + CANCELLED status + reason |
| Global ADR write by org admin | Write policies removed (SELECT only) |
| Snapshot / PDF live master | Finalize stores freeze; PDF from snapshot only |
| PDF accents stripped | Noto Sans embed via `@pdf-lib/fontkit` |

## Tests (this machine)

| Suite | Result |
|-------|--------|
| `npm run test:adr` | 9/9 PASS |
| `npm run test:delivery-notes` | 8/8 PASS (incl. multipage ≥2, cancelled, UTF-8 embed size) |
| `npm test` | 80/80 PASS |
| Full concurrent DB / RLS live | SQL harness `scripts/delivery-note-db-hardening.sql` — **requires migration applied on non-prod DB** (not executed on production) |

## Verdict for next gate

**READY FOR SECOND PRE-PRODUCTION AUDIT**

(Still **NOT** ready to apply to production until second audit + explicit approval.)
