-- =============================================================================
-- Gáz Veled – Üzleti integritás ellenőrzés (READ-ONLY)
-- =============================================================================
-- Fájl: sql/check_business_invariants.sql
-- Dokumentáció: docs/check_business_invariants.md
--
-- SZABÁLY: Kizárólag SELECT. Sem INSERT/UPDATE/DELETE/DDL/DO.
-- Futtatás: Supabase SQL Editor vagy psql (read-only session).
-- =============================================================================


-- =============================================================================
-- SZAKASZ 1: PALACK INTEGRITÁS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 Duplikált sorszám (aktív, nem TEMP)
-- Cél: Egy fizikai sorszám = egy aktív palack rekord.
-- Ellenőrzés: Duplikált barcode csoportosítás.
-- PASS: 0 sor.
-- FAIL jelentése: Két rekord ugyanazzal a sorszámmal – készlet/hely ütközés.
-- -----------------------------------------------------------------------------
SELECT
  '1.1 duplicate_serial_barcode' AS check_id,
  barcode,
  count(*) AS duplicate_count,
  array_agg(id ORDER BY created_at) AS cylinder_ids
FROM public.cylinders
WHERE active = true
  AND coalesce(is_temporary, false) = false
  AND barcode NOT ILIKE 'TEMP%'
GROUP BY barcode
HAVING count(*) > 1
ORDER BY duplicate_count DESC, barcode;


-- -----------------------------------------------------------------------------
-- 1.2 Ugyanaz a sorszám két partnernél (customer)
-- Cél: Palack egyszerre csak egy partnernél lehet.
-- PASS: 0 sor.
-- FAIL jelentése: Azonos vonalkód több partnernél.
-- -----------------------------------------------------------------------------
SELECT
  '1.2 same_barcode_two_partners' AS check_id,
  lower(trim(barcode)) AS barcode_norm,
  count(DISTINCT location_partner_id) AS partner_count,
  array_agg(DISTINCT location_partner_id) AS partner_ids
FROM public.cylinders
WHERE active = true
  AND location_type = 'customer'
  AND location_partner_id IS NOT NULL
  AND coalesce(is_temporary, false) = false
  AND barcode NOT ILIKE 'TEMP%'
GROUP BY lower(trim(barcode))
HAVING count(DISTINCT location_partner_id) > 1;


-- -----------------------------------------------------------------------------
-- 1.3 Két aktív kölcsön ugyanarra a palackra
-- Cél: Max egy aktív kölcsön / palack.
-- PASS: 0 sor.
-- FAIL jelentése: Dupla aktív kölcsön.
-- -----------------------------------------------------------------------------
SELECT
  '1.3 two_active_loans_same_cylinder' AS check_id,
  cl.cylinder_id,
  c.barcode,
  count(*) AS active_loan_count,
  array_agg(cl.id) AS loan_ids
FROM public.cylinder_loans cl
JOIN public.cylinders c ON c.id = cl.cylinder_id
WHERE cl.status = 'active'
GROUP BY cl.cylinder_id, c.barcode
HAVING count(*) > 1;


-- -----------------------------------------------------------------------------
-- 1.4 Két aktív bérlet ugyanarra a palackra (rental_cylinders)
-- Cél: Max egy aktív bérlet / sorszámos palack.
-- PASS: 0 sor.
-- FAIL jelentése: Palack több aktív bérletben.
-- -----------------------------------------------------------------------------
SELECT
  '1.4 two_active_rentals_rental_cylinders' AS check_id,
  rc.cylinder_id,
  c.barcode,
  count(*) AS active_rental_count,
  array_agg(r.id) AS rental_ids
FROM public.rental_cylinders rc
JOIN public.rentals r ON r.id = rc.rental_id AND r.status = 'active'
JOIN public.cylinders c ON c.id = rc.cylinder_id
WHERE rc.removed_at IS NULL
  AND coalesce(c.is_temporary, false) = false
  AND c.barcode NOT ILIKE 'TEMP%'
GROUP BY rc.cylinder_id, c.barcode
HAVING count(*) > 1;


-- -----------------------------------------------------------------------------
-- 1.5 Két aktív bérlet ugyanarra a current_cylinder_id-re
-- Cél: rentals.current_cylinder_id egyedi aktív bérleteknél.
-- PASS: 0 sor.
-- FAIL jelentése: Ugyanaz a palack több bérlet fő palackjaként szerepel.
-- -----------------------------------------------------------------------------
SELECT
  '1.5 two_active_rentals_current_cylinder' AS check_id,
  r.current_cylinder_id,
  c.barcode,
  count(*) AS rental_count,
  array_agg(r.id) AS rental_ids
FROM public.rentals r
JOIN public.cylinders c ON c.id = r.current_cylinder_id
WHERE r.status = 'active'
  AND r.current_cylinder_id IS NOT NULL
GROUP BY r.current_cylinder_id, c.barcode
HAVING count(*) > 1;


-- -----------------------------------------------------------------------------
-- 1.6 Aktív kölcsön ÉS aktív bérlet ugyanazon palackon
-- Cél: Kölcsön és bérlet nem fedheti ugyanazt a sorszámos palackot.
-- PASS: 0 sor.
-- FAIL jelentése: Ütköző aktív kapcsolatok.
-- -----------------------------------------------------------------------------
SELECT
  '1.6 active_loan_and_rental_same_cylinder' AS check_id,
  cl.id AS loan_id,
  r.id AS rental_id,
  c.id AS cylinder_id,
  c.barcode
FROM public.cylinder_loans cl
JOIN public.cylinders c ON c.id = cl.cylinder_id
JOIN public.rental_cylinders rc ON rc.cylinder_id = c.id AND rc.removed_at IS NULL
JOIN public.rentals r ON r.id = rc.rental_id AND r.status = 'active'
WHERE cl.status = 'active'
  AND coalesce(c.is_temporary, false) = false
  AND c.barcode NOT ILIKE 'TEMP%';


-- -----------------------------------------------------------------------------
-- 1.7 Ugyanaz a sorszám customer ÉS warehouse helyen (külön rekordokon)
-- Cél: Egy sorszám nem lehet egyszerre telephelyen és partnernél.
-- PASS: 0 sor.
-- FAIL jelentése: Duplikált sorszám ellentmondó helyeken.
-- -----------------------------------------------------------------------------
SELECT
  '1.7 serial_at_customer_and_warehouse' AS check_id,
  lower(trim(c1.barcode)) AS barcode_norm,
  c1.id AS customer_cylinder_id,
  c2.id AS warehouse_cylinder_id,
  c1.location_partner_id AS customer_partner_id
FROM public.cylinders c1
JOIN public.cylinders c2
  ON lower(trim(c2.barcode)) = lower(trim(c1.barcode))
 AND c2.id <> c1.id
 AND c2.active = true
WHERE c1.active = true
  AND c1.location_type = 'customer'
  AND c2.location_type IN ('warehouse_full', 'warehouse_empty')
  AND coalesce(c1.is_temporary, false) = false
  AND coalesce(c2.is_temporary, false) = false
  AND c1.barcode NOT ILIKE 'TEMP%';


