-- Bérlet típus és lejárat
DO $$ BEGIN
  CREATE TYPE public.rental_type AS ENUM ('yearly', 'monthly', 'free');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS rental_type public.rental_type NOT NULL DEFAULT 'yearly',
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

CREATE INDEX IF NOT EXISTS rentals_expiry_date_idx ON public.rentals(expiry_date);
CREATE INDEX IF NOT EXISTS rentals_rental_type_idx ON public.rentals(rental_type);
