-- Palack gyártó mező (tulajdonos / circulation változatlan marad)

DO $$ BEGIN
  CREATE TYPE public.cylinder_manufacturer AS ENUM ('siad', 'messer', 'linde', 'chinese', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.cylinders
  ADD COLUMN IF NOT EXISTS manufacturer public.cylinder_manufacturer;

UPDATE public.cylinders
SET manufacturer = 'siad'
WHERE manufacturer IS NULL AND circulation = 'siad';

UPDATE public.cylinders
SET manufacturer = 'other'
WHERE manufacturer IS NULL;

ALTER TABLE public.cylinders
  ALTER COLUMN manufacturer SET DEFAULT 'other';

ALTER TABLE public.cylinders
  ALTER COLUMN manufacturer SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cylinders_manufacturer ON public.cylinders (manufacturer);
