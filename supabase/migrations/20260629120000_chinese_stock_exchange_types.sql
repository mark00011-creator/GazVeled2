-- Kínai készlet: ügyfél- és beszállítói csere külön mozgástípussal

ALTER TABLE public.chinese_stock_movements
  DROP CONSTRAINT IF EXISTS chinese_stock_movements_movement_type_check;

ALTER TABLE public.chinese_stock_movements
  ADD CONSTRAINT chinese_stock_movements_movement_type_check
  CHECK (
    movement_type IN (
      'purchase',
      'sale',
      'empty_return',
      'adjustment',
      'exchange',
      'customer_exchange',
      'supplier_exchange'
    )
  );

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
  v_movement_type TEXT;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'A mennyiségnek pozitívnak kell lennie';
  END IF;

  v_movement_type := CASE
    WHEN p_movement_type = 'exchange' THEN 'customer_exchange'
    ELSE p_movement_type
  END;

  CASE v_movement_type
    WHEN 'purchase' THEN
      v_full_delta := p_quantity;
      v_empty_delta := 0;
    WHEN 'sale' THEN
      v_full_delta := -p_quantity;
      v_empty_delta := 0;
    WHEN 'customer_exchange' THEN
      v_full_delta := -p_quantity;
      v_empty_delta := p_quantity;
    WHEN 'supplier_exchange' THEN
      v_full_delta := p_quantity;
      v_empty_delta := -p_quantity;
    WHEN 'empty_return' THEN
      v_full_delta := 0;
      v_empty_delta := p_quantity;
    WHEN 'adjustment' THEN
      IF p_note IS NULL OR length(trim(p_note)) = 0 THEN
        RAISE EXCEPTION 'Korrekciónál megjegyzés kötelező';
      END IF;
      v_full_delta := p_quantity;
      v_empty_delta := 0;
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

  IF v_movement_type = 'customer_exchange' AND v_stock.full_count < p_quantity THEN
    RAISE EXCEPTION 'Nincs elég teli palack a cseréhez.';
  END IF;

  IF v_movement_type = 'supplier_exchange' AND v_stock.empty_count < p_quantity THEN
    RAISE EXCEPTION 'Nincs elég üres palack a beszállítói cseréhez.';
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
    v_stock.id, v_movement_type, p_quantity, v_full_delta, v_empty_delta, p_note, v_uid
  ) RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_chinese_stock(TEXT, TEXT, TEXT, INTEGER, TEXT) TO authenticated;
