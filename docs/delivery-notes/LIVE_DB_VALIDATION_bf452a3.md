# LIVE DB VALIDATION — `bf452a3` (+ bypass hardening)

**Dátum:** 2026-09-25  
**Audit cél commit:** `bf452a3` (server-side finalize authority)  
**Kiegészítő javítás (LIVE-bizonyított HIGH):** `20260925120000_delivery_notes_bypass_hardening.sql`  
**Production apply:** **TILOS / NEM FUTTATVA**  
**Production projekt:** `snmiwsgtnokvqlnwvfwf` — **nem írtunk rá**

---

## FINAL VERDICT

# **READY FOR PRODUCTION APPLY**

Feltételek teljesültek a **validation** DB-n (`wexzoclifwibdqxaowzf`):

- fresh migration + delivery objektumok PASS  
- trust-boundary PASS (A–E)  
- 50 concurrency PASS (`SZL-2026-000055` … `SZL-2026-000104`)  
- two-org sequences PASS (külön `delivery_note_sequences` sorok)  
- rollback / immutability / lifecycle / cross-org / anon / ADR master / snapshot / ADR live PASS  
- bypass GUC kliens-támadás **javítva és újratesztelve**  
- 0 CRITICAL / 0 HIGH a javítás után  
- unit regression PASS  

Ez **engedély a későbbi production apply-re**, nem maga az apply.

---

## 1. PRE

| Mező | Érték |
|------|--------|
| Branch | `main` |
| HEAD (induláskor) | `00ee069` (docs follow-up `bf452a3` után) |
| Dirty | local `pdf-samples-v2/*` zaj |
| Node | v24.16.0 |
| npm | 11.13.0 |
| Docker | telepítve (4.91.0), engine **nem indult** (`dockerDesktopLinuxEngine` pipe hiányzik / WSL) |
| Supabase CLI (npm global) | crash (`Illegal instruction`, Bun baseline) |
| Supabase CLI (npx 2.20.5) | működik, de Docker nélkül `supabase start` FAIL |
| Local `.env` URL | production ref `snmiwsgtnokv…` — **nem használtuk teszt célként** |

## 2. DB target bizonyíték

| Mező | Érték |
|------|--------|
| Validation project | **`wexzoclifwibdqxaowzf`** |
| Név | `GazVeled-live-db-validation-bf452a3` |
| Region | `eu-west-2` |
| Status | `ACTIVE_HEALTHY` |
| Host | `db.wexzoclifwibdqxaowzf.supabase.co` |
| ≠ production | **igen** (`snmiwsgtnokvqlnwvfwf` ≠ `wexzoclifwibdqxaowzf`) |

Megjegyzés: ideiglenes free-tier slot miatt a `Kepviselo-app` (`wdksghmphgvqyfqdgdlv`) szüneteltetve lett a létrehozáshoz; restore külön lépés (jóváhagyás / manuális).

## 3. Fresh migration

| Tétel | Eredmény |
|-------|----------|
| Kiindulás | üres `schema_migrations` |
| Alkalmazás | repo migrációk + repair/corrective sorok → **68+** history (köztük delivery stack + bypass) |
| Delivery migrációk | `delivery_notes_adr`, `delivery_notes_hardening`, `delivery_notes_server_side_finalize`, `delivery_notes_bypass_hardening` |
| Hibák | néhány truncated apply → **repair** migrációkkal pótolva (validation-only) |
| Táblák | `adr_product_master`, `delivery_notes`, `delivery_note_items`, `delivery_note_sequences` **PASS** |
| RPC | `finalize_delivery_note(p_delivery_note_id uuid)` egyetlen overload **PASS** |
| Trigger | `trg_delivery_notes_immutability` (+ items) **PASS** |
| RLS | per-op policies; ADR master csak SELECT **PASS** |

## 4. Trust-boundary (LIVE)

