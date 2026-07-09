-- Kínai bérlet összekötése gyors cserével (rental_quantity_items)

CREATE OR REPLACE FUNCTION public.partner_rented_chinese_quantity(
  p_partner_id uuid,
  p_gas_type text,
  p_size text
) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(rqi.quantity), 0)::integer
  FROM public.rental_quantity_items rqi
  JOIN public.rentals r ON r.id = rqi.rental_id
  WHERE r.partner_id = p_partner_id
    AND r.status IN ('active', 'expired')
    AND rqi.stock_kind = 'chinese'
    AND rqi.gas_type = trim(p_gas_type)
    AND rqi.size = trim(p_size)
    AND rqi.removed_at IS NULL
    AND rqi.quantity > 0;
$$;

CREATE OR REPLACE FUNCTION public.adjust_partner_rental_chinese_quantity(
  p_partner_id uuid,
  p_gas_type text,
  p_size text,
  p_delta integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_remaining integer;
  v_item record;
  v_rental_id uuid;
  v_new_qty integer;
BEGIN
  IF p_delta = 0 THEN RETURN; END IF;

  IF p_delta > 0 THEN
    SELECT rqi.id, rqi.quantity INTO v_item
    FROM public.rental_quantity_items rqi
    JOIN public.rentals r ON r.id = rqi.rental_id
    WHERE r.partner_id = p_partner_id
      AND r.status IN ('active', 'expired')
      AND rqi.stock_kind = 'chinese'
      AND rqi.gas_type = trim(p_gas_type)
      AND rqi.size = trim(p_size)
      AND rqi.removed_at IS NULL
    ORDER BY r.start_date DESC
    LIMIT 1
    FOR UPDATE OF rqi;

    IF v_item.id IS NOT NULL THEN
      UPDATE public.rental_quantity_items
      SET quantity = v_item.quantity + p_delta
      WHERE id = v_item.id;
      RETURN;
    END IF;

    SELECT id INTO v_rental_id
    FROM public.rentals
    WHERE partner_id = p_partner_id AND status IN ('active', 'expired')
    ORDER BY start_date DESC
    LIMIT 1;

    IF v_rental_id IS NULL THEN
      RAISE EXCEPTION 'Nincs aktív bérlet a partnernél';
    END IF;

    INSERT INTO public.rental_quantity_items (rental_id, stock_kind, gas_type, size, quantity)
    VALUES (v_rental_id, 'chinese', trim(p_gas_type), trim(p_size), p_delta);
    RETURN;
  END IF;

  v_remaining := -p_delta;
  FOR v_item IN
    SELECT rqi.id, rqi.quantity
    FROM public.rental_quantity_items rqi
    JOIN public.rentals r ON r.id = rqi.rental_id
    WHERE r.partner_id = p_partner_id
      AND r.status IN ('active', 'expired')
      AND rqi.stock_kind = 'chinese'
      AND rqi.gas_type = trim(p_gas_type)
      AND rqi.size = trim(p_size)
      AND rqi.removed_at IS NULL
      AND rqi.quantity > 0
    ORDER BY r.start_date DESC
    FOR UPDATE OF rqi
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF v_item.quantity <= v_remaining THEN
      v_remaining := v_remaining - v_item.quantity;
      UPDATE public.rental_quantity_items
      SET quantity = 0, removed_at = now()
      WHERE id = v_item.id;
    ELSE
      v_new_qty := v_item.quantity - v_remaining;
      UPDATE public.rental_quantity_items
      SET quantity = v_new_qty
      WHERE id = v_item.id;
      v_remaining := 0;
    END IF;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Nincs elegendő bérelt kínai tétel a partnernél';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.detach_rental_cylinder_for_exchange(
  p_partner_id uuid,
  p_cylinder_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rental_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT rc.rental_id INTO v_rental_id
  FROM public.rental_cylinders rc
  JOIN public.rentals r ON r.id = rc.rental_id
  WHERE rc.cylinder_id = p_cylinder_id
    AND rc.removed_at IS NULL
    AND r.partner_id = p_partner_id
    AND r.status IN ('active', 'expired')
  LIMIT 1;

  IF v_rental_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.rental_cylinders
  SET removed_at = v_now, rental_end_date = v_now::date
  WHERE rental_id = v_rental_id AND cylinder_id = p_cylinder_id AND removed_at IS NULL;

  UPDATE public.rentals
  SET
    current_cylinder_id = CASE WHEN current_cylinder_id = p_cylinder_id THEN NULL ELSE current_cylinder_id END,
    original_cylinder_id = CASE WHEN original_cylinder_id = p_cylinder_id THEN NULL ELSE original_cylinder_id END,
    updated_at = v_now
  WHERE id = v_rental_id;

  RETURN v_rental_id;
END;
$$;

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

GRANT EXECUTE ON FUNCTION public.partner_rented_chinese_quantity(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_partner_rental_chinese_quantity(uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detach_rental_cylinder_for_exchange(uuid, uuid) TO authenticated;
