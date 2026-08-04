-- Gyors csere operátor (exchange_operator) RBAC – profiles.role alapú, defense in depth
-- Production: snmiwsgtnokvqlnwvfwf

-- 1) profiles.role oszlop + constraint
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text;

UPDATE public.profiles SET role = 'admin' WHERE role IS NULL AND email = 'marktheseeker@gmail.com';
UPDATE public.profiles SET role = 'viewer' WHERE role IS NULL;

ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'viewer';
ALTER TABLE public.profiles ALTER COLUMN role SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_role_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_check
      CHECK (role IN ('admin', 'exchange_operator', 'viewer'));
  END IF;
END $$;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'exchange_operator', 'viewer'));

-- Biztos admin
UPDATE public.profiles SET role = 'admin' WHERE email = 'marktheseeker@gmail.com';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2) Szerepkör függvények
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT auth.role()) = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND is_active = true
    );
$$;

CREATE OR REPLACE FUNCTION public.is_exchange_operator()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'exchange_operator' AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_operator()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_exchange_operator();
$$;

CREATE OR REPLACE FUNCTION public.can_exchange()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin() OR public.is_exchange_operator();
$$;

CREATE OR REPLACE FUNCTION public.can_write()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin();
$$;

CREATE OR REPLACE FUNCTION public.require_admin()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_exchange_access()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_exchange() THEN RAISE EXCEPTION 'Exchange access required'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.require_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.require_exchange_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.require_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.require_exchange_access() TO authenticated;

-- 3) handle_new_user: alapértelmezett viewer
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'viewer',
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 4) RLS – auth all cseréje szerepkör-alapúra
-- partners
DROP POLICY IF EXISTS "partners auth all" ON public.partners;
DROP POLICY IF EXISTS "partners select exchange" ON public.partners;
DROP POLICY IF EXISTS "partners write admin" ON public.partners;
CREATE POLICY "partners select exchange" ON public.partners
  FOR SELECT TO authenticated USING (public.can_exchange());
CREATE POLICY "partners write admin" ON public.partners
  FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());

-- cylinders
DROP POLICY IF EXISTS "cylinders auth all" ON public.cylinders;
DROP POLICY IF EXISTS "cylinders select exchange" ON public.cylinders;
DROP POLICY IF EXISTS "cylinders write admin" ON public.cylinders;
CREATE POLICY "cylinders select exchange" ON public.cylinders
  FOR SELECT TO authenticated USING (public.can_exchange());
CREATE POLICY "cylinders write admin" ON public.cylinders
  FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());

-- rentals (operátor: csak olvasás bérlet-cserehez)
DROP POLICY IF EXISTS "rentals auth all" ON public.rentals;
DROP POLICY IF EXISTS "rentals select exchange" ON public.rentals;
DROP POLICY IF EXISTS "rentals write admin" ON public.rentals;
CREATE POLICY "rentals select exchange" ON public.rentals
  FOR SELECT TO authenticated USING (public.can_exchange());
CREATE POLICY "rentals write admin" ON public.rentals
  FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());

-- rental_cylinders
DROP POLICY IF EXISTS "rental_cylinders auth all" ON public.rental_cylinders;
DROP POLICY IF EXISTS "rental_cylinders select exchange" ON public.rental_cylinders;
DROP POLICY IF EXISTS "rental_cylinders write admin" ON public.rental_cylinders;
CREATE POLICY "rental_cylinders select exchange" ON public.rental_cylinders
  FOR SELECT TO authenticated USING (public.can_exchange());
CREATE POLICY "rental_cylinders write admin" ON public.rental_cylinders
  FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());

-- circulation_differences
DROP POLICY IF EXISTS "circulation_differences auth all" ON public.circulation_differences;
DROP POLICY IF EXISTS "circulation_differences select exchange" ON public.circulation_differences;
DROP POLICY IF EXISTS "circulation_differences write admin" ON public.circulation_differences;
CREATE POLICY "circulation_differences select exchange" ON public.circulation_differences
  FOR SELECT TO authenticated USING (public.can_exchange());
CREATE POLICY "circulation_differences write admin" ON public.circulation_differences
  FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());

