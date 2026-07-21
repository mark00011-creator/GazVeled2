-- Kölcsön visszavétel: üres / teli mód; teli visszavételnél a kölcsön exchange nem számlázandó

CREATE OR REPLACE FUNCTION public.return_cylinder_loan(
  p_loan_id uuid,
  p_returned_cylinder_id uuid,
  p_note text DEFAULT NULL,
  p_return_mode text DEFAULT 'empty'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_loan public.cylinder_loans;
  v_loaned public.cylinders;
  v_returned public.cylinders;
  v_uid uuid := auth.uid();
  v_wh_loc public.location_type;
  v_target_status public.cylinder_status;
  v_now timestamptz := now();
  v_mode text := lower(trim(coalesce(p_return_mode, 'empty')));
  v_move_note text;
BEGIN
  IF v_mode NOT IN ('empty', 'full') THEN
    RAISE EXCEPTION 'Érvénytelen visszavételi mód (empty vagy full)';
  END IF;

  SELECT * INTO v_loan FROM public.cylinder_loans WHERE id = p_loan_id FOR UPDATE;
  IF v_loan.id IS NULL THEN RAISE EXCEPTION 'Kölcsön rekord nem található'; END IF;
  IF v_loan.status <> 'active' THEN RAISE EXCEPTION 'A kölcsön már le van zárva'; END IF;

  SELECT * INTO v_loaned FROM public.cylinders WHERE id = v_loan.cylinder_id FOR UPDATE;
  SELECT * INTO v_returned FROM public.cylinders WHERE id = p_returned_cylinder_id FOR UPDATE;
  IF v_returned.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;

  IF v_mode = 'full' THEN
    v_target_status := 'full';
    v_wh_loc := 'warehouse_full'::public.location_type;
    v_move_note := CASE
      WHEN v_returned.id = v_loan.cylinder_id THEN 'Kölcsön visszavéve – teli palack'
      ELSE 'Kölcsön visszavéve – teli helyettesítő palack'
    END;
  ELSE
    v_target_status := 'empty';
    v_wh_loc := 'warehouse_empty'::public.location_type;
    v_move_note := CASE
      WHEN v_returned.id = v_loan.cylinder_id THEN 'Kölcsön visszavéve – üres palack'
      ELSE 'Kölcsön visszavéve – üres helyettesítő palack'
    END;
  END IF;

  INSERT INTO public.movements (
    cylinder_id, from_location, from_partner_id, to_location, status_after, note, created_by
  ) VALUES (
    v_returned.id,
    COALESCE(v_returned.location_type, 'customer'),
    v_returned.location_partner_id,
    v_wh_loc,
    v_target_status,
    v_move_note,
    v_uid
  );

  UPDATE public.cylinders
  SET location_type = v_wh_loc,
      location_partner_id = NULL,
      location_supplier_id = NULL,
      status = v_target_status
  WHERE id = v_returned.id;

  IF v_returned.id <> v_loan.cylinder_id
     AND v_loaned.location_partner_id = v_loan.partner_id THEN
    INSERT INTO public.movements (
      cylinder_id, from_location, from_partner_id, to_location, status_after, note, created_by
    ) VALUES (
      v_loaned.id,
      v_loaned.location_type,
      v_loaned.location_partner_id,
      v_loaned.location_type,
      v_loaned.status,
      'Kölcsön lezárva más palackkal – eredeti palack partner kapcsolat törölve',
      v_uid
    );

    UPDATE public.cylinders
    SET location_partner_id = NULL
    WHERE id = v_loaned.id;
  END IF;

  IF v_mode = 'full' AND v_loan.exchange_id IS NOT NULL THEN
    UPDATE public.exchanges
    SET invoiced = true,
        invoiced_at = COALESCE(invoiced_at, v_now),
        profit = NULL,
        note = trim(both E'\n' FROM concat(
          coalesce(note, ''),
          CASE WHEN coalesce(note, '') = '' THEN '' ELSE E'\n' END,
          'Kölcsön teli visszavétel – nem számlázandó gázcsere'
        ))
    WHERE id = v_loan.exchange_id;
  END IF;

  UPDATE public.cylinder_loans
  SET status = 'returned',
      returned_at = v_now,
      returned_cylinder_id = v_returned.id,
      return_note = p_note,
      updated_at = v_now
  WHERE id = p_loan_id;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_uid,
    CASE WHEN v_mode = 'full' THEN 'Kölcsön teli visszavéve' ELSE 'Kölcsön üres visszavéve' END,
    'cylinder_loan',
    p_loan_id,
    jsonb_build_object(
      'return_mode', v_mode,
      'returned_cylinder_id', v_returned.id,
      'loaned_cylinder_id', v_loan.cylinder_id,
      'partner_id', v_loan.partner_id,
      'exchange_id', v_loan.exchange_id
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.return_cylinder_loan(uuid, uuid, text, text) TO authenticated;
