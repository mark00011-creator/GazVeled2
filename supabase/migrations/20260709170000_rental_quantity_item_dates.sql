-- Darabszámos bérleti tételek saját kezdő / lejárati dátuma

ALTER TABLE public.rental_quantity_items
  ADD COLUMN IF NOT EXISTS rental_start_date date,
  ADD COLUMN IF NOT EXISTS expiry_date date;

UPDATE public.rental_quantity_items rqi
SET
  rental_start_date = COALESCE(rqi.rental_start_date, r.start_date, rqi.added_at::date),
  expiry_date = COALESCE(
    rqi.expiry_date,
    (COALESCE(rqi.rental_start_date, r.start_date, rqi.added_at::date) + interval '1 year')::date
  )
FROM public.rentals r
WHERE r.id = rqi.rental_id;
