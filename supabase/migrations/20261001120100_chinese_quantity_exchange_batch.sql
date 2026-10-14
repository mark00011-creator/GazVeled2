-- Chinese quantity exchange (full out + empty in) with optional batch_id
-- for mixed serial + Chinese quick-exchange events.
-- Production apply: TILOS ebben a körben.
-- Project: snmiwsgtnokvqlnwvfwf

CREATE OR REPLACE FUNCTION public.record_chinese_quantity_exchange(
  p_partner_id uuid,
  p_gas_type text,
  p_size text,
  p_full_out integer,
  p_empty_in integer,
  p_batch_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.require_active_organization();
  v_uid uuid := auth.uid();
  v_gas text := trim(p_gas_type);
  v_size text := trim(p_size);
  v_full integer := COALESCE(p_full_out, 0);
  v_empty integer := COALESCE(p_empty_in, 0);
  v_exchange_id uuid;
  v_note text;
BEGIN
  PERFORM public.require_exchange_access();
  PERFORM public.assert_partner_in_org(p_partner_id);

  IF v_gas IS NULL OR length(v_gas) = 0 OR v_size IS NULL OR length(v_size) = 0 THEN
    RAISE EXCEPTION 'Gáznem és méret kötelező';
  END IF;
  IF v_full < 0 OR v_empty < 0 THEN
    RAISE EXCEPTION 'A mennyiség nem lehet negatív';
  END IF;
  IF v_full = 0 AND v_empty = 0 THEN
    RAISE EXCEPTION 'Legalább egy teli ki vagy üres vissza kell';
  END IF;

  IF v_full > 0 THEN
    PERFORM public.adjust_chinese_stock(
      v_gas, v_size, 'sale', v_full,
      COALESCE(NULLIF(trim(p_note), ''), 'Gyorscsere – kínai teli ki')
    );
  END IF;

  IF v_empty > 0 THEN
    PERFORM public.adjust_chinese_stock(
      v_gas, v_size, 'empty_return', v_empty,
      COALESCE(NULLIF(trim(p_note), ''), 'Gyorscsere – kínai üres vissza')
    );
  END IF;

  v_note := format(
    'Kínai csere: %s %s · teli ki %s · üres vissza %s',
    v_gas, v_size, v_full, v_empty
  );
  IF p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN
    v_note := v_note || ' · ' || trim(p_note);
  END IF;

  INSERT INTO public.exchanges (
    partner_id,
    organization_id,
    incoming_cylinder_id,
    incoming_circulation,
    outgoing_cylinder_id,
    outgoing_circulation,
    incoming_exchange_circulation,
    outgoing_exchange_circulation,
    is_forced_substitution,
    note,
    created_by,
    operation_type,
    batch_id
  ) VALUES (
    p_partner_id,
    v_org,
    NULL,
    'own',
    NULL,
    'own',
    'chinese',
    'chinese',
    false,
    v_note,
    v_uid,
    'chinese_brought',
    p_batch_id
  )
  RETURNING id INTO v_exchange_id;

  RETURN v_exchange_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_chinese_quantity_exchange(uuid, text, text, integer, integer, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_chinese_quantity_exchange(uuid, text, text, integer, integer, uuid, text) TO authenticated;
