# PRE-PRODUCTION AUDIT — commit `1120396`

**Dátum:** 2026-09-23  
**Cél commit:** `112039643a8fd7ee4c172e2a76f9abcf50aff7ec`  
**Production projekt:** `snmiwsgtnokvqlnwvfwf` (`https://snmiwsgtnokvqlnwvfwf.supabase.co`)  
**Migráció vizsgált fájl:** `supabase/migrations/20260923120000_delivery_notes_adr.sql`  
**Production apply ebben a körben:** **TILOS / NEM FUTTATVA**

---

## PRE-PRODUCTION VERDICT

# **NOT READY**

A szállítólevél/ADR séma és a számítómotor jelentős része helyes irányú, de **production apply előtt blokkoló biztonsági és bizonylat-életciklus hibák** vannak. A migráció önmagában új táblákat hoz létre (alacsony lock-kockázat), de a jelenlegi RLS + sorszám + finalizálás modell **nem felel meg** a kötelező auditkövetelményeknek.

---

## 1. COMMIT SCOPE AUDIT (`1120396` — 43 fájl)

### Scope-keverés: **IGEN — dokumentálva**

A commit **nem** csak szállítólevél/ADR. Egy nagy „sprint bundle”: Számlázz, csere-korrekció, bérlet PDF/emlékeztető, scanner UX, dashboard éves lebontás, stb.

### Fájlonként

| # | Fájl | Röviden | ADR/SZL? |
|---|------|---------|----------|
| 1 | `docs/delivery-notes/AGREEMENT.md` | Megállapodás | **Igen** |
| 2 | `docs/delivery-notes/PRE_AUDIT.md` | PRE audit | **Igen** |
| 3 | `docs/delivery-notes/POST_AUDIT.md` | POST audit | **Igen** |
| 4 | `package.json` | `test:adr` script | **Igen** (részben) |
| 5 | `scripts/adr-1136.test.mjs` | ADR 1–9 tesztek | **Igen** |
| 6 | `scripts/exchange-batch.test.mjs` | apró batch teszt fix | Nem |
| 7 | `scripts/rental-contract-pdf.test.mjs` | bérleti PDF teszt | Nem |
| 8 | `scripts/szamlazz-invoicing.test.mjs` | Számlázz teszt | Nem |
| 9 | `src/components/BarcodeScanner.tsx` | kamera permission UX | Nem (külön task) |
| 10 | `src/components/DeliveryNoteAskDialog.tsx` | gyorscsere után SZL? | **Igen** |
| 11 | `src/components/ExchangeOutgoingCorrectionDialog.tsx` | kimenő csere javítás | Nem |
| 12 | `src/components/InvoiceAskDialog.tsx` | számlázás kérdező | Nem (Számlázz) |
| 13 | `src/components/InvoicePreviewDialog.tsx` | számla előnézet | Nem |
| 14 | `src/components/UninvoicedExchangesCard.tsx` | számlázatlan cserék UI | Nem (Számlázz/csere) |
| 15 | `src/components/UninvoicedRentalFeesCard.tsx` | bérlet gáz+díj emlékeztető | Nem (külön task) |
| 16 | `src/integrations/supabase/types.ts` | típus bővítés (pl. rental fee) | Részben / nem SZL |
| 17 | `src/lib/adr/physical.ts` | L/kg parse | **Igen** |
| 18 | `src/lib/adr/types-and-calc.ts` | ADR 1.1.3.6 motor | **Igen** |
| 19 | `src/lib/api/szamlazz.functions.ts` | Számlázz client | Nem |
| 20 | `src/lib/dashboard-stats.ts` | éves havi profit lebontás | Nem (külön task) |
| 21 | `src/lib/delivery-notes/ops.ts` | SZL create/finalize | **Igen** |
| 22 | `src/lib/delivery-notes/pdf.ts` | SZL PDF | **Igen** |
| 23 | `src/lib/delivery-notes/types.ts` | SZL típusok | **Igen** |
| 24 | `src/lib/invoice-drafts.ts` | számla draft | Nem |
| 25 | `src/lib/rental-contract-pdf.ts` | bérleti szerződés PDF fix | Nem |
| 26 | `src/lib/rental-ops.ts` | `initial_fee_invoiced` | Nem |
| 27 | `src/lib/szamlazz/address.ts` | Számlázz cím | Nem |
| 28 | `src/lib/szamlazz/agent.server.ts` | Agent server | Nem |
| 29 | `src/lib/szamlazz/setup.ts` | setup | Nem |
| 30 | `src/lib/szamlazz/xml.ts` | XML | Nem |
| 31 | `src/routeTree.gen.ts` | route gen (+ delivery-notes) | **Igen** (rész) |
| 32 | `src/routes/.../dashboard.tsx` | éves nyereség dialog | Nem (külön) |
| 33 | `src/routes/.../delivery-notes.tsx` | SZL menü | **Igen** |
| 34 | `src/routes/.../more.tsx` | menü link | **Igen** |
| 35 | `src/routes/.../organization-settings.tsx` | Számlázz beállítás UI | Nem |
| 36 | `src/routes/.../quick-exchange.tsx` | invoice + SZL ask | **Részben** |
| 37 | `src/routes/.../rentals.$id.tsx` | bérlet UI apró | Nem |
| 38 | `src/routes/.../rentals.index.tsx` | bérlet lista | Nem |
| 39 | `src/routes/.../suppliers.tsx` | SZL gomb előzményben | **Igen** |
| 40 | `supabase/functions/szamlazz-create-invoice/index.ts` | Edge Function | Nem |
| 41 | `.../20260922120000_szamlazz_invoicing.sql` | Számlázz migráció | Nem |
| 42 | `.../20260923100000_exchange_outgoing_correction.sql` | csere korrekció | Nem |
| 43 | `.../20260923120000_delivery_notes_adr.sql` | ADR/SZL séma | **Igen** |

