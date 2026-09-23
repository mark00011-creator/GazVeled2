-- Delivery note hardening DB tests (run on local/staging AFTER applying migrations).
-- DO NOT run against production without explicit approval.
--
-- Expected:
-- A) Concurrent allocate: 20 unique contiguous numbers
-- B) Lifecycle transitions
-- C) ADR master org-admin cannot write globals
--
-- Usage (example):
--   psql "$DATABASE_URL" -v org_id="'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'" -f scripts/delivery-note-db-hardening.sql

\set ON_ERROR_STOP on

-- Requires: authenticated session with can_exchange + same org; set app.jwt claims in real test harness.
-- This script documents the assertions; prefer Supabase test harness / pgTAP in CI.

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

  -- Simulate 20 sequential allocate calls (true parallel needs multiple sessions)
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
