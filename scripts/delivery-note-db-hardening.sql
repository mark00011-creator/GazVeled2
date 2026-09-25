-- Delivery note hardening + server-side finalize DB probe
-- Run on local/staging AFTER applying:
--   20260923120000_delivery_notes_adr.sql
--   20260923140000_delivery_notes_hardening.sql
--   20260924120000_delivery_notes_server_side_finalize.sql
-- DO NOT run against production without explicit approval.
--
-- Validates (when harness provides authenticated can_exchange session):
-- A) Sequence allocate uniqueness
-- B) finalize_delivery_note(p_delivery_note_id uuid) — NO client snapshots
-- C) Tampering: client cannot pass p_adr_snapshot (signature rejected / missing)
-- D) Later readiness: 50 concurrent finalize, two-org numbering, cross-org RLS,
--    immutability, transaction rollback, snapshot integrity
--
-- Usage (example):
--   psql "$DATABASE_URL" -f scripts/delivery-note-db-hardening.sql

\set ON_ERROR_STOP on

-- Signature gate: only uuid finalize must exist
DO $$
DECLARE
  v_args text;
  v_n int;
BEGIN
  SELECT count(*)::int, string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
  INTO v_n, v_args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'finalize_delivery_note';

  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL finalize overload count=% args=%', v_n, v_args;
  END IF;
  IF v_args IS DISTINCT FROM 'p_delivery_note_id uuid' THEN
    RAISE EXCEPTION 'FAIL unexpected finalize signature: %', v_args;
  END IF;
  RAISE NOTICE 'PASS finalize signature: %', v_args;
END $$;

-- A) Sequence concurrency (serialize via FOR UPDATE of sequence row is inside UPSERT)
DO $$
DECLARE
  v_org uuid;
  v_nums text[] := '{}';
  v_n text;
  i int;
BEGIN
  SELECT id INTO v_org FROM public.organizations LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'SKIP: no organization';
    RETURN;
  END IF;

  FOR i IN 1..20 LOOP
    v_n := public.allocate_delivery_note_number(v_org, 2099);
    v_nums := array_append(v_nums, v_n);
  END LOOP;

  IF (SELECT count(DISTINCT x) FROM unnest(v_nums) x) <> 20 THEN
    RAISE EXCEPTION 'FAIL concurrent uniqueness';
  END IF;
  IF v_nums[1] IS NULL OR v_nums[20] IS NULL THEN
    RAISE EXCEPTION 'FAIL empty numbers';
  END IF;
  RAISE NOTICE 'PASS sequence batch: % .. %', v_nums[1], v_nums[20];
END $$;

-- B) Snapshot builder smoke (no auth) — uses DB rows only
DO $$
DECLARE
  v_note_id uuid;
  v_org uuid;
  v_payload jsonb;
BEGIN
  SELECT id INTO v_org FROM public.organizations LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'SKIP snapshot smoke: no organization';
    RETURN;
  END IF;

  INSERT INTO public.delivery_notes (
    organization_id, status, shipper_name, consignee_name, source_type, adr_ruleset_version
  ) VALUES (
    v_org, 'draft', 'Shipper', 'Consignee', 'manual', 'ADR-2025'
  ) RETURNING id INTO v_note_id;

  INSERT INTO public.delivery_note_items (
    delivery_note_id, organization_id, line_role, cylinder_state,
    gas_type, size, quantity, water_capacity_l, adr_product_key, sort_order
  ) VALUES (
    v_note_id, v_org, 'outgoing_full', 'FULL',
    'Oxigén', '50 L', 3, 50, 'oxigén', 0
  );

  v_payload := public.build_delivery_note_finalize_snapshots(v_note_id);

  IF (v_payload->'adr_snapshot'->>'totalPoints')::numeric IS DISTINCT FROM 150 THEN
    RAISE EXCEPTION 'FAIL expected 150 points, got %', v_payload->'adr_snapshot'->>'totalPoints';
  END IF;
  IF (v_payload->'business_snapshot'->'items'->0->'adrProduct'->>'unNumber') IS DISTINCT FROM '1072' THEN
    RAISE EXCEPTION 'FAIL expected UN 1072 from master';
  END IF;

  DELETE FROM public.delivery_notes WHERE id = v_note_id;
  RAISE NOTICE 'PASS server snapshot builder (O2 3x50L = 150, UN 1072)';
END $$;

-- C) Document later live validation checklist (not executed here without auth harness)
-- TODO live harness:
--   * 50 concurrent finalize_delivery_note(p_delivery_note_id)
--   * two-org numbering uniqueness
--   * cross-org RLS deny
--   * finalized immutability trigger
--   * mid-transaction rollback
--   * tampering via missing old overload (call with jsonb must fail)
--   * snapshot integrity after partner/master mutate