### Külön vizsgált nem-SZL változások

| Terület | Állapot a commitban | Production apply hatása |
|---------|---------------------|-------------------------|
| Éves nyereség havi lebontás | `fetchYearlyMonthlyProfitBreakdown` + dashboard dialog | Csak frontend; DB nem kell |
| Bérlet emlékeztető (gáz+díj) | `UninvoicedRentalFeesCard` + `initial_fee_invoiced` | függhet korábbi rental migrációtól |
| Kamera/scanner permission | `BarcodeScanner` HU NotAllowedError | Csak frontend |
| Számlázz / invoice | nagy blokk + edge + migráció | **külön apply kockázat** |
| Csere outgoing correction | dialog + migráció | Prod-on már van `20260923070752_exchange_outgoing_correction_v2` — **repo fájlnév eltér** |

**Következtetés:** a `1120396` **nem tiszta SZL-PR**. Production SZL apply előtt érdemes csak a SZL/ADR fájlokra szűkített diffet / migrációt kezelni.

---

## 2. MIGRÁCIÓ STATIKUS AUDIT

Fájl: `20260923120000_delivery_notes_adr.sql`

| Ellenőrzés | Eredmény |
|------------|----------|
| Idempotencia | **Részben OK** — `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS`, seed `WHERE NOT EXISTS` |
| Táblaütközés prod | **OK** — prod-on `to_regclass(...)` = **NULL** mindhárom táblára |
| FK | OK → `organizations`, `partners`, `suppliers`, `cylinders`, `auth.users` |
| Unique | partial unique `(organization_id, document_number) WHERE document_number IS NOT NULL` |
| Index | items: `delivery_note_id` |
| NOT NULL / default | status default `draft`; ruleset `ADR-2025`; journey_meta `{}` |
| CHECK | status/source/line_role/cylinder_state/quantity_basis/transport_category |
| Trigger | **nincs** (finalized immutability hiányzik) |
| Function | `next_delivery_note_number` SECURITY DEFINER, `search_path=public` |
| Grants function | REVOKE PUBLIC; GRANT authenticated — OK |
| Table GRANT | **nincs explicit** — Supabase default privilege-re támaszkodik |
| UPDATE/DELETE meglévő adat | **nincs** — csak új objektumok + seed INSERT |
| Lock / hosszú DDL | **Alacsony** — empty CREATE TABLE/INDEX, nincs rewrite |
| UNIQUE NULL org | `UNIQUE (organization_id, gas_type_key, ruleset_version)` — Postgresban **több NULL org_id** sor ugyanazzal a key-jel **lehetséges** (NULL ≠ NULL) |

