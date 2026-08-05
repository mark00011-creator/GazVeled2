-- Eszköz/fogyóanyag B fázis: többtermékes értékesítés + pillanatkép mentés

CREATE OR REPLACE FUNCTION public.supply_compute_sale_line(
  p_purchase_unit numeric,
  p_sale_unit numeric,
  p_quantity integer
)
RETURNS TABLE(
  profit_per_unit numeric,
  line_purchase_value numeric,
  line_profit numeric,
  margin_percent numeric
)
LANGUAGE sql
IMMUTABLE AS $$
  SELECT
    CASE
      WHEN p_purchase_unit IS NULL OR p_sale_unit IS NULL THEN NULL
      ELSE round(p_sale_unit - p_purchase_unit, 0)
    END,
    CASE
      WHEN p_purchase_unit IS NULL THEN NULL
      ELSE round(p_purchase_unit * p_quantity, 0)
    END,
    CASE
      WHEN p_purchase_unit IS NULL OR p_sale_unit IS NULL THEN NULL
      ELSE round((p_sale_unit - p_purchase_unit) * p_quantity, 0)
    END,
    CASE
      WHEN p_purchase_unit IS NULL OR p_purchase_unit <= 0 OR p_sale_unit IS NULL THEN NULL
      ELSE round(((p_sale_unit - p_purchase_unit) / p_purchase_unit) * 100.0, 2)
    END;
$$;