-- -----------------------------------------------------------------------------
-- 1.8 location_type NULL vagy status NULL
-- Cél: Minden aktív palacknak értelmes helye és állapota van.
-- PASS: 0 sor.
-- FAIL jelentése: „Eltűnt” vagy definiálatlan palack.
-- -----------------------------------------------------------------------------
SELECT
  '1.8 null_location_or_status' AS check_id,
  id,
  barcode,
  location_type,
  status
FROM public.cylinders
WHERE active = true
  AND (location_type IS NULL OR status IS NULL);


-- -----------------------------------------------------------------------------
-- 1.9 location_partner_id csak customer esetén
-- Cél: Partner FK csak customer helyen lehet kitöltve.
-- PASS: 0 sor.
-- FAIL jelentése: Rossz hely/partner kombináció.
-- -----------------------------------------------------------------------------
SELECT
  '1.9 partner_id_on_non_customer' AS check_id,
  id,
  barcode,
  location_type,
  location_partner_id
FROM public.cylinders
WHERE active = true
  AND location_type IS DISTINCT FROM 'customer'
  AND location_partner_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 1.10 location_supplier_id csak beszállítói helyen
-- Cél: Supplier FK csak siad / own_supplier helyen.
-- PASS: 0 sor.
-- FAIL jelentése: Rossz supplier/hely kombináció.
-- -----------------------------------------------------------------------------
SELECT
  '1.10 supplier_id_on_non_supplier_location' AS check_id,
  id,
  barcode,
  location_type,
  location_supplier_id
FROM public.cylinders
WHERE active = true
  AND location_type NOT IN ('siad', 'own_supplier')
  AND location_supplier_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 1.11 status vs location ellentmondás (full+warehouse_empty, empty+warehouse_full)
-- Cél: Állapot és telephely típus összhangban.
-- PASS: 0 sor.
-- FAIL jelentése: Hibás készlet besorolás.
-- -----------------------------------------------------------------------------
SELECT
  '1.11 status_location_mismatch' AS check_id,
  id,
  barcode,
  status,
  location_type,
  location_partner_id
FROM public.cylinders
WHERE active = true
  AND (
    (status = 'full' AND location_type = 'warehouse_empty')
    OR (status = 'empty' AND location_type = 'warehouse_full')
  );


-- -----------------------------------------------------------------------------
-- 1.12 v_cylinder_custody inkonzisztencia
-- Cél: View szerinti összhang (customer+partner, bérlet/hely).
-- PASS: 0 sor.
-- FAIL jelentése: Leltár/készlet nem magyarázható.
-- -----------------------------------------------------------------------------
SELECT
  '1.12 v_cylinder_custody_inconsistent' AS check_id,
  cylinder_id,
  barcode,
  location_type,
  partner_id,
  partner_name,
  rental_id,
  rental_status
FROM public.v_cylinder_custody
WHERE is_missing_or_inconsistent = true;


-- =============================================================================
-- SZAKASZ 2: BÉRLETEK
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2.1 Aktív bérlet – hiányzó partner
-- Cél: Minden aktív bérlethez létezik partner.
-- PASS: 0 sor.
-- FAIL jelentése: Árva bérlet rekord.
-- -----------------------------------------------------------------------------
SELECT
  '2.1 active_rental_missing_partner' AS check_id,
  r.id AS rental_id,
  r.partner_id,
  r.status
FROM public.rentals r
LEFT JOIN public.partners p ON p.id = r.partner_id
WHERE r.status = 'active'
  AND (r.partner_id IS NULL OR p.id IS NULL);


-- -----------------------------------------------------------------------------
-- 2.2 Darabszámos bérlet – érvénytelen quantity
-- Cél: rental_quantity_items quantity > 0, aktív bérlet alatt.
-- PASS: 0 sor.
-- FAIL jelentése: Hibás darabszámos bérlet nyilvántartás.
-- -----------------------------------------------------------------------------
SELECT
  '2.2 invalid_quantity_rental_item' AS check_id,
  rqi.id,
  rqi.rental_id,
  rqi.stock_kind,
  rqi.gas_type,
  rqi.size,
  rqi.quantity
FROM public.rental_quantity_items rqi
JOIN public.rentals r ON r.id = rqi.rental_id AND r.status = 'active'
WHERE rqi.removed_at IS NULL
  AND (rqi.quantity IS NULL OR rqi.quantity <= 0);


-- -----------------------------------------------------------------------------
-- 2.3 Sorszámos aktív bérlet – palack customer helyen, de nem a bérlet partnerénél
-- Cél: Bérletben lévő nem-TEMP palack a bérlet partnerénél van.
-- PASS: 0 sor.
-- FAIL jelentése: Palack rossz partnernél a bérlet nyilvántartásához képest.
-- Megjegyzés: TEMP bérlet külön szabály – TEMP partnernél helyes.
-- -----------------------------------------------------------------------------
SELECT
  '2.3 rental_cylinder_wrong_partner' AS check_id,
  r.id AS rental_id,
  r.partner_id AS rental_partner_id,
  c.id AS cylinder_id,
  c.barcode,
  c.location_partner_id AS cylinder_partner_id
FROM public.rentals r
JOIN public.rental_cylinders rc ON rc.rental_id = r.id AND rc.removed_at IS NULL
JOIN public.cylinders c ON c.id = rc.cylinder_id
WHERE r.status = 'active'
  AND coalesce(c.is_temporary, false) = false
  AND c.barcode NOT ILIKE 'TEMP%'
  AND c.location_type = 'customer'
  AND c.location_partner_id IS DISTINCT FROM r.partner_id;


-- =============================================================================
-- SZAKASZ 3: KÖLCSÖNÖK
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3.1 Aktív kölcsön – hiányzó palack
-- Cél: cylinder_id mindig létező palackra mutat.
-- PASS: 0 sor.
-- FAIL jelentése: Törött kölcsön FK.
-- -----------------------------------------------------------------------------
SELECT
  '3.1 active_loan_missing_cylinder' AS check_id,
  cl.id AS loan_id,
  cl.cylinder_id
FROM public.cylinder_loans cl
LEFT JOIN public.cylinders c ON c.id = cl.cylinder_id
WHERE cl.status = 'active'
  AND c.id IS NULL;


-- -----------------------------------------------------------------------------
-- 3.2 Aktív kölcsön – hiányzó partner
-- Cél: partner_id mindig létező partnerre mutat.
-- PASS: 0 sor.
-- FAIL jelentése: Törött kölcsön FK.
-- -----------------------------------------------------------------------------
SELECT
  '3.2 active_loan_missing_partner' AS check_id,
  cl.id AS loan_id,
  cl.partner_id
FROM public.cylinder_loans cl
LEFT JOIN public.partners p ON p.id = cl.partner_id
WHERE cl.status = 'active'
  AND (cl.partner_id IS NULL OR p.id IS NULL);


