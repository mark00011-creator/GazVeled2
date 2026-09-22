-- SEC-001 / SEC-002: profiles privilege lock + org-scoped batch invoice + critical RPC guards
-- Production: snmiwsgtnokvqlnwvfwf
-- Bizonyított: profiles "update own safe" nem zárta az is_platform_admin / organization_id mezőket.

-- ---------------------------------------------------------------------------
-- 1) Privilege lock trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_profiles_privilege_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- is_platform_admin: soha ne legyen kliensből állítható (csak bypass flaggel / migráció)
  IF NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin THEN
    IF current_setting('app.allow_platform_admin_change', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'is_platform_admin módosítása tiltott (SEC-001)'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Saját privileged mezők: csak explicit bypass (SECURITY DEFINER RPC)
  IF auth.uid() IS NOT NULL AND NEW.id = auth.uid() THEN
    IF current_setting('app.allow_profile_privilege_change', true) IS DISTINCT FROM 'on' THEN
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'Saját organization_id közvetlen módosítása tiltott (SEC-001)'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Saját role közvetlen módosítása tiltott (SEC-001)'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        RAISE EXCEPTION 'Saját is_active közvetlen módosítása tiltott (SEC-001)'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_privilege_lock ON public.profiles;
CREATE TRIGGER trg_profiles_privilege_lock
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profiles_privilege_columns();

REVOKE ALL ON FUNCTION public.enforce_profiles_privilege_columns() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2) RLS WITH CHECK szigorítás (defense in depth)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles update own safe" ON public.profiles;
CREATE POLICY "profiles update own safe" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
    AND is_active = (SELECT p.is_active FROM public.profiles p WHERE p.id = auth.uid())
    AND is_platform_admin = (SELECT p.is_platform_admin FROM public.profiles p WHERE p.id = auth.uid())
    AND organization_id IS NOT DISTINCT FROM (
      SELECT p.organization_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "profiles admin update roles" ON public.profiles;
CREATE POLICY "profiles admin update roles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin() AND public.same_org(organization_id))
  WITH CHECK (
    public.is_admin()
    AND public.same_org(organization_id)
    AND is_platform_admin = (
      SELECT p.is_platform_admin FROM public.profiles p WHERE p.id = profiles.id
    )
  );

-- ---------------------------------------------------------------------------
-- 3) SECURITY DEFINER RPC-k: bypass flag a legitim org/role váltáshoz
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_organization_member(
  p_email text,
  p_role text DEFAULT 'exchange_operator',
  p_full_name text DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_uid uuid;
  v_email text := lower(trim(p_email));
  v_existing_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  v_org := public.auth_organization_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'Nincs cég hozzárendelve a fiókodhoz'; END IF;
  IF v_email IS NULL OR v_email = '' THEN RAISE EXCEPTION 'Email kötelező'; END IF;
  IF p_role IS NULL OR p_role NOT IN ('admin', 'exchange_operator', 'viewer') THEN
    RAISE EXCEPTION 'Érvénytelen szerepkör';
  END IF;

  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = v_email LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Nincs ilyen felhasználó: %. Előbb jelentkezzen be / regisztráljon az appban.', v_email;
  END IF;

  SELECT organization_id INTO v_existing_org FROM public.profiles WHERE id = v_uid;
  IF v_existing_org IS NOT NULL AND v_existing_org <> v_org THEN
    RAISE EXCEPTION 'A felhasználó már másik céghez tartozik';
  END IF;

  PERFORM set_config('app.allow_profile_privilege_change', 'on', true);

  INSERT INTO public.profiles (id, email, full_name, role, is_active, organization_id)
  VALUES (
    v_uid, v_email, NULLIF(trim(COALESCE(p_full_name, '')), ''),
    p_role, COALESCE(p_is_active, true), v_org
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    organization_id = v_org,
    updated_at = now();

  RETURN v_uid;
END;
$$;

-- create_organization: wrap profile updates with bypass (replace body section via full recreate from existing)
CREATE OR REPLACE FUNCTION public.platform_set_active_organization(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE id = p_organization_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Ismeretlen vagy inaktív szervezet';
  END IF;

  PERFORM set_config('app.allow_profile_privilege_change', 'on', true);
  UPDATE public.profiles
  SET organization_id = p_organization_id, updated_at = now()
  WHERE id = auth.uid();
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) mark_exchange_batch_invoiced – csak saját org
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_exchange_batch_invoiced(p_batch_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_org uuid := public.require_active_organization();
BEGIN
  PERFORM public.require_exchange_access();
  IF p_batch_id IS NULL THEN RAISE EXCEPTION 'Missing batch_id'; END IF;

  UPDATE public.exchanges
  SET invoiced = true, invoiced_at = now()
  WHERE batch_id = p_batch_id
    AND organization_id = v_org
    AND invoiced = false;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) receive_gas_order – require_write + org
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_gas_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.gas_orders;
  v_item RECORD;
  v_stock public.flaga_pb_stock;
  v_uid UUID := auth.uid();
  v_empty_delta INTEGER;
  v_org uuid := public.require_active_organization();
BEGIN
  PERFORM public.require_write();

  SELECT * INTO v_order FROM public.gas_orders
  WHERE id = p_order_id AND organization_id = v_org FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Rendelés nem található'; END IF;

  UPDATE public.gas_orders
  SET status = 'received', updated_at = now()
  WHERE id = p_order_id AND organization_id = v_org;

  IF v_order.order_kind <> 'flaga_pb' OR v_order.stock_applied_at IS NOT NULL THEN
    RETURN;
  END IF;

  FOR v_item IN
    SELECT gas_type, size, quantity
    FROM public.gas_order_quantity_items
    WHERE gas_order_id = p_order_id AND stock_kind = 'flaga_pb'
  LOOP
    INSERT INTO public.flaga_pb_stock (gas_type, size, full_count, empty_count, organization_id)
    VALUES (trim(v_item.gas_type), trim(v_item.size), 0, 0, v_org)
    ON CONFLICT (organization_id, gas_type, size) DO NOTHING;

    SELECT * INTO v_stock FROM public.flaga_pb_stock
    WHERE gas_type = trim(v_item.gas_type) AND size = trim(v_item.size)
      AND organization_id = v_org
    FOR UPDATE;

    v_empty_delta := -LEAST(v_item.quantity, v_stock.empty_count);

    UPDATE public.flaga_pb_stock
    SET full_count = full_count + v_item.quantity,
        empty_count = empty_count + v_empty_delta,
        updated_at = now()
    WHERE id = v_stock.id;

    INSERT INTO public.flaga_pb_stock_movements (
      stock_id, movement_type, quantity, full_delta, empty_delta, note, created_by, organization_id
    ) VALUES (
      v_stock.id, 'supplier_exchange', v_item.quantity, v_item.quantity, v_empty_delta,
      'Gáz rendelés megérkezett (' || p_order_id || ')', v_uid, v_org
    );
  END LOOP;

  UPDATE public.gas_orders SET stock_applied_at = now()
  WHERE id = p_order_id AND organization_id = v_org;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) return_cylinder_loan – require_exchange + org assert (teljes body)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.return_cylinder_loan(
  p_loan_id uuid,
  p_returned_cylinder_id uuid,
  p_note text DEFAULT NULL,
  p_return_mode text DEFAULT 'empty'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loan public.cylinder_loans;
  v_loaned public.cylinders;
  v_returned public.cylinders;
  v_uid uuid := auth.uid();
  v_wh_loc public.location_type;
  v_target_status public.cyl_status;
  v_now timestamptz := now();
  v_mode text := lower(trim(coalesce(p_return_mode, 'empty')));
  v_move_note text;
  v_org uuid := public.require_active_organization();
BEGIN
  PERFORM public.require_exchange_access();
  IF v_mode NOT IN ('empty', 'full') THEN
    RAISE EXCEPTION 'Érvénytelen visszavételi mód (empty vagy full)';
  END IF;

  SELECT * INTO v_loan FROM public.cylinder_loans
  WHERE id = p_loan_id AND organization_id = v_org FOR UPDATE;
  IF v_loan.id IS NULL THEN RAISE EXCEPTION 'Kölcsön rekord nem található'; END IF;
  IF v_loan.status <> 'active' THEN RAISE EXCEPTION 'A kölcsön már le van zárva'; END IF;

  PERFORM public.assert_cylinder_in_org(p_returned_cylinder_id);
  PERFORM public.assert_cylinder_in_org(v_loan.cylinder_id);

  SELECT * INTO v_loaned FROM public.cylinders
  WHERE id = v_loan.cylinder_id AND organization_id = v_org FOR UPDATE;
  SELECT * INTO v_returned FROM public.cylinders
  WHERE id = p_returned_cylinder_id AND organization_id = v_org FOR UPDATE;
  IF v_returned.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;

  IF v_mode = 'full' THEN
    v_target_status := 'full';
    v_wh_loc := 'warehouse_full'::public.location_type;
    v_move_note := CASE
      WHEN v_returned.id = v_loan.cylinder_id THEN 'Kölcsön visszavéve – teli palack'
      ELSE 'Kölcsön visszavéve – teli helyettesítő palack'
    END;
  ELSE
    v_target_status := 'empty';
    v_wh_loc := 'warehouse_empty'::public.location_type;
    v_move_note := CASE
      WHEN v_returned.id = v_loan.cylinder_id THEN 'Kölcsön visszavéve – üres palack'
      ELSE 'Kölcsön visszavéve – üres helyettesítő palack'
    END;
  END IF;

  INSERT INTO public.movements (
    cylinder_id, from_location, from_partner_id, to_location, status_after, note, created_by, organization_id
  ) VALUES (
    v_returned.id,
    COALESCE(v_returned.location_type, 'customer'),
    v_returned.location_partner_id,
    v_wh_loc, v_target_status, v_move_note, v_uid, v_org
  );

  UPDATE public.cylinders
  SET location_type = v_wh_loc, location_partner_id = NULL, location_supplier_id = NULL, status = v_target_status
  WHERE id = v_returned.id AND organization_id = v_org;

  IF v_returned.id <> v_loan.cylinder_id AND v_loaned.location_partner_id = v_loan.partner_id THEN
    INSERT INTO public.movements (
      cylinder_id, from_location, from_partner_id, to_location, status_after, note, created_by, organization_id
    ) VALUES (
      v_loaned.id, v_loaned.location_type, v_loaned.location_partner_id,
      v_loaned.location_type, v_loaned.status,
      'Kölcsön lezárva más palackkal – eredeti palack partner kapcsolat törölve',
      v_uid, v_org
    );
    UPDATE public.cylinders SET location_partner_id = NULL
    WHERE id = v_loaned.id AND organization_id = v_org;
  END IF;

  IF v_mode = 'full' AND v_loan.exchange_id IS NOT NULL THEN
    UPDATE public.exchanges
    SET invoiced = true,
        invoiced_at = COALESCE(invoiced_at, v_now),
        profit = NULL,
        note = trim(both E'\n' FROM concat(
          coalesce(note, ''),
          CASE WHEN coalesce(note, '') = '' THEN '' ELSE E'\n' END,
          'Kölcsön teli visszavétel – nem számlázandó gázcsere'
        ))
    WHERE id = v_loan.exchange_id AND organization_id = v_org;
  END IF;

  UPDATE public.cylinder_loans
  SET status = 'returned',
      returned_at = v_now,
      returned_cylinder_id = v_returned.id,
      return_note = p_note,
      updated_at = v_now
  WHERE id = p_loan_id AND organization_id = v_org;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value, organization_id)
  VALUES (
    v_uid,
    CASE WHEN v_mode = 'full' THEN 'Kölcsön teli visszavéve' ELSE 'Kölcsön üres visszavéve' END,
    'cylinder_loan', p_loan_id,
    jsonb_build_object(
      'return_mode', v_mode,
      'returned_cylinder_id', v_returned.id,
      'loaned_cylinder_id', v_loan.cylinder_id,
      'partner_id', v_loan.partner_id,
      'exchange_id', v_loan.exchange_id
    ),
    v_org
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) try_delete_orphan_temp_cylinder – require org + write
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_delete_orphan_temp_cylinder(
  p_cylinder_id uuid,
  p_context text DEFAULT 'auto',
  p_user_id uuid DEFAULT auth.uid(),
  p_raise_on_block boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text;
  v_barcode text;
  v_action text;
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  v_org := public.require_active_organization();
  PERFORM public.require_write();
  PERFORM public.assert_cylinder_in_org(p_cylinder_id);

  v_reason := public.temp_cylinder_blocking_reason(p_cylinder_id);
  IF v_reason IS NOT NULL THEN
    IF p_raise_on_block THEN
      RAISE EXCEPTION 'A TEMP palack nem törölhető, mert még aktív kapcsolata van. (%)', v_reason;
    END IF;
    RETURN false;
  END IF;

  SELECT barcode INTO v_barcode FROM public.cylinders
  WHERE id = p_cylinder_id AND organization_id = v_org;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.rentals
  SET
    current_cylinder_id = CASE WHEN current_cylinder_id = p_cylinder_id THEN NULL ELSE current_cylinder_id END,
    original_cylinder_id = CASE WHEN original_cylinder_id = p_cylinder_id THEN NULL ELSE original_cylinder_id END,
    updated_at = now()
  WHERE organization_id = v_org
    AND (current_cylinder_id = p_cylinder_id OR original_cylinder_id = p_cylinder_id);

  DELETE FROM public.rental_cylinders
  WHERE cylinder_id = p_cylinder_id AND removed_at IS NOT NULL;

  UPDATE public.exchanges SET incoming_cylinder_id = NULL
  WHERE incoming_cylinder_id = p_cylinder_id AND organization_id = v_org;
  UPDATE public.exchanges SET outgoing_cylinder_id = NULL
  WHERE outgoing_cylinder_id = p_cylinder_id AND organization_id = v_org;

  DELETE FROM public.rental_reassignments
  WHERE old_cylinder_id = p_cylinder_id OR new_cylinder_id = p_cylinder_id;

  DELETE FROM public.cylinder_loans
  WHERE organization_id = v_org
    AND (cylinder_id = p_cylinder_id OR returned_cylinder_id = p_cylinder_id)
    AND status <> 'active';

  v_action := CASE p_context
    WHEN 'rental_return' THEN 'Árva TEMP palack automatikusan törölve bérleti visszavétel után.'
    WHEN 'temp_to_chinese' THEN 'Árva TEMP palack automatikusan törölve kínai átalakítás után.'
    WHEN 'temp_to_serial' THEN 'Árva TEMP palack automatikusan törölve sorszámra alakítás után.'
    WHEN 'orphan_cleanup' THEN 'Árva TEMP palack automatikusan törölve árva takarítás során.'
    ELSE 'Árva TEMP palack automatikusan törölve.'
  END;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value, organization_id)
  VALUES (
    p_user_id, v_action, 'cylinder', p_cylinder_id,
    jsonb_build_object('barcode', v_barcode, 'context', p_context),
    v_org
  );

  DELETE FROM public.cylinders WHERE id = p_cylinder_id AND organization_id = v_org;
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) Invoice finalize bookkeeping RPC (org-scoped, exchange access)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_invoice_document_exchanges(
  p_document_id uuid,
  p_external_invoice_number text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.require_active_organization();
  v_doc public.invoice_documents;
  v_count integer := 0;
  v_ids uuid[];
BEGIN
  PERFORM public.require_exchange_access();

  SELECT * INTO v_doc FROM public.invoice_documents
  WHERE id = p_document_id AND organization_id = v_org FOR UPDATE;
  IF v_doc.id IS NULL THEN RAISE EXCEPTION 'Dokumentum nem található'; END IF;
  IF v_doc.status = 'finalized' THEN
    RETURN 0;
  END IF;

  SELECT coalesce(array_agg(exchange_id), '{}') INTO v_ids
  FROM public.invoice_document_items
  WHERE document_id = p_document_id
    AND organization_id = v_org
    AND exchange_id IS NOT NULL;

  IF EXISTS (
    SELECT 1 FROM public.exchanges e
    WHERE e.id = ANY (v_ids)
      AND (e.organization_id IS DISTINCT FROM v_org OR e.invoiced = true OR e.partner_id IS DISTINCT FROM v_doc.partner_id)
  ) THEN
    RAISE EXCEPTION 'Számlázandó csere érvénytelen vagy már számlázott / más cégé';
  END IF;

  UPDATE public.exchanges
  SET invoiced = true,
      invoiced_at = now(),
      external_invoice_number = COALESCE(p_external_invoice_number, external_invoice_number)
  WHERE id = ANY (v_ids)
    AND organization_id = v_org
    AND invoiced = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.invoice_documents
  SET status = 'finalized',
      external_invoice_number = COALESCE(p_external_invoice_number, external_invoice_number),
      finalized_at = now(),
      finalized_by = auth.uid(),
      last_error = null,
      updated_at = now()
  WHERE id = p_document_id AND organization_id = v_org;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_invoice_document_exchanges(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_invoice_document_exchanges(uuid, text) TO authenticated;

-- create_organization: privilege bypass a profil org/role íráshoz
-- Paramétersorrend egyezzen a production aláírással (p_admin_email a 3. arg).
CREATE OR REPLACE FUNCTION public.create_organization(
  p_name text,
  p_slug text,
  p_admin_email text DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_tax_regime text DEFAULT 'vat_exempt',
  p_vat_rate numeric DEFAULT 27
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_slug text := lower(trim(p_slug));
  v_name text := trim(p_name);
  v_regime text := CASE WHEN p_tax_regime = 'vat_registered' THEN 'vat_registered' ELSE 'vat_exempt' END;
  v_rate numeric := coalesce(p_vat_rate, 27);
  v_admin uuid;
  v_email text := lower(trim(coalesce(p_admin_email, '')));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform admin jogosultság kell'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'A cég neve kötelező'; END IF;
  IF v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Érvénytelen slug (csak kisbetű, szám, kötőjel)';
  END IF;
  IF v_rate < 0 OR v_rate > 100 THEN RAISE EXCEPTION 'Érvénytelen ÁFA kulcs'; END IF;

  INSERT INTO public.organizations (name, slug, logo_url, settings, is_active)
  VALUES (
    v_name, v_slug, NULLIF(trim(coalesce(p_logo_url, '')), ''),
    jsonb_build_object(
      'modules', jsonb_build_object(
        'flaga_pb', true, 'prima_pb', true, 'chinese_stock', true, 'rentals', true,
        'tool_rental', true, 'quotes', true, 'gas_orders', true, 'suppliers', true
      ),
      'circulations', jsonb_build_array('own', 'siad', 'berpalack'),
      'warehouse_bins', jsonb_build_array(),
      'invoicing', jsonb_build_object(
        'provider', NULL, 'bill_own_circulation', false,
        'bill_siad_circulation', true, 'bill_foreign_circulation', true
      ),
      'tax', jsonb_build_object('regime', v_regime, 'default_rate', v_rate, 'price_entry', 'net')
    ),
    true
  )
  RETURNING id INTO v_id;

  IF v_email <> '' THEN
    SELECT id INTO v_admin FROM auth.users WHERE lower(email) = v_email LIMIT 1;
    IF v_admin IS NULL THEN
      RAISE EXCEPTION 'Nincs ilyen felhasználó: %. Előbb regisztráljon az appban.', v_email;
    END IF;
    PERFORM set_config('app.allow_profile_privilege_change', 'on', true);
    INSERT INTO public.profiles (id, email, full_name, role, is_active, organization_id)
    VALUES (v_admin, v_email, NULL, 'admin', true, v_id)
    ON CONFLICT (id) DO UPDATE SET
      organization_id = v_id, role = 'admin', is_active = true,
      email = EXCLUDED.email, updated_at = now();
  END IF;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    auth.uid(), 'Cég létrehozva', 'organization', v_id,
    jsonb_build_object('name', v_name, 'slug', v_slug, 'tax_regime', v_regime, 'admin_email', nullif(v_email, ''))
  );
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.enforce_profiles_privilege_columns IS
  'SEC-001: tiltja az is_platform_admin és saját privileged mezők kliens UPDATE-jét.';
COMMENT ON FUNCTION public.finalize_invoice_document_exchanges IS
  'SEC: számlázás után exchanges.invoiced org-scoped SECURITY DEFINER frissítés.';
