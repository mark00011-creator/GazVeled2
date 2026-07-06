-- Kölcsönadott palackok: dedikált tábla + RPC-k

DO $$ BEGIN
  CREATE TYPE public.cylinder_loan_status AS ENUM ('active', 'returned');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.exchange_operation_type ADD VALUE 'loan';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.cylinder_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE RESTRICT,
  cylinder_id uuid NOT NULL REFERENCES public.cylinders(id) ON DELETE RESTRICT,
  returned_cylinder_id uuid NULL REFERENCES public.cylinders(id) ON DELETE SET NULL,
  exchange_id uuid NULL REFERENCES public.exchanges(id) ON DELETE SET NULL,
  loaned_at timestamptz NOT NULL DEFAULT now(),
  returned_at timestamptz NULL,
  status public.cylinder_loan_status NOT NULL DEFAULT 'active',
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  note text NULL,
  return_note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Partial unique: only one active loan per outgoing cylinder
CREATE UNIQUE INDEX IF NOT EXISTS idx_cylinder_loans_active_cylinder
  ON public.cylinder_loans (cylinder_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_cylinder_loans_partner_active
  ON public.cylinder_loans (partner_id, loaned_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_cylinder_loans_status
  ON public.cylinder_loans (status, loaned_at DESC);

DROP TRIGGER IF EXISTS trg_cylinder_loans_updated ON public.cylinder_loans;
CREATE TRIGGER trg_cylinder_loans_updated
  BEFORE UPDATE ON public.cylinder_loans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.cylinder_loans TO authenticated;
GRANT ALL ON public.cylinder_loans TO service_role;

ALTER TABLE public.cylinder_loans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cylinder_loans auth select" ON public.cylinder_loans;
CREATE POLICY "cylinder_loans auth select"
  ON public.cylinder_loans FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "cylinder_loans auth insert" ON public.cylinder_loans;
CREATE POLICY "cylinder_loans auth insert"
  ON public.cylinder_loans FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "cylinder_loans auth update" ON public.cylinder_loans;
CREATE POLICY "cylinder_loans auth update"
  ON public.cylinder_loans FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Kölcsön kiadás: 0 üres → 1 teli
CREATE OR REPLACE FUNCTION public.record_cylinder_loan(
  p_partner_id uuid,
  p_outgoing_id uuid,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_out public.cylinders;
  v_uid uuid := auth.uid();
  v_exchange_id uuid;
  v_loan_id uuid;
  v_rental_link uuid;
BEGIN
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;

  SELECT * INTO v_out FROM public.cylinders WHERE id = p_outgoing_id FOR UPDATE;
  IF v_out.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;
  IF v_out.status <> 'full' THEN RAISE EXCEPTION 'A kiadott palacknak teli állapotúnak kell lennie'; END IF;
  IF v_out.location_type <> 'warehouse_full' THEN
    RAISE EXCEPTION 'A kölcsön palacknak a telephelyi teli készletből kell jönnie';
  END IF;

  SELECT rc.rental_id INTO v_rental_link
  FROM public.rental_cylinders rc
  JOIN public.rentals r ON r.id = rc.rental_id
  WHERE rc.cylinder_id = p_outgoing_id
    AND rc.removed_at IS NULL
    AND r.status = 'active'
  LIMIT 1;
  IF v_rental_link IS NOT NULL THEN
    RAISE EXCEPTION 'A palack aktív bérletben van';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cylinder_loans
    WHERE cylinder_id = p_outgoing_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'A palack már kölcsönadott';
  END IF;

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    is_forced_substitution, note, created_by, operation_type
  ) VALUES (
    p_partner_id, NULL, v_out.circulation, v_out.id, v_out.circulation,
    false, COALESCE(NULLIF(trim(p_note), ''), 'Kölcsön'), v_uid, 'loan'
  ) RETURNING id INTO v_exchange_id;

  INSERT INTO public.cylinder_loans (
    partner_id, cylinder_id, exchange_id, note, created_by
  ) VALUES (
    p_partner_id, v_out.id, v_exchange_id, p_note, v_uid
  ) RETURNING id INTO v_loan_id;

  INSERT INTO public.movements (cylinder_id, from_location, to_location, to_partner_id, status_after, note, created_by)
  VALUES (v_out.id, v_out.location_type, 'customer', p_partner_id, 'full', 'Kölcsön – teli kiadva', v_uid);

  UPDATE public.cylinders
  SET status = 'full', location_type = 'customer', location_partner_id = p_partner_id, location_supplier_id = NULL
  WHERE id = v_out.id;

  RETURN v_loan_id;
END $$;

-- Kölcsön visszavétel (a visszahozott palack vonalkódja eltérhet)
CREATE OR REPLACE FUNCTION public.return_cylinder_loan(
  p_loan_id uuid,
  p_returned_cylinder_id uuid,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_loan public.cylinder_loans;
  v_loaned public.cylinders;
  v_returned public.cylinders;
  v_uid uuid := auth.uid();
  v_wh_loc public.location_type;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_loan FROM public.cylinder_loans WHERE id = p_loan_id FOR UPDATE;
  IF v_loan.id IS NULL THEN RAISE EXCEPTION 'Kölcsön rekord nem található'; END IF;
  IF v_loan.status <> 'active' THEN RAISE EXCEPTION 'A kölcsön már le van zárva'; END IF;

  SELECT * INTO v_loaned FROM public.cylinders WHERE id = v_loan.cylinder_id FOR UPDATE;
  SELECT * INTO v_returned FROM public.cylinders WHERE id = p_returned_cylinder_id FOR UPDATE;
  IF v_returned.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;

  v_wh_loc := CASE WHEN v_returned.status = 'full' THEN 'warehouse_full'::public.location_type
                   ELSE 'warehouse_empty'::public.location_type END;

  INSERT INTO public.movements (
    cylinder_id, from_location, from_partner_id, to_location, status_after, note, created_by
  ) VALUES (
    v_returned.id,
    COALESCE(v_returned.location_type, 'customer'),
    v_returned.location_partner_id,
    v_wh_loc,
    v_returned.status,
    CASE
      WHEN v_returned.id = v_loan.cylinder_id THEN 'Kölcsön visszavéve'
      ELSE 'Kölcsön visszavéve (helyettesítő palack)'
    END,
    v_uid
  );

  UPDATE public.cylinders
  SET location_type = v_wh_loc,
      location_partner_id = NULL,
      location_supplier_id = NULL
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

  UPDATE public.cylinder_loans
  SET status = 'returned',
      returned_at = v_now,
      returned_cylinder_id = v_returned.id,
      return_note = p_note,
      updated_at = v_now
  WHERE id = p_loan_id;
END $$;

GRANT EXECUTE ON FUNCTION public.record_cylinder_loan(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_cylinder_loan(uuid, uuid, text) TO authenticated;
