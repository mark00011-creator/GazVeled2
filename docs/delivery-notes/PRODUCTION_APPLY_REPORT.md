# Delivery-note / ADR — PRODUCTION APPLY REPORT

**Dátum:** 2026-09-27  
**Final verdict:** **PRODUCTION ISSUE**

DB apply + trust-boundary + RLS/grants **PASS**. Blokkoló maradék: authenticated UI smoke (nincs auth session), fizikai `pg_dump` backup (WSL/Docker), app deploy SHA API-ból nem igazolható (Vercel 403).

---

## 1. Original dirty tree állapot

| Mező | Érték |
|------|--------|
| Path | `C:\Users\mark00011\Projects\GazVeled2` |
| HEAD | `881182d` |
| Branch | `main` (dirty working tree) |
| Multi-company `20260927*` | **3 untracked fájl megvan** (érintetlen) |
| Művelet a dirty tree-n | **Nincs** reset/stash/clean/branch-switch; csak ez a report frissült |

Dirty tartalom (owner work, megtartva): multi-company onboarding + EQUIPMENT_SALES migrációk/UI/Edge/docs, PDF sample binárisok, `ETAP_CLOSED.md`, stb.

---

## 2. Clean deployment worktree

| Mező | Érték |
|------|--------|
| Path | `C:\Users\mark00011\Projects\GazVeled2-dn-prod-apply` |
| HEAD | `881182d4c7e0135ac27f04cad81ce0cda2fa530c` |
| State | detached `origin/main` |
| `git status` | **clean** |
| `20260927*` multi-company | **0 db** |

Minden production migration művelet ebből a clean worktree forrásfájljaiból / MCP-ből történt.

---

## 3. Backup

| Mező | Érték |
|------|--------|
| Target project | **`snmiwsgtnokvqlnwvfwf`** |
| Időpont | 2026-09-27 ~07:01 (local) |
| Docker/`pg_dump` | **FAIL** — `WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED` (Docker Desktop nem indul WSL nélkül) |
| Használt módszer | **MCP logical snapshot** (migration source SQL másolat + equivalence + method marker) |
| Helyszín | `C:\Users\mark00011\Projects\GazVeled2-backups\dn-pre-apply-20260927-070123` |
| Méret | ~80 KB (forrás SQL + meta; nem full data dump) |
| Restore DN | `DROP` DN táblák/RPC-k + `DELETE` érintett `schema_migrations` sorok; exchange history repair sor visszaállítható |
| Credential gitbe | **nem** került |

**Backup státusz:** bizonyítható *logikai* pre-apply artifact **PASS**; fizikai `pg_dump` **FAIL / WSL**.

---

## 4. Exchange migration equivalence audit

| | Repo | Production |
|--|------|------------|
| Stamp | `20260923100000_exchange_outgoing_correction` | `20260923070752_exchange_outgoing_correction_v2` |
| `correct_exchange_outgoing(uuid,uuid)` | CREATE OR REPLACE | jelen, SECURITY DEFINER, `search_path=public` — **szemantikailag azonos** |
| `mark_rental_initial_fee_invoiced(uuid)` | CREATE OR REPLACE | jelen — **azonos** |
| `rentals.initial_fee_invoiced` | `boolean NOT NULL DEFAULT false` | jelen |
| Re-apply kockázat | **HIGH** — mass `UPDATE rentals SET initial_fee_invoiced=true` |

**Verdikt: A) SEMANTIKAILAG AZONOS** — SQL **nem** futtatható újra.

---

## 5. Migration history repair

| Mező | Érték |
|------|--------|
| Történt? | **IGEN** (backup után) |
| Módszer | `INSERT INTO supabase_migrations.schema_migrations` — `20260923100000` / `exchange_outgoing_correction` (statements = repair-only komment; SQL nem futott) |
| CLI `migration repair` | nem (nincs CLI access token + Docker/WSL) — MCP SQL = ugyanaz a history tábla |

---

## 6. Pending migration lista repair után (elvárt vs tény)

