-- Kínai palackok készletalapú nyilvántartása (nem egyedi sorszám)

CREATE TABLE IF NOT EXISTS public.chinese_cylinder_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gas_type TEXT NOT NULL,
  size TEXT NOT NULL,
  full_count INTEGER NOT NULL DEFAULT 0 CHECK (full_count >= 0),
  empty_count INTEGER NOT NULL DEFAULT 0 CHECK (empty_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gas_type, size)
);

CREATE TABLE IF NOT EXISTS public.chinese_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id UUID NOT NULL REFERENCES public.chinese_cylinder_stock(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('purchase', 'sale', 'exchange', 'empty_return')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  full_delta INTEGER NOT NULL,
  empty_delta INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_chinese_stock_gas ON public.chinese_cylinder_stock (gas_type, size);
CREATE INDEX IF NOT EXISTS idx_chinese_movements_stock ON public.chinese_stock_movements (stock_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_chinese_stock_updated ON public.chinese_cylinder_stock;
CREATE TRIGGER trg_chinese_stock_updated
  BEFORE UPDATE ON public.chinese_cylinder_stock
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chinese_cylinder_stock TO authenticated;
GRANT ALL ON public.chinese_cylinder_stock TO service_role;
ALTER TABLE public.chinese_cylinder_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chinese_stock auth all" ON public.chinese_cylinder_stock;
CREATE POLICY "chinese_stock auth all"
  ON public.chinese_cylinder_stock FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON public.chinese_stock_movements TO authenticated;
GRANT ALL ON public.chinese_stock_movements TO service_role;
ALTER TABLE public.chinese_stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chinese_movements auth all" ON public.chinese_stock_movements;
CREATE POLICY "chinese_movements auth all"
  ON public.chinese_stock_movements FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Atomikus készletmozgás: beszerzés, eladás, csere, üres visszahozás
CREATE OR REPLACE FUNCTION public.adjust_chinese_stock(
  p_gas_type TEXT,
  p_size TEXT,
  p_movement_type TEXT,
  p_quantity INTEGER,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stock public.chinese_cylinder_stock;
  v_uid UUID := auth.uid();
  v_full_delta INTEGER;
  v_empty_delta INTEGER;
  v_mov_id UUID;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'A mennyiségnek pozitívnak kell lennie';
  END IF;

  CASE p_movement_type
    WHEN 'purchase' THEN
      v_full_delta := p_quantity;
      v_empty_delta := 0;
    WHEN 'sale' THEN
      v_full_delta := -p_quantity;
      v_empty_delta := 0;
    WHEN 'exchange' THEN
      v_full_delta := -p_quantity;
      v_empty_delta := p_quantity;
    WHEN 'empty_return' THEN
      v_full_delta := 0;
      v_empty_delta := p_quantity;
    ELSE
      RAISE EXCEPTION 'Ismeretlen mozgástípus: %', p_movement_type;
  END CASE;

  INSERT INTO public.chinese_cylinder_stock (gas_type, size, full_count, empty_count)
  VALUES (trim(p_gas_type), trim(p_size), 0, 0)
  ON CONFLICT (gas_type, size) DO NOTHING;

  SELECT * INTO v_stock
  FROM public.chinese_cylinder_stock
  WHERE gas_type = trim(p_gas_type) AND size = trim(p_size)
  FOR UPDATE;

  IF v_stock.id IS NULL THEN
    RAISE EXCEPTION 'Készlet nem található';
  END IF;

  IF v_stock.full_count + v_full_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég teli kínai palack (szükséges: %, elérhető: %)', p_quantity, v_stock.full_count;
  END IF;

  IF v_stock.empty_count + v_empty_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég üres kínai palack';
  END IF;

  UPDATE public.chinese_cylinder_stock
  SET full_count = full_count + v_full_delta,
      empty_count = empty_count + v_empty_delta,
      updated_at = now()
  WHERE id = v_stock.id;

  INSERT INTO public.chinese_stock_movements (
    stock_id, movement_type, quantity, full_delta, empty_delta, note, created_by
  ) VALUES (
    v_stock.id, p_movement_type, p_quantity, v_full_delta, v_empty_delta, p_note, v_uid
  ) RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_chinese_stock(TEXT, TEXT, TEXT, INTEGER, TEXT) TO authenticated;