-- -----------------------------------------------------------------------------
-- 3.3 Aktív kölcsön – palack nem a kölcsön partnernél (customer)
-- Cél: Aktív kölcsönnél a palack a partnernél van.
-- PASS: 0 sor.
-- FAIL jelentése: Kölcsön palack telephelyen vagy rossz partnernél.
-- -----------------------------------------------------------------------------
SELECT
  '3.3 active_loan_wrong_location' AS check_id,
  cl.id AS loan_id,
  cl.partner_id,
  c.id AS cylinder_id,
  c.barcode,
  c.location_type,
  c.location_partner_id
FROM public.cylinder_loans cl
JOIN public.cylinders c ON c.id = cl.cylinder_id
WHERE cl.status = 'active'
  AND (
    c.location_type <> 'customer'
    OR c.location_partner_id IS DISTINCT FROM cl.partner_id
  );


-- -----------------------------------------------------------------------------
-- 3.4 Lezárt kölcsön – returned_at hiány
-- Cél: status=returned → returned_at kitöltve.
-- PASS: 0 sor.
-- FAIL jelentése: Inkonzisztens lezárt kölcsön.
-- -----------------------------------------------------------------------------
SELECT
  '3.4 returned_loan_missing_returned_at' AS check_id,
  id AS loan_id,
  status,
  returned_at,
  returned_cylinder_id
FROM public.cylinder_loans
WHERE status = 'returned'
  AND returned_at IS NULL;


-- -----------------------------------------------------------------------------
-- 3.5 Lezárt kölcsön – visszahozott palack még customer helyen
-- Cél: Visszavétel után a returned_cylinder telephelyre került.
-- PASS: 0 sor.
-- FAIL jelentése: Visszavett palack még partnernél van.
-- -----------------------------------------------------------------------------
SELECT
  '3.5 returned_loan_cylinder_still_at_customer' AS check_id,
  cl.id AS loan_id,
  cl.returned_cylinder_id,
  c.barcode,
  c.location_type,
  c.location_partner_id,
  c.status
FROM public.cylinder_loans cl
JOIN public.cylinders c ON c.id = cl.returned_cylinder_id
WHERE cl.status = 'returned'
  AND cl.returned_cylinder_id IS NOT NULL
  AND c.location_type = 'customer';


-- =============================================================================
-- SZAKASZ 4: GYORS CSERE (exchanges)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 4.1 Exchange – törött palack hivatkozás
-- Cél: incoming/outgoing cylinder ID-k létező rekordok.
-- PASS: 0 sor.
-- FAIL jelentése: Csere nem követhető palackokra.
-- -----------------------------------------------------------------------------
SELECT
  '4.1 exchange_missing_cylinder' AS check_id,
  e.id AS exchange_id,
  e.incoming_cylinder_id,
  e.outgoing_cylinder_id,
  e.created_at
FROM public.exchanges e
LEFT JOIN public.cylinders ci ON ci.id = e.incoming_cylinder_id
LEFT JOIN public.cylinders co ON co.id = e.outgoing_cylinder_id
WHERE (e.incoming_cylinder_id IS NOT NULL AND ci.id IS NULL)
   OR (e.outgoing_cylinder_id IS NOT NULL AND co.id IS NULL);


-- -----------------------------------------------------------------------------
-- 4.2 Invoiced=true de invoiced_at NULL (ha oszlop létezik)
-- Cél: Kiszámlázás flag konzisztens.
-- PASS: 0 sor.
-- FAIL jelentése: Ellentmondó számlázási állapot.
-- Megjegyzés: invoiced=false NEM hiba (számlázási modul fejlesztés alatt).
-- -----------------------------------------------------------------------------
SELECT
  '4.2 invoiced_without_timestamp' AS check_id,
  id AS exchange_id,
  invoiced,
  invoiced_at,
  created_at
FROM public.exchanges
WHERE invoiced = true
  AND invoiced_at IS NULL;


-- -----------------------------------------------------------------------------
-- 4.3 Gyors csere – hiányzó partner
-- Cél: Minden exchange-hez létezik partner.
-- PASS: 0 sor.
-- FAIL jelentése: Árva csere rekord.
-- -----------------------------------------------------------------------------
SELECT
  '4.3 exchange_missing_partner' AS check_id,
  e.id AS exchange_id,
  e.partner_id
FROM public.exchanges e
LEFT JOIN public.partners p ON p.id = e.partner_id
WHERE e.partner_id IS NULL OR p.id IS NULL;


-- =============================================================================
-- SZAKASZ 5: BESZÁLLÍTÓI CSERE
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 5.1 supplier_exchanges – törött palack ID a tömbben (friss: 90 nap)
-- Cél: Aktuális időszakban minden hivatkozás élő palack.
-- PASS: 0 sor (90 napon belül).
-- FAIL jelentése: Friss beszállítói csere törött palack hivatkozással.
-- -----------------------------------------------------------------------------
SELECT
  '5.1 supplier_exchange_missing_cylinder_recent' AS check_id,
  se.id AS supplier_exchange_id,
  se.created_at,
  cid AS missing_cylinder_id
FROM public.supplier_exchanges se
CROSS JOIN LATERAL unnest(se.returned_cylinder_ids || se.received_cylinder_ids) AS cid
LEFT JOIN public.cylinders c ON c.id = cid
WHERE c.id IS NULL
  AND se.created_at >= (now() - interval '90 days');


-- -----------------------------------------------------------------------------
-- 5.2 supplier_exchanges – törött palack ID (régi, >90 nap) – INFO/WARNING lista
-- Cél: Audit gap felderítése – nem aktuális készlet FAIL.
-- PASS/WARNING: Csak régi rekordok érintettek.
-- -----------------------------------------------------------------------------
SELECT
  '5.2 supplier_exchange_missing_cylinder_historical' AS check_id,
  se.id AS supplier_exchange_id,
  se.created_at,
  cid AS missing_cylinder_id
FROM public.supplier_exchanges se
CROSS JOIN LATERAL unnest(se.returned_cylinder_ids || se.received_cylinder_ids) AS cid
LEFT JOIN public.cylinders c ON c.id = cid
WHERE c.id IS NULL
  AND se.created_at < (now() - interval '90 days')
ORDER BY se.created_at;


-- -----------------------------------------------------------------------------
-- 5.3 supplier_exchanges – hiányzó supplier
-- Cél: Minden supplier_exchange-hez létezik supplier.
-- PASS: 0 sor.
-- FAIL jelentése: Törött beszállító FK.
-- -----------------------------------------------------------------------------
SELECT
  '5.3 supplier_exchange_missing_supplier' AS check_id,
  se.id AS supplier_exchange_id,
  se.supplier_id
FROM public.supplier_exchanges se
LEFT JOIN public.suppliers s ON s.id = se.supplier_id
WHERE se.supplier_id IS NULL OR s.id IS NULL;


