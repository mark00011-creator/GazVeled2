# Delivery-note / ADR — PRODUCTION APPLY REPORT

**Dátum:** 2026-09-27 (blokkoló-lezárás kör)  
**Final verdict:** **PRODUCTION ISSUE – BACKUP BLOCKED**

---

## Executive summary

Managed Supabase backup **nem** áll rendelkezésre ezen a projekten (**organization plan = Free**). A feladat szerinti backup gate ezért **FAIL** → ebben a körben **migration repair és `db push` TILOS**.

Local `pg_dump` / Docker **nem** került újrapróbálásra (WSL blokk; feladat szerint tilos megkerülni).

Új Vercel deploy **nem** történt (production Ready + bf452a3 ősök).

Owner dirty multi-company work **érintetlen**.

---

## 1. Clean worktree

| Mező | Érték |
|------|--------|
| Path | `C:\Users\mark00011\Projects\GazVeled2-dn-prod-apply-v2` |
| HEAD | `758b70f701734a2a360310b69967cbe6a5be7a52` |
| State | detached `origin/main` |
| `git status` | **clean** |
| Untracked `20260927*` | **0** |
| `bf452a3` ős | **igen** |
| `881182d` ős | **igen** |
| `758b70f` (= HEAD) | **igen** |

Előző clean WT (`GazVeled2-dn-prod-apply` @ `881182d`) megmaradt; az aktuális kör a v2 worktree-t használja.

---

## 2. Vercel production állapot

| Mező | Érték |
|------|--------|
| Project | `gazveeled2` |
| Alias | `https://gazveeled2.vercel.app` |
| Status | **Ready** |
| bf452a3 + ősök a deployban | **igen** (felhasználói / előző CLI inspect alapján) |
| Új deploy ebben a körben | **NEM** (nem szükséges) |
| DB schema kompatibilitás (candidate) | `finalize_delivery_note(p_delivery_note_id uuid)` kliens a main-en jelen van → **PASS** (ha a Ready deploy ≥ bf452a3) |

---

## 3. Supabase managed backup

| Mező | Érték |
|------|--------|
| Project | **`snmiwsgtnokvqlnwvfwf`** (GazVeled) |
| MCP URL | `https://snmiwsgtnokvqlnwvfwf.supabase.co` |
| Status | `ACTIVE_HEALTHY` |
| Organization | `eixvdfcluezdbarzsofe` (`mark00011`) |
| **Plan / tier** | **`free` / `tier_free`** (MCP `get_organization`) |
| Daily managed backups | **NEM** — csak Pro / Team / Enterprise |
| PITR | **NEM** elérhető Free-en (PITR add-on Pro+) |
| Management API backup lista | **NEM** hívható bizonyíthatóan (nincs helyi CLI access token ebben a környezetben); plan alapján egyébként is üres / nem támogatott lenne Free-en |
| Restore lehetőség | **NEM** (nincs managed backup restore pont) |
| Utolsó biztonságosan visszaállítható időpont | **N/A** |

**Backup gate:** **FAIL** → **PRODUCTION ISSUE – BACKUP BLOCKED**

Credential / DB password / access token **nem** került a reportba / gitbe.

---

## 4. Restore lehetőség

| Check | Eredmény |
|-------|----------|
| Dashboard Daily Backup restore | **NEM** (Free) |
| PITR restore | **NEM** (Free / nincs PITR) |
| Local pg_dump artifact | **NEM** követelmény ebben a körben; WSL miatt egyébként sem |

---

## 5. Migration list BEFORE (read-only)

CLI `supabase migration list` a clean WT-ből: **FAIL** (`Cannot find project ref` / nincs `supabase link` + access token).

**REMOTE** (MCP `schema_migrations`, version ≥ 20260923):

| version | name |
|---------|------|
| 20260923070752 | exchange_outgoing_correction_v2 |
| 20260923100000 | exchange_outgoing_correction |
| 20260923120000 | delivery_notes_adr |
| 20260923140000 | delivery_notes_hardening |
| 20260924120000 | delivery_notes_server_side_finalize |
| 20260925120000 | delivery_notes_bypass_hardening |
| 20260927051650 | delivery_notes_table_grants |

**LOCAL** (clean WT tracked files, ugyanaz a window):

| file | category |
|------|----------|
| `20260923100000_exchange_outgoing_correction.sql` | EXCHANGE |
| `20260923120000_delivery_notes_adr.sql` | DELIVERY_NOTE |
| `20260923140000_delivery_notes_hardening.sql` | DELIVERY_NOTE |
| `20260924120000_delivery_notes_server_side_finalize.sql` | DELIVERY_NOTE |
| `20260925120000_delivery_notes_bypass_hardening.sql` | DELIVERY_NOTE |
| `20260927*` | **0** (MULTI_COMPANY nincs a clean WT-ben) |