-- exchanges
DROP POLICY IF EXISTS "exchanges auth all" ON public.exchanges;
DROP POLICY IF EXISTS "exchanges select admin" ON public.exchanges;
DROP POLICY IF EXISTS "exchanges insert exchange" ON public.exchanges;
DROP POLICY IF EXISTS "exchanges write admin" ON public.exchanges;
CREATE POLICY "exchanges select admin" ON public.exchanges
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "exchanges insert exchange" ON public.exchanges
  FOR INSERT TO authenticated WITH CHECK (public.can_exchange());
CREATE POLICY "exchanges write admin" ON public.exchanges
  FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());

-- product_prices – csak admin
DROP POLICY IF EXISTS "product_prices auth all" ON public.product_prices;
DROP POLICY IF EXISTS "product_prices admin" ON public.product_prices;
CREATE POLICY "product_prices admin" ON public.product_prices
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- cylinder_history
DROP POLICY IF EXISTS "cylinder_history auth all" ON public.cylinder_history;
DROP POLICY IF EXISTS "cylinder_history select admin" ON public.cylinder_history;
DROP POLICY IF EXISTS "cylinder_history insert exchange" ON public.cylinder_history;
CREATE POLICY "cylinder_history select admin" ON public.cylinder_history
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "cylinder_history insert exchange" ON public.cylinder_history
  FOR INSERT TO authenticated WITH CHECK (public.can_exchange());

-- events
DROP POLICY IF EXISTS "events auth all" ON public.events;
DROP POLICY IF EXISTS "events select admin" ON public.events;
DROP POLICY IF EXISTS "events insert exchange" ON public.events;
CREATE POLICY "events select admin" ON public.events
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "events insert exchange" ON public.events
  FOR INSERT TO authenticated WITH CHECK (public.can_exchange());

-- profiles – saját olvasás + admin teljes, szerepkör-változtatás tiltása önmagának
DROP POLICY IF EXISTS "Profiles readable by authenticated" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles admin read all" ON public.profiles;
DROP POLICY IF EXISTS "profiles admin update roles" ON public.profiles;
DROP POLICY IF EXISTS "profiles update own safe" ON public.profiles;
CREATE POLICY "profiles admin read all" ON public.profiles
  FOR SELECT TO authenticated USING (public.is_admin() OR id = auth.uid());
CREATE POLICY "profiles admin update roles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
CREATE POLICY "profiles update own safe" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
    AND is_active = (SELECT p.is_active FROM public.profiles p WHERE p.id = auth.uid())
  );

-- partner_quantity_stock: operátor olvashat, írni csak admin (RPC-n keresztül)
DROP POLICY IF EXISTS "partner_quantity_stock auth all" ON public.partner_quantity_stock;
DROP POLICY IF EXISTS "partner_quantity_stock select exchange" ON public.partner_quantity_stock;
DROP POLICY IF EXISTS "partner_quantity_stock admin write" ON public.partner_quantity_stock;
CREATE POLICY "partner_quantity_stock select exchange" ON public.partner_quantity_stock
  FOR SELECT TO authenticated USING (public.can_exchange());
CREATE POLICY "partner_quantity_stock admin write" ON public.partner_quantity_stock
  FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());

-- cylinder_loans – csak admin
DROP POLICY IF EXISTS "cylinder_loans auth all" ON public.cylinder_loans;
DROP POLICY IF EXISTS "cylinder_loans auth insert" ON public.cylinder_loans;
DROP POLICY IF EXISTS "cylinder_loans auth update" ON public.cylinder_loans;
DROP POLICY IF EXISTS "cylinder_loans admin" ON public.cylinder_loans;
CREATE POLICY "cylinder_loans admin" ON public.cylinder_loans
  FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());

-- circulation_difference_settlements – csak admin (RPC definer)
DROP POLICY IF EXISTS "circulation_diff_settlements auth all" ON public.circulation_difference_settlements;
DROP POLICY IF EXISTS "circulation_difference_settlements admin" ON public.circulation_difference_settlements;
CREATE POLICY "circulation_difference_settlements admin" ON public.circulation_difference_settlements
  FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());

-- Készlet / admin táblák: can_write()
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = ANY(ARRAY[
        'chinese_cylinder_stock', 'chinese_stock_movements',
        'flaga_pb_stock', 'flaga_pb_stock_movements',
        'prima_pb_stock', 'prima_pb_stock_movements',
        'gas_orders', 'gas_order_items', 'gas_order_quantity_items',
        'quotes', 'quote_items', 'movements', 'rental_reassignments',
        'suppliers', 'audit_log', 'bulk_scans', 'supplier_exchanges',
        'rental_invoices', 'rental_quantity_items'
      ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tablename || ' auth all', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tablename || ' admin', r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write())',
      r.tablename || ' admin', r.tablename
    );
  END LOOP;
