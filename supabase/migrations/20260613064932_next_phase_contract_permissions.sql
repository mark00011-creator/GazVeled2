-- Next phase: rentals, operator permissions, contract metadata, PDF support, registry views.
-- Backwards compatible: only additive columns/functions/views and policy replacements.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
UPDATE public.profiles
SET role = 'viewer'
WHERE role NOT IN ('admin', 'operator', 'viewer');
ALTER TABLE public.profiles
ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'operator', 'viewer'));

CREATE OR REPLACE FUNCTION public.is_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.role()) = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = (SELECT auth.uid())
        AND role = 'operator'
    );
$$;

CREATE OR REPLACE FUNCTION public.can_write()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin() OR public.is_operator();
$$;

CREATE OR REPLACE FUNCTION public.require_write()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_write() THEN
    RAISE EXCEPTION 'Write role required' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.is_operator() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.require_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_operator() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.require_write() TO service_role;

ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS deposit_type text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS contract_number text,
  ADD COLUMN IF NOT EXISTS contract_generated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rentals_deposit_type_check'
      AND conrelid = 'public.rentals'::regclass
  ) THEN
    ALTER TABLE public.rentals
      ADD CONSTRAINT rentals_deposit_type_check CHECK (deposit_type IN ('normal', 'waived', 'custom'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS rentals_contract_number_unique
ON public.rentals(contract_number)
WHERE contract_number IS NOT NULL;

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS personal_id_number text,
  ADD COLUMN IF NOT EXISTS address_card_number text,
  ADD COLUMN IF NOT EXISTS id_card_photo_url text,
  ADD COLUMN IF NOT EXISTS address_card_photo_url text,
  ADD COLUMN IF NOT EXISTS gdpr_accepted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gdpr_accepted_at timestamptz;

ALTER TABLE public.cylinders
  ADD COLUMN IF NOT EXISTS replacement_value numeric(12,2) NOT NULL DEFAULT 100000;

CREATE INDEX IF NOT EXISTS cylinders_replacement_value_idx
ON public.cylinders(replacement_value);

CREATE OR REPLACE FUNCTION public.next_contract_number(p_year integer DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  PERFORM public.require_write();
  PERFORM pg_advisory_xact_lock(20260613, p_year);

  SELECT COALESCE(MAX(NULLIF(right(contract_number, 4), '')::integer), 0) + 1
  INTO v_next
  FROM public.rentals
  WHERE contract_number ~ ('^GV-' || p_year::text || '-[0-9]{4}$');

  RETURN 'GV-' || p_year::text || '-' || lpad(v_next::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_rental_contract_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.contract_number IS NULL THEN
    NEW.contract_number := public.next_contract_number(EXTRACT(YEAR FROM NEW.start_date)::integer);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rentals_contract_number ON public.rentals;
CREATE TRIGGER trg_rentals_contract_number
BEFORE INSERT ON public.rentals
FOR EACH ROW
EXECUTE FUNCTION public.set_rental_contract_number();

GRANT EXECUTE ON FUNCTION public.next_contract_number(integer) TO authenticated;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profiles',
    'partners',
    'suppliers',
    'cylinders',
    'movements',
    'exchanges',
    'supplier_exchanges',
    'rentals',
    'rental_cylinders',
    'rental_invoices',
    'bulk_scans',
    'rental_reassignments',
    'audit_log'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || ' insert admin', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || ' update admin', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || ' delete admin', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || ' insert writer', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || ' update writer', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || ' delete admin', table_name);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.can_write()))',
      table_name || ' insert writer',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.can_write())) WITH CHECK ((SELECT public.can_write()))',
      table_name || ' update writer',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((SELECT public.is_admin()))',
      table_name || ' delete admin',
      table_name
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS "user_roles insert admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles update admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles delete admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles insert writer" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles update writer" ON public.user_roles;

CREATE POLICY "user_roles insert writer"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK ((SELECT public.can_write()));

CREATE POLICY "user_roles update writer"
ON public.user_roles
FOR UPDATE
TO authenticated
USING ((SELECT public.can_write()))
WITH CHECK ((SELECT public.can_write()));

