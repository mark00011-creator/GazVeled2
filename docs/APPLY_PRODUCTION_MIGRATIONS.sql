-- =============================================================================
-- GAZVELED2 PRODUCTION – teljes PB + gázrendelés migráció
-- Projekt: snmiwsgtnokvqlnwvfwf
-- Supabase Dashboard → SQL Editor → New query → illeszd be → Run
-- =============================================================================

-- === 1/2: FLAGA PB + PRÍMA PB készlet (20260621120000) ===

CREATE TABLE IF NOT EXISTS public.flaga_pb_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gas_type TEXT NOT NULL,
  size TEXT NOT NULL,
  full_count INTEGER NOT NULL DEFAULT 0 CHECK (full_count >= 0),
  empty_count INTEGER NOT NULL DEFAULT 0 CHECK (empty_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gas_type, size)
);

CREATE TABLE IF NOT EXISTS public.flaga_pb_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id UUID NOT NULL REFERENCES public.flaga_pb_stock(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('purchase', 'sale', 'exchange', 'empty_return', 'adjustment')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  full_delta INTEGER NOT NULL,
  empty_delta INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.prima_pb_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gas_type TEXT NOT NULL,
  size TEXT NOT NULL,
  full_count INTEGER NOT NULL DEFAULT 0 CHECK (full_count >= 0),
  empty_count INTEGER NOT NULL DEFAULT 0 CHECK (empty_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gas_type, size)
);