END $$;

-- 5) RPC guard – csere műveletek
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
  v_in_key text;
  v_out_key text;
  v_exchange_id uuid;
  v_diff_id uuid;
BEGIN
  PERFORM public.require_exchange_access();
  SELECT * INTO v_in FROM public.cylinders WHERE id = p_incoming_id FOR UPDATE;
  SELECT * INTO v_out FROM public.cylinders WHERE id = p_outgoing_id FOR UPDATE;
  IF v_in.id IS NULL OR v_out.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;

  v_in_key := public.derive_exchange_circulation_key(v_in.circulation, v_in.manufacturer::text);
  v_out_key := public.derive_exchange_circulation_key(v_out.circulation, v_out.manufacturer::text);
  v_forced := v_in_key <> v_out_key OR v_in.gas_type <> v_out.gas_type;

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    incoming_exchange_circulation, outgoing_exchange_circulation,
    is_forced_substitution, reason, rental_reassigned, rental_id, note, created_by, operation_type
  ) VALUES (
    p_partner_id, v_in.id, v_in.circulation, v_out.id, v_out.circulation,
    v_in_key, v_out_key,
    v_forced, NULLIF(trim(COALESCE(p_reason,'')), ''), COALESCE(p_reassign_rental,false), p_rental_id, p_note, v_uid, 'exchange'
  ) RETURNING id INTO v_exchange_id;

  INSERT INTO public.movements (cylinder_id, from_location, from_partner_id, to_location, status_after, note, created_by)
  VALUES (v_in.id, v_in.location_type, v_in.location_partner_id, 'warehouse_empty', 'empty', 'Gyors csere – üres beérkezett', v_uid);

  INSERT INTO public.movements (cylinder_id, from_location, to_location, to_partner_id, status_after, note, created_by)
  VALUES (v_out.id, v_out.location_type, 'customer', p_partner_id, 'full', 'Gyors csere – teli kiadva', v_uid);

  UPDATE public.cylinders SET status = 'empty', location_type = 'warehouse_empty', location_partner_id = NULL, location_supplier_id = NULL WHERE id = v_in.id;
  UPDATE public.cylinders SET status = 'full', location_type = 'customer', location_partner_id = p_partner_id, location_supplier_id = NULL WHERE id = v_out.id;

  IF p_reassign_rental AND p_rental_id IS NOT NULL THEN
    INSERT INTO public.rental_reassignments(rental_id, old_cylinder_id, new_cylinder_id, note, created_by)
    SELECT p_rental_id, current_cylinder_id, v_out.id, 'Gyors csere során', v_uid FROM public.rentals WHERE id = p_rental_id;
    UPDATE public.rentals SET current_cylinder_id = v_out.id, updated_at = now() WHERE id = p_rental_id;
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

CREATE OR REPLACE FUNCTION public.record_empty_return(
  p_partner_id uuid,
  p_incoming_id uuid,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_in public.cylinders;
  v_uid uuid := auth.uid();
  v_exchange_id uuid;
BEGIN
  PERFORM public.require_exchange_access();
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;
  SELECT * INTO v_in FROM public.cylinders WHERE id = p_incoming_id FOR UPDATE;
  IF v_in.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;
  IF v_in.status <> 'empty' THEN RAISE EXCEPTION 'A visszavett palacknak üres állapotúnak kell lennie'; END IF;

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    is_forced_substitution, note, created_by, operation_type
  ) VALUES (
    p_partner_id, v_in.id, v_in.circulation, NULL, v_in.circulation,
    false, p_note, v_uid, 'empty_return'
  ) RETURNING id INTO v_exchange_id;

  INSERT INTO public.movements (cylinder_id, from_location, from_partner_id, to_location, status_after, note, created_by)
  VALUES (v_in.id, COALESCE(v_in.location_type, 'customer'), v_in.location_partner_id, 'warehouse_empty', 'empty', 'Üres visszavétel', v_uid);

  UPDATE public.cylinders
  SET status = 'empty', location_type = 'warehouse_empty', location_partner_id = NULL, location_supplier_id = NULL
  WHERE id = v_in.id;

  RETURN v_exchange_id;