CREATE POLICY "user_roles delete admin"
ON public.user_roles
FOR DELETE
TO authenticated
USING ((SELECT public.is_admin()));

CREATE OR REPLACE FUNCTION public.next_temp_barcode()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_write();
  RETURN 'TEMP-' || lpad(nextval('public.temp_cylinder_seq')::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.find_or_create_cylinder(
  p_barcode text,
  p_circulation public.circulation DEFAULT 'own',
  p_owner public.circulation DEFAULT NULL,
  p_status public.cyl_status DEFAULT 'empty',
  p_location_type public.location_type DEFAULT 'warehouse_empty',
  p_gas_type text DEFAULT 'ISMERETLEN',
  p_size text DEFAULT '—'
) RETURNS TABLE(cylinder public.cylinders, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.cylinders;
  v_created boolean := false;
BEGIN
  PERFORM public.require_write();

  IF p_barcode IS NULL OR length(trim(p_barcode)) = 0 THEN
    RAISE EXCEPTION 'Empty barcode';
  END IF;

  SELECT * INTO v_row FROM public.cylinders WHERE barcode = trim(p_barcode);
  IF NOT FOUND THEN
    INSERT INTO public.cylinders (barcode, gas_type, size, circulation, owner, status, location_type, first_tracked_at)
    VALUES (trim(p_barcode), p_gas_type, p_size, p_circulation, COALESCE(p_owner, p_circulation), p_status, p_location_type, now())
    ON CONFLICT (barcode) DO NOTHING
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      SELECT * INTO v_row FROM public.cylinders WHERE barcode = trim(p_barcode);
    ELSE
      v_created := true;
    END IF;
  END IF;

  cylinder := v_row;
  created := v_created;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.record_exchange(
  p_partner_id uuid,
  p_incoming_id uuid,
  p_outgoing_id uuid,
  p_reason text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_rental_id uuid DEFAULT NULL,
  p_reassign_rental boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_in public.cylinders;
  v_out public.cylinders;
  v_uid uuid := auth.uid();
  v_forced boolean;
  v_exchange_id uuid;
BEGIN
  PERFORM public.require_write();

  SELECT * INTO v_in FROM public.cylinders WHERE id = p_incoming_id FOR UPDATE;
  SELECT * INTO v_out FROM public.cylinders WHERE id = p_outgoing_id FOR UPDATE;
  IF v_in.id IS NULL OR v_out.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;
  v_forced := v_in.circulation <> v_out.circulation;
  IF v_forced AND (p_reason IS NULL OR length(trim(p_reason)) = 0) THEN
    RAISE EXCEPTION 'Reason required for forced substitution';
  END IF;

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    is_forced_substitution, reason, rental_reassigned, rental_id, note, created_by
  ) VALUES (
    p_partner_id, v_in.id, v_in.circulation, v_out.id, v_out.circulation,
    v_forced, NULLIF(trim(COALESCE(p_reason,'')), ''), COALESCE(p_reassign_rental,false), p_rental_id, p_note, v_uid
  ) RETURNING id INTO v_exchange_id;

  INSERT INTO public.movements (cylinder_id, from_location, from_partner_id, to_location, status_after, note, created_by)
  VALUES (v_in.id, v_in.location_type, v_in.location_partner_id, 'warehouse_empty', 'empty', 'Gyors csere – üres beérkezett', v_uid);

  INSERT INTO public.movements (cylinder_id, from_location, to_location, to_partner_id, status_after, note, created_by)
  VALUES (v_out.id, v_out.location_type, 'customer', p_partner_id, 'full', 'Gyors csere – teli kiadva', v_uid);

  UPDATE public.cylinders SET location_type = 'warehouse_empty', location_partner_id = NULL, location_supplier_id = NULL WHERE id = v_in.id;
  UPDATE public.cylinders SET location_type = 'customer', location_partner_id = p_partner_id, location_supplier_id = NULL WHERE id = v_out.id;

  IF p_reassign_rental AND p_rental_id IS NOT NULL THEN
    INSERT INTO public.rental_reassignments(rental_id, old_cylinder_id, new_cylinder_id, note, created_by)
    SELECT p_rental_id, current_cylinder_id, v_out.id, 'Gyors csere során', v_uid FROM public.rentals WHERE id = p_rental_id;
    UPDATE public.rentals SET current_cylinder_id = v_out.id, updated_at = now() WHERE id = p_rental_id;
  END IF;

  RETURN v_exchange_id;
END $$;

CREATE OR REPLACE FUNCTION public.record_supplier_exchange(
  p_supplier_id uuid,
  p_returned_barcodes text[],
  p_received_barcodes text[],
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sup public.suppliers;
  v_circ public.circulation;
  v_loc_empty public.location_type;
  v_uid uuid := auth.uid();
  v_bc text;
  v_cyl public.cylinders;
  v_ret_ids uuid[] := '{}';
  v_rec_ids uuid[] := '{}';
  v_ex_id uuid;
BEGIN
  PERFORM public.require_write();

  SELECT * INTO v_sup FROM public.suppliers WHERE id = p_supplier_id;
  IF v_sup.id IS NULL THEN RAISE EXCEPTION 'Missing supplier'; END IF;
  v_circ := CASE WHEN v_sup.kind = 'siad' THEN 'siad'::public.circulation ELSE 'own'::public.circulation END;
  v_loc_empty := v_sup.kind;

  IF p_returned_barcodes IS NOT NULL THEN
    FOREACH v_bc IN ARRAY p_returned_barcodes LOOP
      IF length(trim(v_bc)) = 0 THEN CONTINUE; END IF;
      SELECT (find_or_create_cylinder(v_bc, v_circ, v_circ, 'empty', v_loc_empty)).cylinder INTO v_cyl;
      INSERT INTO public.movements (cylinder_id, from_location, to_location, to_supplier_id, status_after, note, created_by)
      VALUES (v_cyl.id, v_cyl.location_type, v_loc_empty, p_supplier_id, 'empty', 'Beszállítónak visszaadva', v_uid);
      UPDATE public.cylinders SET circulation = v_circ, owner = v_circ, location_type = v_loc_empty,
        location_supplier_id = p_supplier_id, location_partner_id = NULL WHERE id = v_cyl.id;
      v_ret_ids := v_ret_ids || v_cyl.id;
    END LOOP;
  END IF;

  IF p_received_barcodes IS NOT NULL THEN
    FOREACH v_bc IN ARRAY p_received_barcodes LOOP
      IF length(trim(v_bc)) = 0 THEN CONTINUE; END IF;
      SELECT (find_or_create_cylinder(v_bc, v_circ, v_circ, 'full', 'warehouse_full')).cylinder INTO v_cyl;
      INSERT INTO public.movements (cylinder_id, from_location, from_supplier_id, to_location, status_after, note, created_by)
      VALUES (v_cyl.id, v_cyl.location_type, v_cyl.location_supplier_id, 'warehouse_full', 'full', 'Beszállítótól átvéve', v_uid);
      UPDATE public.cylinders SET circulation = v_circ, owner = v_circ, location_type = 'warehouse_full',
        location_supplier_id = NULL, location_partner_id = NULL WHERE id = v_cyl.id;
      v_rec_ids := v_rec_ids || v_cyl.id;
    END LOOP;
  END IF;

  INSERT INTO public.supplier_exchanges (supplier_id, returned_cylinder_ids, received_cylinder_ids, note, created_by)
  VALUES (p_supplier_id, v_ret_ids, v_rec_ids, p_note, v_uid) RETURNING id INTO v_ex_id;
  RETURN v_ex_id;
END $$;

CREATE OR REPLACE FUNCTION public.reassign_rental_cylinder(
  p_rental_id uuid, p_new_cylinder_id uuid, p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_old uuid;
BEGIN
  PERFORM public.require_write();

  SELECT current_cylinder_id INTO v_old FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  INSERT INTO public.rental_reassignments(rental_id, old_cylinder_id, new_cylinder_id, note, created_by)
  VALUES (p_rental_id, v_old, p_new_cylinder_id, p_note, v_uid);
  UPDATE public.rentals SET current_cylinder_id = p_new_cylinder_id, updated_at = now() WHERE id = p_rental_id;
END $$;

CREATE OR REPLACE FUNCTION public.close_rental(
  p_rental_id uuid,
  p_returned_barcode text,
  p_deposit_returned boolean,
  p_status text DEFAULT 'returned',
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rent public.rentals; v_uid uuid := auth.uid(); v_cyl public.cylinders;
BEGIN
  PERFORM public.require_write();

  SELECT * INTO v_rent FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF v_rent.id IS NULL THEN RAISE EXCEPTION 'Rental not found'; END IF;
  IF v_rent.status <> 'active' THEN RAISE EXCEPTION 'Rental not active'; END IF;
  IF p_status NOT IN ('returned','closed','problematic') THEN RAISE EXCEPTION 'Invalid status'; END IF;

  IF p_returned_barcode IS NOT NULL AND length(trim(p_returned_barcode)) > 0 THEN
    SELECT (find_or_create_cylinder(p_returned_barcode)).cylinder INTO v_cyl;
    INSERT INTO public.movements (cylinder_id, from_location, from_partner_id, to_location, status_after, note, created_by)
    VALUES (v_cyl.id, 'customer', v_rent.partner_id, 'warehouse_empty', 'empty', 'Bérlet visszavétel', v_uid);
    UPDATE public.cylinders SET location_type = 'warehouse_empty', location_partner_id = NULL WHERE id = v_cyl.id;
    UPDATE public.rentals SET current_cylinder_id = v_cyl.id WHERE id = p_rental_id;
  END IF;

  UPDATE public.rentals SET
    status = p_status,
    end_date = CURRENT_DATE,
    note = COALESCE(NULLIF(trim(concat_ws(' | ', p_note, 'kaució: ' || CASE WHEN p_deposit_returned THEN 'visszafizetve' ELSE 'nem' END)), ''), note),
    updated_at = now()
  WHERE id = p_rental_id;
END $$;

CREATE OR REPLACE VIEW public.v_cylinder_custody
WITH (security_invoker = true)
AS
SELECT
  c.id AS cylinder_id,
  c.barcode,
  c.gas_type,
  c.size,
  c.status,
  c.circulation,
  c.owner,
  c.location_type,
  c.location_partner_id AS partner_id,
  p.name AS partner_name,
  rc.rental_id,
  r.status AS rental_status,
  rc.expiry_date AS rental_cylinder_expiry_date,
  c.replacement_value,
  CASE
    WHEN c.location_type = 'customer' AND c.location_partner_id IS NULL THEN true
    WHEN rc.rental_id IS NOT NULL AND c.location_type <> 'customer' THEN true
    ELSE false
  END AS is_missing_or_inconsistent
FROM public.cylinders c
LEFT JOIN public.partners p ON p.id = c.location_partner_id
LEFT JOIN public.rental_cylinders rc ON rc.cylinder_id = c.id AND rc.removed_at IS NULL
LEFT JOIN public.rentals r ON r.id = rc.rental_id
WHERE c.active = true;

CREATE OR REPLACE VIEW public.v_rental_status_overview
WITH (security_invoker = true)
AS
SELECT
  r.*,
  p.name AS partner_name,
  CASE
    WHEN r.status IN ('closed', 'cancelled') THEN r.status
    WHEN r.expiry_date IS NOT NULL AND r.expiry_date < CURRENT_DATE THEN 'expired'
    WHEN r.expiry_date IS NOT NULL AND r.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'soon'
    ELSE r.status
  END AS computed_status,
  CASE
    WHEN r.expiry_date IS NULL THEN NULL
    ELSE (r.expiry_date - CURRENT_DATE)
  END AS days_until_expiry
FROM public.rentals r
LEFT JOIN public.partners p ON p.id = r.partner_id;

GRANT SELECT ON public.v_cylinder_custody TO authenticated;
GRANT SELECT ON public.v_rental_status_overview TO authenticated;
