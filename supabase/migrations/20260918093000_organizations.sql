-- Multi-tenant alap: organizations + organization_id a fő üzleti táblákon
-- Production: snmiwsgtnokvqlnwvfwf
-- Cégek NEM kapnak infra hozzáférést – csak app + support.

-- ---------------------------------------------------------------------------
-- 1) organizations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  logo_url text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT organizations_slug_unique UNIQUE (slug)
);

COMMENT ON TABLE public.organizations IS 'Bérlő cégek – egy app, cégenkénti adatok és beállítások.';
COMMENT ON COLUMN public.organizations.settings IS 'modules, circulations, warehouse_bins, invoicing, branding.';

CREATE INDEX IF NOT EXISTS idx_organizations_active ON public.organizations (is_active) WHERE is_active = true;

-- Fix UUID a meglévő GazVeled adat backfillhez (idempotens)
INSERT INTO public.organizations (id, name, slug, logo_url, settings, is_active)
VALUES (
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'Gáz Veled',
  'gaz-veeled',
  NULL,
  jsonb_build_object(
    'modules', jsonb_build_object(
      'flaga_pb', true,
      'prima_pb', true,
      'chinese_stock', true,
      'rentals', true,
      'tool_rental', true,
      'quotes', true,
      'gas_orders', true,
      'suppliers', true
    ),
    'circulations', jsonb_build_array('own', 'siad', 'berpalack'),
    'warehouse_bins', jsonb_build_array(),
    'invoicing', jsonb_build_object(
      'provider', NULL,
      'bill_own_circulation', false,
      'bill_siad_circulation', true,
      'bill_foreign_circulation', true
    )
  ),
  true
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) profiles.organization_id (előbb oszlop, aztán helper függvények)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

UPDATE public.profiles
SET organization_id = 'a0000000-0000-4000-8000-000000000001'::uuid
WHERE organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_organization_id
  ON public.profiles (organization_id);

-- ---------------------------------------------------------------------------
-- 3) Helper függvények
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.profiles
  WHERE id = auth.uid() AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.same_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_org_id IS NOT NULL
    AND public.auth_organization_id() IS NOT NULL
    AND p_org_id = public.auth_organization_id();
$$;

REVOKE ALL ON FUNCTION public.auth_organization_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.same_org(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.same_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_organization_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.same_org(uuid) TO service_role;

-- handle_new_user: új user viewer, org nélkül (support rendeli hozzá)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, is_active, organization_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NULL),
    'viewer',
    true,
    NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) organization_id az üzleti táblákon
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'partners',
    'suppliers',
    'cylinders',
    'movements',
    'exchanges',
    'supplier_exchanges',
    'rentals',
    'rental_cylinders',
    'rental_invoices',
    'rental_quantity_items',
    'rental_reassignments',
    'cylinder_history',
    'cylinder_loans',
    'events',
    'audit_log',
    'product_prices',
    'quotes',
    'quote_items',
    'gas_orders',
    'gas_order_items',
    'gas_order_quantity_items',
    'chinese_cylinder_stock',
    'chinese_stock_movements',
    'flaga_pb_stock',
    'flaga_pb_stock_movements',
    'prima_pb_stock',
    'prima_pb_stock_movements',
    'circulation_differences',
    'circulation_difference_settlements',
    'partner_quantity_stock',
    'bulk_scans',
    'supply_products',
    'supply_sales',
    'supply_sale_items',
    'supply_stock_movements',
    'supply_billing_queue'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id)',
        t
      );
      EXECUTE format(
        'UPDATE public.%I SET organization_id = %L::uuid WHERE organization_id IS NULL',
        t,
        'a0000000-0000-4000-8000-000000000001'
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (organization_id)',
        'idx_' || t || '_organization_id',
        t
      );
      -- DEFAULT: új sorok a bejelentkezett user orgjába
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN organization_id SET DEFAULT public.auth_organization_id()',
        t
      );
    END IF;
  END LOOP;
END $$;

