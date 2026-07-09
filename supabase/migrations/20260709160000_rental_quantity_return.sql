-- Darabszámos bérleti tétel részleges visszavétele (tranzakcióbiztos)

CREATE OR REPLACE FUNCTION public.return_rental_quantity_items_partial(
  p_rental_id uuid,
  p_items jsonb,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rental record;
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_item_id uuid;
  v_return_qty integer;
  v_row record;
  v_kind_label text;
  v_stock_note text;
  v_desc text;
BEGIN
  IF p_rental_id IS NULL THEN RAISE EXCEPTION 'Missing rental'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nincs visszavételre jelölt tétel';
  END IF;

  SELECT id, partner_id, status INTO v_rental
  FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF v_rental.id IS NULL THEN RAISE EXCEPTION 'Bérlet nem található'; END IF;
  IF v_rental.status NOT IN ('active', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'A bérlet már lezárt';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := (v_item->>'item_id')::uuid;
    v_return_qty := (v_item->>'quantity')::integer;
    IF v_item_id IS NULL OR v_return_qty IS NULL OR v_return_qty <= 0 THEN
      RAISE EXCEPTION 'Érvénytelen visszavételi mennyiség';
    END IF;

    SELECT * INTO v_row
    FROM public.rental_quantity_items
    WHERE id = v_item_id
      AND rental_id = p_rental_id
      AND removed_at IS NULL
      AND quantity > 0
    FOR UPDATE;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'Bérleti tétel nem található'; END IF;
    IF v_return_qty > v_row.quantity THEN
      RAISE EXCEPTION 'A visszavétel nem lehet nagyobb a bérelt darabszámnál';
    END IF;

    v_kind_label := CASE v_row.stock_kind
      WHEN 'chinese' THEN 'Kínai'
      WHEN 'flaga_pb' THEN 'FLAGA PB'
      WHEN 'prima_pb' THEN 'PRÍMA PB'
      ELSE v_row.stock_kind
    END;
    v_stock_note := format('Visszavéve bérletből (%s)', p_rental_id);

    CASE v_row.stock_kind
      WHEN 'chinese' THEN
        PERFORM public.adjust_chinese_stock(
          v_row.gas_type, v_row.size, 'empty_return', v_return_qty, v_stock_note
        );
      WHEN 'flaga_pb' THEN
        PERFORM public.adjust_flaga_pb_stock(
          v_row.gas_type, v_row.size, 'empty_return', v_return_qty, v_stock_note
        );
      WHEN 'prima_pb' THEN
        PERFORM public.adjust_prima_pb_stock(
          v_row.gas_type, v_row.size, 'empty_return', v_return_qty, v_stock_note
        );
      WHEN 'flaga' THEN
        RAISE EXCEPTION 'A régi FLAGA készlet modul megszűnt';
      ELSE
        RAISE EXCEPTION 'Ismeretlen készlettípus: %', v_row.stock_kind;
    END CASE;

    IF v_return_qty >= v_row.quantity THEN
      UPDATE public.rental_quantity_items
      SET removed_at = now()
      WHERE id = v_row.id;
    ELSE
      UPDATE public.rental_quantity_items
      SET quantity = v_row.quantity - v_return_qty
      WHERE id = v_row.id;
    END IF;

    v_desc := format('%s %s %s %s db visszavéve bérletből', v_kind_label, v_row.gas_type, v_row.size, v_return_qty);
    INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
    VALUES (
      v_uid, v_desc, 'rental', p_rental_id,
      jsonb_build_object(
        'partner_id', v_rental.partner_id,
        'item_id', v_row.id,
        'stock_kind', v_row.stock_kind,
        'gas_type', v_row.gas_type,
        'size', v_row.size,
        'return_quantity', v_return_qty,
        'note', p_note
      )
    );
  END LOOP;

  UPDATE public.rentals SET updated_at = now() WHERE id = p_rental_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.return_rental_quantity_items_partial(uuid, jsonb, text) TO authenticated;