-- =============================================================================
-- SZAKASZ 6: HISTORY
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 6.1 History – palack nélkül (orphan)
-- Cél: Minden history rekordhoz létezik palack.
-- PASS: 0 sor.
-- FAIL jelentése: FK integritás sérülés.
-- -----------------------------------------------------------------------------
SELECT
  '6.1 history_orphan_cylinder' AS check_id,
  h.id AS history_id,
  h.cylinder_id,
  h.event_type,
  h.created_at
FROM public.cylinder_history h
LEFT JOIN public.cylinders c ON c.id = h.cylinder_id
WHERE c.id IS NULL;


-- -----------------------------------------------------------------------------
-- 6.2 History – jövőbeli created_at
-- Cél: Időrend ésszerű (nincs jövőbeli esemény).
-- PASS: 0 sor.
-- WARNING jelentése: Óra/sync probléma gyanú.
-- -----------------------------------------------------------------------------
SELECT
  '6.2 history_future_timestamp' AS check_id,
  id AS history_id,
  cylinder_id,
  event_type,
  created_at
FROM public.cylinder_history
WHERE created_at > (now() + interval '5 minutes');


-- -----------------------------------------------------------------------------
-- 6.3 History – ismeretlen event_type
-- Cél: Csak kódban használt típusok.
-- PASS: 0 ismeretlen.
-- WARNING: Új típus – frissítsd a listát docs/sql-ben.
-- -----------------------------------------------------------------------------
SELECT
  '6.3 history_unknown_event_type' AS check_id,
  h.event_type,
  count(*) AS occurrence_count
FROM public.cylinder_history h
WHERE h.event_type NOT IN (
  'cylinder_created', 'temp_created', 'status_change', 'manufacturer_change',
  'owner_change', 'gas_type_change', 'size_change', 'pressure_test_year_change',
  'barcode_change', 'circulation_change', 'quick_exchange', 'partner_issue',
  'partner_return', 'partner_sale', 'rental_start', 'rental_extend',
  'rental_expiry_change', 'rental_close', 'loan_issue', 'loan_return_full',
  'loan_return_empty', 'supplier_exchange', 'supplier_received_from',
  'chinese_brought', 'chinese_take', 'complaint_opened', 'complaint_closed',
  'temp_to_serial', 'temp_to_real', 'temp_to_chinese', 'location_change',
  'warehouse_arrival', 'forced_substitution', 'circulation_difference_created',
  'circulation_difference_settled', 'rental_reassign', 'note_added'
)
GROUP BY h.event_type
ORDER BY occurrence_count DESC;


-- -----------------------------------------------------------------------------
-- 6.4 History – törött related_cylinder_id
-- Cél: related_* UUID-k érvényes rekordra mutatnak.
-- PASS: 0 sor.
-- FAIL jelentése: Előélet link törött.
-- -----------------------------------------------------------------------------
SELECT
  '6.4 history_broken_related_cylinder' AS check_id,
  h.id AS history_id,
  h.event_type,
  h.related_cylinder_id
FROM public.cylinder_history h
LEFT JOIN public.cylinders c ON c.id = h.related_cylinder_id
WHERE h.related_cylinder_id IS NOT NULL
  AND c.id IS NULL;


-- -----------------------------------------------------------------------------
-- 6.5 History – törött related_exchange_id
-- PASS: 0 sor. FAIL: törött exchange link.
-- -----------------------------------------------------------------------------
SELECT
  '6.5 history_broken_related_exchange' AS check_id,
  h.id AS history_id,
  h.event_type,
  h.related_exchange_id
FROM public.cylinder_history h
LEFT JOIN public.exchanges e ON e.id = h.related_exchange_id
WHERE h.related_exchange_id IS NOT NULL
  AND e.id IS NULL;


-- =============================================================================
-- SZAKASZ 7: EVENTS (Global Event Engine)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 7.1 Event Engine health (JSON)
-- Cél: orphan_events=0, missing_links=0, duplicate_groups=0.
-- PASS: healthy=true.
-- FAIL: healthy=false vagy ERROR diagnostic.
-- Megjegyzés: Régi history events nélkül NEM FAIL.
-- -----------------------------------------------------------------------------
SELECT public.event_engine_health() AS event_engine_health;


-- -----------------------------------------------------------------------------
-- 7.2 Event Engine diagnostic – ERROR szint
-- Cél: Nincs ERROR szintű integritás hiba.
-- PASS: 0 ERROR sor.
-- FAIL: ≥1 ERROR.
-- -----------------------------------------------------------------------------
SELECT
  '7.2 event_engine_diagnostic_errors' AS check_id,
  level,
  category,
  message,
  detail_count
FROM public.event_engine_diagnostic()
WHERE level = 'ERROR';


-- -----------------------------------------------------------------------------
-- 7.3 Events – orphan (entity_id nem létező cylinder)
-- Cél: events.entity_type=cylinder → entity_id létezik.
-- PASS: 0 sor.
-- FAIL jelentése: Árva event rekord.
-- -----------------------------------------------------------------------------
SELECT
  '7.3 events_orphan_cylinder_entity' AS check_id,
  e.id AS event_id,
  e.event_type,
  e.entity_id,
  e.created_at
FROM public.events e
LEFT JOIN public.cylinders c ON c.id = e.entity_id
WHERE e.entity_type = 'cylinder'
  AND c.id IS NULL;


-- -----------------------------------------------------------------------------
-- 7.4 Events – missing link (event_group_id a history-ban, de nincs events)
-- Cél: Dual-write kapcsolat az új eseményeknél.
-- PASS: 0 sor (ahol event_group_id kitöltve a wired típusoknál).
-- WARNING: Historikus gap – nem FAIL.
-- -----------------------------------------------------------------------------
SELECT
  '7.4 events_missing_for_history_group' AS check_id,
  h.event_group_id,
  h.event_type,
  count(*) AS history_rows
FROM public.cylinder_history h
WHERE h.event_group_id IS NOT NULL
  AND h.event_type IN ('quick_exchange', 'supplier_exchange', 'temp_to_real', 'temp_to_chinese')
  AND NOT EXISTS (
    SELECT 1 FROM public.events ev WHERE ev.event_group_id = h.event_group_id
  )
GROUP BY h.event_group_id, h.event_type
ORDER BY history_rows DESC
LIMIT 20;


-- =============================================================================
-- SZAKASZ 8: TEMP PALACKOK
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 8.1 TEMP customer helyen partner NÉLKÜL – FAIL
-- Cél: TEMP partnernél = ismert hely; partner nélkül = definiálatlan.
-- PASS: 0 sor.
-- FAIL jelentése: TEMP „eltűnt” (nincs partner).
-- Megjegyzés: TEMP partnernél partnerrel = ÜZLETILEG HELYES, nem hiba.
-- -----------------------------------------------------------------------------
SELECT
  '8.1 temp_at_customer_without_partner' AS check_id,
  c.id,
  c.barcode,
  c.location_type,
  c.location_partner_id,
  c.rental_id
FROM public.cylinders c
WHERE c.active = true
  AND (
    coalesce(c.is_temporary, false) = true
    OR c.barcode ILIKE 'TEMP%'
  )
  AND c.location_type = 'customer'
  AND c.location_partner_id IS NULL;


