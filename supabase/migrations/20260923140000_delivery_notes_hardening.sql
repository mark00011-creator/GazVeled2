-- Corrective migration for delivery notes / ADR (audit 606a811 CRITICAL+HIGH)
-- DO NOT apply to production without a second pre-production audit.
-- Project: GazVeled2 / snmiwsgtnokvqlnwvfwf
--
-- Fixes:
-- 1) FINALIZED/CANCELLED immutability (triggers)
-- 2) Concurrent-safe SZL-YYYY-NNNNNN sequences (no MAX+1)
-- 3) finalize_delivery_note + cancel_delivery_note + attach_delivery_note_pdf RPCs
-- 4) RLS per-operation; no client write on global ADR master
-- 5) status: draft | finalized | cancelled (+ cancel metadata)

-- ---------------------------------------------------------------------------
-- 0) Ensure base tables exist (idempotent if 20260923120000 already applied)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.adr_product_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  gas_type_key text NOT NULL,
  ruleset_version text NOT NULL DEFAULT 'ADR-2025',
  un_number text,
  proper_shipping_name_hu text,
  technical_name_hu text,
  adr_class text,
  classification_code text,
  hazard_labels text[] NOT NULL DEFAULT '{}',
  packing_group text,
  tunnel_restriction_code text,
  transport_category smallint CHECK (transport_category IS NULL OR transport_category BETWEEN 0 AND 4),
  multiplier numeric,
  quantity_basis text NOT NULL DEFAULT 'water_capacity_l'
    CHECK (quantity_basis IN ('water_capacity_l','net_mass_kg','volume_l','not_applicable')),
  transport_document_text text,
  verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, gas_type_key, ruleset_version)
);

CREATE TABLE IF NOT EXISTS public.delivery_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  document_number text,
  status text NOT NULL DEFAULT 'draft',
  issued_at timestamptz,
  partner_id uuid REFERENCES public.partners(id),
  supplier_id uuid REFERENCES public.suppliers(id),
  source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual','supplier_exchange','exchange_batch','quick_exchange')),
  source_id uuid,
  shipper_name text,
  shipper_address text,
  shipper_tax_number text,
  consignee_name text,
  consignee_address text,
  consignee_tax_number text,
  delivery_address text,
  vehicle_plate text,
  driver_name text,
  journey_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  adr_ruleset_version text NOT NULL DEFAULT 'ADR-2025',
  adr_snapshot jsonb,
  business_snapshot jsonb,
  adr_total_points numeric,
  adr_within_116 boolean,
  pdf_base64 text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  finalized_by uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.delivery_note_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_id uuid NOT NULL REFERENCES public.delivery_notes(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  line_role text NOT NULL
    CHECK (line_role IN ('outgoing_full','incoming_empty','other')),
  cylinder_state text NOT NULL DEFAULT 'FULL'
    CHECK (cylinder_state IN ('FULL','PARTIAL','EMPTY_UNCLEANED','EMPTY_CLEAN')),
  gas_type text,
  size text,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  barcode text,
  cylinder_id uuid REFERENCES public.cylinders(id),
  water_capacity_l numeric,
  net_gas_mass_kg numeric,
  adr_product_key text,
  unit_value numeric,
  note text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_notes_org_docnum_uidx
  ON public.delivery_notes (organization_id, document_number)
  WHERE document_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS delivery_note_items_note_idx
  ON public.delivery_note_items (delivery_note_id);

-- ---------------------------------------------------------------------------
-- 1) Status + cancel columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.delivery_notes
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

-- Migrate legacy 'void' -> 'cancelled' if present
UPDATE public.delivery_notes SET status = 'cancelled' WHERE status = 'void';

ALTER TABLE public.delivery_notes DROP CONSTRAINT IF EXISTS delivery_notes_status_check;
ALTER TABLE public.delivery_notes
  ADD CONSTRAINT delivery_notes_status_check
  CHECK (status IN ('draft', 'finalized', 'cancelled'));

