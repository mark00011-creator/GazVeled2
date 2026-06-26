-- Palack előélet: eseményenként külön rekord (bővíthető struktúra)
CREATE TABLE IF NOT EXISTS public.cylinder_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cylinder_id uuid NOT NULL REFERENCES public.cylinders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  description text,
  partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  old_value text,
  new_value text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Későbbi bővítésekhez (most nem használt)
  user_note text,
  ip_address inet,
  document_url text,
  photo_url text,
  pressure_test_certificate_url text
);

CREATE INDEX IF NOT EXISTS idx_cylinder_history_cylinder_created
  ON public.cylinder_history (cylinder_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cylinder_history_event_type
  ON public.cylinder_history (event_type);

COMMENT ON TABLE public.cylinder_history IS 'Palack előélet – eseményenként külön rekord, nem szerkeszthető.';
COMMENT ON COLUMN public.cylinder_history.metadata IS 'Bővíthető JSON (pl. exchange barcodes, rental_id).';
COMMENT ON COLUMN public.cylinder_history.user_note IS 'Későbbi: felhasználói megjegyzés.';
COMMENT ON COLUMN public.cylinder_history.ip_address IS 'Későbbi: IP cím naplózás.';
COMMENT ON COLUMN public.cylinder_history.document_url IS 'Későbbi: csatolt dokumentum.';
COMMENT ON COLUMN public.cylinder_history.photo_url IS 'Későbbi: fotó.';
COMMENT ON COLUMN public.cylinder_history.pressure_test_certificate_url IS 'Későbbi: nyomáspróba jegyzőkönyv.';

ALTER TABLE public.cylinder_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cylinder_history auth select" ON public.cylinder_history;
CREATE POLICY "cylinder_history auth select"
  ON public.cylinder_history FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "cylinder_history auth insert" ON public.cylinder_history;
CREATE POLICY "cylinder_history auth insert"
  ON public.cylinder_history FOR INSERT TO authenticated
  WITH CHECK (true);

GRANT SELECT, INSERT ON public.cylinder_history TO authenticated;
GRANT ALL ON public.cylinder_history TO service_role;
