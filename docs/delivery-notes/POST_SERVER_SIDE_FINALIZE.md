# POST — Server-side finalize authority (HIGH trust-boundary fix)

**Dátum:** 2026-09-25  
**Production apply:** **TILOS / NEM FUTTATVA**  
**Production projekt:** `snmiwsgtnokvqlnwvfwf`

---

## 1. PRE

| Mező | Érték |
|------|--------|
| Branch | `main` |
| PRE HEAD | `8e058db` (second audit re-run) |
| POST HEAD | `bf452a3` |
| Dirty (PRE) | csak local PDF sample zaj (`pdf-samples-v2/*`) — nem része a fixnek |

## 2. Root cause

`finalize_delivery_note(uuid, jsonb, jsonb, numeric, boolean, text)` a kliens `p_adr_snapshot` / `p_business_snapshot` / ADR total értékeket **vakon** a FINALIZED sorba írta → ADR/üzleti integritás kliens-kompromittálható.

## 3. Régi finalize signature

```text
finalize_delivery_note(
  p_note_id uuid,
  p_adr_snapshot jsonb,
  p_business_snapshot jsonb,
  p_adr_total_points numeric,
  p_adr_within_116 boolean,
  p_pdf_base64 text DEFAULT NULL
)
```

## 4. Új finalize signature

```text
finalize_delivery_note(p_delivery_note_id uuid) → jsonb
```

Régi overload: **DROP**-olva. Nincs deprecated param — nem fogadható el kliens snapshot.

## 5. Server-side business snapshot

`build_delivery_note_finalize_snapshots`:
- note + org név (shipper)
- partner / supplier (consignee DB-ből, ha van FK)
- delivery note items (state, qty, size, barcode, water/net, cylinder_id)
- ADR product freeze line-onként

## 6. Server-side ADR snapshot

ADR master lookup (`adr_product_master`): org-specific → global.  
UN, proper shipping name, class, labels, tunnel, category, multiplier, verified, source — mind masterből.

## 7. Server-side ADR calculation

ADR 1.1.3.6 mirror a SQL-ben:
- FULL/PARTIAL compressed: `water_capacity_l × qty × multiplier`
- FULL/PARTIAL liquefied: `net_gas_mass_kg × qty × multiplier`
- EMPTY_UNCLEANED: 0 pont, cat 4, `ÜRES TARTÁLY, 2`
- EMPTY_CLEAN: kimarad a dangerous goods-ból
- total ≤ 1000 → within116

## 8. Eltávolított kliens authority mezők

`p_adr_snapshot`, `p_business_snapshot`, `p_adr_total_points`, `p_adr_within_116`, `p_pdf_base64` (finalize-ból), plusz kliens UN/category/verified/partner név — **nem része** az új RPC-nek.

Frontend `ops.finalizeDeliveryNote`: csak `p_delivery_note_id`; PDF a RPC válasz snapshotjaiból.

## 9. TOCTOU / locking

Finalize: note `FOR UPDATE` → items `FOR UPDATE` → snapshot build → allocate number → status FINALIZED + `finalized_at`/`finalized_by` server-side — egy tranzakció.

## 10. Új migration

`supabase/migrations/20260924120000_delivery_notes_server_side_finalize.sql`

## 11–15. Tesztek / build

| Suite | Eredmény |
|-------|----------|
| Tampering (finalize-authority) | **9/9 PASS** (része a 17 delivery-note tesztnek) |
| Delivery-notes összesen | **17/17 PASS** (8 hardening + 9 authority) |
| ADR | **9/9 PASS** |
| npm test | **80/80 PASS** |
| `npm run build` | **PASS** |
| typecheck (`npx tsc --noEmit`) | **pre-existing FAIL** (szamlazz/rental/supply stb.; delivery-note fájlokra nincs új hiba a scope-ban) |
| lint | scope: delivery-note fájlok; full `eslint .` túl hosszú / nem zárva |

## 16. Repo search `p_adr_snapshot`

- `src/lib/delivery-notes/ops.ts`: **nincs** (authority hívás)
- új migráció `20260924120000_*`: **nincs**
- `server-finalize-authority.ts`: csak `ClientFinalizeTamperAttempt` típusmező (teszthez, **ignorált**)
- régi `20260923140000_*`: history; új migráció **DROP**-olja

## 17. Remaining CRITICAL

Élő DB bizonyíték hiánya (Docker/Supabase CLI) — későbbi **live DB validation**, nem kód HIGH.

## 18. Remaining HIGH

**0** ismert kód HIGH (finalize trust-boundary javítva).

## 19–20. Commit / push

Lásd git output.

---

## Verdict

# **READY FOR LIVE DB VALIDATION**

(**NEM** production apply engedély.)

Feltételek:
- `p_adr_snapshot` már nem authority
- business + ADR snapshot backendből
- ADR total backend számítás
- tampering tesztek PASS
- 0 ismert CRITICAL kódhiba / 0 ismert HIGH kódhiba
- élő DB funkcionális PASS **nincs** állítva (nincs local DB)
