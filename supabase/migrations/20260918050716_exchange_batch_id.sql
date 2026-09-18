-- Multi-pair gyors csere: közös batch_id a számlázási emlékeztető csoportosításához.

ALTER TABLE public.exchanges
  ADD COLUMN IF NOT EXISTS batch_id uuid;

CREATE INDEX IF NOT EXISTS idx_exchanges_batch_id
  ON public.exchanges (batch_id)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exchanges_uninvoiced_batch
  ON public.exchanges (invoiced, batch_id, created_at DESC)
  WHERE invoiced = false;

-- Régi aláírás eltávolítása, új p_batch_id paraméterrel.
DROP FUNCTION IF EXISTS public.record_exchange(uuid, uuid, uuid, text, text, uuid, boolean);

CREATE OR REPLACE FUNCTION public.record_exchange(
  p_partner_id uuid,
  p_incoming_id uuid,
  p_outgoing_id uuid,
  p_reason text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_rental_id uuid DEFAULT NULL,
  p_reassign_rental boolean DEFAULT false,
  p_batch_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in public.cylinders;
  v_out public.cylinders;
  v_uid uuid := auth.uid();
  v_forced boolean;
  v_in_key text;
  v_out_key text;
  v_exchange_id uuid;
  v_diff_id uuid;
BEGIN
  PERFORM public.require_exchange_access();
  SELECT * INTO v_in FROM public.cylinders WHERE id = p_incoming_id FOR UPDATE;
  SELECT * INTO v_out FROM public.cylinders WHERE id = p_outgoing_id FOR UPDATE;
  IF v_in.id IS NULL OR v_out.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;

  v_in_key := public.derive_exchange_circulation_key(v_in.circulation, v_in.manufacturer::text);
  v_out_key := public.derive_exchange_circulation_key(v_out.circulation, v_out.manufacturer::text);
  v_forced := v_in_key <> v_out_key OR v_in.gas_type <> v_out.gas_type;

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    incoming_exchange_circulation, outgoing_exchange_circulation,
    is_forced_substitution, reason, rental_reassigned, rental_id, note, created_by, operation_type, batch_id
  ) VALUES (
    p_partner_id, v_in.id, v_in.circulation, v_out.id, v_out.circulation,
    v_in_key, v_out_key,
    v_forced, NULLIF(trim(COALESCE(p_reason,'')), ''), COALESCE(p_reassign_rental,false), p_rental_id, p_note, v_uid, 'exchange', p_batch_id
  ) RETURNING id INTO v_exchange_id;

  INSERT INTO public.movements (cylinder_id, from_location, from_partner_id, to_location, status_after, note, created_by)
  VALUES (v_in.id, v_in.location_type, v_in.location_partner_id, 'warehouse_empty', 'empty', 'Gyors csere – üres beérkezett', v_uid);

  INSERT INTO public.movements (cylinder_id, from_location, to_location, to_partner_id, status_after, note, created_by)
  VALUES (v_out.id, v_out.location_type, 'customer', p_partner_id, 'full', 'Gyors csere – teli kiadva', v_uid);

  UPDATE public.cylinders SET status = 'empty', location_type = 'warehouse_empty', location_partner_id = NULL, location_supplier_id = NULL WHERE id = v_in.id;
  UPDATE public.cylinders SET status = 'full', location_type = 'customer', location_partner_id = p_partner_id, location_supplier_id = NULL WHERE id = v_out.id;

  IF p_reassign_rental AND p_rental_id IS NOT NULL THEN
    INSERT INTO public.rental_reassignments(rental_id, old_cylinder_id, new_cylinder_id, note, created_by)
    SELECT p_rental_id, current_cylinder_id, v_out.id, 'Gyors csere során', v_uid FROM public.rentals WHERE id = p_rental_id;
    UPDATE public.rentals SET current_cylinder_id = v_out.id, updated_at = now() WHERE id = p_rental_id;
  END IF;

  PERFORM public.settle_circulation_differences_for_exchange(
    p_partner_id, v_exchange_id,
    v_in_key, v_out_key, v_in.gas_type, v_out.gas_type, v_in.size, 1
  );

  IF v_forced THEN
    v_diff_id := public.create_circulation_difference(
      p_partner_id, v_exchange_id,
      v_in_key, v_out_key, v_in.gas_type, v_out.gas_type, v_in.size, 1, p_note
    );
  END IF;

  RETURN v_exchange_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_exchange(uuid, uuid, uuid, text, text, uuid, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_exchange(uuid, uuid, uuid, text, text, uuid, boolean, uuid) TO authenticated;

-- Egy batch összes számlázatlan cseréjének kiszámlázása.
CREATE OR REPLACE FUNCTION public.mark_exchange_batch_invoiced(p_batch_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM public.require_exchange_access();
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'Missing batch_id';
  END IF;

  UPDATE public.exchanges
  SET invoiced = true, invoiced_at = now()
  WHERE batch_id = p_batch_id
    AND invoiced = false;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_exchange_batch_invoiced(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_exchange_batch_invoiced(uuid) TO authenticated;