---

## 3. RLS AUDIT

Policy-k a migrációból (statikus + kód audit; élő RLS teszt tábla hiányában nem futtatható prod-on).

### `adr_product_master`

| Szereplő | SELECT | INSERT/UPDATE/DELETE |
|----------|--------|-------------------|
| Own org authenticated | OK (`same_org` **vagy** `organization_id IS NULL` globális) | Write: csak `is_admin()` + same_org **vagy NULL** |
| Más org | SELECT tiltott saját org sorokra | tiltott |
| Anon | Nincs policy → RLS deny | deny |
| **Probléma** | Globális (`organization_id IS NULL`) seed **minden authenticated** olvashatja — szándékos | **HIGH:** bármely org `is_admin()` **írhatja a globális ADR törzset** (`organization_id IS NULL` ág) |

### `delivery_notes` / `delivery_note_items`

| Követelmény | Eredmény |
|-------------|----------|
| Own org SELECT | OK `same_org` |
| Create/modify | `can_exchange() AND same_org` |
| Más org CRUD | Policy szerint tiltott |
| Anon | Nincs policy → deny |
| **CRITICAL** | `FOR ALL` write **nem korlátoz status-ra** → **finalized / void sor UPDATE+DELETE is engedett** authenticated `can_exchange` usernek |
| Service role | bypass RLS (szokásos) — ne keverendő klienssel |

**Bizonyítás hiány:** élő impersonation/RLS smoke a táblák hiányában productionön **nem futtatható**. Staging apply után kötelező.

---

## 4. DELIVERY NOTE NUMBER AUDIT

Formátum: `SZL-YYYY-000001` — a függvény **szerver oldali** (`next_delivery_note_number`), **nem** csak kliens — ez jó.

| Követelmény | Eredmény |
|-------------|----------|
| DB UNIQUE | van partial unique index |
| Org-scoped számozás | `WHERE organization_id = p_organization_id` — tervezett |
| Void sorszám újrafelhasználás | MAX tartalmazza a meglévő számokat → **üres hely nem kerül újra kiosztásra** (jó a „nem újrafelhasználható” felé) |
| Concurrent | **CRITICAL** — `MAX()+1` **advisory lock / FOR UPDATE / sequence nélkül**. Race: két párhuzamos finalize ugyanazt a számot kaphatja; az egyik UNIQUE-on elbukhat, a másik „győz”. Nincs atomi `INSERT … RETURNING` sorszám foglalás. |
| finalize + RPC szétválasztás | Kliens: RPC → szám → külön UPDATE. Nem egy tranzakcióban foglal. |

---

## 5. SNAPSHOT AUDIT

| Elem | Eredmény |
|------|----------|
| `adr_snapshot` / `business_snapshot` / `pdf_base64` mentés finalize-kor | Igen (`ops.finalizeDeliveryNote`) |
| Finalize ADR forrás | **Élő** `adr_product_master` / fallback seed + item sorok (`buildAdrForItems` → `resolveAdrProduct`) |
| Későbbi master változás a tárolt PDF-et | `pdf_base64` megmarad **ha nem UPDATE-elik** |
| Snapshotból újragyártás | **Nincs** dedikált „PDF csak snapshotból” API; lista nem tölti vissza a PDF-et snapshotból konzisztensen |
| **HIGH** | Nincs DB trigger / policy, ami megtiltja a finalized `adr_snapshot` / `pdf_base64` / `document_number` módosítását |
| **MEDIUM** | Draft→finalize között a master változása befolyásolja a végleges ADR szöveget (item fizikai mezők mentve, ADR törzs élő) |

---

## 6. FINALIZATION / ÉLETCIKLUS AUDIT