| Teszt | Státusz |
|-------|---------|
| A UN 1072 vs kliens 9999 | **PASS** |
| B total 150 vs kliens 0 | **PASS** |
| C verified=false vs kliens true | **PASS** |
| D partner DB név | **PASS** |
| E cat3 + 150 vs kliens cat4/0 | **PASS** |
| finalize single overload | **PASS** |
| Client GUC bypass attack (előtte HIGH) | **PASS** utáni hardeninggel (`bypass_enabled=false`) |

## 5. 50× concurrency

**PASS** — 50/50 unique: first `SZL-2026-000055`, last `SZL-2026-000104`, distinct=50.

## 6. Two-org concurrency

**PASS** — külön sequence sorok `(org_a,2098)` és `(org_b,2098)`. (Azonos `SZL-2098-NNNNNN` suffix két orgban **megengedett**.)

## 7. Rollback

| Teszt | Státusz |
|-------|---------|
| Zero-item finalize FAIL | **PASS** |
| Marad draft | **PASS** |
| Nincs document_number | **PASS** |
| Sequence garancia | allocate a item-check **után** történik → failed finalize nem fogyaszt számot ezen az úton |

## 8. Immutability

FINALIZED/CANCELLED: UPDATE business/snapshot/docnum, DELETE note/item, UPDATE item — **PASS** (bypass hardening után).

## 9. Lifecycle

DRAFT→FINALIZED, FINALIZED→CANCELLED, FINALIZED→FINALIZED fail, cancel reason kötelező, docnum megmarad, `finalized_by=auth.uid()` — **PASS**.

## 10. Cross-org RLS

ORG_A finalize ORG_B note → Organization mismatch **PASS**.

## 11. Anon RLS

SELECT count=0 / INSERT RLS deny / finalize Not authenticated — **PASS**.

## 12. ADR master security

Org user INSERT RLS deny; UPDATE rowcount=0 — **PASS**. Globális master org adminnal sem írható policy-vel.

## 13. Snapshot integrity

Master UN 9999-re mutálva → tárolt snapshot továbbra is UN 1072 szöveg — **PASS**.

## 14. ADR live cases

O2 150; O2+empty 150; CO2 975/1012.5; PB 966/1000.5; mixed 845; threshold 999.999/1000/1000.001 — **PASS**.

## 15. Unverified ADR

Stargon `verified=false` + blocking warning — **PASS**.

## 16. PDF

Unit/hardening PDF (Noto, accents, cancelled, multipage) regression **PASS**. Teljes élő PDF fájl-export a validation DB-ből nem volt külön fájlba mentve; snapshot-alapú PDF útvonal a unit suite-ban bizonyított.

## 17. Regression

| Suite | Eredmény |
|-------|----------|
| ADR | 9/9 PASS |
| delivery-notes (hardening+authority) | 17/17 PASS |
| npm test | 80/80 PASS |
| build | PASS |
| scoped eslint (delivery-notes) | PASS (LINT:0) |
| full `tsc` / `eslint .` | scope-on kívüli ismert / nem delivery regresszió |

## 18. Remaining CRITICAL

**0** (kód). Ops: Docker engine továbbra sem ready local `supabase start`-hoz; validation cloud projekt használandó / törlendő.

## 19. Remaining HIGH

**0** a bypass hardening után.  
(Előtte LIVE-bizonyított HIGH: kliens `set_config('app.delivery_note_bypass','1')` — **javítva** temp-table + REVOKE enter_bypass.)

## 20. Commit / push

Lásd git (bypass migration + validation docs + harness).

## 21. Production

**NEM alkalmazva.** Apply csak külön explicit engedéllyel, migrációkkal:

1. `20260923120000_delivery_notes_adr.sql`  
2. `20260923140000_delivery_notes_hardening.sql`  
3. `20260924120000_delivery_notes_server_side_finalize.sql`  
4. `20260925120000_delivery_notes_bypass_hardening.sql`  

---

Harness: `scripts/live-db-validation-bf452a3.sql` (+ post-bypass variant).  
Validation project id: `wexzoclifwibdqxaowzf`.
