-- Corrective: delivery note bypass must not be client-settable via GUC
-- LIVE DB proof: SET ROLE authenticated; set_config('app.delivery_note_bypass','1',true)
--   → delivery_note_bypass_enabled() returned true (HIGH)
-- DO NOT apply to production without explicit approval.
-- Project: GazVeled2 validation / later prod

CREATE OR REPLACE FUNCTION public.delivery_note_enter_bypass()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _delivery_note_bypass (enabled boolean NOT NULL);
  DELETE FROM _delivery_note_bypass;
  INSERT INTO _delivery_note_bypass(enabled) VALUES (true);
END;
$$;

CREATE OR REPLACE FUNCTION public.delivery_note_exit_bypass()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    DELETE FROM _delivery_note_bypass;
  EXCEPTION
    WHEN undefined_table THEN
      NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.delivery_note_bypass_enabled()
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM _delivery_note_bypass WHERE enabled);
EXCEPTION
  WHEN undefined_table THEN
    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.delivery_note_enter_bypass() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delivery_note_enter_bypass() FROM authenticated;
REVOKE ALL ON FUNCTION public.delivery_note_enter_bypass() FROM anon;
REVOKE ALL ON FUNCTION public.delivery_note_exit_bypass() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delivery_note_exit_bypass() FROM authenticated;
REVOKE ALL ON FUNCTION public.delivery_note_exit_bypass() FROM anon;

-- Rewrite finalize/cancel/attach to use enter/exit bypass (not client GUC)

