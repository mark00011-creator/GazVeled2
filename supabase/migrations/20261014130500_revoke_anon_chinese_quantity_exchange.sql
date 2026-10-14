REVOKE EXECUTE ON FUNCTION public.record_chinese_quantity_exchange(
  uuid,
  text,
  text,
  integer,
  integer,
  uuid,
  text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.record_chinese_quantity_exchange(
  uuid,
  text,
  text,
  integer,
  integer,
  uuid,
  text
) FROM anon;

GRANT EXECUTE ON FUNCTION public.record_chinese_quantity_exchange(
  uuid,
  text,
  text,
  integer,
  integer,
  uuid,
  text
) TO authenticated;
