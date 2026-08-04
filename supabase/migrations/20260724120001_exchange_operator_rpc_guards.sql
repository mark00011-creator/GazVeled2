-- RPC jogosultság guardok – Gyors csere operátor
-- Production: snmiwsgtnokvqlnwvfwf

CREATE OR REPLACE FUNCTION public.adjust_partner_quantity_stock(
  p_partner_id uuid,
  p_stock_kind text,
  p_gas_type text,
  p_size text,
  p_delta integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.partner_quantity_stock;
BEGIN
  PERFORM public.require_exchange_access();
  IF p_delta = 0 THEN RETURN; END IF;

  INSERT INTO public.partner_quantity_stock (partner_id, stock_kind, gas_type, size, quantity)
  VALUES (p_partner_id, p_stock_kind, trim(p_gas_type), trim(p_size), 0)
  ON CONFLICT (partner_id, stock_kind, gas_type, size) DO NOTHING;

  SELECT * INTO v_row
  FROM public.partner_quantity_stock
  WHERE partner_id = p_partner_id
    AND stock_kind = p_stock_kind
    AND gas_type = trim(p_gas_type)
    AND size = trim(p_size)
  FOR UPDATE;

  IF v_row.quantity + p_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég partner készlet (% % %)', p_gas_type, p_size, p_stock_kind;
  END IF;

  UPDATE public.partner_quantity_stock
  SET quantity = quantity + p_delta, updated_at = now()
  WHERE id = v_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.find_or_create_cylinder(
  p_barcode text,
  p_circulation public.circulation DEFAULT 'own',
  p_owner public.circulation DEFAULT NULL,
  p_status public.cyl_status DEFAULT 'empty',
  p_location_type public.location_type DEFAULT 'warehouse_empty',
  p_gas_type text DEFAULT 'ISMERETLEN',
  p_size text DEFAULT '—'
) RETURNS TABLE(cylinder public.cylinders, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.cylinders;
  v_created boolean := false;
BEGIN
  PERFORM public.require_exchange_access();
  IF p_barcode IS NULL OR length(trim(p_barcode)) = 0 THEN
    RAISE EXCEPTION 'Empty barcode';
  END IF;

  SELECT * INTO v_row FROM public.cylinders WHERE barcode = trim(p_barcode);
  IF NOT FOUND THEN
    INSERT INTO public.cylinders (barcode, gas_type, size, circulation, owner, status, location_type, first_tracked_at)
    VALUES (trim(p_barcode), p_gas_type, p_size, p_circulation, COALESCE(p_owner, p_circulation), p_status, p_location_type, now())
    ON CONFLICT (barcode) DO NOTHING
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      SELECT * INTO v_row FROM public.cylinders WHERE barcode = trim(p_barcode);
    ELSE
      v_created := true;
    END IF;
  END IF;

  cylinder := v_row;
  created := v_created;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_temp_barcode()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_exchange_access();
  RETURN 'TEMP-' || lpad(nextval('public.temp_cylinder_seq')::text, 6, '0');
END;
$$;

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
  IF p_movement_type IN ('purchase', 'adjustment', 'empty_adjustment', 'supplier_exchange') THEN
    PERFORM public.require_admin();
  ELSE
    PERFORM public.require_exchange_access();
  END IF;

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
      IF p_note IS NULL OR length(trim(p_note)) = 0 THEN RAISE EXCEPTION 'Korrekciónál megjegyzés kötelező'; END IF;
      v_full_delta := p_quantity; v_empty_delta := 0;
    WHEN 'empty_adjustment' THEN
      IF p_note IS NULL OR length(trim(p_note)) = 0 THEN RAISE EXCEPTION 'Korrekciónál megjegyzés kötelező'; END IF;
      v_full_delta := 0; v_empty_delta := -p_quantity;
    ELSE RAISE EXCEPTION 'Ismeretlen mozgástípus: %', p_movement_type;
  END CASE;

  INSERT INTO public.chinese_cylinder_stock (gas_type, size, full_count, empty_count)
  VALUES (trim(p_gas_type), trim(p_size), 0, 0)
  ON CONFLICT (gas_type, size) DO NOTHING;

  SELECT * INTO v_stock FROM public.chinese_cylinder_stock
  WHERE gas_type = trim(p_gas_type) AND size = trim(p_size) FOR UPDATE;

  IF v_stock.id IS NULL THEN RAISE EXCEPTION 'Készlet nem található'; END IF;
  IF v_movement_type = 'customer_exchange' AND v_stock.full_count < p_quantity THEN
    RAISE EXCEPTION 'Nincs elég teli palack a cseréhez.';
  END IF;
  IF v_movement_type = 'supplier_exchange' AND v_stock.empty_count < p_quantity THEN
    RAISE EXCEPTION 'Nincs elég üres palack a beszállítói cseréhez.';
  END IF;
  IF v_full_delta < 0 AND v_stock.full_count + v_full_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég teli kínai palack (szükséges: %, elérhető: %)', p_quantity, v_stock.full_count;
  END IF;
  IF v_empty_delta < 0 AND v_stock.empty_count + v_empty_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég üres kínai palack (szükséges: %, elérhető: %)', p_quantity, v_stock.empty_count;
  END IF;

  UPDATE public.chinese_cylinder_stock
  SET full_count = full_count + v_full_delta, empty_count = empty_count + v_empty_delta, updated_at = now()
  WHERE id = v_stock.id;

  INSERT INTO public.chinese_stock_movements (stock_id, movement_type, quantity, full_delta, empty_delta, note, created_by)
  VALUES (v_stock.id, v_movement_type, p_quantity, v_full_delta, v_empty_delta, p_note, v_uid)
  RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$;

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
BEGIN
  IF p_movement_type IN ('purchase', 'adjustment') THEN
    PERFORM public.require_admin();
  ELSE
    PERFORM public.require_exchange_access();
  END IF;

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

  INSERT INTO public.flaga_pb_stock (gas_type, size, full_count, empty_count)
  VALUES (trim(p_gas_type), trim(p_size), 0, 0) ON CONFLICT (gas_type, size) DO NOTHING;

  SELECT * INTO v_stock FROM public.flaga_pb_stock
  WHERE gas_type = trim(p_gas_type) AND size = trim(p_size) FOR UPDATE;

  IF v_stock.id IS NULL THEN RAISE EXCEPTION 'Készlet nem található'; END IF;
  IF v_stock.full_count + v_full_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég teli FLAGA PB palack (szükséges: %, elérhető: %)', p_quantity, v_stock.full_count;
  END IF;
  IF v_stock.empty_count + v_empty_delta < 0 THEN RAISE EXCEPTION 'Nincs elég üres FLAGA PB palack'; END IF;

  UPDATE public.flaga_pb_stock
  SET full_count = full_count + v_full_delta, empty_count = empty_count + v_empty_delta, updated_at = now()
  WHERE id = v_stock.id;

  INSERT INTO public.flaga_pb_stock_movements (stock_id, movement_type, quantity, full_delta, empty_delta, note, created_by)
  VALUES (v_stock.id, p_movement_type, p_quantity, v_full_delta, v_empty_delta, p_note, v_uid)
  RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_prima_pb_stock(
  p_gas_type TEXT,
  p_size TEXT,
  p_movement_type TEXT,
  p_quantity INTEGER,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stock public.prima_pb_stock;
  v_uid UUID := auth.uid();
  v_full_delta INTEGER;
  v_empty_delta INTEGER;
  v_mov_id UUID;
BEGIN
  IF p_movement_type IN ('purchase', 'adjustment') THEN
    PERFORM public.require_admin();
  ELSE
    PERFORM public.require_exchange_access();
  END IF;

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

  INSERT INTO public.prima_pb_stock (gas_type, size, full_count, empty_count)
  VALUES (trim(p_gas_type), trim(p_size), 0, 0) ON CONFLICT (gas_type, size) DO NOTHING;

  SELECT * INTO v_stock FROM public.prima_pb_stock
  WHERE gas_type = trim(p_gas_type) AND size = trim(p_size) FOR UPDATE;

  IF v_stock.id IS NULL THEN RAISE EXCEPTION 'Készlet nem található'; END IF;
  IF v_stock.full_count + v_full_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég teli PRÍMA PB palack (szükséges: %, elérhető: %)', p_quantity, v_stock.full_count;
  END IF;
  IF v_stock.empty_count + v_empty_delta < 0 THEN RAISE EXCEPTION 'Nincs elég üres PRÍMA PB palack'; END IF;

  UPDATE public.prima_pb_stock
  SET full_count = full_count + v_full_delta, empty_count = empty_count + v_empty_delta, updated_at = now()
  WHERE id = v_stock.id;

  INSERT INTO public.prima_pb_stock_movements (stock_id, movement_type, quantity, full_delta, empty_delta, note, created_by)
  VALUES (v_stock.id, p_movement_type, p_quantity, v_full_delta, v_empty_delta, p_note, v_uid)
  RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$;

-- Kínai csere RPC-k: require_exchange_access guard (20260709150000 alapján, első sor a törzsben)
-- record_chinese_brought
CREATE OR REPLACE FUNCTION public.record_chinese_brought(
  p_partner_id uuid,
  p_gas_type text,
  p_size text,
  p_quantity integer,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_exchange_id uuid;
  v_mov_id uuid;
BEGIN
  PERFORM public.require_exchange_access();
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'A mennyiségnek pozitívnak kell lennie'; END IF;

  v_mov_id := public.adjust_chinese_stock(trim(p_gas_type), trim(p_size), 'empty_return', p_quantity,
    COALESCE(NULLIF(trim(p_note), ''), 'Hozott kínai – üres be'));

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    incoming_exchange_circulation, outgoing_exchange_circulation,
    is_forced_substitution, note, created_by, operation_type
  ) VALUES (
    p_partner_id, NULL, 'own', NULL, 'own', 'chinese', 'chinese', false,
    format('%s× %s %s · Hozott kínai', p_quantity, trim(p_gas_type), trim(p_size)) ||
      CASE WHEN p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN ' · ' || trim(p_note) ELSE '' END,
    v_uid, 'chinese_brought'
  ) RETURNING id INTO v_exchange_id;

  UPDATE public.partner_quantity_stock
  SET quantity = GREATEST(0, quantity - p_quantity), updated_at = now()
  WHERE partner_id = p_partner_id AND stock_kind = 'chinese'
    AND gas_type = trim(p_gas_type) AND size = trim(p_size) AND quantity > 0;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (v_uid, 'Hozott kínai', 'exchange', v_exchange_id,
    jsonb_build_object('partner_id', p_partner_id, 'gas_type', p_gas_type, 'size', p_size, 'quantity', p_quantity, 'movement_id', v_mov_id));

  RETURN v_exchange_id;
END;
$$;

-- guarded chinese exchange RPCs (from 20260709150000)

CREATE OR REPLACE FUNCTION public.record_chinese_brought_exchange(
  p_partner_id uuid,
  p_in_gas_type text,
  p_in_size text,
  p_quantity integer,
  p_outgoing_kind text,
  p_outgoing_id uuid DEFAULT NULL,
  p_out_gas_type text DEFAULT NULL,
  p_out_size text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_out public.cylinders;
  v_uid uuid := auth.uid();
  v_exchange_id uuid;
  v_mov_id uuid;
  v_out_key text;
  v_forced boolean;
  v_kind text := lower(trim(COALESCE(p_outgoing_kind, '')));
  v_rented_in integer;
  v_same_chinese boolean;
BEGIN
  PERFORM public.require_exchange_access();
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'A mennyiségnek pozitívnak kell lennie';
  END IF;
  IF v_kind NOT IN ('serial', 'chinese') THEN
    RAISE EXCEPTION 'Add meg, milyen teli palackot adsz ki a partnernek.';
  END IF;

  v_rented_in := public.partner_rented_chinese_quantity(p_partner_id, p_in_gas_type, p_in_size);

  IF v_kind = 'serial' THEN
    IF p_outgoing_id IS NULL THEN
      RAISE EXCEPTION 'Add meg, milyen teli palackot adsz ki a partnernek.';
    END IF;

    SELECT * INTO v_out FROM public.cylinders WHERE id = p_outgoing_id FOR UPDATE;
    IF v_out.id IS NULL THEN RAISE EXCEPTION 'A megadott teli palack nem található.'; END IF;
    IF v_out.status <> 'full' OR v_out.location_type <> 'warehouse_full' THEN
      RAISE EXCEPTION 'Ez a palack nem adható ki, mert nem teli telephelyi palack.';
    END IF;

    v_mov_id := public.adjust_chinese_stock(
      trim(p_in_gas_type), trim(p_in_size), 'empty_return', p_quantity,
      COALESCE(NULLIF(trim(p_note), ''), 'Hozott kínai – üres be')
    );

    v_out_key := public.derive_exchange_circulation_key(v_out.circulation, v_out.manufacturer::text);
    v_forced := v_out_key <> 'chinese' OR trim(p_in_gas_type) <> v_out.gas_type;

    INSERT INTO public.exchanges (
      partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
      incoming_exchange_circulation, outgoing_exchange_circulation,
      is_forced_substitution, note, created_by, operation_type
    ) VALUES (
      p_partner_id, NULL, 'own', v_out.id, v_out.circulation,
      'chinese', v_out_key,
      v_forced,
      format('%s× %s %s hozott kínai üres → %s %s teli',
        p_quantity, trim(p_in_gas_type), trim(p_in_size), v_out.gas_type, v_out.size) ||
        CASE WHEN p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN ' · ' || trim(p_note) ELSE '' END,
      v_uid, 'chinese_brought'
    ) RETURNING id INTO v_exchange_id;

    INSERT INTO public.movements (cylinder_id, from_location, to_location, to_partner_id, status_after, note, created_by)
    VALUES (v_out.id, v_out.location_type, 'customer', p_partner_id, 'full', 'Hozott kínai – teli kiadva', v_uid);

    UPDATE public.cylinders
    SET status = 'full', location_type = 'customer', location_partner_id = p_partner_id, location_supplier_id = NULL
    WHERE id = v_out.id;

    PERFORM public.settle_circulation_differences_for_exchange(
      p_partner_id, v_exchange_id,
      'chinese', v_out_key, trim(p_in_gas_type), v_out.gas_type, trim(p_in_size), p_quantity
    );

    IF v_forced THEN
      PERFORM public.create_circulation_difference(
        p_partner_id, v_exchange_id,
        'chinese', v_out_key, trim(p_in_gas_type), v_out.gas_type, trim(p_in_size), p_quantity, p_note
      );
    END IF;

    IF v_rented_in >= p_quantity THEN
      PERFORM public.adjust_partner_rental_chinese_quantity(
        p_partner_id, trim(p_in_gas_type), trim(p_in_size), -p_quantity
      );
    ELSE
      UPDATE public.partner_quantity_stock
      SET quantity = GREATEST(0, quantity - p_quantity), updated_at = now()
      WHERE partner_id = p_partner_id
        AND stock_kind = 'chinese'
        AND gas_type = trim(p_in_gas_type)
        AND size = trim(p_in_size)
        AND quantity > 0;
    END IF;

  ELSE
    IF p_out_gas_type IS NULL OR trim(p_out_gas_type) = ''
       OR p_out_size IS NULL OR trim(p_out_size) = '' THEN
      RAISE EXCEPTION 'Add meg, milyen teli palackot adsz ki a partnernek.';
    END IF;

    v_same_chinese := trim(p_in_gas_type) = trim(p_out_gas_type) AND trim(p_in_size) = trim(p_out_size);

    IF v_same_chinese THEN
      v_mov_id := public.adjust_chinese_stock(
        trim(p_in_gas_type), trim(p_in_size), 'customer_exchange', p_quantity,
        COALESCE(NULLIF(trim(p_note), ''), 'Hozott kínai – üres be / kínai teli ki')
      );
    ELSE
      v_mov_id := public.adjust_chinese_stock(
        trim(p_in_gas_type), trim(p_in_size), 'empty_return', p_quantity,
        COALESCE(NULLIF(trim(p_note), ''), 'Hozott kínai – üres be')
      );
      BEGIN
        v_mov_id := public.adjust_chinese_stock(
          trim(p_out_gas_type), trim(p_out_size), 'sale', p_quantity,
          COALESCE(NULLIF(trim(p_note), ''), 'Hozott kínai – kínai teli ki')
        );
      EXCEPTION
        WHEN OTHERS THEN
          IF SQLERRM LIKE '%Nincs elég teli%' OR SQLERRM LIKE '%Nincs elég teli kínai%' THEN
            RAISE EXCEPTION 'Nincs elegendő kínai teli készlet.';
          ELSE
            RAISE;
          END IF;
      END;
    END IF;

    v_forced := trim(p_in_gas_type) <> trim(p_out_gas_type);

    INSERT INTO public.exchanges (
      partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
      incoming_exchange_circulation, outgoing_exchange_circulation,
      is_forced_substitution, note, created_by, operation_type
    ) VALUES (
      p_partner_id, NULL, 'own', NULL, 'own',
      'chinese', 'chinese',
      v_forced,
      format('%s× %s %s hozott kínai üres → %s× %s %s kínai teli',
        p_quantity, trim(p_in_gas_type), trim(p_in_size),
        p_quantity, trim(p_out_gas_type), trim(p_out_size)) ||
        CASE WHEN p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN ' · ' || trim(p_note) ELSE '' END,
      v_uid, 'chinese_brought'
    ) RETURNING id INTO v_exchange_id;

    PERFORM public.settle_circulation_differences_for_exchange(
      p_partner_id, v_exchange_id,
      'chinese', 'chinese', trim(p_in_gas_type), trim(p_out_gas_type), trim(p_in_size), p_quantity
    );

    IF v_forced THEN
      PERFORM public.create_circulation_difference(
        p_partner_id, v_exchange_id,
        'chinese', 'chinese', trim(p_in_gas_type), trim(p_out_gas_type), trim(p_in_size), p_quantity, p_note
      );
    END IF;

    IF v_same_chinese AND v_rented_in >= p_quantity THEN
      NULL;
    ELSIF v_same_chinese THEN
      PERFORM public.adjust_partner_quantity_stock(
        p_partner_id, 'chinese', trim(p_out_gas_type), trim(p_out_size), p_quantity
      );
      UPDATE public.partner_quantity_stock
      SET quantity = GREATEST(0, quantity - p_quantity), updated_at = now()
      WHERE partner_id = p_partner_id
        AND stock_kind = 'chinese'
        AND gas_type = trim(p_in_gas_type)
        AND size = trim(p_in_size)
        AND quantity > 0;
    ELSE
      IF v_rented_in >= p_quantity THEN
        PERFORM public.adjust_partner_rental_chinese_quantity(
          p_partner_id, trim(p_in_gas_type), trim(p_in_size), -p_quantity
        );
      ELSE
        UPDATE public.partner_quantity_stock
        SET quantity = GREATEST(0, quantity - p_quantity), updated_at = now()
        WHERE partner_id = p_partner_id
          AND stock_kind = 'chinese'
          AND gas_type = trim(p_in_gas_type)
          AND size = trim(p_in_size)
          AND quantity > 0;
      END IF;

      IF public.partner_rented_chinese_quantity(p_partner_id, p_out_gas_type, p_out_size) > 0
         OR EXISTS (
           SELECT 1 FROM public.rentals
           WHERE partner_id = p_partner_id AND status IN ('active', 'expired')
         ) THEN
        PERFORM public.adjust_partner_rental_chinese_quantity(
          p_partner_id, trim(p_out_gas_type), trim(p_out_size), p_quantity
        );
      ELSE
        PERFORM public.adjust_partner_quantity_stock(
          p_partner_id, 'chinese', trim(p_out_gas_type), trim(p_out_size), p_quantity
        );
      END IF;
    END IF;
  END IF;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_uid, 'Hozott kínai csere', 'exchange', v_exchange_id,
    jsonb_build_object(
      'partner_id', p_partner_id,
      'in_gas', p_in_gas_type, 'in_size', p_in_size,
      'outgoing_kind', v_kind,
      'outgoing_id', p_outgoing_id,
      'out_gas', p_out_gas_type, 'out_size', p_out_size,
      'quantity', p_quantity,
      'rented_in', v_rented_in,
      'movement_id', v_mov_id
    )
  );

  RETURN v_exchange_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_chinese_take(
  p_partner_id uuid,
  p_incoming_id uuid,
  p_gas_type text,
  p_size text,
  p_quantity integer,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_in public.cylinders;
  v_uid uuid := auth.uid();
  v_exchange_id uuid;
  v_in_key text;
  v_mov_id uuid;
  v_detached_rental_id uuid;
  v_has_rental boolean;
BEGIN
  PERFORM public.require_exchange_access();
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;
  SELECT * INTO v_in FROM public.cylinders WHERE id = p_incoming_id FOR UPDATE;
  IF v_in.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;
  IF v_in.status <> 'empty' THEN RAISE EXCEPTION 'A beérkező palacknak üresnek kell lennie'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'A mennyiségnek pozitívnak kell lennie'; END IF;

  v_in_key := public.derive_exchange_circulation_key(v_in.circulation, v_in.manufacturer::text);
  v_detached_rental_id := public.detach_rental_cylinder_for_exchange(p_partner_id, p_incoming_id);

  v_mov_id := public.adjust_chinese_stock(trim(p_gas_type), trim(p_size), 'sale', p_quantity,
    COALESCE(NULLIF(trim(p_note), ''), 'Kínait visz – teli ki'));

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    incoming_exchange_circulation, outgoing_exchange_circulation,
    is_forced_substitution, reason, note, created_by, operation_type
  ) VALUES (
    p_partner_id, v_in.id, v_in.circulation, NULL, 'own',
    v_in_key, 'chinese',
    v_in_key <> 'chinese',
    NULL, p_note, v_uid, 'chinese_take'
  ) RETURNING id INTO v_exchange_id;

  INSERT INTO public.movements (cylinder_id, from_location, from_partner_id, to_location, status_after, note, created_by)
  VALUES (v_in.id, COALESCE(v_in.location_type, 'customer'), v_in.location_partner_id, 'warehouse_empty', 'empty', 'Kínait visz – üres be', v_uid);

  UPDATE public.cylinders
  SET status = 'empty', location_type = 'warehouse_empty', location_partner_id = NULL, location_supplier_id = NULL
  WHERE id = v_in.id;

  SELECT EXISTS (
    SELECT 1 FROM public.rentals
    WHERE partner_id = p_partner_id AND status IN ('active', 'expired')
  ) INTO v_has_rental;

  IF v_has_rental OR v_detached_rental_id IS NOT NULL THEN
    PERFORM public.adjust_partner_rental_chinese_quantity(
      p_partner_id, trim(p_gas_type), trim(p_size), p_quantity
    );
  ELSE
    PERFORM public.adjust_partner_quantity_stock(p_partner_id, 'chinese', p_gas_type, p_size, p_quantity);
  END IF;

  PERFORM public.settle_circulation_differences_for_exchange(
    p_partner_id, v_exchange_id,
    v_in_key, 'chinese', v_in.gas_type, trim(p_gas_type), trim(p_size), p_quantity
  );

  IF v_in_key <> 'chinese' OR v_in.gas_type <> trim(p_gas_type) THEN
    PERFORM public.create_circulation_difference(
      p_partner_id, v_exchange_id,
      v_in_key, 'chinese', v_in.gas_type, trim(p_gas_type), trim(p_size), p_quantity, p_note
    );
  END IF;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_uid, 'Kínait visz', 'exchange', v_exchange_id,
    jsonb_build_object(
      'partner_id', p_partner_id, 'incoming_id', p_incoming_id,
      'gas_type', p_gas_type, 'size', p_size, 'quantity', p_quantity,
      'movement_id', v_mov_id, 'detached_rental_id', v_detached_rental_id
    )
  );

  RETURN v_exchange_id;
END;
$$;
