# GazVeled2 – Security Audit

**Dátum:** 2026-09-22  
**Auditor:** Cursor Agent (autorizált)  
**Production projekt:** `snmiwsgtnokvqlnwvfwf` (GazVeled)  
**Frontend URL:** https://gazveeled2.vercel.app  
**API:** https://snmiwsgtnokvqlnwvfwf.supabase.co  

---

## 0. Scope / környezet azonosítás

| Elem | Érték |
|------|--------|
| Repository | GazVeled2 (`C:\Users\mark00011\Projects\GazVeled2`) |
| Branch (PRE) | `main` |
| HEAD (PRE) | `b582f232f881ceae432ef30c5a95d464ad8b2173` |
| Frontend | TanStack Start / Vite / React, Vercel |
| Backend | Supabase (Postgres + Auth + PostgREST + Edge Functions) + TanStack server functions |
| Auth | Supabase Auth (JWT, localStorage session) |
| Storage | Nincs aktív publikus bucket a audit idején (üres `storage.buckets`) |
| Külső API | Számlázz.hu Agent (Edge Function `szamlazz-create-invoice`) |
| Secrets | `SUPABASE_SERVICE_ROLE_KEY` csak server/edge; `VITE_SUPABASE_*` publikus |
| Környezetek | Local Vite; Production Supabase+Vercel. Staging külön nem azonosítható. |

**Korlát:** Production-ön csak passzív / non-destructive ellenőrzés. Aktív destructive teszt nincs. Migrációs DDL alkalmazva (privilege lockdown).

---

## 1. PRE állapot

Lásd: `docs/security/_pre_git_state.txt`

- Dirty: ~15 fájl (Számlázz feature WIP + security migration) – **nem stash/reset**
- Build (audit közben): PASS (`_build_result.txt`)
- npm audit: 11 findings (8 high, 0 critical) – `_npm_audit.txt`

### Architektúra (rövid)

1. Böngésző → Vercel SSR/static → Supabase JS (anon + user JWT)
2. Üzleti írás: SECURITY DEFINER RPC-k + org RLS (`same_org`, `enforce_organization_isolation`)
3. Server functions: `createServerFn` + `requireSupabaseAuth` (pl. számlázás)
4. Számlázz Agent kulcs: org secret tábla / edge, soha nem a kliensnek

### Jogosultsági modell

- `profiles.role`: `admin` | `exchange_operator` | `viewer`
- `profiles.is_platform_admin`, `organization_id`
- Helper: `is_admin()`, `require_write()`, `require_exchange_access()`, `same_org()`

---

## 2. Threat model

### Támadók

| Támadó | Cél |
|--------|-----|
| Anon külső | Adatszivárgás PostgREST/storage/source map |
| Regisztrált user | Más org / más user adat (IDOR/BOLA) |
| Alacsony role (viewer/operator) | Vertical escalation → admin / platform |
| Kompromittált session | Mass assignment `role` / `is_platform_admin` |
| Admin → platform | Cross-tenant |

### Védendő

PII (partnerek), üzleti készlet/csere/bérlet, számlázási titkok, JWT/session, service_role, admin RPC-k.

---

## 3. Findings összefoglaló

| ID | Severity | Státusz | Röviden |
|----|----------|---------|---------|
| SEC-001 | CRITICAL | FIXED | Saját `profiles` UPDATE: `is_platform_admin` / `organization_id` hiányzott a WITH CHECK-ből |
| SEC-002 | HIGH | FIXED | `mark_exchange_batch_invoiced` org szűrés nélkül |
| SEC-003 | HIGH | FIXED | `receive_gas_order` / `return_cylinder_loan` / `try_delete_orphan_temp_cylinder` gyenge org/role |
| SEC-004 | HIGH | FIXED | Operator nem tudta `exchanges.invoiced` frissíteni; insecure workaround kockázat → `finalize_invoice_document_exchanges` |
| SEC-005 | MEDIUM | OPEN | HTTP security headers hiányosak (nincs CSP, X-CTO, Referrer-Policy, Permissions-Policy) |
| SEC-006 | MEDIUM | OPEN | npm 8 high dependency CVE (vite/esbuild toolchain jellegű – lásd audit) |
| SEC-007 | LOW | ACCEPTED | Session JWT localStorage-ban (XSS esetén tokenlopás) – SPA korlát |
| SEC-008 | INFO | OK | Anon REST: nincs nyitott anon SELECT policy (0) |
| SEC-009 | INFO | OK | Minden public tábla RLS enabled |
| SEC-010 | LOW | PARTIAL | `buildSzamlazzXmlPreview` auth middleware hozzáadva (WIP feature branch dirty) |

Részletek: `PENTEST_REPORT.md`, javítások: `SECURITY_FIXES.md`.

---

## 4. Bizonyított vs potenciális

**Bizonyított (policy/SQL audit + reprodukálható PRE állapot):**

- SEC-001: PRE WITH CHECK csak `role` + `is_active` – `is_platform_admin` / `organization_id` szabadon állítható volt PostgREST PATCH-csel.
- SEC-002: DEFINER batch invoice UUID-ra org filter nélkül.

**Passzív black-box:** `_blackbox_anon.txt` (ha jelen van).

**Nem futtatott aktívan production-ön:** brute-force, DoS, destruktív IDOR írás.

---

## 5. Red Team (önrevízió)

- WITH CHECK önmagára SELECT: trigger (`trg_profiles_privilege_lock`) a valódi védvonal.
- `create_organization` param sorrend: production `p_admin_email` 3. – migration igazítva.
- Migration history ≠ bizonyíték: `pg_policy` / `pg_trigger` / `pg_get_functiondef` ellenőrizve.
- Frontend gomb elrejtés ≠ auth – RPC/RLS a forrás.

---

## 6. POST

Lásd `SECURITY_FIXES.md` POST szekció és git commitok a security branchen/mainen.
