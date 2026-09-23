-- Delivery notes + ADR product master (idempotent)
-- DO NOT apply to production in this sprint without explicit approval.
-- Project: GazVeled2 / snmiwsgtnokvqlnwvfwf

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
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','finalized','void')),
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
  -- későbbi menetlevél mezők (opcionális előkészítés)
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

CREATE UNIQUE INDEX IF NOT EXISTS delivery_notes_org_docnum_uidx
  ON public.delivery_notes (organization_id, document_number)
  WHERE document_number IS NOT NULL;

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

CREATE INDEX IF NOT EXISTS delivery_note_items_note_idx
  ON public.delivery_note_items (delivery_note_id);

CREATE OR REPLACE FUNCTION public.next_delivery_note_number(p_organization_id uuid, p_year integer DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer := COALESCE(p_year, EXTRACT(YEAR FROM now())::integer);
  v_prefix text := 'SZL-' || v_year::text || '-';
  v_max integer;
  v_next integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_organization_id IS DISTINCT FROM public.auth_organization_id()
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Organization mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(NULLIF(regexp_replace(document_number, '^SZL-[0-9]{4}-', ''), '')::integer), 0)
  INTO v_max
  FROM public.delivery_notes
  WHERE organization_id = p_organization_id
    AND document_number LIKE v_prefix || '%';

  v_next := v_max + 1;
  RETURN v_prefix || lpad(v_next::text, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_delivery_note_number(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_delivery_note_number(uuid, integer) TO authenticated;

ALTER TABLE public.adr_product_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_note_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS adr_product_master_select ON public.adr_product_master;
CREATE POLICY adr_product_master_select ON public.adr_product_master
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR public.same_org(organization_id));

DROP POLICY IF EXISTS adr_product_master_write ON public.adr_product_master;
CREATE POLICY adr_product_master_write ON public.adr_product_master
  FOR ALL TO authenticated
  USING (public.is_admin() AND (organization_id IS NULL OR public.same_org(organization_id)))
  WITH CHECK (public.is_admin() AND (organization_id IS NULL OR public.same_org(organization_id)));

DROP POLICY IF EXISTS delivery_notes_select ON public.delivery_notes;
CREATE POLICY delivery_notes_select ON public.delivery_notes
  FOR SELECT TO authenticated
  USING (public.same_org(organization_id));

DROP POLICY IF EXISTS delivery_notes_write ON public.delivery_notes;
CREATE POLICY delivery_notes_write ON public.delivery_notes
  FOR ALL TO authenticated
  USING (public.can_exchange() AND public.same_org(organization_id))
  WITH CHECK (public.can_exchange() AND public.same_org(organization_id));

DROP POLICY IF EXISTS delivery_note_items_select ON public.delivery_note_items;
CREATE POLICY delivery_note_items_select ON public.delivery_note_items
  FOR SELECT TO authenticated
  USING (public.same_org(organization_id));

DROP POLICY IF EXISTS delivery_note_items_write ON public.delivery_note_items;
CREATE POLICY delivery_note_items_write ON public.delivery_note_items
  FOR ALL TO authenticated
  USING (public.can_exchange() AND public.same_org(organization_id))
  WITH CHECK (public.can_exchange() AND public.same_org(organization_id));

-- Globális (org NULL) verified seed – csak biztos ADR
INSERT INTO public.adr_product_master (
  organization_id, gas_type_key, ruleset_version, un_number, proper_shipping_name_hu,
  adr_class, classification_code, hazard_labels, tunnel_restriction_code,
  transport_category, multiplier, quantity_basis, transport_document_text,
  verified, verified_at, source
)
SELECT * FROM (VALUES
  (NULL::uuid, 'argon', 'ADR-2025', '1006', 'ARGON, SŰRÍTETT', '2', '1A', ARRAY['2.2']::text[], 'E', 3::smallint, 1::numeric, 'water_capacity_l',
   'UN 1006 ARGON, SŰRÍTETT, 2.2, (E)', true, now(), 'ADR 2025'),
  (NULL::uuid, 'oxigén', 'ADR-2025', '1072', 'OXIGÉN, SŰRÍTETT', '2', '1O', ARRAY['2.2','5.1']::text[], 'E', 3::smallint, 1::numeric, 'water_capacity_l',
   'UN 1072 OXIGÉN, SŰRÍTETT, 2.2 (5.1), (E)', true, now(), 'ADR 2025'),
  (NULL::uuid, 'oxygen', 'ADR-2025', '1072', 'OXIGÉN, SŰRÍTETT', '2', '1O', ARRAY['2.2','5.1']::text[], 'E', 3::smallint, 1::numeric, 'water_capacity_l',
   'UN 1072 OXIGÉN, SŰRÍTETT, 2.2 (5.1), (E)', true, now(), 'ADR 2025'),
  (NULL::uuid, 'nitrogén', 'ADR-2025', '1066', 'NITROGÉN, SŰRÍTETT', '2', '1A', ARRAY['2.2']::text[], 'E', 3::smallint, 1::numeric, 'water_capacity_l',
   'UN 1066 NITROGÉN, SŰRÍTETT, 2.2, (E)', true, now(), 'ADR 2025'),
  (NULL::uuid, 'hélium', 'ADR-2025', '1046', 'HÉLIUM, SŰRÍTETT', '2', '1A', ARRAY['2.2']::text[], 'E', 3::smallint, 1::numeric, 'water_capacity_l',
   'UN 1046 HÉLIUM, SŰRÍTETT, 2.2, (E)', true, now(), 'ADR 2025'),
  (NULL::uuid, 'szén-dioxid', 'ADR-2025', '1013', 'SZÉN-DIOXID', '2', '2A', ARRAY['2.2']::text[], 'C/E', 3::smallint, 1::numeric, 'net_mass_kg',
   'UN 1013 SZÉN-DIOXID, 2.2, (C/E)', true, now(), 'ADR 2025'),
  (NULL::uuid, 'co2', 'ADR-2025', '1013', 'SZÉN-DIOXID', '2', '2A', ARRAY['2.2']::text[], 'C/E', 3::smallint, 1::numeric, 'net_mass_kg',
   'UN 1013 SZÉN-DIOXID, 2.2, (C/E)', true, now(), 'ADR 2025'),
  (NULL::uuid, 'stargon', 'ADR-2025', '1956', 'SŰRÍTETT GÁZ, M.N.N.', '2', NULL, ARRAY['2.2']::text[], 'E', 3::smallint, 1::numeric, 'water_capacity_l',
   NULL, false, NULL::timestamptz, 'Stub – SIAD SDS Ch.14 ellenőrzésig')
) AS v(organization_id, gas_type_key, ruleset_version, un_number, proper_shipping_name_hu,
  adr_class, classification_code, hazard_labels, tunnel_restriction_code,
  transport_category, multiplier, quantity_basis, transport_document_text,
  verified, verified_at, source)
WHERE NOT EXISTS (
  SELECT 1 FROM public.adr_product_master m
  WHERE m.organization_id IS NULL AND m.gas_type_key = v.gas_type_key AND m.ruleset_version = v.ruleset_version
);
