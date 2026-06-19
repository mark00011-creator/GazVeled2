-- Gáz rendelés státusz követés

CREATE TYPE public.gas_order_status AS ENUM ('planned', 'ordered', 'received');

CREATE TABLE public.gas_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status public.gas_order_status NOT NULL DEFAULT 'planned',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE public.gas_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gas_order_id UUID NOT NULL REFERENCES public.gas_orders(id) ON DELETE CASCADE,
  cylinder_id UUID REFERENCES public.cylinders(id) ON DELETE SET NULL,
  barcode TEXT NOT NULL,
  gas_type TEXT NOT NULL,
  size TEXT NOT NULL,
  circulation public.circulation NOT NULL,
  beszerzesi_ar INTEGER CHECK (beszerzesi_ar IS NULL OR beszerzesi_ar >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gas_orders_status ON public.gas_orders (status, created_at DESC);
CREATE INDEX idx_gas_order_items_order ON public.gas_order_items (gas_order_id);

CREATE TRIGGER trg_gas_orders_updated
  BEFORE UPDATE ON public.gas_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gas_orders TO authenticated;
GRANT ALL ON public.gas_orders TO service_role;
ALTER TABLE public.gas_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gas_orders auth all"
  ON public.gas_orders FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gas_order_items TO authenticated;
GRANT ALL ON public.gas_order_items TO service_role;
ALTER TABLE public.gas_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gas_order_items auth all"
  ON public.gas_order_items FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
