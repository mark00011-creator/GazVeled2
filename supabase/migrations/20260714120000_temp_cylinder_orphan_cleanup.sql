-- TEMP palack árva törlés: ellenőrzés, automatikus takarítás, egyszeri production cleanup

CREATE OR REPLACE FUNCTION public.is_temp_cylinder_barcode(p_barcode text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(coalesce(p_barcode, '')) = '' OR trim(p_barcode) ~* '^temp-';
$$;

CREATE OR REPLACE FUNCTION public.is_temp_cylinder_record(p_is_temporary boolean, p_barcode text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p_is_temporary, false) OR public.is_temp_cylinder_barcode(p_barcode);
$$;

CREATE OR REPLACE FUNCTION public.is_deletable_temp_cylinder(p_is_temporary boolean, p_barcode text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.is_temp_cylinder_barcode(p_barcode);
$$;

CREATE OR REPLACE FUNCTION public.temp_cylinder_blocking_reason(p_cylinder_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cyl public.cylinders%ROWTYPE;
BEGIN
  SELECT * INTO v_cyl FROM public.cylinders WHERE id = p_cylinder_id;
  IF NOT FOUND THEN
    RETURN 'nem található';
  END IF;

  IF NOT public.is_deletable_temp_cylinder(v_cyl.is_temporary, v_cyl.barcode) THEN
    RETURN 'nem TEMP palack (valódi sorszám)';
  END IF;

  IF v_cyl.location_partner_id IS NOT NULL THEN
    RETURN 'partnerhez rendelve';
  END IF;

  IF v_cyl.rental_id IS NOT NULL THEN
    RETURN 'aktív rental_id kapcsolat';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rental_cylinders rc
    WHERE rc.cylinder_id = p_cylinder_id AND rc.removed_at IS NULL
  ) THEN
    RETURN 'aktív bérleti kapcsolat (rental_cylinders)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rentals r
    WHERE r.status = 'active'
      AND (r.current_cylinder_id = p_cylinder_id OR r.original_cylinder_id = p_cylinder_id)
  ) THEN
    RETURN 'aktív bérlet current/original hivatkozás';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cylinder_loans cl
    WHERE cl.status = 'active'
      AND (cl.cylinder_id = p_cylinder_id OR cl.returned_cylinder_id = p_cylinder_id)
  ) THEN
    RETURN 'aktív kölcsön';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.try_delete_orphan_temp_cylinder(
  p_cylinder_id uuid,
  p_context text DEFAULT 'auto',
  p_user_id uuid DEFAULT auth.uid(),
  p_raise_on_block boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text;
  v_barcode text;
  v_action text;
BEGIN
  v_reason := public.temp_cylinder_blocking_reason(p_cylinder_id);
  IF v_reason IS NOT NULL THEN
    IF p_raise_on_block THEN
      RAISE EXCEPTION 'A TEMP palack nem törölhető, mert még aktív kapcsolata van. (%)', v_reason;
    END IF;
    RETURN false;
  END IF;

  SELECT barcode INTO v_barcode FROM public.cylinders WHERE id = p_cylinder_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.rentals
  SET
    current_cylinder_id = CASE WHEN current_cylinder_id = p_cylinder_id THEN NULL ELSE current_cylinder_id END,
    original_cylinder_id = CASE WHEN original_cylinder_id = p_cylinder_id THEN NULL ELSE original_cylinder_id END,
    updated_at = now()
  WHERE current_cylinder_id = p_cylinder_id OR original_cylinder_id = p_cylinder_id;

  DELETE FROM public.rental_cylinders
  WHERE cylinder_id = p_cylinder_id AND removed_at IS NOT NULL;

  UPDATE public.exchanges SET incoming_cylinder_id = NULL WHERE incoming_cylinder_id = p_cylinder_id;
  UPDATE public.exchanges SET outgoing_cylinder_id = NULL WHERE outgoing_cylinder_id = p_cylinder_id;

  DELETE FROM public.rental_reassignments
  WHERE old_cylinder_id = p_cylinder_id OR new_cylinder_id = p_cylinder_id;

  DELETE FROM public.cylinder_loans
  WHERE (cylinder_id = p_cylinder_id OR returned_cylinder_id = p_cylinder_id)
    AND status <> 'active';

  v_action := CASE p_context
    WHEN 'rental_return' THEN 'Árva TEMP palack automatikusan törölve bérleti visszavétel után.'
    WHEN 'temp_to_chinese' THEN 'Árva TEMP palack automatikusan törölve kínai átalakítás után.'
    WHEN 'temp_to_serial' THEN 'Árva TEMP palack automatikusan törölve sorszámra alakítás után.'
    WHEN 'orphan_cleanup' THEN 'Árva TEMP palack automatikusan törölve árva takarítás során.'
    ELSE 'Árva TEMP palack automatikusan törölve.'
  END;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    p_user_id,
    v_action,
    'cylinder',
    p_cylinder_id,
    jsonb_build_object('barcode', v_barcode, 'context', p_context)
  );

  DELETE FROM public.cylinders WHERE id = p_cylinder_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_temp_cylinder_barcode(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_temp_cylinder_record(boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_deletable_temp_cylinder(boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.temp_cylinder_blocking_reason(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.try_delete_orphan_temp_cylinder(uuid, text, uuid, boolean) TO authenticated;

-- TEMP → valódi sorszám (B): aktív hivatkozások átmozgatása, majd TEMP törlés
CREATE OR REPLACE FUNCTION public.migrate_temp_cylinder_refs(
  p_temp_cylinder_id uuid,
  p_real_cylinder_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_temp public.cylinders%ROWTYPE;
  v_real public.cylinders%ROWTYPE;
  v_rc public.rental_cylinders%ROWTYPE;
BEGIN
  IF p_temp_cylinder_id = p_real_cylinder_id THEN
    RAISE EXCEPTION 'A TEMP és a valódi palack nem lehet ugyanaz';
  END IF;

  SELECT * INTO v_temp FROM public.cylinders WHERE id = p_temp_cylinder_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEMP palack nem található';
  END IF;

  SELECT * INTO v_real FROM public.cylinders WHERE id = p_real_cylinder_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Valódi palack nem található';
  END IF;

  IF NOT public.is_deletable_temp_cylinder(v_temp.is_temporary, v_temp.barcode) THEN
    RAISE EXCEPTION 'Csak TEMP palack hivatkozásai mozgathatók át';
  END IF;

  IF public.is_deletable_temp_cylinder(v_real.is_temporary, v_real.barcode) THEN
    RAISE EXCEPTION 'A cél palack nem lehet TEMP';
  END IF;

  FOR v_rc IN
    SELECT * FROM public.rental_cylinders
    WHERE cylinder_id = p_temp_cylinder_id AND removed_at IS NULL
  LOOP
    INSERT INTO public.rental_cylinders (
      rental_id, cylinder_id, added_at, removed_at,
      expiry_date, rental_start_date, rental_end_date, rental_deposit
    )
    SELECT
      v_rc.rental_id, p_real_cylinder_id, v_rc.added_at, v_rc.removed_at,
      v_rc.expiry_date, v_rc.rental_start_date, v_rc.rental_end_date, v_rc.rental_deposit
    ON CONFLICT (rental_id, cylinder_id) DO NOTHING;

    UPDATE public.rental_cylinders
    SET removed_at = now(), rental_end_date = coalesce(rental_end_date, current_date)
    WHERE rental_id = v_rc.rental_id AND cylinder_id = p_temp_cylinder_id AND removed_at IS NULL;
  END LOOP;

  UPDATE public.rentals
  SET
    current_cylinder_id = CASE WHEN current_cylinder_id = p_temp_cylinder_id THEN p_real_cylinder_id ELSE current_cylinder_id END,
    original_cylinder_id = CASE WHEN original_cylinder_id = p_temp_cylinder_id THEN p_real_cylinder_id ELSE original_cylinder_id END,
    updated_at = now()
  WHERE current_cylinder_id = p_temp_cylinder_id OR original_cylinder_id = p_temp_cylinder_id;

  IF v_temp.rental_id IS NOT NULL THEN
    UPDATE public.cylinders
    SET rental_id = v_temp.rental_id, updated_at = now()
    WHERE id = p_real_cylinder_id;
  END IF;

  UPDATE public.cylinders
  SET rental_id = NULL, updated_at = now()
  WHERE id = p_temp_cylinder_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.migrate_temp_cylinder_refs(uuid, uuid) TO authenticated;

-- Dry-run: törölhető / nem törölhető TEMP palackok listája
CREATE OR REPLACE FUNCTION public.list_orphan_temp_cylinders(p_include_blocked boolean DEFAULT true)
RETURNS TABLE(
  cylinder_id uuid,
  barcode text,
  gas_type text,
  size text,
  deletable boolean,
  blocking_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.barcode,
    c.gas_type,
    c.size,
    public.temp_cylinder_blocking_reason(c.id) IS NULL AS deletable,
    public.temp_cylinder_blocking_reason(c.id) AS blocking_reason
  FROM public.cylinders c
  WHERE public.is_deletable_temp_cylinder(c.is_temporary, c.barcode)
    AND (p_include_blocked OR public.temp_cylinder_blocking_reason(c.id) IS NULL)
  ORDER BY c.barcode;
$$;

GRANT EXECUTE ON FUNCTION public.list_orphan_temp_cylinders(boolean) TO authenticated;

-- Dry-run SQL (manuális ellenőrzéshez):
-- SELECT * FROM public.list_orphan_temp_cylinders(true) WHERE deletable;
-- SELECT * FROM public.list_orphan_temp_cylinders(true) WHERE NOT deletable;

-- Egyszeri árva TEMP takarítás (idempotens: csak törölhető rekordokra fut)
DO $$
DECLARE
  r record;
  v_deleted int := 0;
BEGIN
  FOR r IN
    SELECT c.id
    FROM public.cylinders c
    WHERE public.is_deletable_temp_cylinder(c.is_temporary, c.barcode)
      AND public.temp_cylinder_blocking_reason(c.id) IS NULL
  LOOP
    IF public.try_delete_orphan_temp_cylinder(r.id, 'orphan_cleanup', NULL, false) THEN
      v_deleted := v_deleted + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'orphan_temp_cleanup_deleted=%', v_deleted;
END $$;