-- -----------------------------------------------------------------------------
-- 8.2 Üzletileg helyes TEMP (partnernél) – INFO
-- Cél: Számláló – nem FAIL.
-- -----------------------------------------------------------------------------
SELECT
  '8.2 temp_at_partner_valid' AS check_id,
  count(*) AS valid_temp_at_partner_count
FROM public.cylinders c
WHERE c.active = true
  AND (
    coalesce(c.is_temporary, false) = true
    OR c.barcode ILIKE 'TEMP%'
  )
  AND c.location_type = 'customer'
  AND c.location_partner_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 8.3 Törölhető (deletable) árva TEMP – WARNING, nem FAIL
-- Cél: list_orphan_temp_cylinders – technikai takarítási jelöltek.
-- Megjegyzés: Partnernél lévő TEMP blocking_reason-nal = üzletileg helyes.
-- -----------------------------------------------------------------------------
SELECT
  '8.3 deletable_orphan_temp' AS check_id,
  cylinder_id,
  barcode,
  gas_type,
  size,
  deletable,
  blocking_reason
FROM public.list_orphan_temp_cylinders(true)
WHERE deletable = true
ORDER BY barcode
LIMIT 50;


-- =============================================================================
-- SZAKASZ 9: KÍNAI KÉSZLET
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 9.1 NULL count – FAIL
-- Cél: full_count / empty_count mindig szám.
-- PASS: 0 sor.
-- FAIL jelentése: Definiálatlan készlet sor.
-- -----------------------------------------------------------------------------
SELECT
  '9.1 chinese_stock_null_count' AS check_id,
  id,
  gas_type,
  size,
  full_count,
  empty_count
FROM public.chinese_cylinder_stock
WHERE full_count IS NULL OR empty_count IS NULL;


-- -----------------------------------------------------------------------------
-- 9.2 Negatív készlet – WARNING/INFO (üzletileg megengedett)
-- Cél: Láthatóság – NEM FAIL.
-- Megjegyzés: Kölcsön/adott ki stb. miatt elfogadható.
-- -----------------------------------------------------------------------------
SELECT
  '9.2 chinese_stock_negative' AS check_id,
  id,
  gas_type,
  size,
  full_count,
  empty_count,
  CASE
    WHEN full_count < 0 AND empty_count < 0 THEN 'both_negative'
    WHEN full_count < 0 THEN 'full_negative'
    WHEN empty_count < 0 THEN 'empty_negative'
  END AS negative_kind
FROM public.chinese_cylinder_stock
WHERE full_count < 0 OR empty_count < 0
ORDER BY gas_type, size;


-- =============================================================================
-- SZAKASZ 10: DASHBOARD SZÁMLÁLÓK (adatbázis aggregátumok)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 10.1 Dashboard számlálók – INFO (manuális összevetés a UI-val)
-- Cél: Ugyanazok a számok, amit a dashboard lekérdez.
-- PASS: Belső összhang (lásd 10.2).
-- -----------------------------------------------------------------------------
SELECT
  '10.1 dashboard_db_counts' AS check_id,
  (SELECT count(*) FROM public.cylinders WHERE active = true) AS active_cylinders,
  (SELECT count(*) FROM public.rentals WHERE status = 'active') AS active_rentals,
  (
    SELECT count(*)
    FROM public.rental_cylinders rc
    JOIN public.rentals r ON r.id = rc.rental_id AND r.status = 'active'
    WHERE rc.removed_at IS NULL
  ) AS rented_cylinders_in_active_rentals,
  (SELECT count(*) FROM public.cylinder_loans WHERE status = 'active') AS active_loans,
  (
    SELECT count(*)
    FROM public.exchanges
    WHERE invoiced = false AND profit IS NOT NULL
  ) AS uninvoiced_with_profit,
  (
    SELECT count(*)
    FROM public.exchanges
    WHERE is_forced_substitution = true
  ) AS forced_substitution_total,
  (
    SELECT count(*)
    FROM public.cylinders
    WHERE active = true AND location_type = 'customer'
  ) AS cylinders_at_customer,
  (
    SELECT count(*)
    FROM public.cylinders
    WHERE active = true AND location_type = 'warehouse_full' AND status = 'full'
  ) AS warehouse_full_count,
  (
    SELECT count(*)
    FROM public.cylinders
    WHERE active = true AND location_type = 'warehouse_empty' AND status = 'empty'
  ) AS warehouse_empty_count;


-- -----------------------------------------------------------------------------
-- 10.2 Dashboard belső összhang – warehouse + customer + supplier <= active
-- Cél: Hely szerinti bontás nem haladja meg az aktív palack számot logikailag.
-- PASS: 0 sor (nincs ellentmondás).
-- FAIL: Szumma helyek > active (dupla számolás gyanú – ritka).
-- -----------------------------------------------------------------------------
SELECT
  '10.2 dashboard_location_sum_check' AS check_id,
  active_total,
  location_bucket_sum,
  active_total - location_bucket_sum AS difference
FROM (
  SELECT
    (SELECT count(*) FROM public.cylinders WHERE active = true) AS active_total,
    (
      SELECT count(*)
      FROM public.cylinders
      WHERE active = true
        AND location_type IN (
          'customer', 'warehouse_full', 'warehouse_empty', 'siad', 'own_supplier'
        )
    ) AS location_bucket_sum
) s
WHERE location_bucket_sum > active_total;


-- =============================================================================
-- SZAKASZ 11: ESZKÖZ- ÉS FOGYÓANYAG-KÉSZLET
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 11.1 Negatív darabszámos készlet
-- PASS: 0 sor.
-- -----------------------------------------------------------------------------
SELECT
  '11.1 supply_negative_stock' AS check_id,
  id,
  natural_key,
  name,
  current_stock
FROM public.supply_products
WHERE stock_kind = 'quantity'
  AND (current_stock IS NULL OR current_stock < 0);


-- -----------------------------------------------------------------------------
-- 11.2 Duplikált natural_key
-- PASS: 0 sor.
-- -----------------------------------------------------------------------------
SELECT
  '11.2 supply_duplicate_natural_key' AS check_id,
  natural_key,
  count(*) AS duplicate_count
FROM public.supply_products
GROUP BY natural_key
HAVING count(*) > 1;


-- -----------------------------------------------------------------------------
-- 11.3 Movement stock_before/stock_after inkonzisztencia
-- PASS: 0 sor.
-- -----------------------------------------------------------------------------
SELECT
  '11.3 supply_movement_stock_mismatch' AS check_id,
  m.id,
  m.product_id,
  m.movement_type,
  m.stock_before,
  m.stock_after,
  m.quantity
FROM public.supply_stock_movements m
WHERE m.stock_after <> (
  m.stock_before + CASE
    WHEN m.movement_type IN ('receipt', 'customer_return', 'correction_increase', 'rental_return')
      THEN m.quantity
    WHEN m.movement_type IN ('sale', 'correction_decrease', 'scrap', 'internal_use', 'rental_out')
      THEN -m.quantity
    WHEN m.movement_type = 'stocktake_delta'
      THEN m.stock_after - m.stock_before
    ELSE 0
  END
);


