-- FLAGA PB rendelés megérkezés: készletmozgás rögzítése (teli +, üres −)
-- + dupla könyvelés elleni védelem (gas_orders.stock_applied_at)

ALTER TABLE public.gas_orders
  ADD COLUMN IF NOT EXISTS stock_applied_at TIMESTAMPTZ;

-- FLAGA PB mozgástípusok bővítése (beszállítói csere: üres ki, teli be)
ALTER TABLE public.flaga_pb_stock_movements
  DROP CONSTRAINT IF EXISTS flaga_pb_stock_movements_movement_type_check;

ALTER TABLE public.flaga_pb_stock_movements
  ADD CONSTRAINT flaga_pb_stock_movements_movement_type_check
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

CREATE OR REPLACE FUNCTION public.adjust_flaga_pb_stock(
  p_gas_type TEXT,
  p_size TEXT,
  p_movement_type TEXT,
  p_quantity INTEGER,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stock public.flaga_pb_stock;
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
    WHEN 'purchase' THEN v_full_delta := p_quantity; v_empty_delta := 0;
    WHEN 'sale' THEN v_full_delta := -p_quantity; v_empty_delta := 0;
    WHEN 'customer_exchange' THEN v_full_delta := -p_quantity; v_empty_delta := p_quantity;
    WHEN 'supplier_exchange' THEN v_full_delta := p_quantity; v_empty_delta := -p_quantity;
    WHEN 'empty_return' THEN v_full_delta := 0; v_empty_delta := p_quantity;
    WHEN 'adjustment' THEN
      IF p_note IS NULL OR length(trim(p_note)) = 0 THEN
        RAISE EXCEPTION 'Korrekciónál megjegyzés kötelező';
      END IF;
      v_full_delta := p_quantity; v_empty_delta := 0;
    ELSE RAISE EXCEPTION 'Ismeretlen mozgástípus: %', p_movement_type;
  END CASE;

  INSERT INTO public.flaga_pb_stock (gas_type, size, full_count, empty_count)
  VALUES (trim(p_gas_type), trim(p_size), 0, 0)
  ON CONFLICT (gas_type, size) DO NOTHING;

  SELECT * INTO v_stock FROM public.flaga_pb_stock
  WHERE gas_type = trim(p_gas_type) AND size = trim(p_size) FOR UPDATE;

  IF v_stock.id IS NULL THEN RAISE EXCEPTION 'Készlet nem található'; END IF;
  IF v_stock.full_count + v_full_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég teli FLAGA PB palack (szükséges: %, elérhető: %)', p_quantity, v_stock.full_count;
  END IF;
  IF v_stock.empty_count + v_empty_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég üres FLAGA PB palack';
  END IF;

  UPDATE public.flaga_pb_stock
  SET full_count = full_count + v_full_delta, empty_count = empty_count + v_empty_delta, updated_at = now()
  WHERE id = v_stock.id;

  INSERT INTO public.flaga_pb_stock_movements (stock_id, movement_type, quantity, full_delta, empty_delta, note, created_by)
  VALUES (v_stock.id, v_movement_type, p_quantity, v_full_delta, v_empty_delta, p_note, v_uid)
  RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$;

-- Rendelés "Megérkezett" státuszba állítása + FLAGA PB készlet könyvelése.
-- A készlet csak egyszer könyvelődik (stock_applied_at őrzi), így a dupla
-- megérkeztetés nem duplázza az egyenleget.
CREATE OR REPLACE FUNCTION public.receive_gas_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.gas_orders;
  v_item RECORD;
  v_stock public.flaga_pb_stock;
  v_uid UUID := auth.uid();
  v_empty_delta INTEGER;
BEGIN
  SELECT * INTO v_order FROM public.gas_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Rendelés nem található';
  END IF;

  UPDATE public.gas_orders
  SET status = 'received', updated_at = now()
  WHERE id = p_order_id;

  -- Csak FLAGA PB darabszámos rendelésnél könyvelünk, és csak egyszer.
  IF v_order.order_kind <> 'flaga_pb' OR v_order.stock_applied_at IS NOT NULL THEN
    RETURN;
  END IF;

  FOR v_item IN
    SELECT gas_type, size, quantity
    FROM public.gas_order_quantity_items
    WHERE gas_order_id = p_order_id AND stock_kind = 'flaga_pb'
  LOOP
    INSERT INTO public.flaga_pb_stock (gas_type, size, full_count, empty_count)
    VALUES (trim(v_item.gas_type), trim(v_item.size), 0, 0)
    ON CONFLICT (gas_type, size) DO NOTHING;

    SELECT * INTO v_stock FROM public.flaga_pb_stock
    WHERE gas_type = trim(v_item.gas_type) AND size = trim(v_item.size) FOR UPDATE;

    -- Csere: teli +qty, üres −qty. Ha kevesebb üres van nyilvántartva,
    -- csak az elérhető üres darabszámot vonjuk le (a megérkeztetés ne akadjon el).
    v_empty_delta := -LEAST(v_item.quantity, v_stock.empty_count);

    UPDATE public.flaga_pb_stock
    SET full_count = full_count + v_item.quantity,
        empty_count = empty_count + v_empty_delta,
        updated_at = now()
    WHERE id = v_stock.id;

    INSERT INTO public.flaga_pb_stock_movements (
      stock_id, movement_type, quantity, full_delta, empty_delta, note, created_by
    ) VALUES (
      v_stock.id,
      'supplier_exchange',
      v_item.quantity,
      v_item.quantity,
      v_empty_delta,
      'Gáz rendelés megérkezett (' || p_order_id || ')',
      v_uid
    );
  END LOOP;

  UPDATE public.gas_orders SET stock_applied_at = now() WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_gas_order(UUID) TO authenticated;
