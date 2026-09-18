-- Supply (eszköz/fogyóanyag) org-szűrés RLS – modul cégenként
-- Production: snmiwsgtnokvqlnwvfwf

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'supply_products',
    'supply_stock_movements',
    'supply_sales',
    'supply_sale_items',
    'supply_billing_queue'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'organization_id'
    ) THEN
      EXECUTE format(
        'UPDATE public.%I SET organization_id = %L::uuid WHERE organization_id IS NULL',
        t,
        'a0000000-0000-4000-8000-000000000001'
      );
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS "supply_products admin select" ON public.supply_products;
CREATE POLICY "supply_products admin select"
  ON public.supply_products FOR SELECT TO authenticated
  USING (public.is_admin() AND public.same_org(organization_id));

DROP POLICY IF EXISTS "supply_movements admin select" ON public.supply_stock_movements;
CREATE POLICY "supply_movements admin select"
  ON public.supply_stock_movements FOR SELECT TO authenticated
  USING (public.is_admin() AND public.same_org(organization_id));

DROP POLICY IF EXISTS "supply_sales admin select" ON public.supply_sales;
CREATE POLICY "supply_sales admin select"
  ON public.supply_sales FOR SELECT TO authenticated
  USING (public.is_admin() AND public.same_org(organization_id));

DROP POLICY IF EXISTS "supply_sale_items admin select" ON public.supply_sale_items;
CREATE POLICY "supply_sale_items admin select"
  ON public.supply_sale_items FOR SELECT TO authenticated
  USING (public.is_admin() AND public.same_org(organization_id));

DROP POLICY IF EXISTS "supply_billing_queue admin select" ON public.supply_billing_queue;
CREATE POLICY "supply_billing_queue admin select"
  ON public.supply_billing_queue FOR SELECT TO authenticated
  USING (public.is_admin() AND public.same_org(organization_id));
