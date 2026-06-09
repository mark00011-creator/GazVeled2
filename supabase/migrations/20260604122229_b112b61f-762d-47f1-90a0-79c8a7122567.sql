
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TYPE public.circulation AS ENUM ('siad', 'own');
CREATE TYPE public.cyl_status AS ENUM ('full', 'empty', 'service');
CREATE TYPE public.location_type AS ENUM ('warehouse_full', 'warehouse_empty', 'customer', 'siad', 'own_supplier');
CREATE TYPE public.partner_type AS ENUM ('company', 'private');

-- updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- user_roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- handle_new_user trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- partners
CREATE TABLE public.partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type partner_type NOT NULL DEFAULT 'company',
  name TEXT NOT NULL,
  company_name TEXT,
  tax_number TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  contact_person TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partners TO authenticated;
GRANT ALL ON public.partners TO service_role;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "partners auth all" ON public.partners FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_partners_updated BEFORE UPDATE ON public.partners FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_partners_name ON public.partners (name);
CREATE INDEX idx_partners_phone ON public.partners (phone);

-- suppliers
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  kind location_type NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suppliers auth all" ON public.suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);
INSERT INTO public.suppliers (name, kind) VALUES ('SIAD', 'siad'), ('Saját szolgáltató', 'own_supplier');

-- cylinders
CREATE TABLE public.cylinders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode TEXT NOT NULL UNIQUE,
  gas_type TEXT NOT NULL,
  size TEXT NOT NULL,
  circulation circulation NOT NULL,
  status cyl_status NOT NULL DEFAULT 'empty',
  location_type location_type NOT NULL DEFAULT 'warehouse_empty',
  location_partner_id UUID REFERENCES public.partners(id) ON DELETE SET NULL,
  location_supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  last_movement_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cylinders TO authenticated;
GRANT ALL ON public.cylinders TO service_role;
ALTER TABLE public.cylinders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cylinders auth all" ON public.cylinders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_cylinders_updated BEFORE UPDATE ON public.cylinders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_cylinders_barcode ON public.cylinders (barcode);
CREATE INDEX idx_cylinders_loc ON public.cylinders (location_type);
CREATE INDEX idx_cylinders_circ ON public.cylinders (circulation);

-- movements
CREATE TABLE public.movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cylinder_id UUID NOT NULL REFERENCES public.cylinders(id) ON DELETE CASCADE,
  from_location location_type,
  from_partner_id UUID REFERENCES public.partners(id) ON DELETE SET NULL,
  from_supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  to_location location_type NOT NULL,
  to_partner_id UUID REFERENCES public.partners(id) ON DELETE SET NULL,
  to_supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  status_after cyl_status NOT NULL,
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.movements TO authenticated;
GRANT ALL ON public.movements TO service_role;
ALTER TABLE public.movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "movements auth all" ON public.movements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_movements_cyl ON public.movements (cylinder_id, created_at DESC);

-- exchanges (partner csere tranzakció)
CREATE TABLE public.exchanges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE RESTRICT,
  incoming_cylinder_id UUID REFERENCES public.cylinders(id) ON DELETE SET NULL,
  incoming_circulation circulation NOT NULL,
  outgoing_cylinder_id UUID REFERENCES public.cylinders(id) ON DELETE SET NULL,
  outgoing_circulation circulation NOT NULL,
  is_forced_substitution BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exchanges TO authenticated;
GRANT ALL ON public.exchanges TO service_role;
ALTER TABLE public.exchanges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exchanges auth all" ON public.exchanges FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_exchanges_partner ON public.exchanges (partner_id, created_at DESC);

-- supplier exchanges
CREATE TABLE public.supplier_exchanges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  returned_cylinder_ids UUID[] NOT NULL DEFAULT '{}',
  received_cylinder_ids UUID[] NOT NULL DEFAULT '{}',
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_exchanges TO authenticated;
GRANT ALL ON public.supplier_exchanges TO service_role;
ALTER TABLE public.supplier_exchanges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supex auth all" ON public.supplier_exchanges FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- rentals
CREATE TABLE public.rentals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE RESTRICT,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  monthly_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  contract_pdf_url TEXT,
  signed_pdf_url TEXT,
  signature_data TEXT,
  signed_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rentals TO authenticated;
GRANT ALL ON public.rentals TO service_role;
ALTER TABLE public.rentals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rentals auth all" ON public.rentals FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_rentals_updated BEFORE UPDATE ON public.rentals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.rental_cylinders (
  rental_id UUID NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  cylinder_id UUID NOT NULL REFERENCES public.cylinders(id) ON DELETE RESTRICT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  PRIMARY KEY (rental_id, cylinder_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rental_cylinders TO authenticated;
GRANT ALL ON public.rental_cylinders TO service_role;
ALTER TABLE public.rental_cylinders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rc auth all" ON public.rental_cylinders FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.rental_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id UUID NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  paid BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rental_invoices TO authenticated;
GRANT ALL ON public.rental_invoices TO service_role;
ALTER TABLE public.rental_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ri auth all" ON public.rental_invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- bulk scans (#4)
CREATE TABLE public.bulk_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url TEXT,
  barcodes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bulk_scans TO authenticated;
GRANT ALL ON public.bulk_scans TO service_role;
ALTER TABLE public.bulk_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bs auth all" ON public.bulk_scans FOR ALL TO authenticated USING (true) WITH CHECK (true);
