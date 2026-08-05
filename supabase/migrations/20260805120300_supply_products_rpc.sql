-- Eszköz- és fogyóanyag-készlet: alap RPC-k (Fázis A)

CREATE OR REPLACE FUNCTION public.try_insert_supply_event(
  p_event_type text,
  p_event_group_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_partner_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_user_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.events (
    event_type,
    event_group_id,
    entity_type,
    entity_id,
    user_id,
    partner_id,
    supplier_id,
    payload,
    metadata
  ) VALUES (
    p_event_type,
    p_event_group_id,
    p_entity_type,
    p_entity_id,
    COALESCE(p_user_id, auth.uid()),
    p_partner_id,
    p_supplier_id,
    COALESCE(p_payload, '{}'::jsonb),
    jsonb_build_object('source', 'supply_rpc')
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'supply_event_insert_failed (%): %', p_event_type, SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_supply_stock_delta(
  p_product_id uuid,
  p_delta integer
)
RETURNS TABLE(stock_before integer, stock_after integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_before integer;
  v_after integer;
BEGIN
  PERFORM public.require_admin();

  SELECT current_stock INTO v_before
  FROM public.supply_products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A termék nem található.';
  END IF;

  v_after := v_before + p_delta;
  IF v_after < 0 THEN
    RAISE EXCEPTION 'Nincs elegendő készlet. Elérhető: %, kért változás: %', v_before, p_delta;
  END IF;

  PERFORM set_config('supply.internal_stock_update', '1', true);
  UPDATE public.supply_products
  SET current_stock = v_after, updated_at = now()
  WHERE id = p_product_id;

  stock_before := v_before;
  stock_after := v_after;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_supply_product(
  p_stock_kind text,
  p_natural_key text,
  p_name text,
  p_unit_of_measure text,
  p_category text DEFAULT NULL,
  p_brand text DEFAULT NULL,
  p_product_type text DEFAULT NULL,
  p_specification text DEFAULT NULL,
  p_packaging text DEFAULT NULL,
  p_minimum_stock integer DEFAULT 0,
  p_purchase_price numeric DEFAULT NULL,
  p_sale_price numeric DEFAULT NULL,
  p_vat_rate numeric DEFAULT 27,
  p_is_sellable boolean DEFAULT false,
  p_is_rentable boolean DEFAULT false,
  p_note text DEFAULT NULL,
  p_initial_stock integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_product_id uuid;
  v_event_group uuid := gen_random_uuid();
  v_stock integer;
BEGIN
  PERFORM public.require_admin();

  IF p_stock_kind NOT IN ('unit', 'quantity') THEN
    RAISE EXCEPTION 'Érvénytelen készlettípus: %', p_stock_kind;
  END IF;
  IF length(trim(p_natural_key)) = 0 THEN
    RAISE EXCEPTION 'A natural_key nem lehet üres.';
  END IF;
  IF p_stock_kind = 'quantity' THEN
    v_stock := COALESCE(p_initial_stock, 0);
    IF v_stock < 0 THEN
      RAISE EXCEPTION 'Az induló készlet nem lehet negatív.';
    END IF;
  ELSE
    v_stock := NULL;
  END IF;

  INSERT INTO public.supply_products (
    stock_kind, natural_key, name, category, brand, product_type, specification, packaging,
    unit_of_measure, current_stock, minimum_stock, purchase_price, sale_price, vat_rate,
    is_sellable, is_rentable, note, created_by
  ) VALUES (
    p_stock_kind, trim(p_natural_key), trim(p_name), NULLIF(trim(p_category), ''), NULLIF(trim(p_brand), ''),
    NULLIF(trim(p_product_type), ''), NULLIF(trim(p_specification), ''), NULLIF(trim(p_packaging), ''),
    trim(p_unit_of_measure), v_stock, COALESCE(p_minimum_stock, 0),
    p_purchase_price, p_sale_price, COALESCE(p_vat_rate, 27),
    COALESCE(p_is_sellable, false), COALESCE(p_is_rentable, false),
    NULLIF(trim(p_note), ''), v_uid
  )
  RETURNING id INTO v_product_id;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_uid, 'Supply termék létrehozva', 'supply_product', v_product_id,
    jsonb_build_object('natural_key', trim(p_natural_key), 'name', trim(p_name), 'stock_kind', p_stock_kind)
  );

  PERFORM public.try_insert_supply_event(
    'supply_product_created', v_event_group, 'supply_product', v_product_id,
    NULL, NULL,
    jsonb_build_object('natural_key', trim(p_natural_key), 'name', trim(p_name)),
    v_uid
  );

  RETURN v_product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_supply_product(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_event_group uuid := gen_random_uuid();
BEGIN
  PERFORM public.require_admin();

  UPDATE public.supply_products
  SET is_active = false, updated_at = now()
  WHERE id = p_product_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A termék nem található vagy már inaktív.';
  END IF;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (v_uid, 'Supply termék inaktiválva', 'supply_product', p_product_id, jsonb_build_object('is_active', false));

  PERFORM public.try_insert_supply_event(
    'supply_product_deactivated', v_event_group, 'supply_product', p_product_id,
    NULL, NULL, '{}'::jsonb, v_uid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_supply_product_prices(
  p_product_id uuid,
  p_purchase_price numeric DEFAULT NULL,
  p_sale_price numeric DEFAULT NULL,
  p_vat_rate numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old record;
  v_event_group uuid := gen_random_uuid();
BEGIN
  PERFORM public.require_admin();

  SELECT purchase_price, sale_price, vat_rate
  INTO v_old
  FROM public.supply_products
  WHERE id = p_product_id AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Az aktív termék nem található.';
  END IF;

  IF p_purchase_price IS NOT NULL AND p_purchase_price < 0 THEN
    RAISE EXCEPTION 'A beszerzési ár nem lehet negatív.';
  END IF;
  IF p_sale_price IS NOT NULL AND p_sale_price <= 0 THEN
    RAISE EXCEPTION 'Az eladási árnak pozitívnak kell lennie.';
  END IF;
  IF p_vat_rate IS NOT NULL AND p_vat_rate < 0 THEN
    RAISE EXCEPTION 'Az áfa nem lehet negatív.';
  END IF;

  UPDATE public.supply_products
  SET
    purchase_price = COALESCE(p_purchase_price, purchase_price),
    sale_price = COALESCE(p_sale_price, sale_price),
    vat_rate = COALESCE(p_vat_rate, vat_rate),
    updated_at = now()
  WHERE id = p_product_id;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, old_value, new_value)
  VALUES (
    v_uid, 'Supply ár módosítva', 'supply_product', p_product_id,
    jsonb_build_object('purchase_price', v_old.purchase_price, 'sale_price', v_old.sale_price, 'vat_rate', v_old.vat_rate),
    jsonb_build_object(
      'purchase_price', COALESCE(p_purchase_price, v_old.purchase_price),
      'sale_price', COALESCE(p_sale_price, v_old.sale_price),
      'vat_rate', COALESCE(p_vat_rate, v_old.vat_rate)
    )
  );

  PERFORM public.try_insert_supply_event(
    'supply_price_updated', v_event_group, 'supply_product', p_product_id,
    NULL, NULL,
    jsonb_build_object(
      'purchase_price', COALESCE(p_purchase_price, v_old.purchase_price),
      'sale_price', COALESCE(p_sale_price, v_old.sale_price)
    ),
    v_uid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_supply_stock(
  p_product_id uuid,
  p_quantity integer,
  p_purchase_price numeric DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_document_number text DEFAULT NULL,
  p_purchase_date date DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_product public.supply_products;
  v_stock record;
  v_event_group uuid := gen_random_uuid();
  v_mov_id uuid;
BEGIN
  PERFORM public.require_admin();

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'A bevételezett mennyiségnek pozitívnak kell lennie.';
  END IF;
  IF p_purchase_price IS NOT NULL AND p_purchase_price < 0 THEN
    RAISE EXCEPTION 'A beszerzési ár nem lehet negatív.';
  END IF;

  SELECT * INTO v_product
  FROM public.supply_products
  WHERE id = p_product_id AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Az aktív termék nem található.';
  END IF;
  IF v_product.stock_kind <> 'quantity' THEN
    RAISE EXCEPTION 'Csak darabszámos termékbevételezés engedélyezett.';
  END IF;

  SELECT * INTO v_stock FROM public.apply_supply_stock_delta(p_product_id, p_quantity);

  IF p_purchase_price IS NOT NULL THEN
    UPDATE public.supply_products
    SET purchase_price = p_purchase_price, updated_at = now()
    WHERE id = p_product_id;
  END IF;

  INSERT INTO public.supply_stock_movements (
    product_id, movement_type, quantity, stock_before, stock_after,
    supplier_id, unit_price, total_amount, document_number, purchase_date,
    event_group_id, note, created_by
  ) VALUES (
    p_product_id, 'receipt', p_quantity, v_stock.stock_before, v_stock.stock_after,
    p_supplier_id, p_purchase_price,
    CASE WHEN p_purchase_price IS NOT NULL THEN round(p_purchase_price * p_quantity, 0) ELSE NULL END,
    NULLIF(trim(p_document_number), ''), p_purchase_date,
    v_event_group, NULLIF(trim(p_note), ''), v_uid
  )
  RETURNING id INTO v_mov_id;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_uid, 'Supply bevételezés', 'supply_movement', v_mov_id,
    jsonb_build_object(
      'product_id', p_product_id, 'quantity', p_quantity,
      'stock_before', v_stock.stock_before, 'stock_after', v_stock.stock_after
    )
  );

  PERFORM public.try_insert_supply_event(
    'supply_stock_received', v_event_group, 'supply_product', p_product_id,
    NULL, p_supplier_id,
    jsonb_build_object('movement_id', v_mov_id, 'quantity', p_quantity),
    v_uid
  );

  RETURN v_mov_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_supply_stock(
  p_product_id uuid,
  p_movement_type text,
  p_quantity integer,
  p_note text DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_product public.supply_products;
  v_delta integer;
  v_stock record;
  v_event_group uuid := gen_random_uuid();
  v_mov_id uuid;
BEGIN
  PERFORM public.require_admin();

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'A mennyiségnek pozitívnak kell lennie.';
  END IF;

  SELECT * INTO v_product
  FROM public.supply_products
  WHERE id = p_product_id AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Az aktív termék nem található.';
  END IF;
  IF v_product.stock_kind <> 'quantity' THEN
    RAISE EXCEPTION 'Csak darabszámos készlet korrekció engedélyezett.';
  END IF;

  v_delta := CASE p_movement_type
    WHEN 'customer_return' THEN p_quantity
    WHEN 'correction_increase' THEN p_quantity
    WHEN 'correction_decrease' THEN -p_quantity
    WHEN 'scrap' THEN -p_quantity
    WHEN 'internal_use' THEN -p_quantity
    WHEN 'stocktake_delta' THEN p_quantity
    WHEN 'rental_out' THEN -p_quantity
    WHEN 'rental_return' THEN p_quantity
    ELSE NULL
  END;

  IF v_delta IS NULL THEN
    RAISE EXCEPTION 'Érvénytelen mozgástípus korrekcióhoz: %', p_movement_type;
  END IF;

  SELECT * INTO v_stock FROM public.apply_supply_stock_delta(p_product_id, v_delta);

  INSERT INTO public.supply_stock_movements (
    product_id, movement_type, quantity, stock_before, stock_after,
    partner_id, event_group_id, note, created_by
  ) VALUES (
    p_product_id, p_movement_type, p_quantity, v_stock.stock_before, v_stock.stock_after,
    p_partner_id, v_event_group, NULLIF(trim(p_note), ''), v_uid
  )
  RETURNING id INTO v_mov_id;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_uid, 'Supply készletkorrekció', 'supply_movement', v_mov_id,
    jsonb_build_object('movement_type', p_movement_type, 'quantity', p_quantity, 'delta', v_delta)
  );

  PERFORM public.try_insert_supply_event(
    'supply_stock_adjusted', v_event_group, 'supply_product', p_product_id,
    p_partner_id, NULL,
    jsonb_build_object('movement_id', v_mov_id, 'movement_type', p_movement_type),
    v_uid
  );

  RETURN v_mov_id;
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
DECLARE
  v_uid uuid := auth.uid();
  v_product public.supply_products;
  v_existing_sale uuid;
  v_unit_price numeric;
  v_line_net numeric;
  v_line_vat numeric;
  v_line_gross numeric;
  v_stock record;
  v_event_group uuid := gen_random_uuid();
  v_sale_id uuid;
  v_mov_id uuid;
BEGIN
  PERFORM public.require_admin();

  IF p_partner_id IS NULL THEN
    RAISE EXCEPTION 'Partner megadása kötelező.';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Az eladott mennyiségnek pozitívnak kell lennie.';
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

  SELECT * INTO v_product
  FROM public.supply_products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A termék nem található.';
  END IF;
  IF NOT v_product.is_active THEN
    RAISE EXCEPTION 'Inaktív termék nem értékesíthető.';
  END IF;
  IF NOT v_product.is_sellable THEN
    RAISE EXCEPTION 'Ez a termék nem eladható.';
  END IF;
  IF v_product.stock_kind <> 'quantity' THEN
    RAISE EXCEPTION 'Csak darabszámos termék értékesíthető.';
  END IF;

  IF p_unit_price IS NOT NULL THEN
    IF p_unit_price < 0 THEN
      RAISE EXCEPTION 'Az egységár nem lehet negatív.';
    END IF;
    v_unit_price := p_unit_price;
  ELSIF v_product.sale_price IS NOT NULL AND v_product.sale_price > 0 THEN
    v_unit_price := v_product.sale_price;
  ELSE
    RAISE EXCEPTION 'Az értékesítéshez eladási ár beállítása szükséges.';
  END IF;

  IF v_product.current_stock < p_quantity THEN
    RAISE EXCEPTION 'Nincs elegendő készlet. Elérhető: %, kért: %', v_product.current_stock, p_quantity;
  END IF;

  v_line_net := round(v_unit_price * p_quantity, 0);
  v_line_vat := round(v_line_net * v_product.vat_rate / 100.0, 0);
  v_line_gross := v_line_net + v_line_vat;

  INSERT INTO public.supply_sales (
    partner_id, sale_date, total_net, total_vat, total_gross, note, idempotency_key, created_by
  ) VALUES (
    p_partner_id, CURRENT_DATE, v_line_net, v_line_vat, v_line_gross,
    NULLIF(trim(p_note), ''), p_idempotency_key, v_uid
  )
  RETURNING id INTO v_sale_id;

  INSERT INTO public.supply_sale_items (
    sale_id, product_id, quantity, unit_of_measure, unit_price,
    line_net, vat_rate, line_vat, line_gross, note
  ) VALUES (
    v_sale_id, p_product_id, p_quantity, v_product.unit_of_measure, v_unit_price,
    v_line_net, v_product.vat_rate, v_line_vat, v_line_gross, NULLIF(trim(p_note), '')
  );

  SELECT * INTO v_stock FROM public.apply_supply_stock_delta(p_product_id, -p_quantity);

  INSERT INTO public.supply_stock_movements (
    product_id, movement_type, quantity, stock_before, stock_after,
    partner_id, related_sale_id, unit_price, total_amount,
    event_group_id, idempotency_key, note, created_by
  ) VALUES (
    p_product_id, 'sale', p_quantity, v_stock.stock_before, v_stock.stock_after,
    p_partner_id, v_sale_id, v_unit_price, v_line_net,
    v_event_group, p_idempotency_key, NULLIF(trim(p_note), ''), v_uid
  )
  RETURNING id INTO v_mov_id;

  INSERT INTO public.supply_billing_queue (
    sale_id, partner_id, product_id, quantity, unit_of_measure, unit_price,
    net_amount, vat_rate, vat_amount, gross_amount, sale_date, status, note
  ) VALUES (
    v_sale_id, p_partner_id, p_product_id, p_quantity, v_product.unit_of_measure, v_unit_price,
    v_line_net, v_product.vat_rate, v_line_vat, v_line_gross, CURRENT_DATE, 'pending',
    NULLIF(trim(p_note), '')
  );

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_uid, 'Supply értékesítés', 'supply_sale', v_sale_id,
    jsonb_build_object(
      'partner_id', p_partner_id, 'product_id', p_product_id,
      'quantity', p_quantity, 'movement_id', v_mov_id, 'line_gross', v_line_gross
    )
  );

  PERFORM public.try_insert_supply_event(
    'supply_stock_sold', v_event_group, 'supply_sale', v_sale_id,
    p_partner_id, NULL,
    jsonb_build_object('product_id', p_product_id, 'quantity', p_quantity, 'movement_id', v_mov_id),
    v_uid
  );

  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION public.try_insert_supply_event(text, uuid, text, uuid, uuid, uuid, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_supply_stock_delta(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_supply_product(text, text, text, text, text, text, text, text, text, integer, numeric, numeric, numeric, boolean, boolean, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deactivate_supply_product(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_supply_product_prices(uuid, numeric, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.receive_supply_stock(uuid, integer, numeric, uuid, text, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_supply_stock(uuid, text, integer, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_supply_sale(uuid, uuid, integer, numeric, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_supply_product(text, text, text, text, text, text, text, text, text, integer, numeric, numeric, numeric, boolean, boolean, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_supply_product(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_supply_product_prices(uuid, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_supply_stock(uuid, integer, numeric, uuid, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_supply_stock(uuid, text, integer, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_supply_sale(uuid, uuid, integer, numeric, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.receive_supply_stock IS 'Darabszámos készlet bevételezése – atomi mozgás + audit + event.';
COMMENT ON FUNCTION public.record_supply_sale IS 'Darabszámos készlet értékesítése – atomi sale + movement + billing_queue.';
COMMENT ON FUNCTION public.adjust_supply_stock IS 'Készletkorrekció / selejt / belső felhasználás – atomi mozgás.';
