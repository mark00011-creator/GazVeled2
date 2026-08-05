-- Eszköz- és fogyóanyag-készlet: RLS és GRANT (Fázis A)
-- Admin: olvasás + RPC-n keresztül írás. exchange_operator és viewer: tiltás.

ALTER TABLE public.supply_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supply_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supply_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supply_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supply_billing_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "supply_products admin select" ON public.supply_products;
CREATE POLICY "supply_products admin select"
  ON public.supply_products FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "supply_movements admin select" ON public.supply_stock_movements;
CREATE POLICY "supply_movements admin select"
  ON public.supply_stock_movements FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "supply_sales admin select" ON public.supply_sales;
CREATE POLICY "supply_sales admin select"
  ON public.supply_sales FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "supply_sale_items admin select" ON public.supply_sale_items;
CREATE POLICY "supply_sale_items admin select"
  ON public.supply_sale_items FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "supply_billing_queue admin select" ON public.supply_billing_queue;
CREATE POLICY "supply_billing_queue admin select"
  ON public.supply_billing_queue FOR SELECT TO authenticated
  USING (public.is_admin());

-- Csak SELECT – közvetlen INSERT/UPDATE/DELETE tiltva (RPC SECURITY DEFINER)
REVOKE ALL ON public.supply_products FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.supply_stock_movements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.supply_sales FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.supply_sale_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.supply_billing_queue FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.supply_products TO authenticated;
GRANT SELECT ON public.supply_stock_movements TO authenticated;
GRANT SELECT ON public.supply_sales TO authenticated;
GRANT SELECT ON public.supply_sale_items TO authenticated;
GRANT SELECT ON public.supply_billing_queue TO authenticated;

GRANT ALL ON public.supply_products TO service_role;
GRANT ALL ON public.supply_stock_movements TO service_role;
GRANT ALL ON public.supply_sales TO service_role;
GRANT ALL ON public.supply_sale_items TO service_role;
GRANT ALL ON public.supply_billing_queue TO service_role;
