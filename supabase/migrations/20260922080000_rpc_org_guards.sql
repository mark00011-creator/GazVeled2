-- RPC org-guardok + org-scoped unique kulcsok
-- Production: snmiwsgtnokvqlnwvfwf
-- Új cégek saját vonalkóddal/készlettel dolgozhassanak; cross-org RPC tiltás.

-- ---------------------------------------------------------------------------
-- 1) Helper assert-ek
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.require_active_organization()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.auth_organization_id();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Nincs aktív szervezet' USING ERRCODE = '42501';
  END IF;
  RETURN v_org;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_partner_in_org(p_partner_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.require_active_organization();
BEGIN
  IF p_partner_id IS NULL THEN
    RAISE EXCEPTION 'Missing partner';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.partners
    WHERE id = p_partner_id AND organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'Partner nem található ebben a cégben' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_cylinder_in_org(p_cylinder_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.require_active_organization();
BEGIN
  IF p_cylinder_id IS NULL THEN
    RAISE EXCEPTION 'Missing cylinder';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cylinders
    WHERE id = p_cylinder_id AND organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'Palack nem található ebben a cégben' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_supplier_in_org(p_supplier_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.require_active_organization();
BEGIN
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Missing supplier';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers
    WHERE id = p_supplier_id AND organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'Beszállító nem található ebben a cégben' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.require_active_organization() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_partner_in_org(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_cylinder_in_org(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_supplier_in_org(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.require_active_organization() TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_partner_in_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_cylinder_in_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_supplier_in_org(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) require_* kiegészítés aktív org-gal
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.require_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_active_organization();
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_exchange_access()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_active_organization();
  IF NOT public.can_exchange() THEN
    RAISE EXCEPTION 'Exchange access required' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_write()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_active_organization();
  IF NOT public.can_write() THEN
    RAISE EXCEPTION 'Write role required' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Unique kulcsok szervezetenként
-- ---------------------------------------------------------------------------
ALTER TABLE public.cylinders DROP CONSTRAINT IF EXISTS cylinders_barcode_key;
ALTER TABLE public.cylinders
  DROP CONSTRAINT IF EXISTS cylinders_org_barcode_key;
ALTER TABLE public.cylinders
  ADD CONSTRAINT cylinders_org_barcode_key UNIQUE (organization_id, barcode);

ALTER TABLE public.chinese_cylinder_stock
  DROP CONSTRAINT IF EXISTS chinese_cylinder_stock_gas_type_size_key;
ALTER TABLE public.chinese_cylinder_stock
  DROP CONSTRAINT IF EXISTS chinese_stock_org_gas_size_key;
ALTER TABLE public.chinese_cylinder_stock
  ADD CONSTRAINT chinese_stock_org_gas_size_key UNIQUE (organization_id, gas_type, size);

ALTER TABLE public.flaga_pb_stock
  DROP CONSTRAINT IF EXISTS flaga_pb_stock_gas_type_size_key;
ALTER TABLE public.flaga_pb_stock
  DROP CONSTRAINT IF EXISTS flaga_pb_stock_org_gas_size_key;
ALTER TABLE public.flaga_pb_stock
  ADD CONSTRAINT flaga_pb_stock_org_gas_size_key UNIQUE (organization_id, gas_type, size);

ALTER TABLE public.prima_pb_stock
  DROP CONSTRAINT IF EXISTS prima_pb_stock_gas_type_size_key;
ALTER TABLE public.prima_pb_stock
  DROP CONSTRAINT IF EXISTS prima_pb_stock_org_gas_size_key;
ALTER TABLE public.prima_pb_stock
  ADD CONSTRAINT prima_pb_stock_org_gas_size_key UNIQUE (organization_id, gas_type, size);

ALTER TABLE public.product_prices
  DROP CONSTRAINT IF EXISTS product_prices_gas_type_size_key;
ALTER TABLE public.product_prices
  DROP CONSTRAINT IF EXISTS product_prices_org_gas_size_key;
ALTER TABLE public.product_prices
  ADD CONSTRAINT product_prices_org_gas_size_key UNIQUE (organization_id, gas_type, size);

ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_name_key;
ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_org_name_key;
ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_org_name_key UNIQUE (organization_id, name);

-- ---------------------------------------------------------------------------
-- 4) find_or_create_cylinder – csak saját org
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_or_create_cylinder(
  p_barcode text,
  p_circulation public.circulation DEFAULT 'own',
  p_owner public.circulation DEFAULT NULL,
  p_status public.cyl_status DEFAULT 'empty',
  p_location_type public.location_type DEFAULT 'warehouse_empty',
  p_gas_type text DEFAULT 'ISMERETLEN',
  p_size text DEFAULT '—'
)
RETURNS TABLE(cylinder public.cylinders, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.require_active_organization();
  v_row public.cylinders;
  v_created boolean := false;
  v_bc text := trim(p_barcode);
BEGIN
  PERFORM public.require_exchange_access();
  IF v_bc IS NULL OR length(v_bc) = 0 THEN
    RAISE EXCEPTION 'Empty barcode';
  END IF;

  SELECT * INTO v_row
  FROM public.cylinders
  WHERE barcode = v_bc AND organization_id = v_org;

  IF NOT FOUND THEN
    INSERT INTO public.cylinders (
      barcode, gas_type, size, circulation, owner, status, location_type,
      first_tracked_at, organization_id
    )
    VALUES (
      v_bc, p_gas_type, p_size, p_circulation, COALESCE(p_owner, p_circulation),
      p_status, p_location_type, now(), v_org
    )
    ON CONFLICT (organization_id, barcode) DO NOTHING
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      SELECT * INTO v_row
      FROM public.cylinders
      WHERE barcode = v_bc AND organization_id = v_org;
    ELSE
      v_created := true;
    END IF;
  END IF;

  cylinder := v_row;
  created := v_created;
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) record_exchange – partner + palackok org assert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_exchange(
  p_partner_id uuid,
  p_incoming_id uuid,
  p_outgoing_id uuid,
  p_reason text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_rental_id uuid DEFAULT NULL,
  p_reassign_rental boolean DEFAULT false,
  p_batch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.require_active_organization();
  v_in public.cylinders;
  v_out public.cylinders;
  v_uid uuid := auth.uid();
  v_forced boolean;
  v_in_key text;
  v_out_key text;
  v_exchange_id uuid;
  v_diff_id uuid;
BEGIN
  PERFORM public.require_exchange_access();
  PERFORM public.assert_partner_in_org(p_partner_id);
  PERFORM public.assert_cylinder_in_org(p_incoming_id);
  PERFORM public.assert_cylinder_in_org(p_outgoing_id);

  SELECT * INTO v_in FROM public.cylinders WHERE id = p_incoming_id AND organization_id = v_org FOR UPDATE;
  SELECT * INTO v_out FROM public.cylinders WHERE id = p_outgoing_id AND organization_id = v_org FOR UPDATE;
  IF v_in.id IS NULL OR v_out.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;

  v_in_key := public.derive_exchange_circulation_key(v_in.circulation, v_in.manufacturer::text);
  v_out_key := public.derive_exchange_circulation_key(v_out.circulation, v_out.manufacturer::text);
  v_forced := v_in_key <> v_out_key OR v_in.gas_type <> v_out.gas_type;

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    incoming_exchange_circulation, outgoing_exchange_circulation,
    is_forced_substitution, reason, rental_reassigned, rental_id, note, created_by, operation_type, batch_id,
    organization_id
  ) VALUES (
    p_partner_id, v_in.id, v_in.circulation, v_out.id, v_out.circulation,
    v_in_key, v_out_key,
    v_forced, NULLIF(trim(COALESCE(p_reason,'')), ''), COALESCE(p_reassign_rental,false), p_rental_id, p_note, v_uid, 'exchange', p_batch_id,
    v_org
  ) RETURNING id INTO v_exchange_id;

  INSERT INTO public.movements (cylinder_id, from_location, from_partner_id, to_location, status_after, note, created_by, organization_id)
  VALUES (v_in.id, v_in.location_type, v_in.location_partner_id, 'warehouse_empty', 'empty', 'Gyors csere – üres beérkezett', v_uid, v_org);

  INSERT INTO public.movements (cylinder_id, from_location, to_location, to_partner_id, status_after, note, created_by, organization_id)
  VALUES (v_out.id, v_out.location_type, 'customer', p_partner_id, 'full', 'Gyors csere – teli kiadva', v_uid, v_org);

  UPDATE public.cylinders SET status = 'empty', location_type = 'warehouse_empty', location_partner_id = NULL, location_supplier_id = NULL WHERE id = v_in.id;
  UPDATE public.cylinders SET status = 'full', location_type = 'customer', location_partner_id = p_partner_id, location_supplier_id = NULL WHERE id = v_out.id;

  IF p_reassign_rental AND p_rental_id IS NOT NULL THEN
    INSERT INTO public.rental_reassignments(rental_id, old_cylinder_id, new_cylinder_id, note, created_by, organization_id)
    SELECT p_rental_id, current_cylinder_id, v_out.id, 'Gyors csere során', v_uid, v_org FROM public.rentals WHERE id = p_rental_id AND organization_id = v_org;
    UPDATE public.rentals SET current_cylinder_id = v_out.id, updated_at = now() WHERE id = p_rental_id AND organization_id = v_org;
  END IF;

  PERFORM public.settle_circulation_differences_for_exchange(
    p_partner_id, v_exchange_id,
    v_in_key, v_out_key, v_in.gas_type, v_out.gas_type, v_in.size, 1
  );

  IF v_forced THEN
    v_diff_id := public.create_circulation_difference(
      p_partner_id, v_exchange_id,
      v_in_key, v_out_key, v_in.gas_type, v_out.gas_type, v_in.size, 1, p_note
    );
  END IF;

  RETURN v_exchange_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) record_supplier_exchange – supplier org assert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_supplier_exchange(
  p_supplier_id uuid,
  p_returned_barcodes text[],
  p_received_barcodes text[],
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.require_active_organization();
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
  PERFORM public.assert_supplier_in_org(p_supplier_id);

  SELECT * INTO v_sup FROM public.suppliers WHERE id = p_supplier_id AND organization_id = v_org;
  IF v_sup.id IS NULL THEN RAISE EXCEPTION 'Missing supplier'; END IF;
  v_circ := CASE WHEN v_sup.kind = 'siad' THEN 'siad'::public.circulation ELSE 'own'::public.circulation END;
  v_loc_empty := v_sup.kind;

  IF p_returned_barcodes IS NOT NULL THEN
    FOREACH v_bc IN ARRAY p_returned_barcodes LOOP
      IF length(trim(v_bc)) = 0 THEN CONTINUE; END IF;
      SELECT (find_or_create_cylinder(v_bc, v_circ, v_circ, 'empty', v_loc_empty)).cylinder INTO v_cyl;
      INSERT INTO public.movements (cylinder_id, from_location, to_location, to_supplier_id, status_after, note, created_by, organization_id)
      VALUES (v_cyl.id, v_cyl.location_type, v_loc_empty, p_supplier_id, 'empty', 'Beszállítónak visszaadva', v_uid, v_org);
      UPDATE public.cylinders SET circulation = v_circ, owner = v_circ, location_type = v_loc_empty,
        location_supplier_id = p_supplier_id, location_partner_id = NULL WHERE id = v_cyl.id;
      v_ret_ids := v_ret_ids || v_cyl.id;
    END LOOP;
  END IF;

  IF p_received_barcodes IS NOT NULL THEN
    FOREACH v_bc IN ARRAY p_received_barcodes LOOP
      IF length(trim(v_bc)) = 0 THEN CONTINUE; END IF;
      SELECT (find_or_create_cylinder(v_bc, v_circ, v_circ, 'full', 'warehouse_full')).cylinder INTO v_cyl;
      INSERT INTO public.movements (cylinder_id, from_location, from_supplier_id, to_location, status_after, note, created_by, organization_id)
      VALUES (v_cyl.id, v_cyl.location_type, v_cyl.location_supplier_id, 'warehouse_full', 'full', 'Beszállítótól átvéve', v_uid, v_org);
      UPDATE public.cylinders SET circulation = v_circ, owner = v_circ, location_type = 'warehouse_full',
        location_supplier_id = NULL, location_partner_id = NULL WHERE id = v_cyl.id;
      v_rec_ids := v_rec_ids || v_cyl.id;
    END LOOP;
  END IF;

  INSERT INTO public.supplier_exchanges (supplier_id, returned_cylinder_ids, received_cylinder_ids, note, created_by, organization_id)
  VALUES (p_supplier_id, v_ret_ids, v_rec_ids, p_note, v_uid, v_org) RETURNING id INTO v_ex_id;
  RETURN v_ex_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) adjust_chinese_stock – org-scoped conflict + lookup
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_chinese_stock(
  p_gas_type text,
  p_size text,
  p_movement_type text,
  p_quantity integer,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.require_active_organization();
  v_stock public.chinese_cylinder_stock;
  v_uid UUID := auth.uid();
  v_full_delta INTEGER;
  v_empty_delta INTEGER;
  v_mov_id UUID;
  v_movement_type TEXT;
BEGIN
  IF p_movement_type IN ('purchase', 'adjustment', 'empty_adjustment', 'supplier_exchange') THEN
    PERFORM public.require_admin();
  ELSE
    PERFORM public.require_exchange_access();
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'A mennyiségnek pozitívnak kell lennie';
  END IF;
  v_movement_type := CASE WHEN p_movement_type = 'exchange' THEN 'customer_exchange' ELSE p_movement_type END;
  CASE v_movement_type
    WHEN 'purchase' THEN v_full_delta := p_quantity; v_empty_delta := 0;
    WHEN 'sale' THEN v_full_delta := -p_quantity; v_empty_delta := 0;
    WHEN 'customer_exchange' THEN v_full_delta := -p_quantity; v_empty_delta := p_quantity;
    WHEN 'supplier_exchange' THEN v_full_delta := p_quantity; v_empty_delta := -p_quantity;
    WHEN 'empty_return' THEN v_full_delta := 0; v_empty_delta := p_quantity;
    WHEN 'adjustment' THEN
      IF p_note IS NULL OR length(trim(p_note)) = 0 THEN RAISE EXCEPTION 'Korrekciónál megjegyzés kötelező'; END IF;
      v_full_delta := p_quantity; v_empty_delta := 0;
    WHEN 'empty_adjustment' THEN
      IF p_note IS NULL OR length(trim(p_note)) = 0 THEN RAISE EXCEPTION 'Korrekciónál megjegyzés kötelező'; END IF;
      v_full_delta := 0; v_empty_delta := -p_quantity;
    ELSE RAISE EXCEPTION 'Ismeretlen mozgástípus: %', p_movement_type;
  END CASE;

  INSERT INTO public.chinese_cylinder_stock (gas_type, size, full_count, empty_count, organization_id)
  VALUES (trim(p_gas_type), trim(p_size), 0, 0, v_org)
  ON CONFLICT (organization_id, gas_type, size) DO NOTHING;

  SELECT * INTO v_stock
  FROM public.chinese_cylinder_stock
  WHERE gas_type = trim(p_gas_type) AND size = trim(p_size) AND organization_id = v_org
  FOR UPDATE;

  IF v_stock.id IS NULL THEN RAISE EXCEPTION 'Készlet nem található'; END IF;
  IF v_movement_type = 'customer_exchange' AND v_stock.full_count < p_quantity THEN
    RAISE EXCEPTION 'Nincs elég teli palack a cseréhez.';
  END IF;
  IF v_movement_type = 'supplier_exchange' AND v_stock.empty_count < p_quantity THEN
    RAISE EXCEPTION 'Nincs elég üres palack a beszállítói cseréhez.';
  END IF;
  IF v_full_delta < 0 AND v_stock.full_count + v_full_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég teli kínai palack (szükséges: %, elérhető: %)', p_quantity, v_stock.full_count;
  END IF;
  IF v_empty_delta < 0 AND v_stock.empty_count + v_empty_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég üres kínai palack (szükséges: %, elérhető: %)', p_quantity, v_stock.empty_count;
  END IF;

  UPDATE public.chinese_cylinder_stock
  SET full_count = full_count + v_full_delta, empty_count = empty_count + v_empty_delta, updated_at = now()
  WHERE id = v_stock.id;

  INSERT INTO public.chinese_stock_movements (
    stock_id, movement_type, quantity, full_delta, empty_delta, note, created_by, organization_id
  ) VALUES (
    v_stock.id, v_movement_type, p_quantity, v_full_delta, v_empty_delta, p_note, v_uid, v_org
  ) RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) adjust_flaga_pb_stock / adjust_prima_pb_stock – org-scoped
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_flaga_pb_stock(
  p_gas_type text,
  p_size text,
  p_movement_type text,
  p_quantity integer,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.require_active_organization();
  v_stock public.flaga_pb_stock;
  v_uid UUID := auth.uid();
  v_full_delta INTEGER;
  v_empty_delta INTEGER;
  v_mov_id UUID;
BEGIN
  IF p_movement_type IN ('purchase', 'adjustment') THEN
    PERFORM public.require_admin();
  ELSE
    PERFORM public.require_exchange_access();
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'A mennyiségnek pozitívnak kell lennie';
  END IF;
  CASE p_movement_type
    WHEN 'purchase' THEN v_full_delta := p_quantity; v_empty_delta := 0;
    WHEN 'sale' THEN v_full_delta := -p_quantity; v_empty_delta := 0;
    WHEN 'exchange' THEN v_full_delta := -p_quantity; v_empty_delta := p_quantity;
    WHEN 'empty_return' THEN v_full_delta := 0; v_empty_delta := p_quantity;
    WHEN 'adjustment' THEN
      IF p_note IS NULL OR length(trim(p_note)) = 0 THEN RAISE EXCEPTION 'Korrekciónál megjegyzés kötelező'; END IF;
      v_full_delta := p_quantity; v_empty_delta := 0;
    ELSE RAISE EXCEPTION 'Ismeretlen mozgástípus: %', p_movement_type;
  END CASE;

  INSERT INTO public.flaga_pb_stock (gas_type, size, full_count, empty_count, organization_id)
  VALUES (trim(p_gas_type), trim(p_size), 0, 0, v_org)
  ON CONFLICT (organization_id, gas_type, size) DO NOTHING;

  SELECT * INTO v_stock FROM public.flaga_pb_stock
  WHERE gas_type = trim(p_gas_type) AND size = trim(p_size) AND organization_id = v_org
  FOR UPDATE;
  IF v_stock.id IS NULL THEN RAISE EXCEPTION 'Készlet nem található'; END IF;
  IF v_stock.full_count + v_full_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég teli FLAGA PB palack (szükséges: %, elérhető: %)', p_quantity, v_stock.full_count;
  END IF;
  IF v_stock.empty_count + v_empty_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég üres FLAGA PB palack';
  END IF;
  UPDATE public.flaga_pb_stock
  SET full_count = full_count + v_full_delta, empty_count = empty_count + v_empty_delta, updated_at = now()
  WHERE id = v_stock.id;
  INSERT INTO public.flaga_pb_stock_movements (
    stock_id, movement_type, quantity, full_delta, empty_delta, note, created_by, organization_id
  ) VALUES (v_stock.id, p_movement_type, p_quantity, v_full_delta, v_empty_delta, p_note, v_uid, v_org)
  RETURNING id INTO v_mov_id;
  RETURN v_mov_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_prima_pb_stock(
  p_gas_type text,
  p_size text,
  p_movement_type text,
  p_quantity integer,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.require_active_organization();
  v_stock public.prima_pb_stock;
  v_uid UUID := auth.uid();
  v_full_delta INTEGER;
  v_empty_delta INTEGER;
  v_mov_id UUID;
BEGIN
  IF p_movement_type IN ('purchase', 'adjustment') THEN
    PERFORM public.require_admin();
  ELSE
    PERFORM public.require_exchange_access();
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'A mennyiségnek pozitívnak kell lennie';
  END IF;
  CASE p_movement_type
    WHEN 'purchase' THEN v_full_delta := p_quantity; v_empty_delta := 0;
    WHEN 'sale' THEN v_full_delta := -p_quantity; v_empty_delta := 0;
    WHEN 'exchange' THEN v_full_delta := -p_quantity; v_empty_delta := p_quantity;
    WHEN 'empty_return' THEN v_full_delta := 0; v_empty_delta := p_quantity;
    WHEN 'adjustment' THEN
      IF p_note IS NULL OR length(trim(p_note)) = 0 THEN RAISE EXCEPTION 'Korrekciónál megjegyzés kötelező'; END IF;
      v_full_delta := p_quantity; v_empty_delta := 0;
    ELSE RAISE EXCEPTION 'Ismeretlen mozgástípus: %', p_movement_type;
  END CASE;

  INSERT INTO public.prima_pb_stock (gas_type, size, full_count, empty_count, organization_id)
  VALUES (trim(p_gas_type), trim(p_size), 0, 0, v_org)
  ON CONFLICT (organization_id, gas_type, size) DO NOTHING;

  SELECT * INTO v_stock FROM public.prima_pb_stock
  WHERE gas_type = trim(p_gas_type) AND size = trim(p_size) AND organization_id = v_org
  FOR UPDATE;
  IF v_stock.id IS NULL THEN RAISE EXCEPTION 'Készlet nem található'; END IF;
  IF v_stock.full_count + v_full_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég teli PRÍMA PB palack (szükséges: %, elérhető: %)', p_quantity, v_stock.full_count;
  END IF;
  IF v_stock.empty_count + v_empty_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég üres PRÍMA PB palack';
  END IF;
  UPDATE public.prima_pb_stock
  SET full_count = full_count + v_full_delta, empty_count = empty_count + v_empty_delta, updated_at = now()
  WHERE id = v_stock.id;
  INSERT INTO public.prima_pb_stock_movements (
    stock_id, movement_type, quantity, full_delta, empty_delta, note, created_by, organization_id
  ) VALUES (v_stock.id, p_movement_type, p_quantity, v_full_delta, v_empty_delta, p_note, v_uid, v_org)
  RETURNING id INTO v_mov_id;
  RETURN v_mov_id;
END;
$$;

COMMENT ON FUNCTION public.require_active_organization IS
  'Aktív organization_id az auth profilból; RPC belépési pont.';
COMMENT ON FUNCTION public.assert_partner_in_org IS
  'Partner csak saját org-ból használható.';
COMMENT ON FUNCTION public.assert_cylinder_in_org IS
  'Palack csak saját org-ból használható.';
COMMENT ON FUNCTION public.assert_supplier_in_org IS
  'Beszállító csak saját org-ból használható.';
