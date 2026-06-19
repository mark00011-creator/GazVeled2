-- Bérleti szerződés V2 – csak hiányzó mezők (nincs duplikáció)

CREATE SEQUENCE IF NOT EXISTS public.rental_contract_number_seq START 1;

CREATE OR REPLACE FUNCTION public.next_rental_contract_number(p_start_date date)
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT to_char(p_start_date, 'YYYY') || '/B-' ||
         lpad(nextval('public.rental_contract_number_seq')::text, 4, '0');
$$;

GRANT EXECUTE ON FUNCTION public.next_rental_contract_number(date) TO authenticated;

ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS contract_number text,
  ADD COLUMN IF NOT EXISTS deposit_type text;

CREATE UNIQUE INDEX IF NOT EXISTS rentals_contract_number_uidx
  ON public.rentals (contract_number)
  WHERE contract_number IS NOT NULL;

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS birth_place text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS mother_name text,
  ADD COLUMN IF NOT EXISTS id_number text,
  ADD COLUMN IF NOT EXISTS address_card_number text;

ALTER TABLE public.cylinders
  ADD COLUMN IF NOT EXISTS factory_serial text,
  ADD COLUMN IF NOT EXISTS replacement_value integer NOT NULL DEFAULT 100000;
