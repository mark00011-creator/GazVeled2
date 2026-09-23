# SECOND PRE-PRODUCTION AUDIT — `0f450af`

**Dátum:** 2026-09-23  
**Auditor mód:** független, bizonyítás-only (nincs fix / feature / refactor)  
**Hardening commit:** `0f450af29c42cb5740229f5d4c326901e239c54b`  
**Előző blokkoló audit doksi:** `docs/delivery-notes/PRE_PRODUCTION_AUDIT_1120396.md` (`606a811`)  
**Production projekt:** `snmiwsgtnokvqlnwvfwf` (`https://snmiwsgtnokvqlnwvfwf.supabase.co`)  
**Production apply ebben a körben:** **TILOS / NEM FUTTATVA**

---

## FINAL VERDICT

# **NOT READY**

A hardening **statikusan** kijavítja a `606a811` CRITICAL immutability / MAX+1 / FOR ALL RLS / globális ADR write problémák nagy részét a kódban és a corrective migrációban.  
**Production apply READY kritériumai azonban nem teljesülnek**, mert:

1. **Élő DB bizonyíték hiányzik** (nincs local Docker / működő Supabase CLI ezen a gépen) → 50-párhuzamos finalize, transaction rollback, cross-org RLS, immutability trigger smoke, fresh migration install **nem futtatható**.
2. **HIGH trust-boundary:** a `finalize_delivery_note` RPC a kliens által küldött ADR/business snapshotot és pontszámot **vakon elfogadja** (nincs szerveroldali újraszámítás / hitelesítés).

---

## 1. PRE

| Mező | Érték |
|------|--------|
| Branch | `main` |
| HEAD | `0f450af29c42cb5740229f5d4c326901e239c54b` |
| Working tree | clean (audit doksi commit előtt) |
| Delivery-note migrációk (repo) | `20260923120000_delivery_notes_adr.sql`, `20260923140000_delivery_notes_hardening.sql` |
| Local/test applied migrations | **Nincs** — Docker nincs, `supabase` CLI crash (`Illegal instruction`), fresh local DB nem indítható |
| Production migration state | delivery note objektumok **hiányoznak** (lásd §2) |

---

## 2. Production migration state (READ-ONLY)

`execute_sql` @ `snmiwsgtnokvqlnwvfwf`:

| Objektum | Eredmény |
|----------|----------|
| `public.adr_product_master` | **NULL** |
| `public.delivery_notes` | **NULL** |
| `public.delivery_note_items` | **NULL** |
| `public.delivery_note_sequences` | **NULL** |
| `finalize_delivery_note(...)` | **NULL** |
| `cancel_delivery_note(...)` | **NULL** |
| `allocate_delivery_note_number(...)` | **NULL** |
| schema_migrations `2026092312%` / `2026092314%` / delivery\|adr | **nincs találat** |

**Bizonyíték:** productionön a delivery-note migráció **továbbra sincs alkalmazva**.

---

## 3. Critical retest (606a811 → 0f450af)

### A. FINALIZED immutability

| Ellenőrzés | Statikus (kód/SQL) | Élő DB |
|------------|-------------------|--------|
| FINALIZED UPDATE tiltás | **PASS design** — `trg_delivery_notes_immutability` + RLS UPDATE csak `status='draft'` | **NEM FUTTATVA** (nincs test DB) |
| FINALIZED DELETE | **PASS design** — trigger: csak draft DELETE | **NEM FUTTATVA** |
| Item UPDATE/DELETE finalized parentnél | **PASS design** — `trg_delivery_note_items_immutability` | **NEM FUTTATVA** |
| Bizonylatszám / snapshot módosítás | **PASS design** — trigger tiltja drafton kívül / bypass szűk | **NEM FUTTATVA** |

**Következtetés:** a korábbi CRITICAL „FOR ALL finalized szerkeszthető” **kijavítva a migráció szövegében**, de **DB-szintű FAIL-próba bizonyíték hiányzik** → READY-kritérium szerint **nem zárható PASS**.

### B. Concurrent numbering