-- -----------------------------------------------------------------------------
-- 11.4 Mozgások összege vs aktuális készlet
-- PASS: 0 sor.
-- -----------------------------------------------------------------------------
SELECT
  '11.4 supply_stock_movement_sum_mismatch' AS check_id,
  p.id,
  p.natural_key,
  p.current_stock AS product_stock,
  coalesce(sum(
    CASE
      WHEN m.movement_type IN ('receipt', 'customer_return', 'correction_increase', 'rental_return')
        THEN m.quantity
      WHEN m.movement_type IN ('sale', 'correction_decrease', 'scrap', 'internal_use', 'rental_out')
        THEN -m.quantity
      WHEN m.movement_type = 'stocktake_delta'
        THEN m.stock_after - m.stock_before
      ELSE 0
    END
  ), 0)::integer AS movement_net
FROM public.supply_products p
LEFT JOIN public.supply_stock_movements m ON m.product_id = p.id
WHERE p.stock_kind = 'quantity'
GROUP BY p.id, p.natural_key, p.current_stock
HAVING p.current_stock IS DISTINCT FROM coalesce(sum(
  CASE
    WHEN m.movement_type IN ('receipt', 'customer_return', 'correction_increase', 'rental_return')
      THEN m.quantity
    WHEN m.movement_type IN ('sale', 'correction_decrease', 'scrap', 'internal_use', 'rental_out')
      THEN -m.quantity
    WHEN m.movement_type = 'stocktake_delta'
      THEN m.stock_after - m.stock_before
    ELSE 0
  END
), 0)::integer;


-- -----------------------------------------------------------------------------
-- 11.5 Eladás partner nélkül
-- PASS: 0 sor.
-- -----------------------------------------------------------------------------
SELECT
  '11.5 supply_sale_without_partner' AS check_id,
  s.id,
  s.partner_id
FROM public.supply_sales s
WHERE s.partner_id IS NULL;


-- -----------------------------------------------------------------------------
-- 11.6 Eladás movement nélkül (sale típus)
-- PASS: 0 sor.
-- -----------------------------------------------------------------------------
SELECT
  '11.6 supply_sale_without_movement' AS check_id,
  s.id
FROM public.supply_sales s
WHERE NOT EXISTS (
  SELECT 1 FROM public.supply_stock_movements m
  WHERE m.related_sale_id = s.id AND m.movement_type = 'sale'
);


-- -----------------------------------------------------------------------------
-- 11.7 Billing queue eladás nélkül
-- PASS: 0 sor.
-- -----------------------------------------------------------------------------
SELECT
  '11.7 supply_billing_without_sale' AS check_id,
  b.id,
  b.sale_id
FROM public.supply_billing_queue b
LEFT JOIN public.supply_sales s ON s.id = b.sale_id
WHERE s.id IS NULL;


-- -----------------------------------------------------------------------------
-- 11.8 Értékesítés eladási ár nélkül (sikeres sale item)
-- PASS: 0 sor.
-- -----------------------------------------------------------------------------
SELECT
  '11.8 supply_sale_without_price' AS check_id,
  si.sale_id,
  si.product_id,
  si.unit_price
FROM public.supply_sale_items si
WHERE si.unit_price IS NULL OR si.unit_price <= 0;


-- -----------------------------------------------------------------------------
-- 11.9 Inaktív termékre értékesítés
-- PASS: 0 sor.
-- -----------------------------------------------------------------------------
SELECT
  '11.9 supply_sale_inactive_product' AS check_id,
  si.sale_id,
  si.product_id,
  p.is_active
FROM public.supply_sale_items si
JOIN public.supply_products p ON p.id = si.product_id
WHERE NOT p.is_active;


-- -----------------------------------------------------------------------------
-- 11.10 Induló seed termékek és mennyiségek
-- PASS: 0 sor (mind a 3 termék megvan a helyes készlettel).
-- -----------------------------------------------------------------------------
SELECT
  '11.10 supply_seed_stock_mismatch' AS check_id,
  expected.natural_key,
  expected.expected_stock,
  p.current_stock
FROM (
  VALUES
    ('supply:mixgas-regulator', 3),
    ('supply:welding-wire-1.0-15kg', 2),
    ('supply:welding-wire-0.8-15kg', 2)
) AS expected(natural_key, expected_stock)
LEFT JOIN public.supply_products p ON p.natural_key = expected.natural_key
WHERE p.id IS NULL OR p.current_stock IS DISTINCT FROM expected.expected_stock;


-- =============================================================================
-- ÖSSZEFOGLALÓ – Business invariant check
-- =============================================================================
-- Cél: Egy futtatásból olvasható PASS/WARNING/FAIL összkép.
-- PASS: violations = 0 minden FAIL-kategóriában.
-- WARNING: nincs FAIL, de warning_signals > 0.
-- FAIL: bármely fail_violations > 0.
-- -----------------------------------------------------------------------------

