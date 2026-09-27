# Delivery-note / ADR — PRODUCTION APPLY REPORT

**Dátum:** 2026-09-27  
**Final verdict:** **PRODUCTION ISSUE** (PRE STOP — apply nem indult)

---

## 1. PRE

| Mező | Érték |
|------|--------|
| Branch | `main` |
| HEAD | `1758542` (`docs: record live DB validation commit hash and push`) |
| origin/main | `1758542` (szinkron) |
| bf452a3 ős HEAD-ben | igen |
| Working tree | **DIRTY** → szabály szerint **STOP** |

### Dirty tartalom (nem delivery-note)

- Untracked / modified: többcéges onboarding + EQUIPMENT_SALES (migrációk, Edge, UI, docs, `package.json`, `routeTree.gen.ts`, …)
- PDF sample binárisok (`docs/delivery-notes/pdf-samples-v2/*`)
- `docs/delivery-notes/ETAP_CLOSED.md` (untracked)

A többcéges munka **nincs commitolva / nincs origin/main-en**. Owner workként megmarad; **nem reverteltük**, **nem töröltük**, **nem módosítottuk** ebben a körben.

---

## 2. Production target

| Mező | Érték |
|------|--------|
| Project ref | **`snmiwsgtnokvqlnwvfwf`** |
| Név | GazVeled |
| MCP URL | `https://snmiwsgtnokvqlnwvfwf.supabase.co` |
| Status | ACTIVE_HEALTHY |
| ≠ validation | `wexzoclifwibdqxaowzf` (INACTIVE) |

---

## 3. Backup

**NOT EXECUTED** — PRE STOP miatt migration előtti backup lépéshez nem jutottunk.

Apply előtt kötelező bizonyítható backup (időpont, mód, azonosító, restore path).

---

## 4. Pending migration audit

### Production history (utolsó releváns)

- Utolsó known version a listában: `20260923070752` / `exchange_outgoing_correction_v2`
- `20260923%` / `24%` / `25%` / `27%` delivery / multi-company: **csak** a fenti v2 sor — **nincs** delivery-note version

### Delivery-note objektumok productionön (részleges apply?)

| Objektum | Állapot |
|----------|---------|
| `adr_product_master` | **nincs** (`null`) |
| `delivery_notes` | **nincs** |
| `delivery_note_items` | **nincs** |
| `delivery_note_sequences` | **nincs** |
| `finalize_delivery_note` | **nincs** |
| `cancel_delivery_note` | **nincs** |

→ **Nincs részleges delivery-note apply.** (Ez PASS a „ne legyen félkész séma” ellenőrzésre.)

### Git-tracked pending (origin/main vs prod)

| Version / fájl | Scope | Megjegyzés |
|----------------|-------|------------|
| `20260923100000_exchange_outgoing_correction.sql` | **UNRELATED** (csere korrekció / bérleti emlékeztető) | Prod-on már van `exchange_outgoing_correction_v2` **más version stamp**-pel (`20260923070752`). Teljes `db push` ezt is újra akarná futtatni. |
| `20260923120000_delivery_notes_adr.sql` | **DELIVERY / ADR** | Validált stack része |
| `20260923140000_delivery_notes_hardening.sql` | **DELIVERY** | Validált |
| `20260924120000_delivery_notes_server_side_finalize.sql` | **DELIVERY** (`bf452a3`) | Validált |
| `20260925120000_delivery_notes_bypass_hardening.sql` | **DELIVERY** (bypass) | Validált |

### Untracked (working tree only — NEM origin/main)

| Fájl | Scope |
|------|--------|
| `20260927120000_multi_company_onboarding_modules.sql` | onboarding / modules |
| `20260927120100_multi_company_provision_rpcs.sql` | onboarding / invite |
| `20260927120200_equipment_sales_shared_stock.sql` | EQUIPMENT_SALES / SHARED |

Ezek **nem** production pending a remote history szerint, de **ebben a dirty workspace-ben** egy vak `supabase db push` / CLI apply **besodorhatná** őket → **TILOS**.

### Scope döntés

**STOP:** ne futtassunk bulk apply-t, amíg:

1. working tree clean (többcéges fájlok stash/külön branch, nem törölve);
2. az `exchange_outgoing_correction` (`20260923100000`) vs prod `…_v2` conflict/skip stratégia nincs rögzítve;
3. delivery-note négyes **külön**, kontrollált apply (nem full pending dump).

Delivery-note négyes **önmagában** alkalmazható lenne (nincs DN objektum prod-on; nincs DN↔multi-company SQL függőség a négyesben). A blokkoló: dirty tree + unrelated pending stamp + backup hiánya.

---

## 5. Alkalmazott migrationök

**Egyik sem.** Apply nem indult.

## 6. Apply eredmény

**NOT EXECUTED**

## 7–11. DB / RLS / RPC / immutability / ADR master

**NOT EXECUTED** (apply előtt STOP).

ADR megjegyzés (következő apply-re): PB / Stargon C18 `verified=false` **maradjon** — ne állítsuk `true`-ra.

## 12. Deploy commit

| | |
|--|--|
| Production app cél | delivery-note kompatibilis kód = **`origin/main` @ `1758542`** (már tartalmazza `bf452a3` + bypass) |
| Többcéges a deployban? | **Nem** — nincs a remote main-en |
| Deploy ebben a körben | **NOT EXECUTED** |

Ha később a többcéges kódot commitolnák mainre DN apply előtt: frontend schema nélkül mehetne productionre → **tiilos** schema nélküli DN-független modul deploy; DN UI már a `1758542`-n van.

## 13–15. UI / PDF / log smoke

**NOT EXECUTED**

## 16. Remaining issues

1. Working tree dirty (többcéges uncommitted + PDF zaj).
2. Pending unrelated `20260923100000_exchange_outgoing_correction.sql` vs prod `v2` version mismatch.
3. Backup még nincs.
4. Apply / smoke / deploy várakozik clean PRE-re.

## 17. Rollback readiness

Nincs új production változás → rollback nem releváns. Apply előtt: backup + egyenkénti DN migráció + history repair szükség esetén az exchange stamp-re.

## 18. Final verdict

# PRODUCTION ISSUE

**Ok:** PRE STOP — dirty working tree; migration scope nem tiszta bulk push-hoz; backup / apply / smoke nem futott.

**Delivery-note séma productionön:** még nincs (tiszta indulás lehetséges a négyes DN migrációval, ha a fenti blokkolók feloldva).

**Többcéges fejlesztés:** meglévő local work — **megtartva**, nem része ennek az élesítésnek.

---

## Következő lépések (külön jóváhagyással)

1. Többcéges változások stash / feature branch (ne törölni).
2. Clean tree a `1758542` / origin/main alapján.
3. Bizonyítható production backup.
4. `exchange_outgoing_correction` stamp stratégia (skip/repair) rögzítése.
5. Csak a 4 DN migráció kontrollált apply.
6. DB post-check + UI smoke (DRAFT only; FINALIZED TILOS).
7. Onboarding/module/EQUIPMENT implementáció / prod: **külön** jóváhagyás.

**DELIVERY NOTE ETAP — production apply még nincs lezárva; implementációra vár a külön jóváhagyott folytatás (előbb DN prod apply).**
