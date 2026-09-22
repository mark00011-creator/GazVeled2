# GazVeled2 – Security Fixes

**Production projekt:** `snmiwsgtnokvqlnwvfwf`  
**Migration file:** `supabase/migrations/20260922140000_security_privilege_lockdown.sql`  
**Applied on prod as (MCP chunks):**  
`security_privilege_lockdown_profiles`, `_rpcs`, `_loan_order`, `_return_loan`, `_temp_invoice_org`, `security_create_org_privilege_bypass`

---

## FIXED

### SEC-001 CRITICAL – profiles privilege lock

**Before:** `profiles update own safe` WITH CHECK nem zárta `is_platform_admin`, `organization_id`.  
**After:**
- Trigger `trg_profiles_privilege_lock` → `enforce_profiles_privilege_columns()`
- WITH CHECK: role, is_active, is_platform_admin, organization_id immutable self-update
- Admin role update nem írhatja át más user `is_platform_admin` mezőjét
- Legitim RPC bypass: `app.allow_profile_privilege_change=on` (`assign_organization_member`, `platform_set_active_organization`, `create_organization`)

**Verify:**
```sql
SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy
 WHERE polrelid='public.profiles'::regclass AND polname='profiles update own safe';
-- tartalmazza: is_platform_admin, organization_id

SELECT tgname FROM pg_trigger
 WHERE tgrelid='public.profiles'::regclass AND tgname='trg_profiles_privilege_lock';
```

**Regression:** `scripts/security-privilege-lockdown.test.mjs`  

---

### SEC-002 HIGH – mark_exchange_batch_invoiced org scope

WHERE `batch_id` **és** `organization_id = require_active_organization()`.

---

### SEC-003 HIGH – loan / gas order / temp cylinder RPCs

- `receive_gas_order`: `require_write` + org filter  
- `return_cylinder_loan`: `require_exchange_access` + org assert  
- `try_delete_orphan_temp_cylinder`: auth + write + `assert_cylinder_in_org`  

---

### SEC-004 HIGH – finalize_invoice_document_exchanges

Új DEFINER RPC: dokumentum + cserék `invoiced` org-scoped finalizálás.  
`src/lib/api/szamlazz.functions.ts` RPC-t hív (WIP feature dirty tree-ben).  
`buildSzamlazzXmlPreview` → `requireSupabaseAuth`.

---

## NOT FIXED / OPEN

| ID | Severity | Miért nyitva | Kockázat | Szükséges |
|----|----------|--------------|----------|-----------|
| SEC-005 | MEDIUM | CSP még nincs (breaking risk SPA-n); `vercel.json`-ban X-CTO / Referrer / Frame / Permissions beállítva | Clickjacking/MIME sniffer enyhítve; XSS CSP nélkül | Staging CSP report-only |
| SEC-006 | MEDIUM | Vak major bump tiltva | Toolchain CVE | Kontrollált `npm audit` remediation |
| SEC-007 | LOW | SPA session modell | XSS→token | CSP + későbbi HttpOnly cookie |

---

## TEST RESULTS

```text
Build: PASS
Unit/integration (npm test suite, audit közben): PASS (exit 0)
Auth security tests (migration static): PASS (4/4)
RLS tests (prod policy/trigger audit): PASS
Black-box pentest (anon GET): PASS (401 NO_LEAK)
Dependency audit: FAIL (8 high open – documented)
Secret scan: PASS (no raw service_role key in repo)
```

---

## PRE → POST

### PRE
- Branch: `main`
- Commit: `b582f232f881ceae432ef30c5a95d464ad8b2173`
- Dirty: Számlázz WIP + security work

### FINDINGS counts
- CRITICAL: 1 (FIXED)
- HIGH: 3 (FIXED)
- MEDIUM: 2 (OPEN)
- LOW: 1 (ACCEPTED) + 1 PARTIAL
- INFO: 2 (OK)

### POST
- Production lockdown applied
- Docs under `docs/security/`
- Regression test added
- Security commits: lásd git log (security: …)