-- NOT NULL külön, biztonságosan
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'partners','suppliers','cylinders','movements','exchanges','supplier_exchanges',
    'rentals','rental_cylinders','rental_invoices','rental_quantity_items','rental_reassignments',
    'cylinder_history','cylinder_loans','events','audit_log','product_prices','quotes','quote_items',
    'gas_orders','gas_order_items','gas_order_quantity_items',
    'chinese_cylinder_stock','chinese_stock_movements',
    'flaga_pb_stock','flaga_pb_stock_movements','prima_pb_stock','prima_pb_stock_movements',
    'circulation_differences','circulation_difference_settlements','partner_quantity_stock','bulk_scans',
    'supply_products','supply_sales','supply_sale_items','supply_stock_movements','supply_billing_queue'
  ];
  nulls bigint;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'organization_id'
    ) THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id IS NULL', t) INTO nulls;
      IF nulls = 0 THEN
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', t);
      END IF;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5) RLS: organizations + profiles org határok
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organizations select own" ON public.organizations;
CREATE POLICY "organizations select own" ON public.organizations
  FOR SELECT TO authenticated
  USING (id = public.auth_organization_id());

DROP POLICY IF EXISTS "organizations update own admin" ON public.organizations;
CREATE POLICY "organizations update own admin" ON public.organizations
  FOR UPDATE TO authenticated
  USING (id = public.auth_organization_id() AND public.is_admin())
  WITH CHECK (id = public.auth_organization_id() AND public.is_admin());

-- profiles: admin csak saját org tagjait látja/módosítja (saját sor továbbra is)
DROP POLICY IF EXISTS "profiles read authenticated" ON public.profiles;
DROP POLICY IF EXISTS "profiles admin read all" ON public.profiles;
CREATE POLICY "profiles admin read all" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (public.is_admin() AND same_org(organization_id))
  );

DROP POLICY IF EXISTS "profiles admin update roles" ON public.profiles;
CREATE POLICY "profiles admin update roles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin() AND same_org(organization_id))
  WITH CHECK (public.is_admin() AND same_org(organization_id));

