-- Bérleti számlázás és palack–bérlet kapcsolat
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS first_invoice_date DATE,
  ADD COLUMN IF NOT EXISTS next_invoice_date DATE,
  ADD COLUMN IF NOT EXISTS billing_cycle_months INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.cylinders
  ADD COLUMN IF NOT EXISTS rental_id UUID REFERENCES public.rentals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cylinders_rental_id_idx ON public.cylinders(rental_id);
CREATE INDEX IF NOT EXISTS rentals_next_invoice_idx ON public.rentals(next_invoice_date);
