-- Nyomáspróba lejárati éve (csak év, opcionális)
ALTER TABLE public.cylinders
  ADD COLUMN IF NOT EXISTS pressure_test_year INTEGER;

ALTER TABLE public.cylinders
  DROP CONSTRAINT IF EXISTS cylinders_pressure_test_year_check;

ALTER TABLE public.cylinders
  ADD CONSTRAINT cylinders_pressure_test_year_check
  CHECK (pressure_test_year IS NULL OR (pressure_test_year >= 1900 AND pressure_test_year <= 2100));

COMMENT ON COLUMN public.cylinders.pressure_test_year IS 'Nyomáspróba lejárati éve (év); NULL ha nincs rögzítve.';
