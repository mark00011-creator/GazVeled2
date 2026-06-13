## Stabilization & core business logic completion (Bulk AI deferred)

Skipping Bulk Barcode AI per your direction. Focus on making the existing workflows bulletproof, then close the remaining business-logic gaps.

### Phase A — Persistence & reliability verification

1. **Database health check** — run linter + read key tables (`cylinders`, `movements`, `exchanges`, `rentals`) to confirm triggers fire and `last_movement_at` updates correctly. Fix any RLS/GRANT gaps surfaced.
2. **`cylinder-ops.ts` hardening** — wrap `findOrCreateCylinder` in a single RPC `find_or_create_cylinder(barcode, defaults)` (SECURITY DEFINER) to prevent race conditions on duplicate barcodes. Replace client-side select+insert with one round-trip.
3. **Movement integrity** — add a trigger guard: every `exchanges` insert must produce two `movements` rows (incoming + outgoing). Currently done in client code; move to a DB function `record_exchange(...)` called from Quick Exchange so partial failures roll back atomically.
4. **Supplier exchange atomicity** — same treatment: `record_supplier_exchange(supplier_id, received_barcodes[], returned_barcodes[])` RPC that upserts cylinders, inserts movements, inserts `supplier_exchanges` in one transaction.

### Phase B — Rental workflow stability

5. **Rental state machine** — DB CHECK trigger on `rentals.status` transitions (`active → returned → closed`; `active → problematic`). Prevents invalid states.
6. **Rental reassignment RPC** — `reassign_rental_cylinder(rental_id, new_cylinder_id, note)` that updates `rentals.current_cylinder_id`, inserts `rental_reassignments`, writes audit, all atomic.
7. **Rental return RPC** — `close_rental(rental_id, returned_cylinder_id, deposit_returned, status)` with validation that the returned cylinder matches `current_cylinder_id`.
8. **Rental return UI fixes** — verify `rental-return.tsx` uses the RPC, shows clear errors, and updates cylinder location to `warehouse_empty`.

### Phase C — Supplier inventory correctness

9. **Audit existing `suppliers.tsx`** — confirm every barcode entry triggers cylinder upsert with correct (circulation, owner, status, location) per the matrix in the plan. Add a verification banner showing affected cylinders before commit.
10. **Backfill safety** — for cylinders that already exist with wrong `owner`/`circulation`, the supplier exchange must NOT silently overwrite; show a "conflict" warning and require operator confirmation.

### Phase D — Remaining business-logic gaps (post-stabilization)

11. **New cylinder classification dialog** auto-shown when `findOrCreateCylinder` creates a row (gas type, size, circulation, category).
12. **Substitution dashboard widget** — OWN→SIAD / SIAD→OWN counts (30d / all-time).
13. **Cylinder detail substitution history** section.
14. **Partner detail page** with profit recommendation (annual exchanges, avg interval, SIAD/OWN ajánlott).
15. **Password recovery** (`/reset-password`), **change password**, **profile menu** in AppShell.
16. **Temporary cylinder photo upload** UI + private `cylinder-photos` storage bucket.

### Deferred

- Bulk Barcode AI vision (Phase E, later).

### Migration footprint

Single migration adding: `find_or_create_cylinder`, `record_exchange`, `record_supplier_exchange`, `reassign_rental_cylinder`, `close_rental` SECURITY DEFINER RPCs; rental status-transition trigger; cylinder upsert conflict helper; `cylinders.category` column.

### Work order

A → B → C are stability-critical and ship first. D can be split into smaller PRs after stabilization is confirmed.

Approve to start with Phase A (migration + RPCs).
