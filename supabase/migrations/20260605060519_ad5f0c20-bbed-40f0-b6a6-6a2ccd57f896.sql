
ALTER TABLE public.cylinders
  ADD COLUMN IF NOT EXISTS is_temporary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS owner public.circulation,
  ADD COLUMN IF NOT EXISTS first_tracked_at timestamptz DEFAULT now();

UPDATE public.cylinders SET owner = circulation WHERE owner IS NULL;
ALTER TABLE public.cylinders ALTER COLUMN owner SET NOT NULL;
ALTER TABLE public.cylinders ALTER COLUMN owner SET DEFAULT 'own';

ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS original_cylinder_id uuid,
  ADD COLUMN IF NOT EXISTS current_cylinder_id uuid,
  ADD COLUMN IF NOT EXISTS circulation public.circulation,
  ADD COLUMN IF NOT EXISTS deposit numeric NOT NULL DEFAULT 0;

ALTER TABLE public.exchanges
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS rental_reassigned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rental_id uuid;

CREATE SEQUENCE IF NOT EXISTS public.temp_cylinder_seq START 1;

CREATE OR REPLACE FUNCTION public.next_temp_barcode()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT 'TMP-' || lpad(nextval('public.temp_cylinder_seq')::text, 6, '0'); $$;

GRANT EXECUTE ON FUNCTION public.next_temp_barcode() TO authenticated;

CREATE TABLE IF NOT EXISTS public.rental_reassignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL,
  old_cylinder_id uuid,
  new_cylinder_id uuid NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rental_reassignments TO authenticated;
GRANT ALL ON public.rental_reassignments TO service_role;
ALTER TABLE public.rental_reassignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rr auth all" ON public.rental_reassignments;
CREATE POLICY "rr auth all" ON public.rental_reassignments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON public.audit_log(created_at DESC);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit read auth" ON public.audit_log;
DROP POLICY IF EXISTS "audit insert auth" ON public.audit_log;
CREATE POLICY "audit read auth" ON public.audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "audit insert auth" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_cylinder_last_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.cylinders
    SET last_movement_at = NEW.created_at, status = NEW.status_after
    WHERE id = NEW.cylinder_id;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_movements_touch_cyl ON public.movements;
CREATE TRIGGER trg_movements_touch_cyl AFTER INSERT ON public.movements
FOR EACH ROW EXECUTE FUNCTION public.touch_cylinder_last_movement();

CREATE OR REPLACE FUNCTION public.log_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE uid uuid;
BEGIN
  uid := auth.uid();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(user_id, action, entity_type, entity_id, new_value)
      VALUES (uid, 'insert', TG_TABLE_NAME, NEW.id, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log(user_id, action, entity_type, entity_id, old_value, new_value)
      VALUES (uid, 'update', TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(user_id, action, entity_type, entity_id, old_value)
      VALUES (uid, 'delete', TG_TABLE_NAME, OLD.id, to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_exchanges ON public.exchanges;
CREATE TRIGGER trg_audit_exchanges AFTER INSERT OR UPDATE OR DELETE ON public.exchanges FOR EACH ROW EXECUTE FUNCTION public.log_audit();
DROP TRIGGER IF EXISTS trg_audit_rentals ON public.rentals;
CREATE TRIGGER trg_audit_rentals AFTER INSERT OR UPDATE OR DELETE ON public.rentals FOR EACH ROW EXECUTE FUNCTION public.log_audit();
DROP TRIGGER IF EXISTS trg_audit_reassign ON public.rental_reassignments;
CREATE TRIGGER trg_audit_reassign AFTER INSERT ON public.rental_reassignments FOR EACH ROW EXECUTE FUNCTION public.log_audit();
