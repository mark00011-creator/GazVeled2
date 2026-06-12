-- TEMP-xxxxxx prefix for ideiglenes vonalkódok
CREATE OR REPLACE FUNCTION public.next_temp_barcode()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT 'TEMP-' || lpad(nextval('public.temp_cylinder_seq')::text, 6, '0'); $$;