CREATE TABLE IF NOT EXISTS public.prima_pb_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id UUID NOT NULL REFERENCES public.prima_pb_stock(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('purchase', 'sale', 'exchange', 'empty_return', 'adjustment')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  full_delta INTEGER NOT NULL,
  empty_delta INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.rental_quantity_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id UUID NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  stock_kind TEXT NOT NULL CHECK (stock_kind IN ('chinese', 'flaga', 'flaga_pb', 'prima_pb')),
  gas_type TEXT NOT NULL,
  size TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_flaga_pb_stock_gas ON public.flaga_pb_stock (gas_type, size);
CREATE INDEX IF NOT EXISTS idx_flaga_pb_movements_stock ON public.flaga_pb_stock_movements (stock_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prima_pb_stock_gas ON public.prima_pb_stock (gas_type, size);
CREATE INDEX IF NOT EXISTS idx_prima_pb_movements_stock ON public.prima_pb_stock_movements (stock_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rental_quantity_items_rental ON public.rental_quantity_items (rental_id, removed_at);

DROP TRIGGER IF EXISTS trg_flaga_pb_stock_updated ON public.flaga_pb_stock;
CREATE TRIGGER trg_flaga_pb_stock_updated
  BEFORE UPDATE ON public.flaga_pb_stock
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_prima_pb_stock_updated ON public.prima_pb_stock;
CREATE TRIGGER trg_prima_pb_stock_updated
  BEFORE UPDATE ON public.prima_pb_stock
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.flaga_pb_stock TO authenticated;
GRANT ALL ON public.flaga_pb_stock TO service_role;
ALTER TABLE public.flaga_pb_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "flaga_pb_stock auth all" ON public.flaga_pb_stock;
CREATE POLICY "flaga_pb_stock auth all"
  ON public.flaga_pb_stock FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON public.flaga_pb_stock_movements TO authenticated;
GRANT ALL ON public.flaga_pb_stock_movements TO service_role;
ALTER TABLE public.flaga_pb_stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "flaga_pb_movements auth all" ON public.flaga_pb_stock_movements;
CREATE POLICY "flaga_pb_movements auth all"
  ON public.flaga_pb_stock_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prima_pb_stock TO authenticated;
GRANT ALL ON public.prima_pb_stock TO service_role;
ALTER TABLE public.prima_pb_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prima_pb_stock auth all" ON public.prima_pb_stock;
CREATE POLICY "prima_pb_stock auth all"
  ON public.prima_pb_stock FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON public.prima_pb_stock_movements TO authenticated;
GRANT ALL ON public.prima_pb_stock_movements TO service_role;
ALTER TABLE public.prima_pb_stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prima_pb_movements auth all" ON public.prima_pb_stock_movements;
CREATE POLICY "prima_pb_movements auth all"
  ON public.prima_pb_stock_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rental_quantity_items TO authenticated;
GRANT ALL ON public.rental_quantity_items TO service_role;
ALTER TABLE public.rental_quantity_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rental_quantity_items auth all" ON public.rental_quantity_items;
CREATE POLICY "rental_quantity_items auth all"
  ON public.rental_quantity_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.flaga_pb_stock (gas_type, size, full_count, empty_count) VALUES
  ('Motorüzemű Flaga', '11 kg', 0, 0),
  ('Propán-Bután', '11,5 kg', 0, 0),
  ('Propán-Bután', '23 kg', 0, 0),
  ('Propán', '10,5 kg', 0, 0),
  ('Kompozit', '7,5 kg', 0, 0)
ON CONFLICT (gas_type, size) DO NOTHING;

INSERT INTO public.prima_pb_stock (gas_type, size, full_count, empty_count) VALUES
  ('Motor', '12,5 kg', 0, 0)
ON CONFLICT (gas_type, size) DO NOTHING;

INSERT INTO public.product_prices (gas_type, size, beszerzesi_ar, arres, eladasi_ar, unit_price, active, note)
VALUES
  ('Motorüzemű Flaga', '11 kg', 0, 0, 0, 0, true, 'FLAGA PB'),
  ('Propán-Bután', '11,5 kg', 0, 0, 0, 0, true, 'FLAGA PB'),
  ('Propán-Bután', '23 kg', 0, 0, 0, 0, true, 'FLAGA PB'),
  ('Propán', '10,5 kg', 0, 0, 0, 0, true, 'FLAGA PB'),
  ('Kompozit', '7,5 kg', 0, 0, 0, 0, true, 'FLAGA PB'),
  ('Motor', '12,5 kg', 0, 0, 0, 0, true, 'PRÍMA PB')
ON CONFLICT (gas_type, size) DO NOTHING;

CREATE OR REPLACE FUNCTION public.adjust_flaga_pb_stock(
  p_gas_type TEXT, p_size TEXT, p_movement_type TEXT, p_quantity INTEGER, p_note TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stock public.flaga_pb_stock; v_uid UUID := auth.uid(); v_full_delta INTEGER; v_empty_delta INTEGER; v_mov_id UUID;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'A mennyiségnek pozitívnak kell lennie'; END IF;
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
  INSERT INTO public.flaga_pb_stock (gas_type, size, full_count, empty_count) VALUES (trim(p_gas_type), trim(p_size), 0, 0) ON CONFLICT (gas_type, size) DO NOTHING;
  SELECT * INTO v_stock FROM public.flaga_pb_stock WHERE gas_type = trim(p_gas_type) AND size = trim(p_size) FOR UPDATE;
  IF v_stock.id IS NULL THEN RAISE EXCEPTION 'Készlet nem található'; END IF;
  IF v_stock.full_count + v_full_delta < 0 THEN RAISE EXCEPTION 'Nincs elég teli FLAGA PB palack'; END IF;
  IF v_stock.empty_count + v_empty_delta < 0 THEN RAISE EXCEPTION 'Nincs elég üres FLAGA PB palack'; END IF;
  UPDATE public.flaga_pb_stock SET full_count = full_count + v_full_delta, empty_count = empty_count + v_empty_delta, updated_at = now() WHERE id = v_stock.id;
  INSERT INTO public.flaga_pb_stock_movements (stock_id, movement_type, quantity, full_delta, empty_delta, note, created_by)
  VALUES (v_stock.id, p_movement_type, p_quantity, v_full_delta, v_empty_delta, p_note, v_uid) RETURNING id INTO v_mov_id;
  RETURN v_mov_id;
END; $$;

CREATE OR REPLACE FUNCTION public.adjust_prima_pb_stock(
  p_gas_type TEXT, p_size TEXT, p_movement_type TEXT, p_quantity INTEGER, p_note TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stock public.prima_pb_stock; v_uid UUID := auth.uid(); v_full_delta INTEGER; v_empty_delta INTEGER; v_mov_id UUID;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'A mennyiségnek pozitívnak kell lennie'; END IF;
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
  INSERT INTO public.prima_pb_stock (gas_type, size, full_count, empty_count) VALUES (trim(p_gas_type), trim(p_size), 0, 0) ON CONFLICT (gas_type, size) DO NOTHING;
  SELECT * INTO v_stock FROM public.prima_pb_stock WHERE gas_type = trim(p_gas_type) AND size = trim(p_size) FOR UPDATE;
  IF v_stock.id IS NULL THEN RAISE EXCEPTION 'Készlet nem található'; END IF;
  IF v_stock.full_count + v_full_delta < 0 THEN RAISE EXCEPTION 'Nincs elég teli PRÍMA PB palack'; END IF;
  IF v_stock.empty_count + v_empty_delta < 0 THEN RAISE EXCEPTION 'Nincs elég üres PRÍMA PB palack'; END IF;
  UPDATE public.prima_pb_stock SET full_count = full_count + v_full_delta, empty_count = empty_count + v_empty_delta, updated_at = now() WHERE id = v_stock.id;
  INSERT INTO public.prima_pb_stock_movements (stock_id, movement_type, quantity, full_delta, empty_delta, note, created_by)
  VALUES (v_stock.id, p_movement_type, p_quantity, v_full_delta, v_empty_delta, p_note, v_uid) RETURNING id INTO v_mov_id;
  RETURN v_mov_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.adjust_flaga_pb_stock(TEXT, TEXT, TEXT, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_prima_pb_stock(TEXT, TEXT, TEXT, INTEGER, TEXT) TO authenticated;

DO $$ BEGIN ALTER TYPE public.exchange_operation_type ADD VALUE 'flaga_pb_sale';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE public.exchange_operation_type ADD VALUE 'prima_pb_sale';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- === 2/2: Gáz rendelés darabszám (20260622120000) ===

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

-- === Ellenőrzés ===
SELECT
  to_regclass('public.flaga_pb_stock') AS flaga_pb_stock,
  to_regclass('public.prima_pb_stock') AS prima_pb_stock,
  to_regclass('public.gas_order_quantity_items') AS gas_order_qty;
