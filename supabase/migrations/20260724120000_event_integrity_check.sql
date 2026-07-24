-- Event Integrity Check: diagnosztika + health / statistics RPC-k (idempotens)

CREATE OR REPLACE FUNCTION public.event_engine_diagnostic()
RETURNS TABLE (
  level text,
  category text,
  message text,
  detail_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_events_exists boolean;
  v_history_exists boolean;
  v_required_indexes text[] := ARRAY[
    'idx_events_created_at',
    'idx_events_event_type',
    'idx_events_event_group',
    'idx_events_entity',
    'idx_events_related_entity',
    'idx_events_partner_id',
    'idx_events_supplier_id',
    'idx_events_payload_gin',
    'idx_events_metadata_gin'
  ];
  v_required_policies text[] := ARRAY['events auth select', 'events auth insert'];
  v_valid_event_types text[] := ARRAY[
    'quick_exchange',
    'supplier_exchange',
    'temp_to_real',
    'temp_to_chinese'
  ];
  v_group_required_types text[] := ARRAY[
    'quick_exchange',
    'supplier_exchange',
    'temp_to_real',
    'temp_to_chinese'
  ];
  v_valid_entity_types text[] := ARRAY[
    'cylinder',
    'rental',
    'partner',
    'supplier',
    'exchange'
  ];
  v_valid_sources text[] := ARRAY['gazveeled'];
  v_valid_severities text[] := ARRAY['info', 'warning', 'error'];
  v_idx text;
  v_policy text;
  v_missing_indexes bigint;
  v_missing_policies bigint;
  v_events_rls boolean;
  v_history_rls boolean;
  v_trigger_count bigint;
  v_grant_select boolean;
  v_grant_insert boolean;
  v_count bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'events'
  ) INTO v_events_exists;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'cylinder_history'
  ) INTO v_history_exists;

  IF v_events_exists THEN
    level := 'INFO';
    category := 'schema';
    message := 'public.events tábla létezik';
    detail_count := 1;
    RETURN NEXT;
  ELSE
    level := 'ERROR';
    category := 'schema';
    message := 'public.events tábla hiányzik';
    detail_count := 1;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_history_exists THEN
    level := 'INFO';
    category := 'schema';
    message := 'public.cylinder_history tábla létezik';
    detail_count := 1;
    RETURN NEXT;
  ELSE
    level := 'ERROR';
    category := 'schema';
    message := 'public.cylinder_history tábla hiányzik';
    detail_count := 1;
    RETURN NEXT;
  END IF;

  SELECT count(*)
  INTO v_missing_indexes
  FROM unnest(v_required_indexes) AS req(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.tablename = 'events'
      AND i.indexname = req.name
  );

  IF v_missing_indexes = 0 THEN
    level := 'INFO';
    category := 'indexes';
    message := 'events kötelező indexek megvannak';
    detail_count := array_length(v_required_indexes, 1);
    RETURN NEXT;
  ELSE
    level := 'ERROR';
    category := 'indexes';
    message := 'events kötelező index(ek) hiányoznak';
    detail_count := v_missing_indexes;
    RETURN NEXT;

    FOR v_idx IN
      SELECT req.name
      FROM unnest(v_required_indexes) AS req(name)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_indexes i
        WHERE i.schemaname = 'public'
          AND i.tablename = 'events'
          AND i.indexname = req.name
      )
    LOOP
      level := 'ERROR';
      category := 'indexes';
      message := format('hiányzó index: %s', v_idx);
      detail_count := 1;
      RETURN NEXT;
    END LOOP;
  END IF;

  SELECT c.relrowsecurity
  INTO v_events_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'events';

  IF coalesce(v_events_rls, false) THEN
    level := 'INFO';
    category := 'rls';
    message := 'events RLS engedélyezve';
    detail_count := 1;
    RETURN NEXT;
  ELSE
    level := 'ERROR';
    category := 'rls';
    message := 'events RLS nincs engedélyezve';
    detail_count := 1;
    RETURN NEXT;
  END IF;

  IF v_history_exists THEN
    SELECT c.relrowsecurity
    INTO v_history_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'cylinder_history';

    IF coalesce(v_history_rls, false) THEN
      level := 'INFO';
      category := 'rls';
      message := 'cylinder_history RLS engedélyezve';
      detail_count := 1;
      RETURN NEXT;
    ELSE
      level := 'WARNING';
      category := 'rls';
      message := 'cylinder_history RLS nincs engedélyezve';
      detail_count := 1;
      RETURN NEXT;
    END IF;
  END IF;

  SELECT count(*)
  INTO v_missing_policies
  FROM unnest(v_required_policies) AS req(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'events'
      AND p.policyname = req.name
  );

  IF v_missing_policies = 0 THEN
    level := 'INFO';
    category := 'policies';
    message := 'events policy-k megvannak';
    detail_count := array_length(v_required_policies, 1);
    RETURN NEXT;
  ELSE
    level := 'ERROR';
    category := 'policies';
    message := 'events policy(k) hiányoznak';
    detail_count := v_missing_policies;
    RETURN NEXT;

    FOR v_policy IN
      SELECT req.name
      FROM unnest(v_required_policies) AS req(name)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = 'events'
          AND p.policyname = req.name
      )
    LOOP
      level := 'ERROR';
      category := 'policies';
      message := format('hiányzó policy: %s', v_policy);
      detail_count := 1;
      RETURN NEXT;
    END LOOP;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.table_name = 'events'
      AND g.grantee = 'authenticated'
      AND g.privilege_type = 'SELECT'
  ) INTO v_grant_select;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.table_name = 'events'
      AND g.grantee = 'authenticated'
      AND g.privilege_type = 'INSERT'
  ) INTO v_grant_insert;

  IF v_grant_select AND v_grant_insert THEN
    level := 'INFO';
    category := 'grants';
    message := 'events GRANT-ok megfelelőek (authenticated SELECT/INSERT)';
    detail_count := 2;
    RETURN NEXT;
  ELSE
    level := 'ERROR';
    category := 'grants';
    message := 'events GRANT-ok hiányosak authenticated szerepkörhöz';
    detail_count := CASE WHEN v_grant_select THEN 0 ELSE 1 END + CASE WHEN v_grant_insert THEN 0 ELSE 1 END;
    RETURN NEXT;
  END IF;

  SELECT count(*)
  INTO v_trigger_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'events'
    AND NOT t.tgisinternal;

  level := 'INFO';
  category := 'triggers';
  message := 'events triggerek száma';
  detail_count := v_trigger_count;
  RETURN NEXT;

  SELECT count(*)
  INTO v_count
  FROM public.events e
  WHERE e.event_type IS NULL
     OR NOT (e.event_type = ANY (v_valid_event_types));

  IF v_count = 0 THEN
    level := 'INFO';
    category := 'event_type';
    message := 'minden events.event_type érvényes';
    detail_count := 0;
    RETURN NEXT;
  ELSE
    level := 'WARNING';
    category := 'event_type';
    message := 'ismeretlen vagy hiányzó events.event_type';
    detail_count := v_count;
    RETURN NEXT;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.events e
  WHERE e.entity_id IS NULL;

  IF v_count = 0 THEN
    level := 'INFO';
    category := 'entity_id';
    message := 'nincs NULL events.entity_id';
    detail_count := 0;
    RETURN NEXT;
  ELSE
    level := 'ERROR';
    category := 'entity_id';
    message := 'NULL events.entity_id sorok';
    detail_count := v_count;
    RETURN NEXT;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.events e
  WHERE e.event_type = ANY (v_group_required_types)
    AND e.event_group_id IS NULL;

  IF v_count = 0 THEN
    level := 'INFO';
    category := 'event_group_id';
    message := 'event_group_id kötelező típusoknál kitöltve';
    detail_count := 0;
    RETURN NEXT;
  ELSE
    level := 'WARNING';
    category := 'event_group_id';
    message := 'NULL event_group_id a csoportos eseményeknél';
    detail_count := v_count;
    RETURN NEXT;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM (
    SELECT e.event_group_id, e.entity_id, e.event_type
    FROM public.events e
    WHERE e.event_group_id IS NOT NULL
    GROUP BY e.event_group_id, e.entity_id, e.event_type
    HAVING count(*) > 1
  ) d;

  IF v_count = 0 THEN
    level := 'INFO';
    category := 'duplicates';
    message := 'nincs duplikált event_group_id + entity_id + event_type';
    detail_count := 0;
    RETURN NEXT;
  ELSE
    level := 'WARNING';
    category := 'duplicates';
    message := 'duplikált event_group_id + entity_id + event_type kombinációk';
    detail_count := v_count;
    RETURN NEXT;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.events e
  WHERE e.related_entity_id IS NOT NULL
    AND (
      e.related_entity_type IS NULL
      OR NOT (e.related_entity_type = ANY (v_valid_entity_types))
      OR CASE e.related_entity_type
        WHEN 'cylinder' THEN NOT EXISTS (SELECT 1 FROM public.cylinders c WHERE c.id = e.related_entity_id)
        WHEN 'rental' THEN NOT EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = e.related_entity_id)
        WHEN 'partner' THEN NOT EXISTS (SELECT 1 FROM public.partners p WHERE p.id = e.related_entity_id)
        WHEN 'supplier' THEN NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = e.related_entity_id)
        WHEN 'exchange' THEN NOT EXISTS (SELECT 1 FROM public.exchanges x WHERE x.id = e.related_entity_id)
        ELSE true
      END
    );

  IF v_count = 0 THEN
    level := 'INFO';
    category := 'related_entity';
    message := 'related_* hivatkozások érvényesek';
    detail_count := 0;
    RETURN NEXT;
  ELSE
    level := 'WARNING';
    category := 'related_entity';
    message := 'orphan vagy hibás related_* hivatkozások';
    detail_count := v_count;
    RETURN NEXT;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.events e
  WHERE e.entity_type IS NULL
     OR NOT (e.entity_type = ANY (v_valid_entity_types));

  IF v_count = 0 THEN
    level := 'INFO';
    category := 'entity_type';
    message := 'minden events.entity_type érvényes';
    detail_count := 0;
    RETURN NEXT;
  ELSE
    level := 'ERROR';
    category := 'entity_type';
    message := 'hibás events.entity_type értékek';
    detail_count := v_count;
    RETURN NEXT;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.events e
  WHERE coalesce(e.metadata ->> 'source', 'gazveeled') <> ALL (v_valid_sources);

  IF v_count = 0 THEN
    level := 'INFO';
    category := 'source';
    message := 'metadata.source értékek érvényesek';
    detail_count := 0;
    RETURN NEXT;
  ELSE
    level := 'WARNING';
    category := 'source';
    message := 'hibás metadata.source értékek';
    detail_count := v_count;
    RETURN NEXT;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.events e
  WHERE e.metadata ? 'severity'
    AND lower(e.metadata ->> 'severity') <> ALL (v_valid_severities);

  IF v_count = 0 THEN
    level := 'INFO';
    category := 'severity';
    message := 'metadata.severity értékek érvényesek (ha megadva)';
    detail_count := 0;
    RETURN NEXT;
  ELSE
    level := 'WARNING';
    category := 'severity';
    message := 'hibás metadata.severity értékek';
    detail_count := v_count;
    RETURN NEXT;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.events;

  level := 'INFO';
  category := 'volume';
  message := 'events sorok száma';
  detail_count := v_count;
  RETURN NEXT;

  IF v_history_exists THEN
    SELECT count(*)
    INTO v_count
    FROM public.cylinder_history;

    level := 'INFO';
    category := 'volume';
    message := 'cylinder_history sorok száma';
    detail_count := v_count;
    RETURN NEXT;
  END IF;

  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.event_engine_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_events_count bigint := 0;
  v_missing_links bigint := 0;
  v_orphan_events bigint := 0;
  v_duplicate_groups bigint := 0;
  v_error_count bigint := 0;
  v_warnings jsonb := '[]'::jsonb;