CREATE OR REPLACE FUNCTION public.record_supply_sale_batch(
  p_partner_id uuid,
  p_items jsonb,
  p_note text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing_sale uuid;
  v_event_group uuid := gen_random_uuid();
  v_sale_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_unit_price numeric;
  v_product public.supply_products;
  v_line_net numeric;
  v_line_vat numeric;
  v_line_gross numeric;
  v_stock record;
  v_mov_id uuid;
  v_snap record;
  v_total_net numeric := 0;
  v_total_vat numeric := 0;
  v_total_gross numeric := 0;
  v_total_purchase numeric := 0;
  v_total_profit numeric := 0;
  v_item_count integer := 0;
  v_locked_ids uuid[];
BEGIN
  PERFORM public.require_admin();

  IF p_partner_id IS NULL THEN
    RAISE EXCEPTION 'Partner megadása kötelező.';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Legalább egy termék megadása kötelező.';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_sale FROM public.supply_sales WHERE idempotency_key = p_idempotency_key;
    IF v_existing_sale IS NOT NULL THEN
      RETURN v_existing_sale;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.partners WHERE id = p_partner_id) THEN
    RAISE EXCEPTION 'A partner nem található.';
  END IF;

  SELECT array_agg(DISTINCT (elem->>'product_id')::uuid ORDER BY (elem->>'product_id')::uuid)
  INTO v_locked_ids
  FROM jsonb_array_elements(p_items) AS elem;

  IF v_locked_ids IS NULL OR array_length(v_locked_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Érvénytelen terméklista.';
  END IF;

  PERFORM 1
  FROM public.supply_products p
  WHERE p.id = ANY(v_locked_ids)
  ORDER BY p.id
  FOR UPDATE;

  INSERT INTO public.supply_sales (
    partner_id, sale_date, total_net, total_vat, total_gross,
    total_purchase_value, total_profit, note, idempotency_key, created_by, event_group_id
  ) VALUES (
    p_partner_id, CURRENT_DATE, 0, 0, 0, 0, 0,
    NULLIF(trim(p_note), ''), p_idempotency_key, v_uid, v_event_group
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS t(value)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := NULLIF(v_item->>'unit_price', '')::numeric;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Minden tételhez termék kötelező.';
    END IF;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Az eladott mennyiségnek pozitívnak kell lennie.';
    END IF;

    SELECT * INTO v_product
    FROM public.supply_products
    WHERE id = v_product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A termék nem található.';
    END IF;
    IF NOT v_product.is_active THEN
      RAISE EXCEPTION 'Inaktív termék nem értékesíthető: %', v_product.name;
    END IF;
    IF NOT v_product.is_sellable THEN
      RAISE EXCEPTION 'Ez a termék nem eladható: %', v_product.name;
    END IF;
    IF v_product.stock_kind <> 'quantity' THEN
      RAISE EXCEPTION 'Csak darabszámos termék értékesíthető: %', v_product.name;
    END IF;

    IF v_unit_price IS NOT NULL THEN
      IF v_unit_price < 0 THEN
        RAISE EXCEPTION 'Az egységár nem lehet negatív.';
      END IF;
    ELSIF v_product.sale_price IS NOT NULL AND v_product.sale_price > 0 THEN
      v_unit_price := v_product.sale_price;
    ELSE
      RAISE EXCEPTION 'Eladási ár beállítása szükséges: %', v_product.name;
    END IF;

    IF v_product.current_stock < v_quantity THEN
      RAISE EXCEPTION 'Nincs elegendő készlet. Elérhető: % %, értékesíteni kívánt: % %',
        v_product.current_stock, v_product.unit_of_measure, v_quantity, v_product.unit_of_measure;
    END IF;

    v_line_net := round(v_unit_price * v_quantity, 0);
    v_line_vat := round(v_line_net * v_product.vat_rate / 100.0, 0);
    v_line_gross := v_line_net + v_line_vat;

    SELECT * INTO v_snap
    FROM public.supply_compute_sale_line(v_product.purchase_price, v_unit_price, v_quantity);

    INSERT INTO public.supply_sale_items (
      sale_id, product_id, quantity, unit_of_measure, unit_price,
      line_net, vat_rate, line_vat, line_gross, note,
      product_name, specification, packaging, purchase_unit_price,
      profit_per_unit, line_purchase_value, line_profit, margin_percent
    ) VALUES (
      v_sale_id, v_product_id, v_quantity, v_product.unit_of_measure, v_unit_price,
      v_line_net, v_product.vat_rate, v_line_vat, v_line_gross, NULLIF(trim(p_note), ''),
      v_product.name, v_product.specification, v_product.packaging, v_product.purchase_price,
      v_snap.profit_per_unit, v_snap.line_purchase_value, v_snap.line_profit, v_snap.margin_percent
    );

    SELECT * INTO v_stock FROM public.apply_supply_stock_delta(v_product_id, -v_quantity);

    INSERT INTO public.supply_stock_movements (
      product_id, movement_type, quantity, stock_before, stock_after,
      partner_id, related_sale_id, unit_price, total_amount,
      event_group_id, idempotency_key, note, created_by
    ) VALUES (
      v_product_id, 'sale', v_quantity, v_stock.stock_before, v_stock.stock_after,
      p_partner_id, v_sale_id, v_unit_price, v_line_net,
      v_event_group, p_idempotency_key, NULLIF(trim(p_note), ''), v_uid
    )
    RETURNING id INTO v_mov_id;

    INSERT INTO public.supply_billing_queue (
      sale_id, partner_id, product_id, quantity, unit_of_measure, unit_price,
      net_amount, vat_rate, vat_amount, gross_amount, sale_date, status, note,
      product_name, purchase_unit_price, line_profit
    ) VALUES (
      v_sale_id, p_partner_id, v_product_id, v_quantity, v_product.unit_of_measure, v_unit_price,
      v_line_net, v_product.vat_rate, v_line_vat, v_line_gross, CURRENT_DATE, 'pending',
      NULLIF(trim(p_note), ''),
      v_product.name, v_product.purchase_price, v_snap.line_profit
    );

    v_total_net := v_total_net + v_line_net;
    v_total_vat := v_total_vat + v_line_vat;
    v_total_gross := v_total_gross + v_line_gross;
    v_total_purchase := v_total_purchase + coalesce(v_snap.line_purchase_value, 0);
    v_total_profit := v_total_profit + coalesce(v_snap.line_profit, 0);
    v_item_count := v_item_count + 1;
  END LOOP;

  UPDATE public.supply_sales
  SET
    total_net = v_total_net,
    total_vat = v_total_vat,
    total_gross = v_total_gross,
    total_purchase_value = CASE WHEN v_total_purchase > 0 THEN v_total_purchase ELSE NULL END,
    total_profit = CASE WHEN v_total_profit <> 0 OR v_total_purchase > 0 THEN v_total_profit ELSE NULL END
  WHERE id = v_sale_id;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_uid, 'Supply értékesítés', 'supply_sale', v_sale_id,
    jsonb_build_object(
      'partner_id', p_partner_id,
      'item_count', v_item_count,
      'total_gross', v_total_gross,
      'event_group_id', v_event_group
    )
  );

  PERFORM public.try_insert_supply_event(
    'supply_stock_sold', v_event_group, 'supply_sale', v_sale_id,
    p_partner_id, NULL,
    jsonb_build_object('item_count', v_item_count, 'total_gross', v_total_gross),
    v_uid
  );

  RETURN v_sale_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_supply_sale(
  p_partner_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_unit_price numeric DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  RETURN public.record_supply_sale_batch(
    p_partner_id,
    jsonb_build_array(
      jsonb_build_object(
        'product_id', p_product_id,
        'quantity', p_quantity,
        'unit_price', p_unit_price
      )
    ),
    p_note,
    p_idempotency_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.supply_compute_sale_line(numeric, numeric, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_supply_sale_batch(uuid, jsonb, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_supply_sale_batch(uuid, jsonb, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.record_supply_sale_batch IS 'Többtermékes darabszámos értékesítés – atomi sale + items + movements + billing_queue + pillanatkép.';
