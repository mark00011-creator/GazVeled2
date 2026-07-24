-- Event Engine Integrity Check (idempotens, read-only)
-- Production / Supabase SQL Editor: futtasd teljes egészében.
-- Előfeltétel: event_integrity_check migráció alkalmazva.

-- 1) Részletes ellenőrzések
SELECT
  level,
  category,
  message,
  detail_count
FROM public.event_engine_diagnostic()
ORDER BY
  CASE level
    WHEN 'ERROR' THEN 1
    WHEN 'WARNING' THEN 2
    ELSE 3
  END,
  category,
  message;

-- 2) Összesítés: ERROR / WARNING / INFO
SELECT
  level,
  count(*) AS check_count,
  sum(detail_count) AS issue_or_info_count
FROM public.event_engine_diagnostic()
GROUP BY level
ORDER BY
  CASE level
    WHEN 'ERROR' THEN 1
    WHEN 'WARNING' THEN 2
    ELSE 3
  END;

-- 3) Health RPC (JSON)
SELECT public.event_engine_health();

-- 4) Statisztika RPC (JSON)
SELECT public.event_statistics();