ALTER TABLE public.delivery_notes DROP CONSTRAINT IF EXISTS delivery_notes_cancel_reason_chk;
ALTER TABLE public.delivery_notes
  ADD CONSTRAINT delivery_notes_cancel_reason_chk
  CHECK (
    (status <> 'cancelled')
    OR (cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) > 0)
  );

-- ---------------------------------------------------------------------------
-- 2) Sequence table (concurrency-safe)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_note_sequences (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year >= 2000 AND year <= 2100),
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, year)
);

ALTER TABLE public.delivery_note_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_note_sequences_select ON public.delivery_note_sequences;
CREATE POLICY delivery_note_sequences_select ON public.delivery_note_sequences
  FOR SELECT TO authenticated
  USING (public.same_org(organization_id));

-- No INSERT/UPDATE/DELETE policies for authenticated — only SECURITY DEFINER RPCs

-- ---------------------------------------------------------------------------
-- 3) Bypass helpers for allowed privileged transitions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delivery_note_bypass_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('app.delivery_note_bypass', true), '') = '1';
$$;

-- ---------------------------------------------------------------------------
-- 4) Allocate next document number (atomic UPSERT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_delivery_note_number(p_organization_id uuid, p_year integer DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer := COALESCE(p_year, EXTRACT(YEAR FROM now())::integer);
  v_next integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS DISTINCT FROM public.auth_organization_id()
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Organization mismatch' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_exchange() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Insufficient privilege' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.delivery_note_sequences AS s (organization_id, year, last_number)
  VALUES (p_organization_id, v_year, 1)
  ON CONFLICT (organization_id, year)
  DO UPDATE SET
    last_number = s.last_number + 1,
    updated_at = now()
  RETURNING last_number INTO v_next;

  RETURN 'SZL-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_delivery_note_number(uuid, integer) FROM PUBLIC;
-- Not granted to authenticated directly; only called from finalize RPC

-- Replace old MAX()+1 function: keep name but redirect to allocator (compat)
CREATE OR REPLACE FUNCTION public.next_delivery_note_number(p_organization_id uuid, p_year integer DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.allocate_delivery_note_number(p_organization_id, p_year);
END;
$$;

REVOKE ALL ON FUNCTION public.next_delivery_note_number(uuid, integer) FROM PUBLIC;
-- No CLIENT grant — numbering only via finalize RPC

-- ---------------------------------------------------------------------------
-- 5) Immutability triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_delivery_notes_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IS DISTINCT FROM 'draft' AND NOT public.delivery_note_bypass_enabled() THEN
      RAISE EXCEPTION 'Csak piszkozat szállítólevél törölhető (status=%)', OLD.status
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Allowed privileged paths
    IF public.delivery_note_bypass_enabled() THEN
      -- cancel: finalized -> cancelled
      IF OLD.status = 'finalized' AND NEW.status = 'cancelled' THEN
        IF NEW.document_number IS DISTINCT FROM OLD.document_number
           OR NEW.adr_snapshot IS DISTINCT FROM OLD.adr_snapshot
           OR NEW.business_snapshot IS DISTINCT FROM OLD.business_snapshot
           OR (OLD.pdf_base64 IS NOT NULL AND NEW.pdf_base64 IS DISTINCT FROM OLD.pdf_base64 AND NEW.pdf_base64 IS NULL)
        THEN
          RAISE EXCEPTION 'Érvénytelenítés során snapshot/sorszám nem módosítható'
            USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END IF;
      -- attach pdf once: null -> value on finalized/cancelled
      IF OLD.status IN ('finalized', 'cancelled')
         AND OLD.pdf_base64 IS NULL
         AND NEW.pdf_base64 IS NOT NULL
         AND NEW.status IS NOT DISTINCT FROM OLD.status
         AND NEW.document_number IS NOT DISTINCT FROM OLD.document_number
         AND NEW.adr_snapshot IS NOT DISTINCT FROM OLD.adr_snapshot
         AND NEW.business_snapshot IS NOT DISTINCT FROM OLD.business_snapshot
      THEN
        RETURN NEW;
      END IF;
      -- finalize path: draft -> finalized
      IF OLD.status = 'draft' AND NEW.status = 'finalized' THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Nem engedélyezett szállítólevél bypass UPDATE'
        USING ERRCODE = 'P0001';
    END IF;

    -- Normal client updates: only draft
    IF OLD.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Véglegesített/érvénytelenített szállítólevél nem módosítható'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Státuszváltás csak finalize/cancel RPC-n keresztül engedélyezett'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.document_number IS DISTINCT FROM OLD.document_number THEN
      RAISE EXCEPTION 'Bizonylatszám kliensből nem állítható'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_notes_immutability ON public.delivery_notes;
CREATE TRIGGER trg_delivery_notes_immutability
  BEFORE UPDATE OR DELETE ON public.delivery_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_delivery_notes_immutability();

CREATE OR REPLACE FUNCTION public.trg_delivery_note_items_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_note_id uuid;
BEGIN
  v_note_id := COALESCE(NEW.delivery_note_id, OLD.delivery_note_id);
  SELECT status INTO v_status FROM public.delivery_notes WHERE id = v_note_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Szállítólevél nem található' USING ERRCODE = 'P0001';
  END IF;
  IF v_status IS DISTINCT FROM 'draft' AND NOT public.delivery_note_bypass_enabled() THEN
    RAISE EXCEPTION 'Véglegesített/érvénytelenített szállítólevél tételei nem módosíthatók'
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_note_items_immutability ON public.delivery_note_items;
CREATE TRIGGER trg_delivery_note_items_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON public.delivery_note_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_delivery_note_items_immutability();

-- ---------------------------------------------------------------------------
-- 6) Finalize RPC (transactional)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_delivery_note(
  p_note_id uuid,
  p_adr_snapshot jsonb,
  p_business_snapshot jsonb,
  p_adr_total_points numeric,
  p_adr_within_116 boolean,
  p_pdf_base64 text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note public.delivery_notes%ROWTYPE;
  v_docnum text;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_exchange() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Insufficient privilege' USING ERRCODE = '42501';
  END IF;
  IF p_adr_snapshot IS NULL OR p_business_snapshot IS NULL THEN
    RAISE EXCEPTION 'ADR és üzleti snapshot kötelező' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_note
  FROM public.delivery_notes
  WHERE id = p_note_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Szállítólevél nem található' USING ERRCODE = 'P0001';
  END IF;
  IF v_note.organization_id IS DISTINCT FROM public.auth_organization_id()
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Organization mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_note.status = 'finalized' THEN
    RAISE EXCEPTION 'A szállítólevél már véglegesítve van' USING ERRCODE = 'P0001';
  END IF;
  IF v_note.status = 'cancelled' THEN
    RAISE EXCEPTION 'Érvénytelenített szállítólevél nem véglegesíthető' USING ERRCODE = 'P0001';
  END IF;
  IF v_note.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Csak piszkozat véglegesíthető (status=%)', v_note.status USING ERRCODE = 'P0001';
  END IF;

  v_docnum := public.allocate_delivery_note_number(v_note.organization_id, EXTRACT(YEAR FROM now())::integer);

  PERFORM set_config('app.delivery_note_bypass', '1', true);

  UPDATE public.delivery_notes
  SET
    status = 'finalized',
    document_number = v_docnum,
    issued_at = now(),
    finalized_at = now(),
    finalized_by = auth.uid(),
    adr_snapshot = p_adr_snapshot,
    business_snapshot = p_business_snapshot,
    adr_total_points = p_adr_total_points,
    adr_within_116 = p_adr_within_116,
    pdf_base64 = COALESCE(p_pdf_base64, pdf_base64),
    updated_at = now()
  WHERE id = p_note_id
    AND status = 'draft';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Finalize sikertelen: frissített sorok száma (%)', v_updated
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_note FROM public.delivery_notes WHERE id = p_note_id;

  RETURN jsonb_build_object(
    'id', v_note.id,
    'document_number', v_note.document_number,
    'status', v_note.status,
    'issued_at', v_note.issued_at,
    'finalized_at', v_note.finalized_at,
    'adr_snapshot', v_note.adr_snapshot,
    'business_snapshot', v_note.business_snapshot,
    'adr_total_points', v_note.adr_total_points,
    'adr_within_116', v_note.adr_within_116,
    'adr_ruleset_version', v_note.adr_ruleset_version,
    'shipper_name', v_note.shipper_name,
    'shipper_address', v_note.shipper_address,
    'consignee_name', v_note.consignee_name,
    'consignee_address', v_note.consignee_address,
    'delivery_address', v_note.delivery_address,
    'vehicle_plate', v_note.vehicle_plate,
    'driver_name', v_note.driver_name,
    'cancellation_reason', v_note.cancellation_reason,
    'pdf_attached', (v_note.pdf_base64 IS NOT NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_delivery_note(uuid, jsonb, jsonb, numeric, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_delivery_note(uuid, jsonb, jsonb, numeric, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) Cancel RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_delivery_note(
  p_note_id uuid,
  p_reason text,
  p_pdf_base64 text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note public.delivery_notes%ROWTYPE;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_exchange() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Insufficient privilege' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Az érvénytelenítés indoka kötelező' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_note
  FROM public.delivery_notes
  WHERE id = p_note_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Szállítólevél nem található' USING ERRCODE = 'P0001';
  END IF;
  IF v_note.organization_id IS DISTINCT FROM public.auth_organization_id()
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Organization mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_note.status = 'cancelled' THEN
    RAISE EXCEPTION 'A szállítólevél már érvénytelenítve van' USING ERRCODE = 'P0001';
  END IF;
  IF v_note.status IS DISTINCT FROM 'finalized' THEN
    RAISE EXCEPTION 'Csak véglegesített szállítólevél érvényteleníthető' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.delivery_note_bypass', '1', true);

  UPDATE public.delivery_notes
  SET
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = auth.uid(),
    cancellation_reason = trim(p_reason),
    pdf_base64 = COALESCE(p_pdf_base64, pdf_base64),
    updated_at = now()
  WHERE id = p_note_id
    AND status = 'finalized';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Cancel sikertelen: frissített sorok száma (%)', v_updated
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_note FROM public.delivery_notes WHERE id = p_note_id;

  RETURN jsonb_build_object(
    'id', v_note.id,
    'document_number', v_note.document_number,
    'status', v_note.status,
    'cancelled_at', v_note.cancelled_at,
    'cancellation_reason', v_note.cancellation_reason,
    'adr_snapshot', v_note.adr_snapshot,
    'business_snapshot', v_note.business_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_delivery_note(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_delivery_note(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8) Attach PDF once (finalized/cancelled, only if null)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attach_delivery_note_pdf(
  p_note_id uuid,
  p_pdf_base64 text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note public.delivery_notes%ROWTYPE;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_exchange() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Insufficient privilege' USING ERRCODE = '42501';
  END IF;
  IF p_pdf_base64 IS NULL OR length(p_pdf_base64) = 0 THEN
    RAISE EXCEPTION 'PDF tartalom kötelező' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_note
  FROM public.delivery_notes
  WHERE id = p_note_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Szállítólevél nem található' USING ERRCODE = 'P0001';
  END IF;
  IF v_note.organization_id IS DISTINCT FROM public.auth_organization_id()
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Organization mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_note.status NOT IN ('finalized', 'cancelled') THEN
    RAISE EXCEPTION 'PDF csak véglegesített/érvénytelenített bizonylathoz csatolható' USING ERRCODE = 'P0001';
  END IF;
  IF v_note.pdf_base64 IS NOT NULL THEN
    -- idempotent success if already attached
    RETURN true;
  END IF;

  PERFORM set_config('app.delivery_note_bypass', '1', true);

  UPDATE public.delivery_notes
  SET pdf_base64 = p_pdf_base64, updated_at = now()
  WHERE id = p_note_id
    AND pdf_base64 IS NULL
    AND status IN ('finalized', 'cancelled');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'PDF csatolás sikertelen (rowcount=%)', v_updated USING ERRCODE = 'P0001';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_delivery_note_pdf(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attach_delivery_note_pdf(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9) RLS redesign
-- ---------------------------------------------------------------------------
ALTER TABLE public.adr_product_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_note_items ENABLE ROW LEVEL SECURITY;

-- ADR master: SELECT only for authenticated; NO write policies for clients
DROP POLICY IF EXISTS adr_product_master_select ON public.adr_product_master;
DROP POLICY IF EXISTS adr_product_master_write ON public.adr_product_master;
CREATE POLICY adr_product_master_select ON public.adr_product_master
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR public.same_org(organization_id));
-- intentional: no INSERT/UPDATE/DELETE for authenticated (service_role / migrations only)

-- delivery_notes
DROP POLICY IF EXISTS delivery_notes_select ON public.delivery_notes;
DROP POLICY IF EXISTS delivery_notes_write ON public.delivery_notes;
DROP POLICY IF EXISTS delivery_notes_insert ON public.delivery_notes;
DROP POLICY IF EXISTS delivery_notes_update ON public.delivery_notes;
DROP POLICY IF EXISTS delivery_notes_delete ON public.delivery_notes;

CREATE POLICY delivery_notes_select ON public.delivery_notes
  FOR SELECT TO authenticated
  USING (public.same_org(organization_id));

CREATE POLICY delivery_notes_insert ON public.delivery_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_exchange()
    AND public.same_org(organization_id)
    AND status = 'draft'
    AND document_number IS NULL
  );

CREATE POLICY delivery_notes_update ON public.delivery_notes
  FOR UPDATE TO authenticated
  USING (public.can_exchange() AND public.same_org(organization_id) AND status = 'draft')
  WITH CHECK (public.can_exchange() AND public.same_org(organization_id) AND status = 'draft');

CREATE POLICY delivery_notes_delete ON public.delivery_notes
  FOR DELETE TO authenticated
  USING (public.can_exchange() AND public.same_org(organization_id) AND status = 'draft');

-- delivery_note_items
DROP POLICY IF EXISTS delivery_note_items_select ON public.delivery_note_items;
DROP POLICY IF EXISTS delivery_note_items_write ON public.delivery_note_items;
DROP POLICY IF EXISTS delivery_note_items_insert ON public.delivery_note_items;
DROP POLICY IF EXISTS delivery_note_items_update ON public.delivery_note_items;
DROP POLICY IF EXISTS delivery_note_items_delete ON public.delivery_note_items;

CREATE POLICY delivery_note_items_select ON public.delivery_note_items
  FOR SELECT TO authenticated
  USING (public.same_org(organization_id));

CREATE POLICY delivery_note_items_insert ON public.delivery_note_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_exchange()
    AND public.same_org(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.delivery_notes n
      WHERE n.id = delivery_note_id AND n.status = 'draft' AND public.same_org(n.organization_id)
    )
  );

CREATE POLICY delivery_note_items_update ON public.delivery_note_items
  FOR UPDATE TO authenticated
  USING (
    public.can_exchange()
    AND public.same_org(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.delivery_notes n
      WHERE n.id = delivery_note_id AND n.status = 'draft'
    )
  )
  WITH CHECK (
    public.can_exchange()
    AND public.same_org(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.delivery_notes n
      WHERE n.id = delivery_note_id AND n.status = 'draft'
    )
  );

CREATE POLICY delivery_note_items_delete ON public.delivery_note_items
  FOR DELETE TO authenticated
  USING (
    public.can_exchange()
    AND public.same_org(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.delivery_notes n
      WHERE n.id = delivery_note_id AND n.status = 'draft'
    )
  );
