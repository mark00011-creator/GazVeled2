-- Global Event Engine: központi üzleti esemény napló (cylinder_history mellett)

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  event_group_id uuid,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  related_entity_type text,
  related_entity_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_events_created_at ON public.events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON public.events (event_type);
CREATE INDEX IF NOT EXISTS idx_events_event_group
  ON public.events (event_group_id)
  WHERE event_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_entity
  ON public.events (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_related_entity
  ON public.events (related_entity_type, related_entity_id, created_at DESC)
  WHERE related_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_partner_id
  ON public.events (partner_id, created_at DESC)
  WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_supplier_id
  ON public.events (supplier_id, created_at DESC)
  WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_payload_gin ON public.events USING gin (payload);
CREATE INDEX IF NOT EXISTS idx_events_metadata_gin ON public.events USING gin (metadata);

COMMENT ON TABLE public.events IS 'Központi üzleti esemény napló – AI és globális lekérdezésekhez.';
COMMENT ON COLUMN public.events.payload IS 'Strukturált üzleti adat (vonalkódok, csere id, stb.).';
COMMENT ON COLUMN public.events.metadata IS 'Technikai / forrás meta (pl. cylinder_history sync).';

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events auth select" ON public.events;
CREATE POLICY "events auth select"
  ON public.events FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "events auth insert" ON public.events;
CREATE POLICY "events auth insert"
  ON public.events FOR INSERT TO authenticated
  WITH CHECK (true);

GRANT SELECT, INSERT ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;
