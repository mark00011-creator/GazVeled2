-- Corrective migration: server-side finalize authority for delivery notes
-- Fixes HIGH trust-boundary: client must NOT supply ADR/business snapshots or totals.
-- DO NOT apply to production without live DB validation + explicit approval.
-- Project: GazVeled2 / snmiwsgtnokvqlnwvfwf
--
-- Changes:
-- 1) DROP old finalize_delivery_note(uuid, jsonb, jsonb, numeric, boolean, text)
-- 2) CREATE finalize_delivery_note(p_delivery_note_id uuid) — server builds snapshots
-- 3) Helpers: gas_type_to_adr_key, parse physical, ADR 1.1.3.6 calc, snapshot builders

-- ---------------------------------------------------------------------------
-- Helpers: gas type key + physical parse (mirror src/lib/adr/physical.ts)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gas_type_to_adr_key(p_gas_type text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  g text := lower(trim(COALESCE(p_gas_type, '')));
BEGIN
  IF g = '' THEN
    RETURN '';
  END IF;
  IF position('stargon' in g) > 0 THEN RETURN 'stargon'; END IF;
  IF position('argon' in g) > 0 THEN RETURN 'argon'; END IF;
  IF position('oxig' in g) > 0 OR position('oxygen' in g) > 0 OR g = 'o2' THEN RETURN 'oxigén'; END IF;
  IF position('nitro' in g) > 0 OR g = 'n2' THEN RETURN 'nitrogén'; END IF;
  IF position('héli' in g) > 0 OR position('heli' in g) > 0 OR g = 'he' THEN RETURN 'hélium'; END IF;
  IF position('szén' in g) > 0 OR position('co2' in g) > 0 OR position('dioxid' in g) > 0 THEN RETURN 'szén-dioxid'; END IF;
  IF position('propán' in g) > 0 OR position('bután' in g) > 0 OR position('pb' in g) > 0 OR position('flaga' in g) > 0 THEN RETURN 'pb'; END IF;
  RETURN g;
END;
$$;

CREATE OR REPLACE FUNCTION public.parse_water_capacity_l(p_size text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s text := lower(trim(replace(COALESCE(p_size, ''), ',', '.')));
  m text[];
BEGIN
  m := regexp_match(s, '^(\d+(?:\.\d+)?)\s*l(?:iter)?$');
  IF m IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN m[1]::numeric;
END;
$$;

CREATE OR REPLACE FUNCTION public.parse_net_gas_mass_kg(p_size text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s text := lower(trim(replace(COALESCE(p_size, ''), ',', '.')));
  m text[];
BEGIN
  IF s ~ '^1-5\s*kg$' THEN
    RETURN NULL;
  END IF;
  m := regexp_match(s, '^(\d+(?:\.\d+)?)\s*kg$');
  IF m IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN m[1]::numeric;
END;
$$;

CREATE OR REPLACE FUNCTION public.adr_default_multiplier(p_cat smallint)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_cat
    WHEN 0 THEN 0::numeric
    WHEN 1 THEN 50::numeric
    WHEN 2 THEN 3::numeric
    WHEN 3 THEN 1::numeric
    WHEN 4 THEN 0::numeric
    ELSE 0::numeric
  END;
$$;

CREATE OR REPLACE FUNCTION public.format_adr_transport_document_text(
  p_un text,
  p_name text,
  p_labels text[],
  p_tunnel text,
  p_override text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  labels text;
  label_part text;
  tunnel_part text;
BEGIN
  IF p_override IS NOT NULL AND length(trim(p_override)) > 0 THEN
    RETURN trim(p_override);
  END IF;
  IF p_un IS NULL OR p_name IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_labels IS NULL OR cardinality(p_labels) = 0 THEN
    labels := '';
  ELSIF cardinality(p_labels) = 1 THEN
    labels := p_labels[1];
  ELSE
    labels := p_labels[1] || ' (' || array_to_string(p_labels[2:], ', ') || ')';
  END IF;
  label_part := CASE WHEN labels <> '' THEN ', ' || labels ELSE '' END;
  tunnel_part := CASE WHEN p_tunnel IS NOT NULL AND length(trim(p_tunnel)) > 0 THEN ', (' || p_tunnel || ')' ELSE '' END;
  RETURN 'UN ' || p_un || ' ' || p_name || label_part || tunnel_part;
END;
$$;

-- ---------------------------------------------------------------------------
-- Build finalized ADR + business snapshots from DB rows only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.build_delivery_note_finalize_snapshots(p_note_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note public.delivery_notes%ROWTYPE;
  v_org_name text;
  v_partner_name text;
  v_partner_address text;
  v_supplier_name text;
  v_shipper_name text;
  v_shipper_address text;
  v_consignee_name text;
  v_consignee_address text;
  v_ruleset text;
  v_item public.delivery_note_items%ROWTYPE;
  v_master public.adr_product_master%ROWTYPE;
  v_has_master boolean;
  v_key text;
  v_water numeric;
  v_net numeric;
  v_basis text;
  v_unit text;
  v_per_unit numeric;
  v_mult numeric;
  v_cat smallint;
  v_points numeric;
  v_doc text;
  v_warning text;
  v_cat1 numeric := 0;
  v_cat2 numeric := 0;
  v_cat3 numeric := 0;
  v_empty_uncleaned int := 0;
  v_total numeric;
  v_within boolean;
  v_status_hu text;
  v_empty_agg text;
  v_blocking jsonb := '[]'::jsonb;
  v_adr_lines jsonb := '[]'::jsonb;
  v_biz_items jsonb := '[]'::jsonb;
  v_line_id text;
  v_label text;
  v_product_json jsonb;
  v_line_json jsonb;
  v_adr jsonb;
  v_business jsonb;
  v_frozen_at timestamptz := now();
BEGIN
  SELECT * INTO v_note FROM public.delivery_notes WHERE id = p_note_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Szállítólevél nem található' USING ERRCODE = 'P0001';
  END IF;

  v_ruleset := COALESCE(NULLIF(trim(v_note.adr_ruleset_version), ''), 'ADR-2025');

  SELECT o.name INTO v_org_name FROM public.organizations o WHERE o.id = v_note.organization_id;
  IF v_note.partner_id IS NOT NULL THEN
    SELECT p.name, p.address INTO v_partner_name, v_partner_address
    FROM public.partners p WHERE p.id = v_note.partner_id;
  END IF;
  IF v_note.supplier_id IS NOT NULL THEN
    SELECT s.name INTO v_supplier_name FROM public.suppliers s WHERE s.id = v_note.supplier_id;
  END IF;

  v_shipper_name := COALESCE(NULLIF(trim(v_org_name), ''), v_note.shipper_name, '');
  v_shipper_address := v_note.shipper_address;
  v_consignee_name := COALESCE(v_note.consignee_name, '');
  v_consignee_address := v_note.consignee_address;
  IF v_partner_name IS NOT NULL AND length(trim(v_partner_name)) > 0 THEN
    v_consignee_name := v_partner_name;
    v_consignee_address := v_partner_address;
  ELSIF v_supplier_name IS NOT NULL AND length(trim(v_supplier_name)) > 0 THEN
    v_consignee_name := v_supplier_name;
  END IF;

  FOR v_item IN
    SELECT * FROM public.delivery_note_items
    WHERE delivery_note_id = p_note_id
    ORDER BY sort_order, created_at
  LOOP
    v_key := COALESCE(NULLIF(trim(v_item.adr_product_key), ''), public.gas_type_to_adr_key(v_item.gas_type));
    v_water := CASE
      WHEN v_item.water_capacity_l IS NOT NULL AND v_item.water_capacity_l > 0 THEN v_item.water_capacity_l
      ELSE public.parse_water_capacity_l(v_item.size)
    END;
    v_net := CASE
      WHEN v_item.net_gas_mass_kg IS NOT NULL AND v_item.net_gas_mass_kg > 0 THEN v_item.net_gas_mass_kg
      ELSE public.parse_net_gas_mass_kg(v_item.size)
    END;
    v_label := trim(COALESCE(v_item.gas_type, '?') || ' ' || COALESCE(v_item.size, ''));
    v_line_id := v_item.id::text;
    v_warning := NULL;
    v_doc := NULL;
    v_cat := NULL;
    v_mult := 0;
    v_points := 0;
    v_per_unit := 0;
    v_unit := NULL;
    v_product_json := NULL;
    v_has_master := false;

    -- ADR master: org-specific preferred, then global
    SELECT m.* INTO v_master
    FROM public.adr_product_master m
    WHERE m.gas_type_key = v_key
      AND m.ruleset_version = v_ruleset
      AND (m.organization_id = v_note.organization_id OR m.organization_id IS NULL)
    ORDER BY (m.organization_id IS NOT NULL) DESC
    LIMIT 1;
    v_has_master := FOUND;

    IF v_has_master THEN
      v_product_json := jsonb_build_object(
        'unNumber', v_master.un_number,
        'properShippingNameHu', v_master.proper_shipping_name_hu,
        'technicalNameHu', v_master.technical_name_hu,
        'adrClass', v_master.adr_class,
        'classificationCode', v_master.classification_code,
        'hazardLabels', to_jsonb(COALESCE(v_master.hazard_labels, '{}'::text[])),
        'packingGroup', v_master.packing_group,
        'tunnelRestrictionCode', v_master.tunnel_restriction_code,
        'transportCategory', v_master.transport_category,
        'multiplier', v_master.multiplier,
        'quantityBasis', v_master.quantity_basis,
        'verified', v_master.verified,
        'verifiedAt', v_master.verified_at,
        'source', v_master.source,
        'rulesetVersion', v_master.ruleset_version,
        'transportDocumentText', v_master.transport_document_text
      );
      v_basis := COALESCE(v_master.quantity_basis, 'water_capacity_l');
    ELSE
      v_product_json := jsonb_build_object(
        'unNumber', NULL,
        'properShippingNameHu', NULL,
        'technicalNameHu', NULL,
        'adrClass', NULL,
        'classificationCode', NULL,
        'hazardLabels', '[]'::jsonb,
        'packingGroup', NULL,
        'tunnelRestrictionCode', NULL,
        'transportCategory', NULL,
        'multiplier', NULL,
        'quantityBasis', 'not_applicable',
        'verified', false,
        'verifiedAt', NULL,
        'source', NULL,
        'rulesetVersion', v_ruleset,
        'transportDocumentText', NULL
      );
      v_basis := 'not_applicable';
    END IF;

    IF v_item.quantity <= 0 THEN
      CONTINUE;
    END IF;

    IF v_item.cylinder_state = 'EMPTY_CLEAN' THEN
      v_cat := NULL;
      v_mult := 0;
      v_points := 0;
      v_doc := NULL;
      v_line_json := jsonb_build_object(
        'id', v_line_id,
        'state', v_item.cylinder_state,
        'quantity', v_item.quantity,
        'includedInDangerousGoods', false,
        'adrQuantity', 0,
        'adrQuantityUnit', NULL,
        'transportCategory', NULL,
        'multiplier', 0,
        'points', 0,
        'documentLineText', NULL,
        'businessLabel', v_label
      );
    ELSIF v_item.cylinder_state = 'EMPTY_UNCLEANED' THEN
      v_empty_uncleaned := v_empty_uncleaned + v_item.quantity;
      v_cat := 4;
      v_mult := 0;
      v_points := 0;
      v_doc := 'ÜRES TARTÁLY, 2';
      v_line_json := jsonb_build_object(
        'id', v_line_id,
        'state', v_item.cylinder_state,
        'quantity', v_item.quantity,
        'includedInDangerousGoods', true,
        'adrQuantity', 0,
        'adrQuantityUnit', NULL,
        'transportCategory', 4,
        'multiplier', 0,
        'points', 0,
        'documentLineText', v_doc,
        'businessLabel', v_label
      );
    ELSE
      -- FULL / PARTIAL — category/points/UN exclusively from ADR master
      IF NOT v_has_master THEN
        v_warning := 'A termék ADR törzsadata nincs hitelesítve.';
        v_blocking := v_blocking || jsonb_build_array(v_label || ': ' || v_warning);
        v_cat := NULL;
        v_mult := 0;
        v_doc := NULL;
      ELSE
        IF NOT v_master.verified THEN
          v_warning := 'A termék ADR törzsadata nincs hitelesítve.';
          v_blocking := v_blocking || jsonb_build_array(v_label || ': ' || v_warning);
        END IF;
        v_cat := v_master.transport_category;
        IF v_cat IS NULL THEN
          v_blocking := v_blocking || jsonb_build_array(
            v_label || ': Hiányzó szállítási kategória az ADR törzsben.'
          );
          v_mult := 0;
        ELSE
          v_mult := COALESCE(v_master.multiplier, public.adr_default_multiplier(v_cat));
        END IF;
        v_doc := public.format_adr_transport_document_text(
          v_master.un_number,
          v_master.proper_shipping_name_hu,
          v_master.hazard_labels,
          v_master.tunnel_restriction_code,
          v_master.transport_document_text
        );
      END IF;

      v_per_unit := 0;
      v_unit := NULL;
      IF v_basis = 'water_capacity_l' OR v_basis = 'volume_l' THEN
        IF v_water IS NOT NULL AND v_water > 0 THEN
          v_per_unit := v_water;
          v_unit := 'L';
        END IF;
      ELSIF v_basis = 'net_mass_kg' THEN
        IF v_net IS NOT NULL AND v_net > 0 THEN
          v_per_unit := v_net;
          v_unit := 'kg';
        END IF;
      END IF;

      IF (v_basis IN ('water_capacity_l', 'volume_l', 'net_mass_kg')) AND v_per_unit = 0 THEN
        v_blocking := v_blocking || jsonb_build_array(
          v_label || ': hiányzó víztérfogat/nettó töltet az ADR számításhoz.'
        );
      END IF;

      v_points := v_per_unit * COALESCE(v_mult, 0) * v_item.quantity;
      IF v_cat = 1 THEN v_cat1 := v_cat1 + v_points; END IF;
      IF v_cat = 2 THEN v_cat2 := v_cat2 + v_points; END IF;
      IF v_cat = 3 THEN v_cat3 := v_cat3 + v_points; END IF;

      v_line_json := jsonb_build_object(
        'id', v_line_id,
        'state', v_item.cylinder_state,
        'quantity', v_item.quantity,
        'includedInDangerousGoods', true,
        'adrQuantity', v_per_unit * v_item.quantity,
        'adrQuantityUnit', v_unit,
        'transportCategory', v_cat,
        'multiplier', COALESCE(v_mult, 0),
        'points', v_points,
        'documentLineText', v_doc,
        'businessLabel', v_label,
        'warning', v_warning
      );
    END IF;

    v_adr_lines := v_adr_lines || jsonb_build_array(v_line_json);

    v_biz_items := v_biz_items || jsonb_build_array(
      jsonb_build_object(
        'lineRole', v_item.line_role,
        'cylinderState', v_item.cylinder_state,
        'gasType', v_item.gas_type,
        'size', v_item.size,
        'quantity', v_item.quantity,
        'barcode', v_item.barcode,
        'waterCapacityL', v_water,
        'netGasMassKg', v_net,
        'adrProductKey', NULLIF(v_key, ''),
        'note', v_item.note,
        'adrProduct', CASE
          WHEN v_product_json IS NULL THEN NULL
          ELSE jsonb_build_object(
            'unNumber', v_product_json->'unNumber',
            'properShippingNameHu', v_product_json->'properShippingNameHu',
            'adrClass', v_product_json->'adrClass',
            'classificationCode', v_product_json->'classificationCode',
            'hazardLabels', v_product_json->'hazardLabels',
            'tunnelRestrictionCode', v_product_json->'tunnelRestrictionCode',
            'transportCategory', v_product_json->'transportCategory',
            'multiplier', v_product_json->'multiplier',
            'quantityBasis', v_product_json->'quantityBasis',
            'verified', v_product_json->'verified',
            'rulesetVersion', v_product_json->'rulesetVersion',
            'transportDocumentText', v_product_json->'transportDocumentText'
          )
        END,
        'adrLine', v_line_json
      )
    );
  END LOOP;

  v_total := v_cat1 + v_cat2 + v_cat3;
  v_within := v_total <= 1000;
  v_status_hu := CASE
    WHEN v_within THEN 'Mennyiségi állapot: ADR 1.1.3.6 határán belül'
    ELSE 'FIGYELEM: ADR 1.1.3.6 mennyiségi határ túllépve'
  END;
  IF v_empty_uncleaned > 0 THEN
    v_empty_agg := 'ÜRES TARTÁLY, 2 (összesen ' || v_empty_uncleaned::text || ' db üres, tisztítatlan gáztartály)';
  ELSE
    v_empty_agg := NULL;
  END IF;

  -- Deduplicate blocking warnings (simple unique via DISTINCT jsonb_array_elements_text)
  SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb)
  INTO v_blocking
  FROM jsonb_array_elements_text(v_blocking) AS t(x);

  v_adr := jsonb_build_object(
    'rulesetVersion', v_ruleset,
    'lines', v_adr_lines,
    'pointsByCategory', jsonb_build_object('cat1', v_cat1, 'cat2', v_cat2, 'cat3', v_cat3),
    'emptyUncleanedCount', v_empty_uncleaned,
    'totalPoints', v_total,
    'within116Exemption', v_within,
    'statusLabelHu', v_status_hu,
    'emptyTankAggregateText', v_empty_agg,
    'blockingWarnings', v_blocking,
    'frozenAt', v_frozen_at
  );

  v_business := jsonb_build_object(
    'version', 1,
    'shipperName', v_shipper_name,
    'shipperAddress', v_shipper_address,
    'consigneeName', v_consignee_name,
    'consigneeAddress', v_consignee_address,
    'deliveryAddress', v_note.delivery_address,
    'vehiclePlate', v_note.vehicle_plate,
    'driverName', v_note.driver_name,
    'items', v_biz_items
  );

  RETURN jsonb_build_object(
    'adr_snapshot', v_adr,
    'business_snapshot', v_business,
    'adr_total_points', v_total,
    'adr_within_116', v_within,
    'adr_ruleset_version', v_ruleset
  );
END;
$$;

REVOKE ALL ON FUNCTION public.build_delivery_note_finalize_snapshots(uuid) FROM PUBLIC;
-- Internal helper — not granted to authenticated (called only from finalize RPC)

-- ---------------------------------------------------------------------------
-- Drop OLD client-trust finalize overload (must not remain callable)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finalize_delivery_note(uuid, jsonb, jsonb, numeric, boolean, text);

-- ---------------------------------------------------------------------------
-- New finalize: only delivery note id — server builds all authority data
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_delivery_note(p_delivery_note_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note public.delivery_notes%ROWTYPE;
  v_docnum text;
  v_updated integer;
  v_payload jsonb;
  v_item_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_exchange() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Insufficient privilege' USING ERRCODE = '42501';
  END IF;

  -- 1) Lock draft note
  SELECT * INTO v_note
  FROM public.delivery_notes
  WHERE id = p_delivery_note_id
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

  -- 2) Lock items (TOCTOU)
  PERFORM 1
  FROM public.delivery_note_items
  WHERE delivery_note_id = p_delivery_note_id
  FOR UPDATE;

  SELECT count(*)::integer INTO v_item_count
  FROM public.delivery_note_items
  WHERE delivery_note_id = p_delivery_note_id;
  IF v_item_count IS NULL OR v_item_count < 1 THEN
    RAISE EXCEPTION 'Szállítólevélnek legalább egy tétele kell' USING ERRCODE = 'P0001';
  END IF;

  -- 3) Server-side business + ADR snapshots (ignores any client payload — none accepted)
  v_payload := public.build_delivery_note_finalize_snapshots(p_delivery_note_id);

  -- 4) Allocate number + finalize in same transaction
  v_docnum := public.allocate_delivery_note_number(v_note.organization_id, EXTRACT(YEAR FROM now())::integer);

  PERFORM set_config('app.delivery_note_bypass', '1', true);

  UPDATE public.delivery_notes
  SET
    status = 'finalized',
    document_number = v_docnum,
    issued_at = now(),
    finalized_at = now(),
    finalized_by = auth.uid(),
    adr_snapshot = v_payload->'adr_snapshot',
    business_snapshot = v_payload->'business_snapshot',
    adr_total_points = (v_payload->>'adr_total_points')::numeric,
    adr_within_116 = (v_payload->>'adr_within_116')::boolean,
    adr_ruleset_version = COALESCE(v_payload->>'adr_ruleset_version', adr_ruleset_version),
    pdf_base64 = NULL,
    updated_at = now()
  WHERE id = p_delivery_note_id
    AND status = 'draft';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Finalize sikertelen: frissített sorok száma (%)', v_updated
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_note FROM public.delivery_notes WHERE id = p_delivery_note_id;

  RETURN jsonb_build_object(
    'id', v_note.id,
    'document_number', v_note.document_number,
    'status', v_note.status,
    'issued_at', v_note.issued_at,
    'finalized_at', v_note.finalized_at,
    'finalized_by', v_note.finalized_by,
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
    'pdf_attached', (v_note.pdf_base64 IS NOT NULL),
    'authority', 'server'
  );
END;
$$;

COMMENT ON FUNCTION public.finalize_delivery_note(uuid) IS
  'Server-side finalize authority. Only p_delivery_note_id accepted. '
  'ADR/business snapshots and totals are computed from DB (items + adr_product_master + partner/org). '
  'Client snapshot parameters are intentionally not part of this signature (dropped overload).';

REVOKE ALL ON FUNCTION public.finalize_delivery_note(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_delivery_note(uuid) TO authenticated;

-- Ensure old signature cannot remain via alternate name
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'finalize_delivery_note'
      AND pg_get_function_identity_arguments(p.oid) <> 'p_delivery_note_id uuid'
  ) THEN
    RAISE EXCEPTION 'Unexpected finalize_delivery_note overload still exists: %',
      (SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'finalize_delivery_note');
  END IF;
END $$;
