-- LIVE DB validation harness for bf452a3
-- TARGET: validation project only (never production)
-- Runs as privileged SQL (MCP execute_sql). Uses JWT claim simulation for auth.uid().

CREATE TEMP TABLE IF NOT EXISTS live_validation_results (
  section text,
  test_name text,
  status text,
  detail text
);

CREATE OR REPLACE FUNCTION pg_temp.assert_pass(p_section text, p_name text, p_ok boolean, p_detail text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO live_validation_results VALUES (
    p_section, p_name, CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END, p_detail
  );
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.drop_draft_note(p_note uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.delivery_notes WHERE id = p_note AND status = 'draft') THEN
    RETURN;
  END IF;
  DELETE FROM public.delivery_note_items WHERE delivery_note_id = p_note;
  DELETE FROM public.delivery_notes WHERE id = p_note;
END;
$$;

DO $$
DECLARE
  v_org_a uuid := 'a0000000-0000-4000-8000-000000000001';
  v_org_b uuid := 'a0000000-0000-4000-8000-000000000002';
  v_user_a uuid := 'b0000000-0000-4000-8000-0000000000a1';
  v_user_b uuid := 'b0000000-0000-4000-8000-0000000000b1';
  v_partner_a uuid;
  v_partner_b uuid;
  v_note uuid;
  v_payload jsonb;
  v_fin jsonb;
  v_nums text[];
  v_n text;
  v_i int;
  v_ok boolean;
  v_err text;
  v_doc text;
  v_status text;
  v_cnt int;
  v_snap jsonb;
  v_total numeric;
  v_cat int;
  v_verified boolean;
  v_un text;
  v_consignee text;
  v_notes uuid[] := '{}';
  v_year int := 2098;
BEGIN
  -- Seed PB master for ADR cases (cat 2 ×3) if missing
  INSERT INTO public.adr_product_master (
    organization_id, gas_type_key, ruleset_version, un_number, proper_shipping_name_hu,
    adr_class, hazard_labels, tunnel_restriction_code, transport_category, multiplier,
    quantity_basis, verified, verified_at, source, transport_document_text
  )
  SELECT NULL, 'pb', 'ADR-2025', '1965', 'SZÉNHIDROGÉN-GÁZKEVERÉK, CSEPPFOLYÓSÍTOTT, M.N.N.',
    '2', ARRAY['2.1']::text[], 'B/D', 2::smallint, 3::numeric,
    'net_mass_kg', true, now(), 'LIVE validation seed',
    'UN 1965 SZÉNHIDROGÉN-GÁZKEVERÉK, CSEPPFOLYÓSÍTOTT, M.N.N., 2.1, (B/D)'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.adr_product_master WHERE organization_id IS NULL AND gas_type_key='pb' AND ruleset_version='ADR-2025'
  );

  -- Auth users (idempotent)
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'live-a@validation.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'live-b@validation.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, email, full_name, organization_id, is_active, role)
  VALUES
    (v_user_a, 'live-a@validation.local', 'Live User A', v_org_a, true, 'admin'),
    (v_user_b, 'live-b@validation.local', 'Live User B', v_org_b, true, 'admin')
  ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, is_active = true, role = 'admin';

  -- Roles table (legacy / dual path)
  INSERT INTO public.user_roles (user_id, role)
  SELECT v_user_a, 'admin'::public.app_role
  WHERE NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=v_user_a AND role='admin'::public.app_role);
  INSERT INTO public.user_roles (user_id, role)
  SELECT v_user_b, 'admin'::public.app_role
  WHERE NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=v_user_b AND role='admin'::public.app_role);

  -- Partners
  INSERT INTO public.partners (id, organization_id, type, name, address)
  VALUES (gen_random_uuid(), v_org_a, 'company', 'Valódi Partner Kft.', 'Valódi út 1.')
  RETURNING id INTO v_partner_a;
  -- if conflict path - fetch existing
  IF v_partner_a IS NULL THEN
    SELECT id INTO v_partner_a FROM public.partners WHERE organization_id=v_org_a AND name='Valódi Partner Kft.' LIMIT 1;
  END IF;
  INSERT INTO public.partners (organization_id, type, name, address)
  VALUES (v_org_b, 'company', 'ORG B Partner', 'B út 2.')
  RETURNING id INTO v_partner_b;

  -- Helper to set JWT
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);

  -- ========== TRUST BOUNDARY via build_delivery_note_finalize_snapshots ==========
  INSERT INTO public.delivery_notes (
    organization_id, status, partner_id, shipper_name, consignee_name, consignee_address,
    delivery_address, source_type, adr_ruleset_version, created_by
  ) VALUES (
    v_org_a, 'draft', v_partner_a, 'Hamis Shipper', 'Hamis Partner Kft.', 'Hamis cím',
    'Telephely', 'manual', 'ADR-2025', v_user_a
  ) RETURNING id INTO v_note;

  INSERT INTO public.delivery_note_items (
    delivery_note_id, organization_id, line_role, cylinder_state, gas_type, size, quantity,
    water_capacity_l, adr_product_key, sort_order
  ) VALUES (
    v_note, v_org_a, 'outgoing_full', 'FULL', 'Oxigén', '50 L', 3, 50, 'oxigén', 0
  );

  v_payload := public.build_delivery_note_finalize_snapshots(v_note);
  v_un := v_payload->'business_snapshot'->'items'->0->'adrProduct'->>'unNumber';
  v_total := (v_payload->>'adr_total_points')::numeric;
  v_verified := (v_payload->'business_snapshot'->'items'->0->'adrProduct'->>'verified')::boolean;
  v_cat := (v_payload->'adr_snapshot'->'lines'->0->>'transportCategory')::int;
  v_consignee := v_payload->'business_snapshot'->>'consigneeName';

  PERFORM pg_temp.assert_pass('trust', 'A UN 1072 not 9999', v_un = '1072', 'got=' || coalesce(v_un,'null'));
  PERFORM pg_temp.assert_pass('trust', 'B ADR total 150 not 0', v_total = 150, 'got=' || coalesce(v_total::text,'null'));
  PERFORM pg_temp.assert_pass('trust', 'D partner from DB', v_consignee = 'Valódi Partner Kft.', 'got=' || coalesce(v_consignee,'null'));
  PERFORM pg_temp.assert_pass('trust', 'E category 3 points 150', v_cat = 3 AND v_total = 150, format('cat=%s total=%s', v_cat, v_total));

  -- Verified=false (stargon)
  DELETE FROM public.delivery_note_items WHERE delivery_note_id = v_note;
  INSERT INTO public.delivery_note_items (
    delivery_note_id, organization_id, line_role, cylinder_state, gas_type, size, quantity,
    water_capacity_l, adr_product_key, sort_order
  ) VALUES (
    v_note, v_org_a, 'outgoing_full', 'FULL', 'Stargon', '50 L', 1, 50, 'stargon', 0
  );
  v_payload := public.build_delivery_note_finalize_snapshots(v_note);
  v_verified := (v_payload->'business_snapshot'->'items'->0->'adrProduct'->>'verified')::boolean;
  PERFORM pg_temp.assert_pass(
    'trust', 'C verified false',
    v_verified IS FALSE AND jsonb_array_length(v_payload->'adr_snapshot'->'blockingWarnings') > 0,
    'verified=' || coalesce(v_verified::text,'null')
  );

  -- Finalize RPC signature: old overload must not exist
  SELECT count(*)::int INTO v_cnt FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='finalize_delivery_note';
  PERFORM pg_temp.assert_pass('trust', 'finalize single overload', v_cnt = 1, 'count=' || v_cnt);

  -- Reset note to O2 for finalize lifecycle
  DELETE FROM public.delivery_note_items WHERE delivery_note_id = v_note;
  INSERT INTO public.delivery_note_items (
    delivery_note_id, organization_id, line_role, cylinder_state, gas_type, size, quantity,
    water_capacity_l, adr_product_key, sort_order
  ) VALUES (
    v_note, v_org_a, 'outgoing_full', 'FULL', 'Oxigén', '50 L', 3, 50, 'oxigén', 0
  );

  -- ========== LIFECYCLE finalize ==========
  BEGIN
    v_fin := public.finalize_delivery_note(v_note);
    PERFORM pg_temp.assert_pass('lifecycle', 'DRAFT->FINALIZED', v_fin->>'status' = 'finalized', v_fin->>'document_number');
    PERFORM pg_temp.assert_pass('lifecycle', 'document_number server', (v_fin->>'document_number') LIKE 'SZL-%', v_fin->>'document_number');
    PERFORM pg_temp.assert_pass('lifecycle', 'finalized_by auth', (v_fin->>'finalized_by') = v_user_a::text, coalesce(v_fin->>'finalized_by','null'));
    PERFORM pg_temp.assert_pass('trust', 'finalize total 150', (v_fin->>'adr_total_points')::numeric = 150, v_fin->>'adr_total_points');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_pass('lifecycle', 'DRAFT->FINALIZED', false, SQLERRM);
  END;

  -- FINALIZED -> FINALIZED fail
  BEGIN
    PERFORM public.finalize_delivery_note(v_note);
    PERFORM pg_temp.assert_pass('lifecycle', 'FINALIZED->FINALIZED fail', false, 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_pass('lifecycle', 'FINALIZED->FINALIZED fail', true, SQLERRM);
  END;

  -- Immutability UPDATE
  BEGIN
    UPDATE public.delivery_notes SET consignee_name = 'HACK' WHERE id = v_note;
    PERFORM pg_temp.assert_pass('immutability', 'UPDATE business field', false, 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_pass('immutability', 'UPDATE business field', true, SQLERRM);
  END;
  BEGIN
    UPDATE public.delivery_notes SET adr_snapshot = '{}'::jsonb WHERE id = v_note;
    PERFORM pg_temp.assert_pass('immutability', 'UPDATE snapshot', false, 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_pass('immutability', 'UPDATE snapshot', true, SQLERRM);
  END;
  BEGIN
    UPDATE public.delivery_notes SET document_number = 'SZL-HACK' WHERE id = v_note;
    PERFORM pg_temp.assert_pass('immutability', 'UPDATE document_number', false, 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_pass('immutability', 'UPDATE document_number', true, SQLERRM);
  END;
  BEGIN
    DELETE FROM public.delivery_notes WHERE id = v_note;
    PERFORM pg_temp.assert_pass('immutability', 'DELETE finalized', false, 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_pass('immutability', 'DELETE finalized', true, SQLERRM);
  END;
  BEGIN
    UPDATE public.delivery_note_items SET quantity = 99 WHERE delivery_note_id = v_note;
    PERFORM pg_temp.assert_pass('immutability', 'UPDATE item', false, 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_pass('immutability', 'UPDATE item', true, SQLERRM);
  END;
  BEGIN
    DELETE FROM public.delivery_note_items WHERE delivery_note_id = v_note;
    PERFORM pg_temp.assert_pass('immutability', 'DELETE item', false, 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_pass('immutability', 'DELETE item', true, SQLERRM);
  END;

  -- Snapshot integrity: mutate sources then rebuild PDF path uses stored snapshot
  SELECT adr_snapshot INTO v_snap FROM public.delivery_notes WHERE id = v_note;
  UPDATE public.partners SET name = 'MUTATED Partner' WHERE id = v_partner_a;
  UPDATE public.adr_product_master SET un_number = '9999', proper_shipping_name_hu = 'HAMIS' WHERE gas_type_key='oxigén' AND organization_id IS NULL;
  -- stored snapshot must still be 1072
  PERFORM pg_temp.assert_pass(
    'snapshot', 'stored UN after master mutate',
    (v_snap->'lines'->0->>'documentLineText') LIKE '%1072%',
    left(coalesce(v_snap->'lines'->0->>'documentLineText',''), 80)
  );
  -- restore master
  UPDATE public.adr_product_master SET un_number = '1072', proper_shipping_name_hu = 'OXIGÉN, SŰRÍTETT' WHERE gas_type_key='oxigén' AND organization_id IS NULL;
  UPDATE public.partners SET name = 'Valódi Partner Kft.' WHERE id = v_partner_a;

  -- Cancel
  BEGIN
    v_fin := public.cancel_delivery_note(v_note, 'Teszt érvénytelenítés', NULL);
    PERFORM pg_temp.assert_pass('lifecycle', 'FINALIZED->CANCELLED', v_fin->>'status' = 'cancelled', v_fin->>'cancellation_reason');
    SELECT document_number, status INTO v_doc, v_status FROM public.delivery_notes WHERE id = v_note;
    PERFORM pg_temp.assert_pass('lifecycle', 'cancel keeps document_number', v_doc IS NOT NULL AND v_status='cancelled', v_doc);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_pass('lifecycle', 'FINALIZED->CANCELLED', false, SQLERRM);
  END;

  BEGIN
    UPDATE public.delivery_notes SET consignee_name='X' WHERE id=v_note;
    PERFORM pg_temp.assert_pass('immutability', 'UPDATE cancelled', false, 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_pass('immutability', 'UPDATE cancelled', true, SQLERRM);
  END;
  BEGIN
    DELETE FROM public.delivery_notes WHERE id=v_note;
    PERFORM pg_temp.assert_pass('immutability', 'DELETE cancelled', false, 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_pass('immutability', 'DELETE cancelled', true, SQLERRM);
  END;

  -- Cancel without reason
  INSERT INTO public.delivery_notes (organization_id, status, shipper_name, consignee_name, source_type, created_by)
  VALUES (v_org_a, 'draft', 'S', 'C', 'manual', v_user_a) RETURNING id INTO v_note;
  INSERT INTO public.delivery_note_items (delivery_note_id, organization_id, line_role, cylinder_state, gas_type, size, quantity, water_capacity_l, adr_product_key)
  VALUES (v_note, v_org_a, 'outgoing_full', 'FULL', 'Oxigén', '50 L', 1, 50, 'oxigén');
  v_fin := public.finalize_delivery_note(v_note);
  BEGIN
    PERFORM public.cancel_delivery_note(v_note, '   ', NULL);
    PERFORM pg_temp.assert_pass('lifecycle', 'cancel reason required', false, 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_pass('lifecycle', 'cancel reason required', true, SQLERRM);
  END;

  -- ========== ADR LIVE CASES via snapshot builder ==========
  -- O2 3x50 = 150
  INSERT INTO public.delivery_notes (organization_id, status, shipper_name, consignee_name, source_type, created_by)
  VALUES (v_org_a, 'draft', 'S', 'C', 'manual', v_user_a) RETURNING id INTO v_note;
  INSERT INTO public.delivery_note_items (delivery_note_id, organization_id, line_role, cylinder_state, gas_type, size, quantity, water_capacity_l, adr_product_key)
  VALUES (v_note, v_org_a, 'outgoing_full', 'FULL', 'Oxigén', '50 L', 3, 50, 'oxigén');
  v_payload := public.build_delivery_note_finalize_snapshots(v_note);
  PERFORM pg_temp.assert_pass('adr', 'O2 3x50=150', (v_payload->>'adr_total_points')::numeric = 150, v_payload->>'adr_total_points');

  -- O2 + empty
  INSERT INTO public.delivery_note_items (delivery_note_id, organization_id, line_role, cylinder_state, gas_type, size, quantity, water_capacity_l, adr_product_key, sort_order)
  VALUES (v_note, v_org_a, 'incoming_empty', 'EMPTY_UNCLEANED', 'Oxigén', '50 L', 3, 50, 'oxigén', 1);
  v_payload := public.build_delivery_note_finalize_snapshots(v_note);
  PERFORM pg_temp.assert_pass('adr', 'O2+empty=150', (v_payload->>'adr_total_points')::numeric = 150
    AND (v_payload->'adr_snapshot'->>'emptyTankAggregateText') LIKE '%ÜRES TARTÁLY%', v_payload->>'adr_total_points');

  -- CO2 26 / 27
  PERFORM pg_temp.drop_draft_note(v_note);
  INSERT INTO public.delivery_notes (organization_id, status, shipper_name, consignee_name, source_type, created_by)
  VALUES (v_org_a, 'draft', 'S', 'C', 'manual', v_user_a) RETURNING id INTO v_note;
  INSERT INTO public.delivery_note_items (delivery_note_id, organization_id, line_role, cylinder_state, gas_type, size, quantity, net_gas_mass_kg, adr_product_key)
  VALUES (v_note, v_org_a, 'outgoing_full', 'FULL', 'CO2', '37.5 kg', 26, 37.5, 'szén-dioxid');
  v_payload := public.build_delivery_note_finalize_snapshots(v_note);
  PERFORM pg_temp.assert_pass('adr', 'CO2 26x37.5=975', (v_payload->>'adr_total_points')::numeric = 975, v_payload->>'adr_total_points');
  UPDATE public.delivery_note_items SET quantity = 27 WHERE delivery_note_id = v_note;
  v_payload := public.build_delivery_note_finalize_snapshots(v_note);
  PERFORM pg_temp.assert_pass('adr', 'CO2 27x37.5=1012.5', (v_payload->>'adr_total_points')::numeric = 1012.5, v_payload->>'adr_total_points');

  -- PB 28 / 29
  PERFORM pg_temp.drop_draft_note(v_note);
  INSERT INTO public.delivery_notes (organization_id, status, shipper_name, consignee_name, source_type, created_by)
  VALUES (v_org_a, 'draft', 'S', 'C', 'manual', v_user_a) RETURNING id INTO v_note;
  INSERT INTO public.delivery_note_items (delivery_note_id, organization_id, line_role, cylinder_state, gas_type, size, quantity, net_gas_mass_kg, adr_product_key)
  VALUES (v_note, v_org_a, 'outgoing_full', 'FULL', 'PB', '11.5 kg', 28, 11.5, 'pb');
  v_payload := public.build_delivery_note_finalize_snapshots(v_note);
  PERFORM pg_temp.assert_pass('adr', 'PB 28x11.5x3=966', (v_payload->>'adr_total_points')::numeric = 966, v_payload->>'adr_total_points');
  UPDATE public.delivery_note_items SET quantity = 29 WHERE delivery_note_id = v_note;
  v_payload := public.build_delivery_note_finalize_snapshots(v_note);
  PERFORM pg_temp.assert_pass('adr', 'PB 29x11.5x3=1000.5', (v_payload->>'adr_total_points')::numeric = 1000.5, v_payload->>'adr_total_points');

  -- Mixed 845
  PERFORM pg_temp.drop_draft_note(v_note);
  INSERT INTO public.delivery_notes (organization_id, status, shipper_name, consignee_name, source_type, created_by)
  VALUES (v_org_a, 'draft', 'S', 'C', 'manual', v_user_a) RETURNING id INTO v_note;
  INSERT INTO public.delivery_note_items (delivery_note_id, organization_id, line_role, cylinder_state, gas_type, size, quantity, water_capacity_l, net_gas_mass_kg, adr_product_key, sort_order)
  VALUES
    (v_note, v_org_a, 'outgoing_full', 'FULL', 'Oxigén', '50 L', 10, 50, NULL, 'oxigén', 0),
    (v_note, v_org_a, 'outgoing_full', 'FULL', 'PB', '11.5 kg', 10, NULL, 11.5, 'pb', 1);
  v_payload := public.build_delivery_note_finalize_snapshots(v_note);
  PERFORM pg_temp.assert_pass('adr', 'mixed=845', (v_payload->>'adr_total_points')::numeric = 845, v_payload->>'adr_total_points');

  -- Threshold
  DELETE FROM public.delivery_note_items WHERE delivery_note_id = v_note;
  INSERT INTO public.delivery_note_items (delivery_note_id, organization_id, line_role, cylinder_state, gas_type, size, quantity, water_capacity_l, adr_product_key)
  VALUES (v_note, v_org_a, 'outgoing_full', 'FULL', 'Oxigén', 'x', 1, 999.999, 'oxigén');
  v_payload := public.build_delivery_note_finalize_snapshots(v_note);
  PERFORM pg_temp.assert_pass('adr', 'threshold 999.999 within', (v_payload->>'adr_within_116')::boolean IS TRUE, v_payload->>'adr_total_points');
  UPDATE public.delivery_note_items SET water_capacity_l = 1000, quantity = 1 WHERE delivery_note_id = v_note;
  v_payload := public.build_delivery_note_finalize_snapshots(v_note);
  PERFORM pg_temp.assert_pass('adr', 'threshold 1000 within', (v_payload->>'adr_within_116')::boolean IS TRUE AND (v_payload->>'adr_total_points')::numeric = 1000, v_payload->>'adr_total_points');
  UPDATE public.delivery_note_items SET water_capacity_l = 1000.001 WHERE delivery_note_id = v_note;
  v_payload := public.build_delivery_note_finalize_snapshots(v_note);
  PERFORM pg_temp.assert_pass('adr', 'threshold 1000.001 over', (v_payload->>'adr_within_116')::boolean IS FALSE, v_payload->>'adr_total_points');

  -- ========== 50 concurrent finalize (serial loop simulating UPSERT contention) ==========
  v_nums := '{}';
  FOR v_i IN 1..50 LOOP
    INSERT INTO public.delivery_notes (organization_id, status, shipper_name, consignee_name, source_type, created_by)
    VALUES (v_org_a, 'draft', 'S', 'C', 'manual', v_user_a) RETURNING id INTO v_note;
    INSERT INTO public.delivery_note_items (delivery_note_id, organization_id, line_role, cylinder_state, gas_type, size, quantity, water_capacity_l, adr_product_key)
    VALUES (v_note, v_org_a, 'outgoing_full', 'FULL', 'Oxigén', '50 L', 1, 50, 'oxigén');
    v_fin := public.finalize_delivery_note(v_note);
    v_nums := array_append(v_nums, v_fin->>'document_number');
  END LOOP;
  SELECT count(DISTINCT x) INTO v_cnt FROM unnest(v_nums) x;
  PERFORM pg_temp.assert_pass('concurrency', '50 unique numbers', v_cnt = 50 AND array_length(v_nums,1)=50,
    format('first=%s last=%s distinct=%s', v_nums[1], v_nums[50], v_cnt));

  -- ========== TWO ORG ==========
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);
  v_n := public.allocate_delivery_note_number(v_org_a, v_year);
  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_b::text, 'role', 'authenticated')::text, true);
  v_doc := public.allocate_delivery_note_number(v_org_b, v_year);
  -- Independent org sequences may share the same numeric suffix; prove separate rows.
  SELECT count(*)::int INTO v_cnt FROM public.delivery_note_sequences WHERE year = v_year;
  PERFORM pg_temp.assert_pass('concurrency', 'two-org independent sequences',
    v_cnt >= 2 AND v_n LIKE 'SZL-2098-%' AND v_doc LIKE 'SZL-2098-%'
      AND EXISTS (SELECT 1 FROM public.delivery_note_sequences WHERE organization_id=v_org_a AND year=v_year)
      AND EXISTS (SELECT 1 FROM public.delivery_note_sequences WHERE organization_id=v_org_b AND year=v_year),
    format('A=%s B=%s seq_rows=%s', v_n, v_doc, v_cnt));

  -- Reset JWT to A
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);

  -- ========== ROLLBACK: exception after allocate inside explicit block ==========
  -- Prove allocate+finalize atomicity: force failure by locking impossible state via invalid status mid-way
  -- Use a draft that we delete items after lock simulation: finalize should fail on zero items and not consume? 
  -- Actually allocate happens AFTER item count check in new RPC. Force fail with concurrent status change:
  INSERT INTO public.delivery_notes (organization_id, status, shipper_name, consignee_name, source_type, created_by)
  VALUES (v_org_a, 'draft', 'S', 'C', 'manual', v_user_a) RETURNING id INTO v_note;
  -- no items -> should fail before allocate
  BEGIN
    PERFORM public.finalize_delivery_note(v_note);
    PERFORM pg_temp.assert_pass('rollback', 'zero items fail', false, 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_pass('rollback', 'zero items fail', true, SQLERRM);
  END;
  SELECT status INTO v_status FROM public.delivery_notes WHERE id = v_note;
  PERFORM pg_temp.assert_pass('rollback', 'still draft after fail', v_status = 'draft', v_status);
  SELECT count(*) INTO v_cnt FROM public.delivery_note_sequences WHERE organization_id=v_org_a AND year = EXTRACT(YEAR FROM now())::int;
  -- sequence may exist from prior finalizes; ensure this failed note has no document_number
  SELECT document_number INTO v_doc FROM public.delivery_notes WHERE id = v_note;
  PERFORM pg_temp.assert_pass('rollback', 'no docnum on failed finalize', v_doc IS NULL, coalesce(v_doc,'null'));

  -- ========== ADR MASTER write deny (as authenticated role) ==========
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.adr_product_master (gas_type_key, ruleset_version, verified) VALUES ('hack','ADR-2025', true);
    RESET ROLE;
    PERFORM pg_temp.assert_pass('adr_master', 'org user INSERT fail', false, 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM pg_temp.assert_pass('adr_master', 'org user INSERT fail', true, SQLERRM);
  END;
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);

  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.adr_product_master SET verified = true WHERE gas_type_key='stargon' AND organization_id IS NULL;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    RESET ROLE;
    PERFORM pg_temp.assert_pass('adr_master', 'org user UPDATE blocked', v_cnt = 0, 'rowcount=' || v_cnt);
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM pg_temp.assert_pass('adr_master', 'org user UPDATE blocked', true, SQLERRM);
  END;

  -- Cross-org: user A cannot finalize org B note
  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_b::text, 'role', 'authenticated')::text, true);
  INSERT INTO public.delivery_notes (organization_id, status, shipper_name, consignee_name, source_type, created_by)
  VALUES (v_org_b, 'draft', 'S', 'C', 'manual', v_user_b) RETURNING id INTO v_note;
  INSERT INTO public.delivery_note_items (delivery_note_id, organization_id, line_role, cylinder_state, gas_type, size, quantity, water_capacity_l, adr_product_key)
  VALUES (v_note, v_org_b, 'outgoing_full', 'FULL', 'Oxigén', '50 L', 1, 50, 'oxigén');

  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.finalize_delivery_note(v_note);
    PERFORM pg_temp.assert_pass('rls', 'cross-org finalize fail', false, 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_pass('rls', 'cross-org finalize fail', true, SQLERRM);
  END;

END $$;

SELECT section, test_name, status, detail FROM live_validation_results ORDER BY section, test_name;
SELECT status, count(*)::int AS n FROM live_validation_results GROUP BY status ORDER BY 1;
