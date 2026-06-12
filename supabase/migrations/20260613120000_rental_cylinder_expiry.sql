-- Palack szintű bérlet lejárat
ALTER TABLE public.rental_cylinders
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

UPDATE public.rentals
SET expiry_date = (start_date::date + interval '1 year')::date
WHERE expiry_date IS NULL AND start_date IS NOT NULL;

UPDATE public.rental_cylinders rc
SET expiry_date = COALESCE(
  r.expiry_date,
  (r.start_date::date + interval '1 year')::date,
  (rc.added_at::date + interval '1 year')::date
)
FROM public.rentals r
WHERE rc.rental_id = r.id
  AND rc.expiry_date IS NULL
  AND rc.removed_at IS NULL;

CREATE INDEX IF NOT EXISTS rental_cylinders_expiry_idx ON public.rental_cylinders(expiry_date);
