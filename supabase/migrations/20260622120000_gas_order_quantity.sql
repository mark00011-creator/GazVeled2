-- Gáz rendelés: darabszám alapú (kínai / PRÍMA PB / FLAGA PB) tételek

ALTER TABLE public.gas_orders
  ADD COLUMN IF NOT EXISTS order_kind TEXT NOT NULL DEFAULT 'serial'
    CHECK (order_kind IN ('serial', 'chinese_prima', 'flaga_pb'));

CREATE TABLE IF NOT EXISTS public.gas_order_quantity_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gas_order_id UUID NOT NULL REFERENCES public.gas_orders(id) ON DELETE CASCADE,
  stock_kind TEXT NOT NULL CHECK (stock_kind IN ('chinese', 'prima_pb', 'flaga_pb')),
  gas_type TEXT NOT NULL,
  size TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  beszerzesi_ar INTEGER CHECK (beszerzesi_ar IS NULL OR beszerzesi_ar >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gas_order_quantity_items_order
  ON public.gas_order_quantity_items (gas_order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gas_order_quantity_items TO authenticated;
GRANT ALL ON public.gas_order_quantity_items TO service_role;
ALTER TABLE public.gas_order_quantity_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gas_order_quantity_items auth all" ON public.gas_order_quantity_items;
CREATE POLICY "gas_order_quantity_items auth all"
  ON public.gas_order_quantity_items FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
