-- Per-cylinder rental period and deposit (Excel import can differ within one partner rental)
ALTER TABLE public.rental_cylinders
  ADD COLUMN IF NOT EXISTS rental_start_date DATE,
  ADD COLUMN IF NOT EXISTS rental_end_date DATE,
  ADD COLUMN IF NOT EXISTS rental_deposit NUMERIC(12,2);

-- Backfill from partner-level rental for existing / migrated rows (re-import can overwrite per cylinder later)
UPDATE public.rental_cylinders rc
SET
  rental_start_date = COALESCE(rc.rental_start_date, r.start_date::date, rc.added_at::date),
  rental_end_date = COALESCE(rc.rental_end_date, r.end_date::date),
  rental_deposit = COALESCE(rc.rental_deposit, r.deposit)
FROM public.rentals r
WHERE rc.rental_id = r.id
  AND (
    rc.rental_start_date IS NULL
    OR rc.rental_end_date IS NULL
    OR rc.rental_deposit IS NULL
  );

CREATE INDEX IF NOT EXISTS rental_cylinders_rental_start_idx ON public.rental_cylinders(rental_start_date);
CREATE INDEX IF NOT EXISTS rental_cylinders_rental_end_idx ON public.rental_cylinders(rental_end_date);