| Ellenőrzés | Eredmény |
|------------|----------|
| Nincs aktív `MAX()+1` a hardening allocatorban | **PASS** — `delivery_note_sequences` UPSERT `last_number + 1` (`allocate_delivery_note_number`) |
| Régi `MAX()+1` a **120000** migrációban még benne van | **Dokumentált** — `20260923120000` L114; a **140000** felülírja `next_delivery_note_number`-t allocatorra. **Mindkét migráció kell.** |
| 50 párhuzamos finalize | **NEM FUTTATVA** (nincs DB) |
| Unit szimuláció 20 | hardening test PASS (nem helyettesíti a 50-ös DB tesztet) |
| Két org scope | **Statikus PASS** (PK `(organization_id, year)`); élő **NEM FUTTATVA** |
| UNIQUE `(organization_id, document_number)` | **PASS** partial unique index a migrációban |

### C. Zero-row finalize

Statikus RPC ellenőrzés (`finalize_delivery_note`):

- missing id → RAISE  
- org mismatch → 42501  
- already finalized / cancelled / non-draft → RAISE  
- `ROW_COUNT != 1` → RAISE  

Frontend (`ops.finalizeDeliveryNote`): siker csak ha `rpcData.document_number` és `status === 'finalized'`.

**Élő próba:** **NEM FUTTATVA**.

---

## 4. Concurrency 50-run eredmény

**NEM FUTTATHATÓ** ezen a környezeten.

- Docker: nincs  
- Supabase CLI: abort (`Illegal instruction`)  
- Production: apply tilos + táblák nincsenek  

→ **READY blokkoló hiányzó bizonyíték.**

---

## 5. Transaction rollback teszt

**Statikus elemzés:** `allocate` + finalize UPDATE **egy** `SECURITY DEFINER` függvényben, egy Postgres tranzakcióban. RAISE esetén a sequence UPSERT is rollbackel.

**Ügyfél oldali rés** (nem DB fél-FINALIZED, de dokumentálandó):

1. RPC finalize siker (szám kiosztva, status FINALIZED)  
2. kliens PDF generál  
3. `attach_delivery_note_pdf`  

Ha 2–3 elbukik: dokumentum FINALIZED **PDF nélkül** (szám elfogyott). Ez nem „félig FINALIZED status”, de **részleges üzleti állapot**.

**Élő mid-finalize failure injection:** **NEM FUTTATVA**.

---

## 6. Lifecycle

| Átmenet | Design | Élő |
|---------|--------|-----|
| DRAFT → FINALIZED | PASS (finalize RPC) | N/A |
| DRAFT → CANCELLED | **FAIL tervezetten** (cancel csak finalized) | N/A |
| FINALIZED → CANCELLED | PASS (cancel RPC) | N/A |
| FINALIZED → DRAFT | FAIL (trigger) | N/A |
| CANCELLED → DRAFT/FINALIZED | FAIL | N/A |
| FINALIZED → FINALIZED | FAIL | N/A |
| DELETE finalized/cancelled | FAIL | N/A |

Élő DB lifecycle: **NEM FUTTATVA**.

---

## 7. Cancel workflow

Statikus PASS elemek:

- `cancellation_reason` kötelező (RPC + CHECK)  
- `cancelled_at` / `cancelled_by` kitöltés  
- sorszám / snapshot megőrzés (trigger tiltja snapshot/szám változást cancelnél)  
- új sorszám nincs  
- PDF „ÉRVÉNYTELENÍTVE” generálás kliensen snapshotból (`pdf.ts` + hardening PDF minta)

Élő cancel RPC: **NEM FUTTATVA**.  
PDF minta: `docs/delivery-notes/pdf-samples-v2/cancelled.pdf` (~19.7 KB, embedded font méret).

---

## 8. ADR master RLS

Statikus:

- SELECT authenticated: `organization_id IS NULL OR same_org`  
- **Nincs** INSERT/UPDATE/DELETE policy authenticated felé → RLS deny  
- Org admin write: **tiltott design szerint**

Élő anon / org user / org admin mátrix: **NEM FUTTATVA**.

---

## 9. Cross-org RLS

Statikus: `same_org` a note/item policy-kban; finalize/cancel org check.

Élő ORG_A / ORG_B API próba: **NEM FUTTATVA** → READY blokkoló.

---

## 10. Snapshot integrity

Statikus:

- Finalize után PDF: `generateDeliveryNotePdfFromSnapshots`  
- Unit teszt: live product mutate után snapshot `properShippingNameHu` változatlan (`delivery-note-hardening.test.mjs`)

Élő partner/master UPDATE után PDF újragenerálás: **NEM FUTTATVA** (nincs DB).

---

## 11. ADR calculation

`npm run test:adr` → **9/9 PASS** (újrafuttatva ebben az auditban).

Float/threshold probe (`scripts/second-audit-probe.mjs`):

| Case | total | within |
|------|-------|--------|
| 999.999 | 999.999 | true |
| 1000 exact (20×50) | 1000 | true |
| 1000.001 | 1000.001 | false |
| 29×11.5×3 | 1000.5 | false |

`<= 1000` küszöb viselkedés helyes ezeken a mintákon.  
**MEDIUM (ismert):** szélső lebegőpontos szorzatok elméletileg továbbra is kockázatosak (nem jelent meg a fenti esetekben).

---

## 12. Unverified products

- Stargon: stub `verified=false`, warning path tesztelve (ADR #9 + hardening).  
- PB: nincs verified seed; `gasTypeToAdrKey` → `"pb"`; fallback **nem talál ki UN-t** (üres unverified product) ha nincs master sor.  
- **MEDIUM:** név alapú kulcs-heuristika (`physical.ts` `gasTypeToAdrKey`) téves kulcsra mapelhet — nem UN-kitalálás, de rossz master lookup.

---

## 13. PDF eredmények

| Minta | Oldal | Méret | Megjegyzés |
|-------|-------|-------|------------|
| v2 cancelled / draft / finalized accents | 1 | ~19–20 KB | post-Noto (régi Helvetica minták ~2 KB) |
| v2 multipage-20plus | **2** | ~21 KB | oldaltörés bizonyított |
| v1 A–F (1120396 kori) | 1 | ~2 KB | **elavult** Helvetica/strip korszak — ne használd readiness bizonyítéknak |

Font fájlok: `public/fonts/NotoSans-Regular.ttf` / `Bold` jelen vannak (~569 KB).  
Build tartalmazza `pdf-lib__fontkit` (~1.1 MB chunk).  
String „Noto” nem mindig látszik subset streamben (`notoHint=false`) — **méret + fontkit + unit tesztek** az elsődleges bizonyíték.

Új 10-es vizuális checklist teljes élő regenerálása ebben a körben: részben (v2 minták + unit), nem teljes manuális nyomtatási audit.

---

## 14. Migration fresh-install test

**FAIL / NEM FUTTATHATÓ** — nincs local Postgres/Docker.

Statikus ordering:

1. `20260923120000` — base tables + régi MAX+1 + gyenge RLS  
2. `20260923140000` — sequences, triggers, RPCs, RLS rewrite, status cancelled  

**Kockázat:** ha valaki **csak** a 120000-t apply-olja productionre, a régi CRITICAL-ök visszatérnek. Apply eljárásnak **mindkettőt** kell tartalmaznia.

Repo vs prod history: delivery migrációk prod-on nincsenek; egyéb (szamlazz/correction) név-eltérések továbbra is fennállnak a tágabb repóban (scope kívül).

---

## 15. SECURITY DEFINER / search_path

| Function | search_path=public | EXECUTE |
|----------|-------------------|---------|
| `allocate_delivery_note_number` | yes | **nincs** GRANT authenticated (csak belső) |
| `next_delivery_note_number` | yes | REVOKE ALL (120000 GRANT-ot 140000 visszavon) |
| `finalize_delivery_note` | yes | authenticated |
| `cancel_delivery_note` | yes | authenticated |
| `attach_delivery_note_pdf` | yes | authenticated |
| immutability triggers | yes | — |

Org spoofing: finalize a note `organization_id`-jét használja allocationhoz + `auth_organization_id` check.  
Bypass: `set_config('app.delivery_note_bypass','1', true)` csak definer függvényekben.

**LOW:** `is_platform_admin()` átlépheti az org checket (szándékos platform képesség).

---

## 16. Client trust-boundary audit

| Adat | Ki állítja | Értékelés |
|------|------------|-----------|
| document_number | szerver allocate | PASS |
| finalized_at / finalized_by | szerver `now()` / `auth.uid()` | PASS |
| cancelled_at / cancelled_by | szerver | PASS |
| **adr_snapshot** | **kliens param** `p_adr_snapshot` | **HIGH FAIL** |
| **business_snapshot** | **kliens** `p_business_snapshot` | **HIGH FAIL** |
| **adr_total_points / adr_within_116** | **kliens** | **HIGH FAIL** |
| pdf_base64 | kliens attach (egyszer, finalized) | MEDIUM (tartalom nem validált) |

**Fájl:** `supabase/migrations/20260923140000_delivery_notes_hardening.sql` — `finalize_delivery_note` ~L326–390  
**Fájl:** `src/lib/delivery-notes/ops.ts` — `finalizeDeliveryNote` RPC hívás ~L280–286  

**Reprodukció (koncepcionális):** authenticated `can_exchange` user RPC-t hív hamis `p_adr_snapshot` / csökkentett `p_adr_total_points` értékkel → DB elfogadja, PDF a hamis snapshotból készül.  
**Következtetés:** jogi/ADR hitelesség kliens-kompromittálható.

---

## 17. Regression

| Suite | Eredmény (2026-09-23 audit) |
|-------|------------------------------|
| ADR | **9/9 PASS** |
| hardening | **8/8 PASS** |
| `npm test` | **80/80 PASS** |
| `npm run build` | **PASS** |
| typecheck | **nincs** dedikált script |
| lint | **nem futtatva** (korábbi hang / idő) → PARTIAL |

---

## 18. Scope audit (`0f450af`)

A commit **delivery-note / ADR / PDF / migráció / font** scope-ban van.

**Nem** módosít Számlázz / bérlet / scanner / éves nyereség / OCR / csere-korrekció fájlokat.

(A korábbi `1120396` scope-keverés a history-ban megmarad — ebben a körben nem revertelve.)

---

## 19. Remaining findings

### CRITICAL

1. **Hiányzó élő DB bizonyíték a READY kapuhoz**  
   - Concurrency 50, transaction injection, cross-org RLS, immutability smoke, fresh migration install **nem bizonyított**.  
   - Környezet: nincs Docker; Supabase CLI nem fut.  
   - **Következmény:** production apply előtt a kötelező bizonyítékok hiányoznak → **NOT READY**.

### HIGH

2. **Finalize RPC elfogadja a kliens ADR/business snapshotját és pontszámát**  
   - `20260923140000_delivery_notes_hardening.sql` `finalize_delivery_note`  
   - `src/lib/delivery-notes/ops.ts`  
   - **Következmény:** hamis ADR megfelelőség / pontszám rögzíthető.

3. **Élő cross-org / ADR-master role mátrix nincs lefuttatva**  
   - Design OK, bizonyíték hiány → security gate incomplete.

### MEDIUM

4. Régi `MAX()+1` kód a 120000 migrációban megmarad (140000 felülírja — mindkettő kötelező apply).  
5. Finalize után PDF attach külön lépés → FINALIZED PDF nélkül lehetséges.  
6. `gasTypeToAdrKey` név-heuristika.  
7. v1 PDF minták elavultak (Helvetica).  
8. Lint/typecheck nincs lezárva.

### LOW

9. Platform admin org-bypass a finalize/cancel RPC-ben.  
10. `notoHint` string-keresés negatív subsetelt fontnál (méret alapján OK).

---

## 20. Final verdict (ismétlés)

# **NOT READY**

**Nem** `READY FOR PRODUCTION APPLY`.

Következő lépés (audit javaslat, nem implementáció ebben a körben):

1. Staging/local Postgres + mindkét migráció apply.  
2. 50-párhuzamos finalize + két-org concurrency.  
3. Trigger/RLS smoke + transaction failure injection.  
4. Finalize RPC: szerveroldali ADR újraszámítás / snapshot validáció (trust boundary).  
5. Új második audit PASS után explicit production apply engedély.

---

## Mellékletek

- Probe: `scripts/second-audit-probe.mjs`  
- PDF v2: `docs/delivery-notes/pdf-samples-v2/`  
- Hardening POST: `docs/delivery-notes/HARDENING_POST_606a811.md`
