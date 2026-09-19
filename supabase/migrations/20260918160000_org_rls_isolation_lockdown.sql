-- Org izoláció lockdown: új cégek üres adatot látnak, nincs Gáz Veled spillover
-- Production: snmiwsgtnokvqlnwvfwf
--
-- Probléma: sok legacy RLS policy (qual=true / csak can_write) OR-olódik a same_org
-- policykkal → más szervezet adatai látszanak (árlista, bérletek, kínai készlet, stb.).
-- SECURITY DEFINER RPC-k megkerülik az RLS-t → trigger is kell az írás védelméhez.

-- ---------------------------------------------------------------------------
-- 1) Írásvédelem: organization_id kényszerítés (profiles kivétel)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_organization_isolation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  -- Migráció / service_role: ne akadályozzuk
  IF auth.uid() IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_org := public.auth_organization_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Nincs aktív szervezet a profilon';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.organization_id IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'Szervezetek közötti törlés tiltott';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.organization_id := coalesce(NEW.organization_id, v_org);
    IF NEW.organization_id IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'Szervezetek közötti beszúrás tiltott';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: ne lehessen más cég sorát módosítani / org-ot átírni
  IF OLD.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'Szervezetek közötti módosítás tiltott';
  END IF;
  NEW.organization_id := v_org;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_organization_isolation() FROM PUBLIC;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'partners', 'cylinders', 'suppliers', 'exchanges', 'movements', 'rentals',
    'rental_cylinders', 'rental_invoices', 'rental_reassignments', 'rental_quantity_items',
    'events', 'cylinder_history', 'cylinder_loans', 'audit_log', 'bulk_scans',
    'product_prices', 'quotes', 'quote_items',
    'chinese_cylinder_stock', 'chinese_stock_movements',
    'flaga_pb_stock', 'flaga_pb_stock_movements',
    'prima_pb_stock', 'prima_pb_stock_movements',
    'partner_quantity_stock',
    'circulation_differences', 'circulation_difference_settlements',
    'gas_orders', 'gas_order_items', 'gas_order_quantity_items',
    'supplier_exchanges',
    'supply_products', 'supply_stock_movements', 'supply_sales', 'supply_sale_items',
    'supply_billing_queue'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'organization_id'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_enforce_org_isolation ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_enforce_org_isolation
           BEFORE INSERT OR UPDATE OR DELETE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_isolation()',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Helper: összes policy törlése egy tábláról
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._drop_all_policies(p_table text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = p_table
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, p_table);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Tiszta org-szűrt RLS minden üzleti táblán
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  -- --- partners ---
  PERFORM public._drop_all_policies('partners');
  CREATE POLICY "partners select org" ON public.partners
    FOR SELECT TO authenticated
    USING (public.can_exchange() AND public.same_org(organization_id));
  CREATE POLICY "partners write org" ON public.partners
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- cylinders ---
  PERFORM public._drop_all_policies('cylinders');
  CREATE POLICY "cylinders select org" ON public.cylinders
    FOR SELECT TO authenticated
    USING (public.can_exchange() AND public.same_org(organization_id));
  CREATE POLICY "cylinders write org" ON public.cylinders
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- suppliers ---
  PERFORM public._drop_all_policies('suppliers');
  CREATE POLICY "suppliers select org" ON public.suppliers
    FOR SELECT TO authenticated
    USING (public.can_exchange() AND public.same_org(organization_id));
  CREATE POLICY "suppliers write org" ON public.suppliers
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- exchanges ---
  PERFORM public._drop_all_policies('exchanges');
  CREATE POLICY "exchanges select org" ON public.exchanges
    FOR SELECT TO authenticated
    USING (public.is_admin() AND public.same_org(organization_id));
  CREATE POLICY "exchanges insert org" ON public.exchanges
    FOR INSERT TO authenticated
    WITH CHECK (public.can_exchange() AND public.same_org(organization_id));
  CREATE POLICY "exchanges write org" ON public.exchanges
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- movements ---
  PERFORM public._drop_all_policies('movements');
  CREATE POLICY "movements select org" ON public.movements
    FOR SELECT TO authenticated
    USING (public.can_exchange() AND public.same_org(organization_id));
  CREATE POLICY "movements insert org" ON public.movements
    FOR INSERT TO authenticated
    WITH CHECK (public.can_exchange() AND public.same_org(organization_id));
  CREATE POLICY "movements write org" ON public.movements
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- rentals ---
  PERFORM public._drop_all_policies('rentals');
  CREATE POLICY "rentals select org" ON public.rentals
    FOR SELECT TO authenticated
    USING (public.can_exchange() AND public.same_org(organization_id));
  CREATE POLICY "rentals write org" ON public.rentals
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- rental_cylinders ---
  PERFORM public._drop_all_policies('rental_cylinders');
  CREATE POLICY "rental_cylinders select org" ON public.rental_cylinders
    FOR SELECT TO authenticated
    USING (public.can_exchange() AND public.same_org(organization_id));
  CREATE POLICY "rental_cylinders write org" ON public.rental_cylinders
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- rental_invoices ---
  PERFORM public._drop_all_policies('rental_invoices');
  CREATE POLICY "rental_invoices select org" ON public.rental_invoices
    FOR SELECT TO authenticated
    USING (public.can_write() AND public.same_org(organization_id));
  CREATE POLICY "rental_invoices write org" ON public.rental_invoices
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- rental_reassignments ---
  PERFORM public._drop_all_policies('rental_reassignments');
  CREATE POLICY "rental_reassignments select org" ON public.rental_reassignments
    FOR SELECT TO authenticated
    USING (public.can_write() AND public.same_org(organization_id));
  CREATE POLICY "rental_reassignments write org" ON public.rental_reassignments
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- rental_quantity_items ---
  PERFORM public._drop_all_policies('rental_quantity_items');
  CREATE POLICY "rental_quantity_items select org" ON public.rental_quantity_items
    FOR SELECT TO authenticated
    USING (public.can_exchange() AND public.same_org(organization_id));
  CREATE POLICY "rental_quantity_items write org" ON public.rental_quantity_items
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- events ---
  PERFORM public._drop_all_policies('events');
  CREATE POLICY "events select org" ON public.events
    FOR SELECT TO authenticated
    USING (public.is_admin() AND public.same_org(organization_id));
  CREATE POLICY "events insert org" ON public.events
    FOR INSERT TO authenticated
    WITH CHECK (public.can_exchange() AND public.same_org(organization_id));

  -- --- cylinder_history ---
  PERFORM public._drop_all_policies('cylinder_history');
  CREATE POLICY "cylinder_history select org" ON public.cylinder_history
    FOR SELECT TO authenticated
    USING ((public.is_admin() OR public.can_exchange()) AND public.same_org(organization_id));
  CREATE POLICY "cylinder_history insert org" ON public.cylinder_history
    FOR INSERT TO authenticated
    WITH CHECK (public.can_exchange() AND public.same_org(organization_id));

  -- --- cylinder_loans ---
  PERFORM public._drop_all_policies('cylinder_loans');
  CREATE POLICY "cylinder_loans select org" ON public.cylinder_loans
    FOR SELECT TO authenticated
    USING (public.can_exchange() AND public.same_org(organization_id));
  CREATE POLICY "cylinder_loans write org" ON public.cylinder_loans
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- audit_log ---
  PERFORM public._drop_all_policies('audit_log');
  CREATE POLICY "audit_log select org" ON public.audit_log
    FOR SELECT TO authenticated
    USING (public.is_admin() AND public.same_org(organization_id));
  CREATE POLICY "audit_log insert org" ON public.audit_log
    FOR INSERT TO authenticated
    WITH CHECK (public.same_org(organization_id));

  -- --- bulk_scans ---
  PERFORM public._drop_all_policies('bulk_scans');
  CREATE POLICY "bulk_scans select org" ON public.bulk_scans
    FOR SELECT TO authenticated
    USING (public.can_write() AND public.same_org(organization_id));
  CREATE POLICY "bulk_scans write org" ON public.bulk_scans
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- product_prices (csak saját org) ---
  PERFORM public._drop_all_policies('product_prices');
  CREATE POLICY "product_prices select org" ON public.product_prices
    FOR SELECT TO authenticated
    USING (public.is_admin() AND public.same_org(organization_id));
  CREATE POLICY "product_prices write org" ON public.product_prices
    FOR ALL TO authenticated
    USING (public.is_admin() AND public.same_org(organization_id))
    WITH CHECK (public.is_admin() AND public.same_org(organization_id));

  -- --- quotes / quote_items ---
  PERFORM public._drop_all_policies('quotes');
  CREATE POLICY "quotes select org" ON public.quotes
    FOR SELECT TO authenticated
    USING (public.can_write() AND public.same_org(organization_id));
  CREATE POLICY "quotes write org" ON public.quotes
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  PERFORM public._drop_all_policies('quote_items');
  CREATE POLICY "quote_items select org" ON public.quote_items
    FOR SELECT TO authenticated
    USING (public.can_write() AND public.same_org(organization_id));
  CREATE POLICY "quote_items write org" ON public.quote_items
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- chinese stock ---
  PERFORM public._drop_all_policies('chinese_cylinder_stock');
  CREATE POLICY "chinese_stock select org" ON public.chinese_cylinder_stock
    FOR SELECT TO authenticated
    USING (public.can_exchange() AND public.same_org(organization_id));
  CREATE POLICY "chinese_stock write org" ON public.chinese_cylinder_stock
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  PERFORM public._drop_all_policies('chinese_stock_movements');
  CREATE POLICY "chinese_movements select org" ON public.chinese_stock_movements
    FOR SELECT TO authenticated
    USING (public.can_exchange() AND public.same_org(organization_id));
  CREATE POLICY "chinese_movements write org" ON public.chinese_stock_movements
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- flaga / prima ---
  FOREACH t IN ARRAY ARRAY['flaga_pb_stock', 'prima_pb_stock'] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      PERFORM public._drop_all_policies(t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
           USING (public.can_exchange() AND public.same_org(organization_id))',
        t || ' select org', t
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
           USING (public.can_write() AND public.same_org(organization_id))
           WITH CHECK (public.can_write() AND public.same_org(organization_id))',
        t || ' write org', t
      );
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['flaga_pb_stock_movements', 'prima_pb_stock_movements'] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      PERFORM public._drop_all_policies(t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
           USING (public.can_exchange() AND public.same_org(organization_id))',
        t || ' select org', t
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
           USING (public.can_write() AND public.same_org(organization_id))
           WITH CHECK (public.can_write() AND public.same_org(organization_id))',
        t || ' write org', t
      );
    END IF;
  END LOOP;

  -- --- partner_quantity_stock ---
  PERFORM public._drop_all_policies('partner_quantity_stock');
  CREATE POLICY "partner_qty select org" ON public.partner_quantity_stock
    FOR SELECT TO authenticated
    USING (public.can_exchange() AND public.same_org(organization_id));
  CREATE POLICY "partner_qty write org" ON public.partner_quantity_stock
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- circulation differences ---
  PERFORM public._drop_all_policies('circulation_differences');
  CREATE POLICY "circ_diff select org" ON public.circulation_differences
    FOR SELECT TO authenticated
    USING (public.can_exchange() AND public.same_org(organization_id));
  CREATE POLICY "circ_diff write org" ON public.circulation_differences
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  PERFORM public._drop_all_policies('circulation_difference_settlements');
  CREATE POLICY "circ_settle select org" ON public.circulation_difference_settlements
    FOR SELECT TO authenticated
    USING (public.can_write() AND public.same_org(organization_id));
  CREATE POLICY "circ_settle write org" ON public.circulation_difference_settlements
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- gas orders ---
  FOREACH t IN ARRAY ARRAY['gas_orders', 'gas_order_items', 'gas_order_quantity_items'] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      PERFORM public._drop_all_policies(t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
           USING (public.can_write() AND public.same_org(organization_id))',
        t || ' select org', t
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
           USING (public.can_write() AND public.same_org(organization_id))
           WITH CHECK (public.can_write() AND public.same_org(organization_id))',
        t || ' write org', t
      );
    END IF;
  END LOOP;

  -- --- supplier_exchanges ---
  PERFORM public._drop_all_policies('supplier_exchanges');
  CREATE POLICY "supplier_exchanges select org" ON public.supplier_exchanges
    FOR SELECT TO authenticated
    USING (public.can_exchange() AND public.same_org(organization_id));
  CREATE POLICY "supplier_exchanges write org" ON public.supplier_exchanges
    FOR ALL TO authenticated
    USING (public.can_write() AND public.same_org(organization_id))
    WITH CHECK (public.can_write() AND public.same_org(organization_id));

  -- --- supply_* (admin, org) ---
  FOREACH t IN ARRAY ARRAY[
    'supply_products', 'supply_stock_movements', 'supply_sales',
    'supply_sale_items', 'supply_billing_queue'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      PERFORM public._drop_all_policies(t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
           USING (public.is_admin() AND public.same_org(organization_id))',
        t || ' select org', t
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
           USING (public.is_admin() AND public.same_org(organization_id))
           WITH CHECK (public.is_admin() AND public.same_org(organization_id))',
        t || ' write org', t
      );
    END IF;
  END LOOP;
END $$;

-- profiles: ne legyen org-független update writer leak
DROP POLICY IF EXISTS "profiles delete admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles insert writer" ON public.profiles;
DROP POLICY IF EXISTS "profiles update writer" ON public.profiles;
-- megtartjuk: profiles admin read all, admin update roles, update own safe

DROP FUNCTION IF EXISTS public._drop_all_policies(text);

COMMENT ON FUNCTION public.enforce_organization_isolation IS
  'BEFORE trigger: organization_id = auth_organization_id(); cross-org írás tiltott.';
