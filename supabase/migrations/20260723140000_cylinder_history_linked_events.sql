-- Kapcsolódó események: csoportosítás és kereszthivatkozások (visszafelé kompatibilis)

ALTER TABLE public.cylinder_history
  ADD COLUMN IF NOT EXISTS event_group_id uuid,
  ADD COLUMN IF NOT EXISTS related_cylinder_id uuid REFERENCES public.cylinders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_exchange_id uuid,
  ADD COLUMN IF NOT EXISTS related_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cylinder_history_event_group
  ON public.cylinder_history (event_group_id)
  WHERE event_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cylinder_history_related_cylinder
  ON public.cylinder_history (related_cylinder_id)
  WHERE related_cylinder_id IS NOT NULL;

COMMENT ON COLUMN public.cylinder_history.event_group_id IS 'Logikai eseménycsoport – több palack / objektum ugyanahhoz a művelethez.';
COMMENT ON COLUMN public.cylinder_history.related_cylinder_id IS 'Párban lévő vagy cserélt másik palack.';
COMMENT ON COLUMN public.cylinder_history.related_rental_id IS 'Kapcsolódó bérlet.';
COMMENT ON COLUMN public.cylinder_history.related_partner_id IS 'Kapcsolódó partner (üzleti hivatkozás).';
COMMENT ON COLUMN public.cylinder_history.related_exchange_id IS 'Kapcsolódó csere / szolgáltatói csere rekord (exchanges vagy supplier_exchanges id).';
COMMENT ON COLUMN public.cylinder_history.related_supplier_id IS 'Kapcsolódó szolgáltató.';
COMMENT ON COLUMN public.cylinder_history.related_user_id IS 'Műveletet végző felhasználó (audit).';