**Eltérés-jegyzet:** remote tartalmazza a DN négyest + exchange repair sort + `delivery_notes_table_grants` (előző kör MCP apply). Local tracked fájlok között a grants migration **nincs** (csak prod history).

---

## 6. Exchange equivalence

| Objektum | Production | Repo `20260923100000` |
|----------|------------|------------------------|
| `correct_exchange_outgoing(uuid,uuid)` | SECURITY DEFINER, `search_path=public` | ugyanaz |
| `mark_rental_initial_fee_invoiced(uuid)` | SECURITY DEFINER, `search_path=public` | ugyanaz |
| `rentals.initial_fee_invoiced` | `boolean NOT NULL DEFAULT false` | ugyanaz |
| Re-apply kockázat | mass `UPDATE rentals … initial_fee_invoiced=true` | **tilos újrafuttatni** |

**Eredmény: EQUIVALENT**

History: `20260923100000` remote-on **már be van jegyezve** (előző kör repair) a `…_v2` (`20260923070752`) mellett.

---

## 7. Migration repair

| Mező | Érték |
|------|--------|
| Ebben a körben | **NEM futott** (backup gate FAIL) |
| Dry-run | **NEM futott** (gate FAIL; CLI link hiány) |
| Előző kör | repair már megtörtént (`20260923100000` history-only) |

---

## 8. Migration list AFTER

Nincs változás ebben a körben — lásd §5 REMOTE.

---

## 9. Final `db push --dry-run`

**NOT EXECUTED** — backup gate FAIL + CLI nem linkelt.

---

## 10. Ténylegesen alkalmazott migrationök (ebben a körben)

**Egyik sem.** Apply / repair **TILOS** volt.

### Előző körből (már productionön — tájékoztató)

DN objektumok / history már jelen vannak (MCP apply + grants). Ez **nem** jelenti, hogy a backup gate most PASS lenne.

---

## 11. Production schema (read-only ellenőrzés)

| Objektum | Állapot |
|----------|---------|
| `adr_product_master` | létezik |
| `delivery_notes` | létezik |
| `delivery_note_items` | létezik |
| `delivery_note_sequences` | létezik |
| `finalize_delivery_note(p_delivery_note_id uuid)` | létezik |
| `cancel_delivery_note(uuid,text,text)` | létezik |
| jsonb finalize overload | **0** |

---

## 12. Security (rövid)

Előző körben: RLS on, immutability trigger, ADR master csak SELECT policy, anon EXECUTE finalize/cancel = false. Ebben a körben nem változtattunk.

---

## 13. Trust boundary

`finalize_delivery_note` egyetlen overload: `p_delivery_note_id uuid` — nincs authoritative client snapshot param. **PASS** (read-only).

---

## 14. ADR master

| Key | verified |
|-----|----------|
| `stargon` | **false** (nem módosítva) |
| `pb` | **nincs sor** (nem promote-olva true-ra) |

---

## 15. UI smoke

**NOT EXECUTED** ebben a körben (backup gate STOP; nincs auth session a kötelező „Több → Szállítólevelek” smoke-hoz). Mesterséges FINALIZED / SZL fogyasztás **nem** történt.

---

## 16. Original dirty multi-company work

| Check | Eredmény |
|-------|----------|
| Path | `C:\Users\mark00011\Projects\GazVeled2` |
| HEAD | `758b70f` |
| Untracked `20260927*` | **3** megvan |
| reset/stash/clean/delete | **nem** |
| DN deployba commitolva | **nem** (csak ez a report frissül) |

---

## 17. Rollback readiness

| Elem | Állapot |
|------|---------|
| Managed backup restore | **NINCS** (Free) |
| PITR | **NINCS** |
| DN séma rollback | manuális DROP + history delete (előző report); **nincs** managed restore pont |
| Ajánlás | Pro upgrade **vagy** WSL helyreállítása után egyszeri `db dump` off-site mentés, mielőtt további prod schema változás |

---

## 18. Final verdict

# **PRODUCTION ISSUE – BACKUP BLOCKED**

**Ok:** Organization **Free** → nincs bizonyítható Supabase managed Daily Backup / PITR / restore. A feladat szerint ilyenkor repair és apply **TILOS**.

**Nem blokkolók ebben a körben (információ):**  
clean worktree PASS; exchange **EQUIVALENT**; Vercel Ready + bf452a3 ősök → új deploy nem kell; multi-company local work sértetlen.

**Következő lépés a READY-hez:** managed backup (Pro+) **vagy** bizonyítható dump restore path → utána dry-run / (ha még kell) apply megerősítés + authenticated UI smoke.