| Követelmény | Eredmény |
|-------------|----------|
| DRAFT | van (`draft`) |
| FINALIZED | van (`finalized`) |
| CANCELLED | **Nincs** ilyen státusz — helyette CHECK: `void` |
| Void/storno ops/UI | **Nincs implementálva** |
| Finalized immutability | **CRITICAL FAIL** — RLS engedi UPDATE/DELETE; nincs trigger |
| Sorszám finalized után | kliens oldalon nem védve DB-szinten status alapján |
| Soft-cancel helyett delete | CASCADE DELETE items + engedélyezett DELETE → **adatvesztés lehetséges** |

---

## 7. ADR CALCULATOR AUDIT

`npm run test:adr` → **9/9 PASS** (2026-09-23 újrafuttatva).

| Szabály | Bizonyíték |
|---------|------------|
| Sűrített → `water_capacity_l` | O2 tesztek 1,2,6,8 |
| Cseppfolyós → `net_mass_kg` | CO2 / PB tesztek 4,5 |
| Cat 2 ×3 | PB fixture |
| Cat 3 ×1 | O2 |
| EMPTY_UNCLEANED → cat4 / 0 pont | tesztek 2,3 |
| EMPTY_CLEAN kimarad | teszt 7 |
| PARTIAL = FULL ADR | teszt 8 |
| Kevert összeg | teszt 6 = 845 |
| ≤1000 határon belül | 975; **exact 1000:** audit script `20×50=1000` → within=true |
| >1000 figyelmeztetés | 1012.5 / 1000.5 |
| Float | **MEDIUM:** `2000/3/11.5` jellegű szorzat → `1999.9999999999998` (audit harness). Egész db×kg tesztek OK. |

---

## 8. UNVERIFIED ADR MASTER

| Követelmény | Eredmény |
|-------------|----------|
| `verified=false` → blocking warning | teszt 9 PASS; Stargon stub `verified:false` |
| Üzleti SZL készülhet | Igen — finalize **nem blokkol** warningra; `adrReady=false` toast |
| „Hiteles ADR” állítás | PDF: figyelmeztető sor, ha `!adrReady` |
| Stargon/PB kitalálás | Stargon stub UN 1956 + `verified=false`; PB nincs auto-verified seed a migrációban |

---

## 9. PDF AUDIT

Generált minták: `docs/delivery-notes/pdf-samples/` (+ `scripts/delivery-note-pdf-audit.mjs`)

| Minta | Pont | Oldal | Megjegyzés |
|-------|------|-------|------------|
| A 3 teli + 3 üres O2 | 150 | 1 | `ÜRES TARTÁLY, 2` OK |
| B csak üres | 0 | 1 | OK |
| C kevert O2+PB | 845 | 1 | OK |
| D <1000 | 845 | 1 | OK |
| E >1000 | 1350 | 1 | túllépés szöveg OK |
| F sok barcode | 0 | 1 | üzleti aggregáció miatt **nem** váltott több oldalra |

| Követelmény | Eredmény |
|-------------|----------|
| Magyar ékezet | **HIGH/MEDIUM:** `pdfSafe()` **levágja** az ékezeteket (Helvetica WinAnsi) — cím: `SZALLITOLEVEL` |
| A4 | 595×842 OK |
| Többoldalas | kód van (`ensure`/`drawHeader` folytatás); **mintában nem igazolva** |
| Sorszám header/footer | van |
| ADR blokk / aláírás | van |
| Levágott szöveg | word-wrap van; hosszú sorok részben védettek |

---

## 10. BUILD ÉS TEST

| Parancs | Eredmény |
|---------|----------|
| `npm run test:adr` | **PASS** 9/9 |
| `npm test` | **PASS** 80/80 |
| `npm run build` | **PASS** |
| `npm run lint` | **NEM ZÁRULT** ésszerű időn belül (eslint futás elakadt / túl hosszú) → auditban **PARTIAL** |
| Typecheck külön | nincs dedikált script a `package.json`-ban |

---

## 11. PRODUCTION PRECHECK (READ-ONLY)

Projekt URL: `https://snmiwsgtnokvqlnwvfwf.supabase.co` — egyezik a kötelező ID-vel.

