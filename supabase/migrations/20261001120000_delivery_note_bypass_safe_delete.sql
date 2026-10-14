-- Delivery note finalize: safe DELETE in bypass helpers
-- Root cause: DELETE FROM _delivery_note_bypass without WHERE
--   → PostgREST/safe-delete style AbsoluteEmptyFilters (code 21000)
-- Production apply: TILOS ebben a körben (csak staging/local)
-- Project: snmiwsgtnokvqlnwvfwf

CREATE OR REPLACE FUNCTION public.delivery_note_enter_bypass()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _delivery_note_bypass (enabled boolean NOT NULL);
  DELETE FROM _delivery_note_bypass WHERE TRUE;
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
    DELETE FROM _delivery_note_bypass WHERE TRUE;
  EXCEPTION
    WHEN undefined_table THEN
      NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.delivery_note_enter_bypass() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delivery_note_enter_bypass() FROM authenticated;
REVOKE ALL ON FUNCTION public.delivery_note_enter_bypass() FROM anon;
REVOKE ALL ON FUNCTION public.delivery_note_exit_bypass() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delivery_note_exit_bypass() FROM authenticated;
REVOKE ALL ON FUNCTION public.delivery_note_exit_bypass() FROM anon;