WITH
fail_1 AS (
  SELECT (
    (SELECT count(*) FROM (SELECT 1 FROM public.cylinders WHERE active = true AND coalesce(is_temporary, false) = false AND barcode NOT ILIKE 'TEMP%' GROUP BY barcode HAVING count(*) > 1) d)
    + (SELECT count(*) FROM (SELECT 1 FROM public.cylinders WHERE active = true AND location_type = 'customer' AND location_partner_id IS NOT NULL AND coalesce(is_temporary, false) = false AND barcode NOT ILIKE 'TEMP%' GROUP BY lower(trim(barcode)) HAVING count(DISTINCT location_partner_id) > 1) d)
    + (SELECT count(*) FROM (SELECT 1 FROM public.cylinder_loans WHERE status = 'active' GROUP BY cylinder_id HAVING count(*) > 1) d)
    + (SELECT count(*) FROM (SELECT 1 FROM public.rental_cylinders rc JOIN public.rentals r ON r.id = rc.rental_id AND r.status = 'active' JOIN public.cylinders c ON c.id = rc.cylinder_id WHERE rc.removed_at IS NULL AND coalesce(c.is_temporary, false) = false AND c.barcode NOT ILIKE 'TEMP%' GROUP BY rc.cylinder_id HAVING count(*) > 1) d)
    + (SELECT count(*) FROM (SELECT 1 FROM public.rentals WHERE status = 'active' AND current_cylinder_id IS NOT NULL GROUP BY current_cylinder_id HAVING count(*) > 1) d)
    + (SELECT count(*) FROM public.cylinder_loans cl JOIN public.cylinders c ON c.id = cl.cylinder_id JOIN public.rental_cylinders rc ON rc.cylinder_id = c.id AND rc.removed_at IS NULL JOIN public.rentals r ON r.id = rc.rental_id AND r.status = 'active' WHERE cl.status = 'active' AND coalesce(c.is_temporary, false) = false AND c.barcode NOT ILIKE 'TEMP%')
    + (SELECT count(*) FROM public.cylinders c1 JOIN public.cylinders c2 ON lower(trim(c2.barcode)) = lower(trim(c1.barcode)) AND c2.id <> c1.id AND c2.active = true WHERE c1.active = true AND c1.location_type = 'customer' AND c2.location_type IN ('warehouse_full', 'warehouse_empty') AND coalesce(c1.is_temporary, false) = false AND coalesce(c2.is_temporary, false) = false AND c1.barcode NOT ILIKE 'TEMP%')
    + (SELECT count(*) FROM public.cylinders WHERE active = true AND (location_type IS NULL OR status IS NULL))
    + (SELECT count(*) FROM public.cylinders WHERE active = true AND location_type IS DISTINCT FROM 'customer' AND location_partner_id IS NOT NULL)
    + (SELECT count(*) FROM public.cylinders WHERE active = true AND location_type NOT IN ('siad', 'own_supplier') AND location_supplier_id IS NOT NULL)
    + (SELECT count(*) FROM public.cylinders WHERE active = true AND ((status = 'full' AND location_type = 'warehouse_empty') OR (status = 'empty' AND location_type = 'warehouse_full')))
    + (SELECT count(*) FROM public.v_cylinder_custody WHERE is_missing_or_inconsistent = true)
  )::bigint AS violations
),
fail_2 AS (
  SELECT (
    (SELECT count(*) FROM public.rentals r LEFT JOIN public.partners p ON p.id = r.partner_id WHERE r.status = 'active' AND (r.partner_id IS NULL OR p.id IS NULL))
    + (SELECT count(*) FROM public.rental_quantity_items rqi JOIN public.rentals r ON r.id = rqi.rental_id AND r.status = 'active' WHERE rqi.removed_at IS NULL AND (rqi.quantity IS NULL OR rqi.quantity <= 0))
    + (SELECT count(*) FROM public.rentals r JOIN public.rental_cylinders rc ON rc.rental_id = r.id AND rc.removed_at IS NULL JOIN public.cylinders c ON c.id = rc.cylinder_id WHERE r.status = 'active' AND coalesce(c.is_temporary, false) = false AND c.barcode NOT ILIKE 'TEMP%' AND c.location_type = 'customer' AND c.location_partner_id IS DISTINCT FROM r.partner_id)
  )::bigint AS violations
),
fail_3 AS (
  SELECT (
    (SELECT count(*) FROM public.cylinder_loans cl LEFT JOIN public.cylinders c ON c.id = cl.cylinder_id WHERE cl.status = 'active' AND c.id IS NULL)
    + (SELECT count(*) FROM public.cylinder_loans cl LEFT JOIN public.partners p ON p.id = cl.partner_id WHERE cl.status = 'active' AND (cl.partner_id IS NULL OR p.id IS NULL))
    + (SELECT count(*) FROM public.cylinder_loans cl JOIN public.cylinders c ON c.id = cl.cylinder_id WHERE cl.status = 'active' AND (c.location_type <> 'customer' OR c.location_partner_id IS DISTINCT FROM cl.partner_id))
    + (SELECT count(*) FROM public.cylinder_loans WHERE status = 'returned' AND returned_at IS NULL)
    + (SELECT count(*) FROM public.cylinder_loans cl JOIN public.cylinders c ON c.id = cl.returned_cylinder_id WHERE cl.status = 'returned' AND cl.returned_cylinder_id IS NOT NULL AND c.location_type = 'customer')
  )::bigint AS violations
),
fail_4 AS (
  SELECT (
    (SELECT count(*) FROM public.exchanges e LEFT JOIN public.cylinders ci ON ci.id = e.incoming_cylinder_id LEFT JOIN public.cylinders co ON co.id = e.outgoing_cylinder_id WHERE (e.incoming_cylinder_id IS NOT NULL AND ci.id IS NULL) OR (e.outgoing_cylinder_id IS NOT NULL AND co.id IS NULL))
    + (SELECT count(*) FROM public.exchanges WHERE invoiced = true AND invoiced_at IS NULL)
    + (SELECT count(*) FROM public.exchanges e LEFT JOIN public.partners p ON p.id = e.partner_id WHERE e.partner_id IS NULL OR p.id IS NULL)
  )::bigint AS violations
),
fail_5 AS (
  SELECT (
    (SELECT count(*) FROM public.supplier_exchanges se CROSS JOIN LATERAL unnest(se.returned_cylinder_ids || se.received_cylinder_ids) AS cid LEFT JOIN public.cylinders c ON c.id = cid WHERE c.id IS NULL AND se.created_at >= (now() - interval '90 days'))
    + (SELECT count(*) FROM public.supplier_exchanges se LEFT JOIN public.suppliers s ON s.id = se.supplier_id WHERE se.supplier_id IS NULL OR s.id IS NULL)
  )::bigint AS violations
),
fail_6 AS (
  SELECT (
    (SELECT count(*) FROM public.cylinder_history h LEFT JOIN public.cylinders c ON c.id = h.cylinder_id WHERE c.id IS NULL)
    + (SELECT count(*) FROM public.cylinder_history h LEFT JOIN public.cylinders c ON c.id = h.related_cylinder_id WHERE h.related_cylinder_id IS NOT NULL AND c.id IS NULL)
    + (SELECT count(*) FROM public.cylinder_history h LEFT JOIN public.exchanges e ON e.id = h.related_exchange_id WHERE h.related_exchange_id IS NOT NULL AND e.id IS NULL)
  )::bigint AS violations
),
fail_7 AS (
  SELECT (
    (SELECT count(*) FROM public.event_engine_diagnostic() WHERE level = 'ERROR')
    + (SELECT count(*) FROM public.events e LEFT JOIN public.cylinders c ON c.id = e.entity_id WHERE e.entity_type = 'cylinder' AND c.id IS NULL)
    + CASE WHEN coalesce((public.event_engine_health()->>'healthy')::boolean, false) = false THEN 1 ELSE 0 END
  )::bigint AS violations
),
fail_8 AS (
  SELECT (
    SELECT count(*) FROM public.cylinders c
    WHERE c.active = true
      AND (coalesce(c.is_temporary, false) = true OR c.barcode ILIKE 'TEMP%')
      AND c.location_type = 'customer'
      AND c.location_partner_id IS NULL
  )::bigint AS violations
),
fail_9 AS (
  SELECT (SELECT count(*) FROM public.chinese_cylinder_stock WHERE full_count IS NULL OR empty_count IS NULL)::bigint AS violations
),
fail_10 AS (
  SELECT (
    SELECT CASE WHEN location_bucket_sum > active_total THEN 1 ELSE 0 END
    FROM (
      SELECT
        (SELECT count(*) FROM public.cylinders WHERE active = true) AS active_total,
        (SELECT count(*) FROM public.cylinders WHERE active = true AND location_type IN ('customer', 'warehouse_full', 'warehouse_empty', 'siad', 'own_supplier')) AS location_bucket_sum
    ) x
  )::bigint AS violations
),
fail_11 AS (
  SELECT (
    (SELECT count(*) FROM public.supply_products WHERE stock_kind = 'quantity' AND (current_stock IS NULL OR current_stock < 0))
    + (SELECT count(*) FROM (SELECT 1 FROM public.supply_products GROUP BY natural_key HAVING count(*) > 1) d)
    + (SELECT count(*) FROM public.supply_sales WHERE partner_id IS NULL)
    + (SELECT count(*) FROM public.supply_sales s WHERE NOT EXISTS (SELECT 1 FROM public.supply_stock_movements m WHERE m.related_sale_id = s.id AND m.movement_type = 'sale'))
    + (SELECT count(*) FROM public.supply_billing_queue b LEFT JOIN public.supply_sales s ON s.id = b.sale_id WHERE s.id IS NULL)
    + (SELECT count(*) FROM public.supply_sale_items si WHERE si.unit_price IS NULL OR si.unit_price <= 0)
    + (SELECT count(*) FROM public.supply_sale_items si JOIN public.supply_products p ON p.id = si.product_id WHERE NOT p.is_active)
    + (
      SELECT count(*)
      FROM (
        VALUES
          ('supply:mixgas-regulator', 3),
          ('supply:welding-wire-1.0-15kg', 2),
          ('supply:welding-wire-0.8-15kg', 2)
      ) AS expected(natural_key, expected_stock)
      LEFT JOIN public.supply_products p ON p.natural_key = expected.natural_key
      WHERE p.id IS NULL OR p.current_stock IS DISTINCT FROM expected.expected_stock
    )
  )::bigint AS violations
),
warn_signals AS (
  SELECT (
    (SELECT count(*) FROM public.chinese_cylinder_stock WHERE full_count < 0 OR empty_count < 0)
    + (SELECT count(*) FROM public.list_orphan_temp_cylinders(true) WHERE deletable = true)
    + (SELECT count(*) FROM public.cylinder_history WHERE created_at > (now() + interval '5 minutes'))
    + (SELECT count(*) FROM public.event_engine_diagnostic() WHERE level = 'WARNING')
    + (SELECT count(*) FROM public.supplier_exchanges se CROSS JOIN LATERAL unnest(se.returned_cylinder_ids || se.received_cylinder_ids) AS cid LEFT JOIN public.cylinders c ON c.id = cid WHERE c.id IS NULL AND se.created_at < (now() - interval '90 days'))
    + (SELECT count(DISTINCT h.event_type) FROM public.cylinder_history h WHERE h.event_type NOT IN (
      'cylinder_created', 'temp_created', 'status_change', 'manufacturer_change', 'owner_change',
      'gas_type_change', 'size_change', 'pressure_test_year_change', 'barcode_change', 'circulation_change',
      'quick_exchange', 'partner_issue', 'partner_return', 'partner_sale', 'rental_start', 'rental_extend',
      'rental_expiry_change', 'rental_close', 'loan_issue', 'loan_return_full', 'loan_return_empty',
      'supplier_exchange', 'supplier_received_from', 'chinese_brought', 'chinese_take', 'complaint_opened',
      'complaint_closed', 'temp_to_serial', 'temp_to_real', 'temp_to_chinese', 'location_change',
      'warehouse_arrival', 'forced_substitution', 'circulation_difference_created',
      'circulation_difference_settled', 'rental_reassign', 'note_added'
    ))
  )::bigint AS warning_count
),
sections AS (
  SELECT 'Palack integritás' AS section_name, fail_1.violations, CASE WHEN fail_1.violations = 0 THEN 'PASS' ELSE 'FAIL' END AS status FROM fail_1
  UNION ALL SELECT 'Bérletek', fail_2.violations, CASE WHEN fail_2.violations = 0 THEN 'PASS' ELSE 'FAIL' END FROM fail_2
  UNION ALL SELECT 'Kölcsönök', fail_3.violations, CASE WHEN fail_3.violations = 0 THEN 'PASS' ELSE 'FAIL' END FROM fail_3
  UNION ALL SELECT 'Gyors csere', fail_4.violations, CASE WHEN fail_4.violations = 0 THEN 'PASS' ELSE 'FAIL' END FROM fail_4
  UNION ALL SELECT 'Beszállítói csere', fail_5.violations, CASE WHEN fail_5.violations = 0 THEN 'PASS' ELSE 'FAIL' END FROM fail_5
  UNION ALL SELECT 'History', fail_6.violations, CASE WHEN fail_6.violations = 0 THEN 'PASS' ELSE 'FAIL' END FROM fail_6
  UNION ALL SELECT 'Events', fail_7.violations, CASE WHEN fail_7.violations = 0 THEN 'PASS' ELSE 'FAIL' END FROM fail_7
  UNION ALL SELECT 'TEMP', fail_8.violations, CASE WHEN fail_8.violations = 0 THEN 'PASS' ELSE 'FAIL' END FROM fail_8
  UNION ALL SELECT 'Kínai készlet', fail_9.violations, CASE WHEN fail_9.violations = 0 THEN 'PASS' ELSE 'FAIL' END FROM fail_9
  UNION ALL SELECT 'Dashboard', fail_10.violations, CASE WHEN fail_10.violations = 0 THEN 'PASS' ELSE 'FAIL' END FROM fail_10
  UNION ALL SELECT 'Eszköz- és fogyóanyag-készlet', fail_11.violations, CASE WHEN fail_11.violations = 0 THEN 'PASS' ELSE 'FAIL' END FROM fail_11
),
warning_detail AS (
  SELECT 'Figyelmeztetések (összes)' AS section_name, warn_signals.warning_count AS violations, CASE WHEN warn_signals.warning_count = 0 THEN 'PASS' ELSE 'WARNING' END AS status FROM warn_signals
),
overall AS (
  SELECT
    coalesce((SELECT sum(CASE WHEN status = 'FAIL' THEN 1 ELSE 0 END) FROM sections), 0) AS fail_sections,
    (SELECT warning_count FROM warn_signals) AS warning_signals
  FROM warn_signals
)
SELECT report_title, section_name, violations, status
FROM (
  SELECT 1 AS ord, 'Business invariant check'::text AS report_title, NULL::text AS section_name, NULL::bigint AS violations, NULL::text AS status
  UNION ALL SELECT 2, '─────────────────────────', NULL, NULL, NULL
  UNION ALL SELECT 3, section_name, section_name, violations, status FROM sections
  UNION ALL SELECT 4, '─────────────────────────', NULL, NULL, NULL
  UNION ALL SELECT 5, warning_detail.section_name, warning_detail.section_name, warning_detail.violations, warning_detail.status FROM warning_detail
  UNION ALL SELECT 6, '─────────────────────────', NULL, NULL, NULL
  UNION ALL SELECT 7, 'Overall:', NULL, NULL,
    CASE
      WHEN (SELECT fail_sections FROM overall) > 0 THEN 'FAIL'
      WHEN (SELECT warning_signals FROM overall) > 0 THEN 'WARNING'
      ELSE 'PASS'
    END
) report
ORDER BY ord, section_name NULLS FIRST;