END;
$$;

-- record_partner_sale guard
CREATE OR REPLACE FUNCTION public.record_partner_sale(
  p_partner_id uuid,
  p_outgoing_id uuid,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_out public.cylinders;
  v_uid uuid := auth.uid();
  v_exchange_id uuid;
BEGIN
  PERFORM public.require_exchange_access();
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;
  SELECT * INTO v_out FROM public.cylinders WHERE id = p_outgoing_id FOR UPDATE;
  IF v_out.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;
  IF v_out.status <> 'full' THEN RAISE EXCEPTION 'A kiadott palacknak teli állapotúnak kell lennie'; END IF;

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    is_forced_substitution, note, created_by, operation_type
  ) VALUES (
    p_partner_id, NULL, v_out.circulation, v_out.id, v_out.circulation,
    false, p_note, v_uid, 'sale'
  ) RETURNING id INTO v_exchange_id;

  INSERT INTO public.movements (cylinder_id, from_location, to_location, to_partner_id, status_after, note, created_by)
  VALUES (v_out.id, v_out.location_type, 'customer', p_partner_id, 'full', 'Eladás – teli kiadva', v_uid);

  UPDATE public.cylinders
  SET status = 'full', location_type = 'customer', location_partner_id = p_partner_id, location_supplier_id = NULL
  WHERE id = v_out.id;

  RETURN v_exchange_id;
END;
$$;

-- record_cylinder_loan – csak admin (eredeti törzs + guard)
CREATE OR REPLACE FUNCTION public.record_cylinder_loan(
  p_partner_id uuid,
  p_outgoing_id uuid,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_out public.cylinders;
  v_uid uuid := auth.uid();
  v_exchange_id uuid;
  v_loan_id uuid;
  v_rental_link uuid;
BEGIN
  PERFORM public.require_admin();
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;

  SELECT * INTO v_out FROM public.cylinders WHERE id = p_outgoing_id FOR UPDATE;
  IF v_out.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;
  IF v_out.status <> 'full' THEN RAISE EXCEPTION 'A kiadott palacknak teli állapotúnak kell lennie'; END IF;
  IF v_out.location_type <> 'warehouse_full' THEN
    RAISE EXCEPTION 'A kölcsön palacknak a telephelyi teli készletből kell jönnie';
  END IF;

  SELECT rc.rental_id INTO v_rental_link
  FROM public.rental_cylinders rc
  JOIN public.rentals r ON r.id = rc.rental_id
  WHERE rc.cylinder_id = p_outgoing_id
    AND rc.removed_at IS NULL
    AND r.status = 'active'
  LIMIT 1;
  IF v_rental_link IS NOT NULL THEN
    RAISE EXCEPTION 'A palack aktív bérletben van';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cylinder_loans
    WHERE cylinder_id = p_outgoing_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'A palack már kölcsönadott';
  END IF;

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    is_forced_substitution, note, created_by, operation_type
  ) VALUES (
    p_partner_id, NULL, v_out.circulation, v_out.id, v_out.circulation,
    false, COALESCE(NULLIF(trim(p_note), ''), 'Kölcsön'), v_uid, 'loan'
  ) RETURNING id INTO v_exchange_id;

  INSERT INTO public.cylinder_loans (
    partner_id, cylinder_id, exchange_id, note, created_by
  ) VALUES (
    p_partner_id, v_out.id, v_exchange_id, p_note, v_uid
  ) RETURNING id INTO v_loan_id;

  INSERT INTO public.movements (cylinder_id, from_location, to_location, to_partner_id, status_after, note, created_by)
  VALUES (v_out.id, v_out.location_type, 'customer', p_partner_id, 'full', 'Kölcsön – teli kiadva', v_uid);

  UPDATE public.cylinders
  SET status = 'full', location_type = 'customer', location_partner_id = p_partner_id, location_supplier_id = NULL
  WHERE id = v_out.id;

  RETURN v_loan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_exchange(uuid, uuid, uuid, text, text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_empty_return(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_partner_sale(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_cylinder_loan(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_exchange(uuid, uuid, uuid, text, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_empty_return(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_partner_sale(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_cylinder_loan(uuid, uuid, text) TO authenticated;