Repair után apply előtt a clean repo szerinti pending **csak** a 4 DN migráció volt.

**THESE MIGRATIONS WILL APPLY (és alkalmaztuk):**

1. `20260923120000_delivery_notes_adr.sql` — ADR master + DN táblák + seed + RLS v1  
2. `20260923140000_delivery_notes_hardening.sql` — immutability, sequences, finalize/cancel RPC, RLS redesign  
3. `20260924120000_delivery_notes_server_side_finalize.sql` — trust-boundary finalize (`p_delivery_note_id` only)  
4. `20260925120000_delivery_notes_bypass_hardening.sql` — bypass GUC hardening  

**THESE WILL NOT APPLY:** multi-company / onboarding / EQUIPMENT / exchange correction re-run / Számlázz / scanner / OCR / rental unrelated — **nem** kerültek productionre.

Extra post-apply (MCP, repo fájl nélkül): `20260927051650_delivery_notes_table_grants` — authenticated/service_role DML GRANT (MCP `CREATE TABLE` nem örökölte a CLI default privilege-eket).

---

## 7. DN-only apply lista

Lásd §6. Apply csatorna: Supabase MCP `apply_migration` + version remap a repo stamp-ekre (CLI `db push` Docker/token híján nem volt elérhető).

---

## 8. Apply eredmény

| Migráció | Eredmény |
|----------|----------|
| history repair `20260923100000` | PASS |
| `delivery_notes_adr` → `20260923120000` | PASS |
| `delivery_notes_hardening` → `20260923140000` | PASS |
| `delivery_notes_server_side_finalize` → `20260924120000` | PASS |
| `delivery_notes_bypass_hardening` → `20260925120000` | PASS |
| `delivery_notes_table_grants` → `20260927051650` | PASS (privilege alignment) |

---

## 9. Production DB objects

| Objektum | Állapot |
|----------|---------|
| `adr_product_master` | létezik, RLS on |
| `delivery_notes` | létezik, RLS on |
| `delivery_note_items` | létezik, RLS on |
| `delivery_note_sequences` | létezik, RLS on, PK `(organization_id, year)` |
| `finalize_delivery_note(p_delivery_note_id uuid)` | létezik |
| `cancel_delivery_note(uuid, text, text)` | létezik |
| Oszlopok (`status`, `document_number`, `finalized_at/by`, `cancelled_at/by`, `cancellation_reason`, `business_snapshot`, `adr_snapshot`) | **mind jelen** |
| Unique docnum index | `delivery_notes_org_docnum_uidx` |
| Immutability triggers | `trg_delivery_notes_immutability`, `trg_delivery_note_items_immutability` |

---

## 10. RLS / security

| Check | Eredmény |
|-------|----------|
| RLS enabled (4 tábla) | PASS |
| ADR master: csak SELECT policy (nincs write policy) | PASS |
| DN per-op policies (select/insert/update/delete) | PASS |
| sequences: csak SELECT policy | PASS |
| `finalize`/`cancel`: anon EXECUTE = false; authenticated = true | PASS |
| authenticated DML GRANT (post-fix fix után) | PASS |
| anon SELECT delivery_notes | false |
| Runtime anon REST | `delivery_notes` GET **401**; `finalize` RPC **401**; ADR hack row **nem** keletkezett |
| Cross-org runtime | **NOT EXECUTED** (nincs második auth session) |
| Org admin ADR write runtime | **NOT EXECUTED** (statikus: nincs INSERT policy + `auth_adr_ins=false`) |

---

## 11. Trust boundary

| Követelmény (bf452a3) | Production |
|------------------------|------------|
| Nincs authoritative `p_adr_snapshot` param | PASS — signature: `p_delivery_note_id uuid` only |
| Nincs authoritative `p_business_snapshot` param | PASS |
| jsonb overload count | **0** |
| ADR total szerver (`build_delivery_note_finalize_snapshots`) | PASS |
| `finalized_by = auth.uid()` | PASS |
| `finalized_at = now()` | PASS |
| document number `allocate_delivery_note_number` | PASS |
| SECURITY DEFINER + `search_path=public` | PASS |

