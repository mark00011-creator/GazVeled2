-- Platform: több cég létrehozása, listázás, aktív cég váltás
-- Production: snmiwsgtnokvqlnwvfwf
-- Cégek NEM kapnak infra hozzáférést – platform admin (te) kezeli.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_platform_admin IS
  'Platform üzemeltető: új cég létrehozás, céglista, aktív cég váltás. Nem ügyféljog.';

-- Márk = platform admin (Gáz Veled)
UPDATE public.profiles
SET is_platform_admin = true, updated_at = now()
WHERE id = 'c1f07f26-98d8-4180-ae0a-08340418a856'::uuid
   OR lower(coalesce(email, '')) = 'marktheseeker@gmail.com';

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT is_platform_admin FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- Platform admin látja az összes céget
DROP POLICY IF EXISTS "organizations select platform" ON public.organizations;
CREATE POLICY "organizations select platform" ON public.organizations
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- Demo / minta cég (áfakörös, szűkebb modulok) – bemutatóhoz
INSERT INTO public.organizations (id, name, slug, logo_url, settings, is_active)
VALUES (
  'a0000000-0000-4000-8000-000000000002'::uuid,
  'Minta Gáztelep',
  'minta-gaztelep',
  NULL,
  jsonb_build_object(
    'modules', jsonb_build_object(
      'flaga_pb', false,
      'prima_pb', false,
      'chinese_stock', false,
      'rentals', true,
      'tool_rental', true,
      'quotes', true,
      'gas_orders', true,
      'suppliers', true
    ),
    'circulations', jsonb_build_array('own', 'siad'),
    'warehouse_bins', jsonb_build_array('Kaloda 1', 'Kaloda 2'),
    'invoicing', jsonb_build_object(
      'provider', NULL,
      'bill_own_circulation', false,
      'bill_siad_circulation', true,
      'bill_foreign_circulation', true
    ),
    'tax', jsonb_build_object(
      'regime', 'vat_registered',
      'default_rate', 27,
      'price_entry', 'net'
    )
  ),
  true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  settings = EXCLUDED.settings,
  is_active = true,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.create_organization(
  p_name text,
  p_slug text,
  p_admin_email text DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_tax_regime text DEFAULT 'vat_exempt',
  p_vat_rate numeric DEFAULT 27
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_slug text := lower(trim(p_slug));
  v_name text := trim(p_name);
  v_regime text := CASE WHEN p_tax_regime = 'vat_registered' THEN 'vat_registered' ELSE 'vat_exempt' END;
  v_rate numeric := coalesce(p_vat_rate, 27);
  v_admin uuid;
  v_email text := lower(trim(coalesce(p_admin_email, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin jogosultság kell';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'A cég neve kötelező';
  END IF;
  IF v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Érvénytelen slug (csak kisbetű, szám, kötőjel)';
  END IF;
  IF v_rate < 0 OR v_rate > 100 THEN
    RAISE EXCEPTION 'Érvénytelen ÁFA kulcs';
  END IF;

  INSERT INTO public.organizations (name, slug, logo_url, settings, is_active)
  VALUES (
    v_name,
    v_slug,
    NULLIF(trim(coalesce(p_logo_url, '')), ''),
    jsonb_build_object(
      'modules', jsonb_build_object(
        'flaga_pb', true,
        'prima_pb', true,
        'chinese_stock', true,
        'rentals', true,
        'tool_rental', true,
        'quotes', true,
        'gas_orders', true,
        'suppliers', true
      ),
      'circulations', jsonb_build_array('own', 'siad', 'berpalack'),
      'warehouse_bins', jsonb_build_array(),
      'invoicing', jsonb_build_object(
        'provider', NULL,
        'bill_own_circulation', false,
        'bill_siad_circulation', true,
        'bill_foreign_circulation', true
      ),
      'tax', jsonb_build_object(
        'regime', v_regime,
        'default_rate', v_rate,
        'price_entry', 'net'
      )
    ),
    true
  )
  RETURNING id INTO v_id;

  IF v_email <> '' THEN
    SELECT id INTO v_admin FROM auth.users WHERE lower(email) = v_email LIMIT 1;
    IF v_admin IS NULL THEN
      RAISE EXCEPTION 'Nincs ilyen felhasználó: %. Előbb regisztráljon az appban.', v_email;
    END IF;

    INSERT INTO public.profiles (id, email, full_name, role, is_active, organization_id)
    VALUES (v_admin, v_email, NULL, 'admin', true, v_id)
    ON CONFLICT (id) DO UPDATE SET
      organization_id = v_id,
      role = 'admin',
      is_active = true,
      email = EXCLUDED.email,
      updated_at = now();
  END IF;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    auth.uid(),
    'Cég létrehozva',
    'organization',
    v_id,
    jsonb_build_object('name', v_name, 'slug', v_slug, 'tax_regime', v_regime, 'admin_email', nullif(v_email, ''))
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization(text, text, text, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text, text, text, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_set_active_organization(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin jogosultság kell';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Cég kötelező';
  END IF;

  SELECT name INTO v_name FROM public.organizations WHERE id = p_organization_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A cég nem található vagy inaktív';
  END IF;

  UPDATE public.profiles
  SET organization_id = p_organization_id, updated_at = now()
  WHERE id = auth.uid();

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    auth.uid(),
    'Platform aktív cég váltás',
    'organization',
    p_organization_id,
    jsonb_build_object('organization_name', v_name)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.platform_set_active_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_set_active_organization(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_list_organizations()
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  logo_url text,
  is_active boolean,
  tax_regime text,
  member_count bigint,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id,
    o.name,
    o.slug,
    o.logo_url,
    o.is_active,
    coalesce(o.settings->'tax'->>'regime', 'vat_exempt') AS tax_regime,
    (SELECT count(*) FROM public.profiles p WHERE p.organization_id = o.id) AS member_count,
    o.created_at
  FROM public.organizations o
  WHERE public.is_platform_admin()
  ORDER BY o.created_at;
$$;

REVOKE ALL ON FUNCTION public.platform_list_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_list_organizations() TO authenticated;

COMMENT ON FUNCTION public.create_organization IS
  'Platform admin: új bérlő cég + opcionális első admin e-mail.';
COMMENT ON FUNCTION public.platform_set_active_organization IS
  'Platform admin: saját profil organization_id váltása (bemutató / support).';
COMMENT ON FUNCTION public.platform_list_organizations IS
  'Platform admin: összes cég listája tagszámmal.';
