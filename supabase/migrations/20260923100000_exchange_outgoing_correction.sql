-- Csere kiadás korrekció + éves bérleti díj számlázási emlékeztető
-- Production: snmiwsgtnokvqlnwvfwf

-- ---------------------------------------------------------------------------
-- 1) correct_exchange_outgoing – tévesen kiadott teli palack cseréje
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_exchange_outgoing(
  p_exchange_id uuid,
  p_new_outgoing_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.require_active_organization();
  v_uid uuid := auth.uid();
  v_ex public.exchanges;
  v_old public.cylinders;
  v_new public.cylinders;
  v_buy numeric;
  v_sell numeric;
BEGIN
  PERFORM public.require_exchange_access();
  IF p_exchange_id IS NULL OR p_new_outgoing_id IS NULL THEN
    RAISE EXCEPTION 'Hiányzó paraméter';
  END IF;

  SELECT * INTO v_ex FROM public.exchanges
  WHERE id = p_exchange_id AND organization_id = v_org
  FOR UPDATE;
  IF v_ex.id IS NULL THEN RAISE EXCEPTION 'Csere nem található'; END IF;
  IF v_ex.invoiced THEN
    RAISE EXCEPTION 'Már számlázott cserét nem lehet így javítani';
  END IF;
  IF v_ex.outgoing_cylinder_id IS NULL THEN
    RAISE EXCEPTION 'Nincs kiadott palack a cserén';
  END IF;
  IF v_ex.outgoing_cylinder_id = p_new_outgoing_id THEN
    RAISE EXCEPTION 'A helyes palack már a cserén van';
  END IF;

  SELECT * INTO v_old FROM public.cylinders
  WHERE id = v_ex.outgoing_cylinder_id AND organization_id = v_org
  FOR UPDATE;
  SELECT * INTO v_new FROM public.cylinders
  WHERE id = p_new_outgoing_id AND organization_id = v_org
  FOR UPDATE;
  IF v_old.id IS NULL OR v_new.id IS NULL THEN
    RAISE EXCEPTION 'Palack nem található';
  END IF;

  IF v_old.location_type IS DISTINCT FROM 'customer'
     OR v_old.location_partner_id IS DISTINCT FROM v_ex.partner_id THEN
    RAISE EXCEPTION 'A téves palack nincs a partnernél (állapot megváltozott)';
  END IF;
  IF v_new.location_type IS DISTINCT FROM 'warehouse_full' OR v_new.status IS DISTINCT FROM 'full' THEN
    RAISE EXCEPTION 'A helyes palacknak teli kalodában, teli státusszal kell lennie';
  END IF;

  SELECT beszerzesi_ar, eladasi_ar INTO v_buy, v_sell
  FROM public.product_prices
  WHERE organization_id = v_org
    AND active
    AND lower(gas_type) = lower(v_new.gas_type)
    AND size = v_new.size
  LIMIT 1;

  UPDATE public.exchanges SET
    outgoing_cylinder_id = v_new.id,
    outgoing_circulation = COALESCE(v_new.circulation, outgoing_circulation),
    outgoing_exchange_circulation = COALESCE(v_new.manufacturer::text, outgoing_exchange_circulation),
    is_forced_substitution = CASE
      WHEN v_ex.incoming_cylinder_id IS NULL THEN is_forced_substitution
      ELSE EXISTS (
        SELECT 1 FROM public.cylinders inc
        WHERE inc.id = v_ex.incoming_cylinder_id
          AND lower(inc.gas_type) IS DISTINCT FROM lower(v_new.gas_type)
      )
    END,
    beszerzesi_ar = COALESCE(v_buy, beszerzesi_ar),
    eladasi_ar = COALESCE(v_sell, eladasi_ar),
    profit = CASE
      WHEN v_buy IS NOT NULL AND v_sell IS NOT NULL THEN v_sell - v_buy
      ELSE profit
    END,
    note = trim(both E'\n' FROM concat(
      coalesce(note, ''),
      CASE WHEN coalesce(note, '') = '' THEN '' ELSE E'\n' END,
      'Korrekció: téves kiadás ', v_old.barcode, ' → ', v_new.barcode
    ))
  WHERE id = v_ex.id AND organization_id = v_org;

  INSERT INTO public.movements (
    cylinder_id, from_location, from_partner_id, to_location, to_partner_id,
    status_after, note, created_by, organization_id
  ) VALUES (
    v_old.id, 'customer', v_ex.partner_id, 'warehouse_full', NULL,
    'full', 'Csere korrekció – tévesen kiadott palack visszavéve teli kalodába', v_uid, v_org
  );

  UPDATE public.cylinders SET
    location_type = 'warehouse_full',
    location_partner_id = NULL,
    location_supplier_id = NULL,
    status = 'full'
  WHERE id = v_old.id AND organization_id = v_org;

  INSERT INTO public.movements (
    cylinder_id, from_location, from_partner_id, to_location, to_partner_id,
    status_after, note, created_by, organization_id
  ) VALUES (
    v_new.id, 'warehouse_full', NULL, 'customer', v_ex.partner_id,
    'full', 'Csere korrekció – helyes teli palack kiadva partnernek', v_uid, v_org
  );

  UPDATE public.cylinders SET
    location_type = 'customer',
    location_partner_id = v_ex.partner_id,
    location_supplier_id = NULL,
    status = 'full'
  WHERE id = v_new.id AND organization_id = v_org;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, old_value, new_value, organization_id)
  VALUES (
    v_uid,
    'Csere kiadás korrekció',
    'exchange',
    v_ex.id,
    jsonb_build_object(
      'outgoing_id', v_old.id, 'barcode', v_old.barcode,
      'gas_type', v_old.gas_type, 'manufacturer', v_old.manufacturer
    ),
    jsonb_build_object(
      'outgoing_id', v_new.id, 'barcode', v_new.barcode,
      'gas_type', v_new.gas_type, 'manufacturer', v_new.manufacturer,
      'beszerzesi_ar', v_buy, 'eladasi_ar', v_sell
    ),
    v_org
  );
END;
$$;

REVOKE ALL ON FUNCTION public.correct_exchange_outgoing(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_exchange_outgoing(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Bérleti díj első számlázás jelző
-- ---------------------------------------------------------------------------
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS initial_fee_invoiced boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.rentals.initial_fee_invoiced IS
  'True, ha a bérlet induló (éves/havi) díját már számlázták / rögzítették.';

-- Meglévő bérletek: ne jelenjenek meg tömegesen (audit trigger bypass)
ALTER TABLE public.rentals DISABLE TRIGGER trg_audit_rentals;
UPDATE public.rentals SET initial_fee_invoiced = true WHERE TRUE;
UPDATE public.rentals
SET initial_fee_invoiced = false
WHERE id = 'e6770478-e171-4259-88f5-621f8bb30edd'
  AND organization_id = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE public.rentals ENABLE TRIGGER trg_audit_rentals;

CREATE OR REPLACE FUNCTION public.mark_rental_initial_fee_invoiced(p_rental_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.require_active_organization();
BEGIN
  PERFORM public.require_exchange_access();
  UPDATE public.rentals
  SET initial_fee_invoiced = true,
      updated_at = now()
  WHERE id = p_rental_id
    AND organization_id = v_org
    AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bérlet nem található';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_rental_initial_fee_invoiced(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_rental_initial_fee_invoiced(uuid) TO authenticated;