-- ---------------------------------------------------------------------------
-- 6) Fő táblák RLS: org szűrés a meglévő jogosultság mellé
--     (policy csere – idempotens DROP + CREATE)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- partners
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='partners') THEN
    DROP POLICY IF EXISTS "partners select exchange" ON public.partners;
    CREATE POLICY "partners select exchange" ON public.partners
      FOR SELECT TO authenticated USING (public.can_exchange() AND public.same_org(organization_id));
    DROP POLICY IF EXISTS "partners write admin" ON public.partners;
    CREATE POLICY "partners write admin" ON public.partners
      FOR ALL TO authenticated
      USING (public.can_write() AND public.same_org(organization_id))
      WITH CHECK (public.can_write() AND public.same_org(organization_id));
  END IF;

  -- cylinders
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cylinders') THEN
    DROP POLICY IF EXISTS "cylinders select exchange" ON public.cylinders;
    CREATE POLICY "cylinders select exchange" ON public.cylinders
      FOR SELECT TO authenticated USING (public.can_exchange() AND public.same_org(organization_id));
    DROP POLICY IF EXISTS "cylinders write admin" ON public.cylinders;
    CREATE POLICY "cylinders write admin" ON public.cylinders
      FOR ALL TO authenticated
      USING (public.can_write() AND public.same_org(organization_id))
      WITH CHECK (public.can_write() AND public.same_org(organization_id));
  END IF;

  -- suppliers
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='suppliers') THEN
    DROP POLICY IF EXISTS "suppliers auth all" ON public.suppliers;
    DROP POLICY IF EXISTS "suppliers select exchange" ON public.suppliers;
    DROP POLICY IF EXISTS "suppliers write admin" ON public.suppliers;
    CREATE POLICY "suppliers select exchange" ON public.suppliers
      FOR SELECT TO authenticated USING (public.can_exchange() AND public.same_org(organization_id));
    CREATE POLICY "suppliers write admin" ON public.suppliers
      FOR ALL TO authenticated
      USING (public.can_write() AND public.same_org(organization_id))
      WITH CHECK (public.can_write() AND public.same_org(organization_id));
  END IF;

  -- exchanges
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='exchanges') THEN
    DROP POLICY IF EXISTS "exchanges select admin" ON public.exchanges;
    DROP POLICY IF EXISTS "exchanges insert exchange" ON public.exchanges;
    DROP POLICY IF EXISTS "exchanges write admin" ON public.exchanges;
    CREATE POLICY "exchanges select admin" ON public.exchanges
      FOR SELECT TO authenticated USING (public.is_admin() AND public.same_org(organization_id));
    CREATE POLICY "exchanges insert exchange" ON public.exchanges
      FOR INSERT TO authenticated
      WITH CHECK (public.can_exchange() AND public.same_org(organization_id));
    CREATE POLICY "exchanges write admin" ON public.exchanges
      FOR ALL TO authenticated
      USING (public.can_write() AND public.same_org(organization_id))
      WITH CHECK (public.can_write() AND public.same_org(organization_id));
  END IF;

  -- movements
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='movements') THEN
    DROP POLICY IF EXISTS "movements auth all" ON public.movements;
    DROP POLICY IF EXISTS "movements select exchange" ON public.movements;
    DROP POLICY IF EXISTS "movements write admin" ON public.movements;
    CREATE POLICY "movements select exchange" ON public.movements
      FOR SELECT TO authenticated USING (public.can_exchange() AND public.same_org(organization_id));
    CREATE POLICY "movements write exchange" ON public.movements
      FOR INSERT TO authenticated
      WITH CHECK (public.can_exchange() AND public.same_org(organization_id));
    CREATE POLICY "movements write admin" ON public.movements
      FOR ALL TO authenticated
      USING (public.can_write() AND public.same_org(organization_id))
      WITH CHECK (public.can_write() AND public.same_org(organization_id));
  END IF;

  -- rentals
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='rentals') THEN
    DROP POLICY IF EXISTS "rentals select exchange" ON public.rentals;
    DROP POLICY IF EXISTS "rentals write admin" ON public.rentals;
    CREATE POLICY "rentals select exchange" ON public.rentals
      FOR SELECT TO authenticated USING (public.can_exchange() AND public.same_org(organization_id));
    CREATE POLICY "rentals write admin" ON public.rentals
      FOR ALL TO authenticated
      USING (public.can_write() AND public.same_org(organization_id))
      WITH CHECK (public.can_write() AND public.same_org(organization_id));
  END IF;

  -- events
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='events') THEN
    DROP POLICY IF EXISTS "events select admin" ON public.events;
    DROP POLICY IF EXISTS "events insert exchange" ON public.events;
    DROP POLICY IF EXISTS "events auth select" ON public.events;
    DROP POLICY IF EXISTS "events auth insert" ON public.events;
    CREATE POLICY "events select admin" ON public.events
      FOR SELECT TO authenticated USING (public.is_admin() AND public.same_org(organization_id));
    CREATE POLICY "events insert exchange" ON public.events
      FOR INSERT TO authenticated
      WITH CHECK (public.can_exchange() AND public.same_org(organization_id));
  END IF;

  -- cylinder_history
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cylinder_history') THEN
    DROP POLICY IF EXISTS "cylinder_history select admin" ON public.cylinder_history;
    DROP POLICY IF EXISTS "cylinder_history insert exchange" ON public.cylinder_history;
    DROP POLICY IF EXISTS "cylinder_history auth select" ON public.cylinder_history;
    DROP POLICY IF EXISTS "cylinder_history auth insert" ON public.cylinder_history;
    CREATE POLICY "cylinder_history select admin" ON public.cylinder_history
      FOR SELECT TO authenticated USING (
        (public.is_admin() OR public.can_exchange()) AND public.same_org(organization_id)
      );
    CREATE POLICY "cylinder_history insert exchange" ON public.cylinder_history
      FOR INSERT TO authenticated
      WITH CHECK (public.can_exchange() AND public.same_org(organization_id));
  END IF;
END $$;

GRANT SELECT ON public.organizations TO authenticated;
GRANT UPDATE ON public.organizations TO authenticated;
