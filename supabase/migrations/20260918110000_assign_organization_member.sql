-- Jogosultság modul: cégadmin hozzárendelhet felhasználót e-mail alapján
-- Production: snmiwsgtnokvqlnwvfwf

CREATE OR REPLACE FUNCTION public.assign_organization_member(
  p_email text,
  p_role text DEFAULT 'exchange_operator',
  p_full_name text DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_uid uuid;
  v_email text := lower(trim(p_email));
  v_existing_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  v_org := public.auth_organization_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Nincs cég hozzárendelve a fiókodhoz';
  END IF;

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Email kötelező';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('admin', 'exchange_operator', 'viewer') THEN
    RAISE EXCEPTION 'Érvénytelen szerepkör';
  END IF;

  SELECT id INTO v_uid
  FROM auth.users
  WHERE lower(email) = v_email
  LIMIT 1;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Nincs ilyen felhasználó: %. Előbb jelentkezzen be / regisztráljon az appban.', v_email;
  END IF;

  SELECT organization_id INTO v_existing_org
  FROM public.profiles
  WHERE id = v_uid;

  IF v_existing_org IS NOT NULL AND v_existing_org <> v_org THEN
    RAISE EXCEPTION 'A felhasználó már másik céghez tartozik';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, is_active, organization_id)
  VALUES (
    v_uid,
    v_email,
    NULLIF(trim(COALESCE(p_full_name, '')), ''),
    p_role,
    COALESCE(p_is_active, true),
    v_org
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    organization_id = v_org,
    updated_at = now();

  RETURN v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_organization_member(text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_organization_member(text, text, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.assign_organization_member(text, text, text, boolean) IS
  'Cégadmin: meglévő auth user hozzárendelése a saját organization-höz szerepkörrel.';
