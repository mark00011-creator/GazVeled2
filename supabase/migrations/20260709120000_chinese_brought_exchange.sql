-- Hozott kínai: teljes csere egy tranzakcióban (üres be + teli ki)

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
BEGIN
  IF p_partner_id IS NULL THEN
    RAISE EXCEPTION 'Missing partner';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'A mennyiségnek pozitívnak kell lennie';
  END IF;
  IF v_kind NOT IN ('serial', 'chinese') THEN
    RAISE EXCEPTION 'Add meg, milyen teli palackot adsz ki a partnernek.';
  END IF;

  IF v_kind = 'serial' THEN
    IF p_outgoing_id IS NULL THEN
      RAISE EXCEPTION 'Add meg, milyen teli palackot adsz ki a partnernek.';
    END IF;

    SELECT * INTO v_out FROM public.cylinders WHERE id = p_outgoing_id FOR UPDATE;
    IF v_out.id IS NULL THEN
      RAISE EXCEPTION 'A megadott teli palack nem található.';
    END IF;
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

  ELSE
    IF p_out_gas_type IS NULL OR trim(p_out_gas_type) = ''
       OR p_out_size IS NULL OR trim(p_out_size) = '' THEN
      RAISE EXCEPTION 'Add meg, milyen teli palackot adsz ki a partnernek.';
    END IF;

    IF trim(p_in_gas_type) = trim(p_out_gas_type) AND trim(p_in_size) = trim(p_out_size) THEN
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

    PERFORM public.adjust_partner_quantity_stock(
      p_partner_id, 'chinese', trim(p_out_gas_type), trim(p_out_size), p_quantity
    );

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
  END IF;

  UPDATE public.partner_quantity_stock
  SET quantity = GREATEST(0, quantity - p_quantity), updated_at = now()
  WHERE partner_id = p_partner_id
    AND stock_kind = 'chinese'
    AND gas_type = trim(p_in_gas_type)
    AND size = trim(p_in_size)
    AND quantity > 0;

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
      'movement_id', v_mov_id
    )
  );

  RETURN v_exchange_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_chinese_brought_exchange(
  uuid, text, text, integer, text, uuid, text, text, text
) TO authenticated;