CREATE OR REPLACE FUNCTION public.finalize_delivery_note(p_delivery_note_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note public.delivery_notes%ROWTYPE;
  v_docnum text;
  v_updated integer;
  v_payload jsonb;
  v_item_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_exchange() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Insufficient privilege' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_note
  FROM public.delivery_notes
  WHERE id = p_delivery_note_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Szállítólevél nem található' USING ERRCODE = 'P0001';
  END IF;
  IF v_note.organization_id IS DISTINCT FROM public.auth_organization_id()
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Organization mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_note.status = 'finalized' THEN
    RAISE EXCEPTION 'A szállítólevél már véglegesítve van' USING ERRCODE = 'P0001';
  END IF;
  IF v_note.status = 'cancelled' THEN
    RAISE EXCEPTION 'Érvénytelenített szállítólevél nem véglegesíthető' USING ERRCODE = 'P0001';
  END IF;
  IF v_note.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Csak piszkozat véglegesíthető (status=%)', v_note.status USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.delivery_note_items
  WHERE delivery_note_id = p_delivery_note_id
  FOR UPDATE;

  SELECT count(*)::integer INTO v_item_count
  FROM public.delivery_note_items
  WHERE delivery_note_id = p_delivery_note_id;
  IF v_item_count IS NULL OR v_item_count < 1 THEN
    RAISE EXCEPTION 'Szállítólevélnek legalább egy tétele kell' USING ERRCODE = 'P0001';
  END IF;

  v_payload := public.build_delivery_note_finalize_snapshots(p_delivery_note_id);
  v_docnum := public.allocate_delivery_note_number(v_note.organization_id, EXTRACT(YEAR FROM now())::integer);

  PERFORM public.delivery_note_enter_bypass();
  BEGIN
    UPDATE public.delivery_notes
    SET
      status = 'finalized',
      document_number = v_docnum,
      issued_at = now(),
      finalized_at = now(),
      finalized_by = auth.uid(),
      adr_snapshot = v_payload->'adr_snapshot',
      business_snapshot = v_payload->'business_snapshot',
      adr_total_points = (v_payload->>'adr_total_points')::numeric,
      adr_within_116 = (v_payload->>'adr_within_116')::boolean,
      adr_ruleset_version = COALESCE(v_payload->>'adr_ruleset_version', adr_ruleset_version),
      pdf_base64 = NULL,
      updated_at = now()
    WHERE id = p_delivery_note_id
      AND status = 'draft';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'Finalize sikertelen: frissített sorok száma (%)', v_updated
        USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.delivery_note_exit_bypass();
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.delivery_note_exit_bypass();
    RAISE;
  END;

  SELECT * INTO v_note FROM public.delivery_notes WHERE id = p_delivery_note_id;

  RETURN jsonb_build_object(
    'id', v_note.id,
    'document_number', v_note.document_number,
    'status', v_note.status,
    'issued_at', v_note.issued_at,
    'finalized_at', v_note.finalized_at,
    'finalized_by', v_note.finalized_by,
    'adr_snapshot', v_note.adr_snapshot,
    'business_snapshot', v_note.business_snapshot,
    'adr_total_points', v_note.adr_total_points,
    'adr_within_116', v_note.adr_within_116,
    'adr_ruleset_version', v_note.adr_ruleset_version,
    'shipper_name', v_note.shipper_name,
    'shipper_address', v_note.shipper_address,
    'consignee_name', v_note.consignee_name,
    'consignee_address', v_note.consignee_address,
    'delivery_address', v_note.delivery_address,
    'vehicle_plate', v_note.vehicle_plate,
    'driver_name', v_note.driver_name,
    'cancellation_reason', v_note.cancellation_reason,
    'pdf_attached', (v_note.pdf_base64 IS NOT NULL),
    'authority', 'server'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_delivery_note(
  p_note_id uuid,
  p_reason text,
  p_pdf_base64 text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note public.delivery_notes%ROWTYPE;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_exchange() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Insufficient privilege' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Az érvénytelenítés indoka kötelező' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_note
  FROM public.delivery_notes
  WHERE id = p_note_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Szállítólevél nem található' USING ERRCODE = 'P0001';
  END IF;
  IF v_note.organization_id IS DISTINCT FROM public.auth_organization_id()
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Organization mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_note.status = 'cancelled' THEN
    RAISE EXCEPTION 'A szállítólevél már érvénytelenítve van' USING ERRCODE = 'P0001';
  END IF;
  IF v_note.status IS DISTINCT FROM 'finalized' THEN
    RAISE EXCEPTION 'Csak véglegesített szállítólevél érvényteleníthető' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.delivery_note_enter_bypass();
  BEGIN
    UPDATE public.delivery_notes
    SET
      status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancellation_reason = trim(p_reason),
      pdf_base64 = COALESCE(p_pdf_base64, pdf_base64),
      updated_at = now()
    WHERE id = p_note_id
      AND status = 'finalized';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'Cancel sikertelen: frissített sorok száma (%)', v_updated
        USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.delivery_note_exit_bypass();
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.delivery_note_exit_bypass();
    RAISE;
  END;

  SELECT * INTO v_note FROM public.delivery_notes WHERE id = p_note_id;

  RETURN jsonb_build_object(
    'id', v_note.id,
    'document_number', v_note.document_number,
    'status', v_note.status,
    'cancelled_at', v_note.cancelled_at,
    'cancellation_reason', v_note.cancellation_reason,
    'adr_snapshot', v_note.adr_snapshot,
    'business_snapshot', v_note.business_snapshot
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_delivery_note_pdf(
  p_note_id uuid,
  p_pdf_base64 text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note public.delivery_notes%ROWTYPE;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_exchange() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Insufficient privilege' USING ERRCODE = '42501';
  END IF;
  IF p_pdf_base64 IS NULL OR length(p_pdf_base64) = 0 THEN
    RAISE EXCEPTION 'PDF tartalom kötelező' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_note
  FROM public.delivery_notes
  WHERE id = p_note_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Szállítólevél nem található' USING ERRCODE = 'P0001';
  END IF;
  IF v_note.organization_id IS DISTINCT FROM public.auth_organization_id()
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Organization mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_note.status NOT IN ('finalized', 'cancelled') THEN
    RAISE EXCEPTION 'PDF csak véglegesített/érvénytelenített bizonylathoz csatolható' USING ERRCODE = 'P0001';
  END IF;
  IF v_note.pdf_base64 IS NOT NULL THEN
    RETURN true;
  END IF;

  PERFORM public.delivery_note_enter_bypass();
  BEGIN
    UPDATE public.delivery_notes
    SET pdf_base64 = p_pdf_base64, updated_at = now()
    WHERE id = p_note_id
      AND pdf_base64 IS NULL
      AND status IN ('finalized', 'cancelled');

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'PDF csatolás sikertelen (rowcount=%)', v_updated USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.delivery_note_exit_bypass();
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.delivery_note_exit_bypass();
    RAISE;
  END;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_delivery_note(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_delivery_note(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_delivery_note(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_delivery_note(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.attach_delivery_note_pdf(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attach_delivery_note_pdf(uuid, text) TO authenticated;
