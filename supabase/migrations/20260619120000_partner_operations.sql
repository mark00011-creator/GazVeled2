-- Partner művelettípusok: csere, eladás, üres visszavétel, kínai eladás

DO $$ BEGIN
  CREATE TYPE public.exchange_operation_type AS ENUM ('exchange', 'sale', 'empty_return', 'chinese_sale');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.exchanges
  ADD COLUMN IF NOT EXISTS operation_type public.exchange_operation_type NOT NULL DEFAULT 'exchange';

CREATE INDEX IF NOT EXISTS idx_exchanges_operation_type ON public.exchanges (operation_type, created_at DESC);

-- Csere: meglévő RPC frissítése operation_type-pal
CREATE OR REPLACE FUNCTION public.record_exchange(
  p_partner_id uuid,
  p_incoming_id uuid,
  p_outgoing_id uuid,
  p_reason text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_rental_id uuid DEFAULT NULL,
  p_reassign_rental boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_in public.cylinders;
  v_out public.cylinders;
  v_uid uuid := auth.uid();
  v_forced boolean;
  v_exchange_id uuid;
BEGIN
  SELECT * INTO v_in FROM public.cylinders WHERE id = p_incoming_id FOR UPDATE;
  SELECT * INTO v_out FROM public.cylinders WHERE id = p_outgoing_id FOR UPDATE;
  IF v_in.id IS NULL OR v_out.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;
  v_forced := v_in.circulation <> v_out.circulation;
  IF v_forced AND (p_reason IS NULL OR length(trim(p_reason)) = 0) THEN
    RAISE EXCEPTION 'Reason required for forced substitution';
  END IF;

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    is_forced_substitution, reason, rental_reassigned, rental_id, note, created_by, operation_type
  ) VALUES (
    p_partner_id, v_in.id, v_in.circulation, v_out.id, v_out.circulation,
    v_forced, NULLIF(trim(COALESCE(p_reason,'')), ''), COALESCE(p_reassign_rental,false), p_rental_id, p_note, v_uid, 'exchange'
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

  RETURN v_exchange_id;
END $$;

-- Eladás: csak kimenő teli palack
CREATE OR REPLACE FUNCTION public.record_partner_sale(
  p_partner_id uuid,
  p_outgoing_id uuid,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_out public.cylinders;
  v_uid uuid := auth.uid();
  v_exchange_id uuid;
BEGIN
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;
  SELECT * INTO v_out FROM public.cylinders WHERE id = p_outgoing_id FOR UPDATE;
  IF v_out.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;
  IF v_out.status <> 'full' THEN RAISE EXCEPTION 'A kiadott palacknak teli állapotúnak kell lennie'; END IF;

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    is_forced_substitution, note, created_by, operation_type
  ) VALUES (
    p_partner_id, NULL, v_out.circulation, v_out.id, v_out.circulation,
    false, p_note, v_uid, 'sale'
  ) RETURNING id INTO v_exchange_id;

  INSERT INTO public.movements (cylinder_id, from_location, to_location, to_partner_id, status_after, note, created_by)
  VALUES (v_out.id, v_out.location_type, 'customer', p_partner_id, 'full', 'Eladás – teli kiadva', v_uid);

  UPDATE public.cylinders
  SET status = 'full', location_type = 'customer', location_partner_id = p_partner_id, location_supplier_id = NULL
  WHERE id = v_out.id;

  RETURN v_exchange_id;
END $$;

-- Üres visszavétel: csak bejövő üres palack
CREATE OR REPLACE FUNCTION public.record_empty_return(
  p_partner_id uuid,
  p_incoming_id uuid,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_in public.cylinders;
  v_uid uuid := auth.uid();
  v_exchange_id uuid;
BEGIN
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;
  SELECT * INTO v_in FROM public.cylinders WHERE id = p_incoming_id FOR UPDATE;
  IF v_in.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;
  IF v_in.status <> 'empty' THEN RAISE EXCEPTION 'A visszavett palacknak üres állapotúnak kell lennie'; END IF;

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    is_forced_substitution, note, created_by, operation_type
  ) VALUES (
    p_partner_id, v_in.id, v_in.circulation, NULL, v_in.circulation,
    false, p_note, v_uid, 'empty_return'
  ) RETURNING id INTO v_exchange_id;

  INSERT INTO public.movements (cylinder_id, from_location, from_partner_id, to_location, status_after, note, created_by)
  VALUES (v_in.id, COALESCE(v_in.location_type, 'customer'), v_in.location_partner_id, 'warehouse_empty', 'empty', 'Üres visszavétel', v_uid);

  UPDATE public.cylinders
  SET status = 'empty', location_type = 'warehouse_empty', location_partner_id = NULL, location_supplier_id = NULL
  WHERE id = v_in.id;

  RETURN v_exchange_id;
END $$;

GRANT EXECUTE ON FUNCTION public.record_partner_sale(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_empty_return(uuid, uuid, text) TO authenticated;
