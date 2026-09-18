-- Supply termék szerkesztés + create ÁFA default org szerint
-- Production: snmiwsgtnokvqlnwvfwf

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
  p_vat_rate numeric DEFAULT NULL,
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
  v_vat numeric;
BEGIN
  PERFORM public.require_admin();

  IF p_stock_kind NOT IN ('unit', 'quantity') THEN
    RAISE EXCEPTION 'Érvénytelen készlettípus: %', p_stock_kind;
  END IF;
  IF length(trim(p_natural_key)) = 0 THEN
    RAISE EXCEPTION 'A natural_key nem lehet üres.';
  END IF;
  IF length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'A név nem lehet üres.';
  END IF;
  IF length(trim(p_unit_of_measure)) = 0 THEN
    RAISE EXCEPTION 'A mértékegység nem lehet üres.';
  END IF;

  IF p_stock_kind = 'quantity' THEN
    v_stock := COALESCE(p_initial_stock, 0);
    IF v_stock < 0 THEN
      RAISE EXCEPTION 'Az induló készlet nem lehet negatív.';
    END IF;
  ELSE
    v_stock := NULL;
  END IF;

  v_vat := public.org_effective_vat_rate(p_vat_rate);

  INSERT INTO public.supply_products (
    stock_kind, natural_key, name, category, brand, product_type, specification, packaging,
    unit_of_measure, current_stock, minimum_stock, purchase_price, sale_price, vat_rate,
    is_sellable, is_rentable, note, created_by
  ) VALUES (
    p_stock_kind, trim(p_natural_key), trim(p_name), NULLIF(trim(p_category), ''), NULLIF(trim(p_brand), ''),
    NULLIF(trim(p_product_type), ''), NULLIF(trim(p_specification), ''), NULLIF(trim(p_packaging), ''),
    trim(p_unit_of_measure), v_stock, COALESCE(p_minimum_stock, 0),
    p_purchase_price, p_sale_price, v_vat,
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

CREATE OR REPLACE FUNCTION public.update_supply_product(
  p_product_id uuid,
  p_name text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_brand text DEFAULT NULL,
  p_product_type text DEFAULT NULL,
  p_specification text DEFAULT NULL,
  p_packaging text DEFAULT NULL,
  p_unit_of_measure text DEFAULT NULL,
  p_minimum_stock integer DEFAULT NULL,
  p_is_sellable boolean DEFAULT NULL,
  p_is_rentable boolean DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old public.supply_products;
  v_event_group uuid := gen_random_uuid();
BEGIN
  PERFORM public.require_admin();

  SELECT * INTO v_old FROM public.supply_products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A termék nem található.';
  END IF;

  IF p_name IS NOT NULL AND length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'A név nem lehet üres.';
  END IF;
  IF p_unit_of_measure IS NOT NULL AND length(trim(p_unit_of_measure)) = 0 THEN
    RAISE EXCEPTION 'A mértékegység nem lehet üres.';
  END IF;
  IF p_minimum_stock IS NOT NULL AND p_minimum_stock < 0 THEN
    RAISE EXCEPTION 'A minimum készlet nem lehet negatív.';
  END IF;

  UPDATE public.supply_products
  SET
    name = COALESCE(NULLIF(trim(p_name), ''), name),
    category = CASE WHEN p_category IS NULL THEN category ELSE NULLIF(trim(p_category), '') END,
    brand = CASE WHEN p_brand IS NULL THEN brand ELSE NULLIF(trim(p_brand), '') END,
    product_type = CASE WHEN p_product_type IS NULL THEN product_type ELSE NULLIF(trim(p_product_type), '') END,
    specification = CASE WHEN p_specification IS NULL THEN specification ELSE NULLIF(trim(p_specification), '') END,
    packaging = CASE WHEN p_packaging IS NULL THEN packaging ELSE NULLIF(trim(p_packaging), '') END,
    unit_of_measure = COALESCE(NULLIF(trim(p_unit_of_measure), ''), unit_of_measure),
    minimum_stock = COALESCE(p_minimum_stock, minimum_stock),
    is_sellable = COALESCE(p_is_sellable, is_sellable),
    is_rentable = COALESCE(p_is_rentable, is_rentable),
    is_active = COALESCE(p_is_active, is_active),
    note = CASE WHEN p_note IS NULL THEN note ELSE NULLIF(trim(p_note), '') END,
    updated_at = now()
  WHERE id = p_product_id;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, old_value, new_value)
  VALUES (
    v_uid, 'Supply termék módosítva', 'supply_product', p_product_id,
    jsonb_build_object(
      'name', v_old.name,
      'category', v_old.category,
      'is_active', v_old.is_active,
      'is_sellable', v_old.is_sellable,
      'minimum_stock', v_old.minimum_stock
    ),
    jsonb_build_object(
      'name', COALESCE(NULLIF(trim(p_name), ''), v_old.name),
      'category', CASE WHEN p_category IS NULL THEN v_old.category ELSE NULLIF(trim(p_category), '') END,
      'is_active', COALESCE(p_is_active, v_old.is_active),
      'is_sellable', COALESCE(p_is_sellable, v_old.is_sellable),
      'minimum_stock', COALESCE(p_minimum_stock, v_old.minimum_stock)
    )
  );

  PERFORM public.try_insert_supply_event(
    'supply_product_updated', v_event_group, 'supply_product', p_product_id,
    NULL, NULL,
    jsonb_build_object('name', COALESCE(NULLIF(trim(p_name), ''), v_old.name)),
    v_uid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_supply_product(
  uuid, text, text, text, text, text, text, text, integer, boolean, boolean, boolean, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_supply_product(
  uuid, text, text, text, text, text, text, text, integer, boolean, boolean, boolean, text
) TO authenticated;

COMMENT ON FUNCTION public.update_supply_product IS
  'Supply termék meta szerkesztése (készletszám nélkül – az bevételezés/korrekció útján megy).';