BEGIN
  IF to_regclass('public.events') IS NOT NULL THEN
    SELECT count(*) INTO v_events_count FROM public.events;
  END IF;

  IF to_regclass('public.events') IS NOT NULL AND to_regclass('public.cylinder_history') IS NOT NULL THEN
    SELECT count(*)
    INTO v_missing_links
    FROM public.cylinder_history ch
    WHERE ch.event_type IN ('quick_exchange', 'supplier_exchange', 'temp_to_serial', 'temp_to_chinese')
      AND ch.event_group_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.events e
        WHERE e.event_group_id = ch.event_group_id
          AND e.entity_id = ch.cylinder_id
          AND e.event_type = CASE ch.event_type
            WHEN 'temp_to_serial' THEN 'temp_to_real'
            ELSE ch.event_type
          END
      );

    SELECT count(*)
    INTO v_orphan_events
    FROM public.events e
    WHERE CASE e.entity_type
        WHEN 'cylinder' THEN NOT EXISTS (SELECT 1 FROM public.cylinders c WHERE c.id = e.entity_id)
        WHEN 'rental' THEN NOT EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = e.entity_id)
        WHEN 'partner' THEN NOT EXISTS (SELECT 1 FROM public.partners p WHERE p.id = e.entity_id)
        WHEN 'supplier' THEN NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = e.entity_id)
        WHEN 'exchange' THEN NOT EXISTS (SELECT 1 FROM public.exchanges x WHERE x.id = e.entity_id)
        ELSE true
      END
      OR (
        e.related_entity_id IS NOT NULL
        AND (
          e.related_entity_type IS NULL
          OR CASE e.related_entity_type
            WHEN 'cylinder' THEN NOT EXISTS (SELECT 1 FROM public.cylinders c WHERE c.id = e.related_entity_id)
            WHEN 'rental' THEN NOT EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = e.related_entity_id)
            WHEN 'partner' THEN NOT EXISTS (SELECT 1 FROM public.partners p WHERE p.id = e.related_entity_id)
            WHEN 'supplier' THEN NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = e.related_entity_id)
            WHEN 'exchange' THEN NOT EXISTS (SELECT 1 FROM public.exchanges x WHERE x.id = e.related_entity_id)
            ELSE true
          END
        )
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.cylinder_history ch
        WHERE ch.event_group_id = e.event_group_id
          AND ch.cylinder_id = e.entity_id
          AND ch.event_type = CASE e.event_type
            WHEN 'temp_to_real' THEN 'temp_to_serial'
            ELSE e.event_type
          END
      );

    SELECT count(*)
    INTO v_duplicate_groups
    FROM (
      SELECT e.event_group_id, e.entity_id, e.event_type
      FROM public.events e
      WHERE e.event_group_id IS NOT NULL
      GROUP BY e.event_group_id, e.entity_id, e.event_type
      HAVING count(*) > 1
    ) d;
  END IF;

  SELECT count(*)
  INTO v_error_count
  FROM public.event_engine_diagnostic() d
  WHERE d.level = 'ERROR';

  SELECT coalesce(jsonb_agg(d.message ORDER BY d.category, d.message), '[]'::jsonb)
  INTO v_warnings
  FROM public.event_engine_diagnostic() d
  WHERE d.level = 'WARNING';

  RETURN jsonb_build_object(
    'healthy', (v_error_count = 0 AND v_missing_links = 0 AND v_orphan_events = 0 AND v_duplicate_groups = 0),
    'events', v_events_count,
    'missing_links', v_missing_links,
    'orphan_events', v_orphan_events,
    'duplicate_groups', v_duplicate_groups,
    'warnings', v_warnings
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.event_statistics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_total bigint := 0;
  v_by_event_type jsonb := '[]'::jsonb;
  v_by_entity_type jsonb := '[]'::jsonb;
  v_by_source jsonb := '[]'::jsonb;
  v_by_severity jsonb := '[]'::jsonb;
  v_daily jsonb := '[]'::jsonb;
BEGIN
  IF to_regclass('public.events') IS NULL THEN
    RETURN jsonb_build_object(
      'total', 0,
      'by_event_type', '[]'::jsonb,
      'by_entity_type', '[]'::jsonb,
      'by_source', '[]'::jsonb,
      'by_severity', '[]'::jsonb,
      'daily_last_30_days', '[]'::jsonb
    );
  END IF;

  SELECT count(*) INTO v_total FROM public.events;

  SELECT coalesce(jsonb_agg(jsonb_build_object('event_type', t.event_type, 'count', t.cnt) ORDER BY t.cnt DESC, t.event_type), '[]'::jsonb)
  INTO v_by_event_type
  FROM (
    SELECT e.event_type, count(*) AS cnt
    FROM public.events e
    GROUP BY e.event_type
  ) t;

  SELECT coalesce(jsonb_agg(jsonb_build_object('entity_type', t.entity_type, 'count', t.cnt) ORDER BY t.cnt DESC, t.entity_type), '[]'::jsonb)
  INTO v_by_entity_type
  FROM (
    SELECT e.entity_type, count(*) AS cnt
    FROM public.events e
    GROUP BY e.entity_type
  ) t;

  SELECT coalesce(jsonb_agg(jsonb_build_object('source', t.source, 'count', t.cnt) ORDER BY t.cnt DESC, t.source), '[]'::jsonb)
  INTO v_by_source
  FROM (
    SELECT coalesce(e.metadata ->> 'source', 'gazveeled') AS source, count(*) AS cnt
    FROM public.events e
    GROUP BY 1
  ) t;

  SELECT coalesce(jsonb_agg(jsonb_build_object('severity', t.severity, 'count', t.cnt) ORDER BY t.cnt DESC, t.severity), '[]'::jsonb)
  INTO v_by_severity
  FROM (
    SELECT coalesce(e.metadata ->> 'severity', 'info') AS severity, count(*) AS cnt
    FROM public.events e
    GROUP BY 1
  ) t;

  SELECT coalesce(jsonb_agg(jsonb_build_object('day', t.day, 'count', t.cnt) ORDER BY t.day DESC), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT (e.created_at AT TIME ZONE 'Europe/Budapest')::date AS day, count(*) AS cnt
    FROM public.events e
    WHERE e.created_at >= now() - interval '30 days'
    GROUP BY 1
  ) t;

  RETURN jsonb_build_object(
    'total', v_total,
    'by_event_type', v_by_event_type,
    'by_entity_type', v_by_entity_type,
    'by_source', v_by_source,
    'by_severity', v_by_severity,
    'daily_last_30_days', v_daily
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.event_engine_diagnostic() TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_engine_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_statistics() TO authenticated;

GRANT EXECUTE ON FUNCTION public.event_engine_diagnostic() TO service_role;
GRANT EXECUTE ON FUNCTION public.event_engine_health() TO service_role;
GRANT EXECUTE ON FUNCTION public.event_statistics() TO service_role;

COMMENT ON FUNCTION public.event_engine_diagnostic() IS 'Event Engine integritás ellenőrzés – ERROR/WARNING/INFO sorok.';
COMMENT ON FUNCTION public.event_engine_health() IS 'Event Engine egészség JSON összesítő.';
COMMENT ON FUNCTION public.event_statistics() IS 'Event Engine statisztika JSON (típus, forrás, napi bontás).';
