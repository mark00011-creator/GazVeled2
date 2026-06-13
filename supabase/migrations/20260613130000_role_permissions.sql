-- Role-based permissions using profiles.role.

ALTER TABLE public.profiles
ADD COLUMN role text NOT NULL DEFAULT 'viewer';

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'viewer'));

UPDATE public.profiles
SET role = 'admin'
WHERE email = 'marktheseeker@gmail.com';

UPDATE public.profiles
SET role = 'viewer'
WHERE email = 'horv.mark@freemail.hu';

CREATE OR REPLACE FUNCTION public.is_admin()
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
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.require_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;

REVOKE ALL ON FUNCTION public.require_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.require_admin() TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_log TO authenticated;

DROP POLICY IF EXISTS "Profiles readable by authenticated" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users see own roles" ON public.user_roles;
DROP POLICY IF EXISTS "partners auth all" ON public.partners;
DROP POLICY IF EXISTS "suppliers auth all" ON public.suppliers;
DROP POLICY IF EXISTS "cylinders auth all" ON public.cylinders;
DROP POLICY IF EXISTS "movements auth all" ON public.movements;
DROP POLICY IF EXISTS "exchanges auth all" ON public.exchanges;
DROP POLICY IF EXISTS "supex auth all" ON public.supplier_exchanges;
DROP POLICY IF EXISTS "rentals auth all" ON public.rentals;
DROP POLICY IF EXISTS "rc auth all" ON public.rental_cylinders;
DROP POLICY IF EXISTS "ri auth all" ON public.rental_invoices;
DROP POLICY IF EXISTS "bs auth all" ON public.bulk_scans;
DROP POLICY IF EXISTS "rr auth all" ON public.rental_reassignments;
DROP POLICY IF EXISTS "audit read auth" ON public.audit_log;
DROP POLICY IF EXISTS "audit insert auth" ON public.audit_log;

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
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || ' read authenticated', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || ' insert admin', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || ' update admin', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || ' delete admin', table_name);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      table_name || ' read authenticated',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()))',
      table_name || ' insert admin',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()))',
      table_name || ' update admin',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((SELECT public.is_admin()))',
      table_name || ' delete admin',
      table_name
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS "user_roles read own or admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles insert admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles update admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles delete admin" ON public.user_roles;

CREATE POLICY "user_roles read own or admin"
ON public.user_roles
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = user_id OR (SELECT public.is_admin()));

CREATE POLICY "user_roles insert admin"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "user_roles update admin"
ON public.user_roles
FOR UPDATE
TO authenticated
USING ((SELECT public.is_admin()))
WITH CHECK ((SELECT public.is_admin()));

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
  PERFORM public.require_admin();
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
  PERFORM public.require_admin();

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
  PERFORM public.require_admin();

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
  PERFORM public.require_admin();

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
  PERFORM public.require_admin();

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
  PERFORM public.require_admin();

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

GRANT EXECUTE ON FUNCTION public.next_temp_barcode() TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_create_cylinder(text, public.circulation, public.circulation, public.cyl_status, public.location_type, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_exchange(uuid, uuid, uuid, text, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_supplier_exchange(uuid, text[], text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_rental_cylinder(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_rental(uuid, text, boolean, text, text) TO authenticated;