| Ellenőrzés | Eredmény |
|------------|----------|
| `adr_product_master` / `delivery_notes` / `delivery_note_items` | **nem léteznek** |
| `next_delivery_note_number` | **nem létezik** |
| Migrations history tartalmaz `20260923120000` | **NEM** |
| Helpers (`same_org`, `can_exchange`, `auth_organization_id`, `is_admin`, `gen_random_uuid`) | **léteznek** |
| Extension | `pgcrypto` / `gen_random_uuid` OK |
| History figyelmeztetés | Prod: `20260923070752_exchange_outgoing_correction_v2`; repo: `20260923100000_exchange_outgoing_correction.sql` — **név/verzió eltérés**. Számlázz: prod `20260922102615_…`, repo `20260922120000_…`. |

**Semmilyen DDL/DML nem futott.**

---

## 12. HIBALISTA (severity nélkül)

### CRITICAL

1. **Finalized dokumentum RLS szerint továbbra is UPDATE/DELETE-elhető** (`FOR ALL` + nincs status guard / immutability trigger).
2. **Sorszám race:** `MAX()+1` nem konkurencia-biztos; nincs atomi foglalás.
3. **Finalize UPDATE 0 sor** esetén a kliens sikernek veheti (nincs `count` ellenőrzés) — race/stale draft.

### HIGH

4. Globális `adr_product_master` (`organization_id IS NULL`) **bármely org admin által írható**.
5. Nincs **CANCELLED/void storno workflow** (csak CHECK `void`, ops/UI hiány).
6. Snapshot/PDF **nincs DB-szintű immutability**; későbbi master/partner változtatás ellen csak „konvenció”.
7. PDF **nem ékezethelyes** (`pdfSafe` strip).
8. Commit **scope-keverés** — production SZL apply nem „tiszta” diff.

### MEDIUM

9. UNIQUE `(organization_id, …)` NULL org_id mellett gyenge.
10. Float pontszám szélsőérték (nem egész kg/db).
11. Többoldalas PDF mintában nem bizonyított.
12. `delivery_notes` típusok nincsenek a generált `Database` types-ban (`any` cast).
13. Lint nem zárult le az audit időablakában.
14. Repo vs prod migration history eltérések (correction / szamlazz fájlnevek).

### LOW

15. `pdf_base64` DB-ben nagy payload.
16. Státusz név `void` vs követelmény `CANCELLED` elnevezés.
17. F-multipage minta aggregáció miatt 1 oldal.

---

## Production migráció várható hatása

- **Új üres táblák + seed (8 ADR sor) + 1 function + RLS policy-k.**
- Meglévő üzleti táblák **nem** UPDATE/DELETE.
- **Downtime:** várhatóan **nincs** (rövid ACCESS EXCLUSIVE CREATE TABLE üres relációkon, tipikusan ms–s).
- **Lock kockázat:** **alacsony**, ha nincs konkurens hosszú tranzakció ugyanarra a DDL-re.
- **Rollback:** `DROP TABLE … CASCADE` + `DROP FUNCTION next_delivery_note_number` (adatvesztés az új táblákon). Előtte backup ajánlott.
- **Backup szükséglet:** igen — standard pre-migration snapshot (Supabase PITR / dump), még üres táblák esetén is.

### Apply eljárás (NE FUTTASD most)

1. Backup / PITR pont.
2. Győződj meg: project ref = `snmiwsgtnokvqlnwvfwf`.
3. **Csak** ezt a fájlt alkalmazd (ne vakon az egész 1120396 migráció-köteget):

```bash
# példa – NE futtasd ebben az audit körben
supabase db push --include-all
# vagy célzottan MCP/CLI-lel kizárólag:
# 20260923120000_delivery_notes_adr.sql
```

4. Azonnali audit: `to_regclass`, policy lista, `pg_get_functiondef('next_delivery_note_number')`, seed COUNT.
5. Auth sessionnel RLS smoke (own org / other org / anon).
6. **Előbb javítsd a CRITICAL/HIGH pontokat** (immutability trigger, sorszám lock, void storno, globális ADR write szűkítés) — majd újra PRE-PRODUCTION audit.

---

## Mellékletek

- PDF minták: `docs/delivery-notes/pdf-samples/*.pdf`
- PDF harness: `scripts/delivery-note-pdf-audit.mjs`