---

## 12. ADR master

| Key | verified | Megjegyzés |
|-----|----------|------------|
| `stargon` | **false** | stub — **nem** állítottuk true-ra |
| `pb` | **nincs sor** | SECOND_PRE: nincs verified seed; **nem** promote-oltuk true-ra |
| „Stargon C18” külön key | **nincs** | normalizer → `stargon` (verified=false) |

---

## 13. App deploy

| Mező | Érték |
|------|--------|
| Deploy candidate | `origin/main` = **`881182d`** |
| bf452a3 ős | igen |
| DN UI / ops `p_delivery_note_id` | igen (`src/lib/delivery-notes/ops.ts`) |
| Noto Sans PDF fontok | igen (`public/fonts/NotoSans-*.ttf`) |
| Multi-company a candidate-en | **nincs** |
| Élő site | `https://gazveeled2.vercel.app` HTTP 200, auth oldal betölt |
| Production deploy SHA (Vercel API) | **NOT CONFIRMED** (403 Forbidden) |

Ha a production app még pre-bf452a3 kliens: finalize signature mismatch — redeploy `origin/main` szükséges. Candidate kompatibilis.

---

## 14. UI smoke

| Check | Eredmény |
|-------|----------|
| App betölt / login UI | PASS (`/auth`) |
| Több → Szállítólevelek (auth után) | **NOT EXECUTED** — nincs production auth session |
| Lista / migration warning / console | **NOT EXECUTED** |
| Kézi / beszállítói / gyorscsere SZL indítás | **NOT EXECUTED** |
| FINALIZED bizonylat / SZL sorszám fogyasztás | **szándékosan nem** |

---

## 15. Log check

| Forrás | Eredmény |
|--------|----------|
| postgres_logs ERROR (ClickHouse filter) | üres találat a lekérdezett ablakban |
| Részletes postgres dump | intermittent backend error — **PARTIAL** |
| Frontend fatal (auth page) | nincs látható fatal a snapshotban |

---

## 16. Multi-company local work sértetlensége

| Check | Eredmény |
|-------|----------|
| Dirty tree fájlok megvannak | PASS |
| Untracked `20260927*` (3 db) | PASS |
| Nem reset/clean/delete | PASS |
| Nem commitoltuk multi-company-t ezzel a deployjal | PASS |

---

## 17. Rollback readiness

1. Fizikai dump hiányzik (WSL) — teljes DB restore korlátozott.  
2. DN rollback: drop tables/functions + delete migration rows `20260923120000`…`20260925120000` (+ grants `20260927051650`).  
3. Exchange repair sor (`20260923100000`) törölhető history-ből; `…_v2` marad.  
4. Backup folder: `GazVeled2-backups\dn-pre-apply-20260927-070123`.

---

## 18. Remaining issue

1. **UI smoke** authenticated — kötelező manuális / session-es smoke.  
2. **WSL/Docker** — `pg_dump` backup + CLI `db push`/`migration repair` továbbra sem.  
3. **Vercel deploy SHA** — API 403; erősítsd, hogy production app ≥ `bf452a3`.  
4. **Repo sync** — `delivery_notes_table_grants` csak production history-ben; érdemes később tracked migrationként felvenni (clean/main), nem a dirty multi-company tree részeként.  
5. PB master sor továbbra sincs (szándékos / SECOND_PRE); Stargon C18 külön key nincs.

---

## 19. Final verdict

# **PRODUCTION ISSUE**

**Indok:** Delivery-note/ADR séma productionön **alkalmazva és trust-boundary szerint helyes**, de a kötelező authenticated UI smoke és a fizikai backup/WSL hiány miatt a teljes production-verification szabály szerinti **PASS / PRODUCTION READY nem adható**.

**DB apply:** sikeres (DN-only).  
**Multi-company:** nem került productionre; local dirty work érintetlen.
