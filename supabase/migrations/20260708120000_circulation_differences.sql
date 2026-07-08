-- Körforgás-eltérés (Circulation Difference) rendszer
-- Finom körforgás-kulcsok: siad_rental, own_siad, linde, messer, other, chinese, flaga_pb, prima_pb

DO $$ BEGIN
  CREATE TYPE public.circulation_difference_status AS ENUM ('open', 'partially_settled', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.exchange_operation_type ADD VALUE 'chinese_brought';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.exchange_operation_type ADD VALUE 'chinese_take';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Finom körforgás-kulcs palackból (megfelel a TS classifySerialCylinder logikának)
CREATE OR REPLACE FUNCTION public.derive_exchange_circulation_key(
  p_circulation public.circulation,
  p_manufacturer text
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_manufacturer = 'chinese' THEN 'chinese'
    WHEN p_circulation = 'siad' THEN 'siad_rental'
    WHEN p_manufacturer = 'siad' THEN 'own_siad'
    WHEN p_manufacturer = 'linde' THEN 'linde'
    WHEN p_manufacturer = 'messer' THEN 'messer'
    ELSE 'other'
  END;
$$;

COMMENT ON FUNCTION public.derive_exchange_circulation_key IS
  'Finom körforgás-kulcs palack circulation + manufacturer alapján (csere ajánlás, eltérés).';

-- Körforgás-eltérések
CREATE TABLE IF NOT EXISTS public.circulation_differences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Hozott / kiadott körforgás (finom kulcs, pl. chinese, own_siad)
  incoming_exchange_circulation text NOT NULL,
  outgoing_exchange_circulation text NOT NULL,
  incoming_gas_type text NOT NULL,
  outgoing_gas_type text NOT NULL,
  size text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  quantity_settled integer NOT NULL DEFAULT 0 CHECK (quantity_settled >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  status public.circulation_difference_status NOT NULL DEFAULT 'open',
  exchange_id uuid REFERENCES public.exchanges(id) ON DELETE SET NULL,
  CHECK (quantity_settled <= quantity)
);

COMMENT ON TABLE public.circulation_differences IS
  'Körforgás-eltérés – partner hozott és kapott körforgás eltérése (AI: nyitott eltérések partnerenként).';
COMMENT ON COLUMN public.circulation_differences.incoming_exchange_circulation IS 'Hozott körforgás finom kulcs';
COMMENT ON COLUMN public.circulation_differences.outgoing_exchange_circulation IS 'Kiadott körforgás finom kulcs';
COMMENT ON COLUMN public.circulation_differences.quantity IS 'Darabszám (sorszámos palacknál 1)';
COMMENT ON COLUMN public.circulation_differences.quantity_settled IS 'Eddig rendezett darabszám';
COMMENT ON COLUMN public.circulation_differences.exchange_id IS 'Létrehozó csere tranzakció';

CREATE INDEX IF NOT EXISTS idx_circulation_differences_partner_status
  ON public.circulation_differences (partner_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_circulation_differences_open_match
  ON public.circulation_differences (
    partner_id,
    outgoing_exchange_circulation,
    incoming_exchange_circulation,
    outgoing_gas_type,
    incoming_gas_type,
    size
  )
  WHERE status IN ('open', 'partially_settled');

-- Rendezés követése: melyik csere melyik eltérést rendezte
CREATE TABLE IF NOT EXISTS public.circulation_difference_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  difference_id uuid NOT NULL REFERENCES public.circulation_differences(id) ON DELETE CASCADE,
  settling_exchange_id uuid NOT NULL REFERENCES public.exchanges(id) ON DELETE RESTRICT,
  quantity_settled integer NOT NULL CHECK (quantity_settled > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.circulation_difference_settlements IS
  'Körforgás-eltérés részleges/teljes rendezése – melyik későbbi csere rendezte.';

CREATE INDEX IF NOT EXISTS idx_circulation_diff_settlements_diff
  ON public.circulation_difference_settlements (difference_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_circulation_diff_settlements_exchange
  ON public.circulation_difference_settlements (settling_exchange_id);

-- Partnernél lévő darabszám alapú készlet (Kínai / FLAGA PB / PRÍMA PB)
CREATE TABLE IF NOT EXISTS public.partner_quantity_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  stock_kind text NOT NULL CHECK (stock_kind IN ('chinese', 'flaga_pb', 'prima_pb')),
  gas_type text NOT NULL,
  size text NOT NULL,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, stock_kind, gas_type, size)
);

COMMENT ON TABLE public.partner_quantity_stock IS
  'Partnernél lévő darabszám alapú körforgásos készlet (Kínai stb.).';

CREATE INDEX IF NOT EXISTS idx_partner_quantity_stock_partner
  ON public.partner_quantity_stock (partner_id, stock_kind);

-- Exchanges: finom körforgás-kulcsok naplózása
ALTER TABLE public.exchanges
  ADD COLUMN IF NOT EXISTS incoming_exchange_circulation text,
  ADD COLUMN IF NOT EXISTS outgoing_exchange_circulation text;

-- Partner készlet növelése/csökkentése
CREATE OR REPLACE FUNCTION public.adjust_partner_quantity_stock(
  p_partner_id uuid,
  p_stock_kind text,
  p_gas_type text,
  p_size text,
  p_delta integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.partner_quantity_stock;
BEGIN
  IF p_delta = 0 THEN RETURN; END IF;

  INSERT INTO public.partner_quantity_stock (partner_id, stock_kind, gas_type, size, quantity)
  VALUES (p_partner_id, p_stock_kind, trim(p_gas_type), trim(p_size), 0)
  ON CONFLICT (partner_id, stock_kind, gas_type, size) DO NOTHING;

  SELECT * INTO v_row
  FROM public.partner_quantity_stock
  WHERE partner_id = p_partner_id
    AND stock_kind = p_stock_kind
    AND gas_type = trim(p_gas_type)
    AND size = trim(p_size)
  FOR UPDATE;

  IF v_row.quantity + p_delta < 0 THEN
    RAISE EXCEPTION 'Nincs elég partner készlet (% % %)', p_gas_type, p_size, p_stock_kind;
  END IF;

  UPDATE public.partner_quantity_stock
  SET quantity = quantity + p_delta, updated_at = now()
  WHERE id = v_row.id;
END;
$$;

-- Eltérés státusz frissítése rendezés után
CREATE OR REPLACE FUNCTION public.apply_circulation_difference_settlement(
  p_difference_id uuid,
  p_settling_exchange_id uuid,
  p_quantity integer,
  p_created_by uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_diff public.circulation_differences;
  v_new_settled integer;
  v_status public.circulation_difference_status;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'A rendezett mennyiségnek pozitívnak kell lennie';
  END IF;

  SELECT * INTO v_diff FROM public.circulation_differences WHERE id = p_difference_id FOR UPDATE;
  IF v_diff.id IS NULL THEN RAISE EXCEPTION 'Körforgás-eltérés nem található'; END IF;
  IF v_diff.status = 'closed' THEN RAISE EXCEPTION 'Az eltérés már lezárt'; END IF;

  v_new_settled := v_diff.quantity_settled + p_quantity;
  IF v_new_settled > v_diff.quantity THEN
    RAISE EXCEPTION 'A rendezés meghaladja a nyitott mennyiséget';
  END IF;

  INSERT INTO public.circulation_difference_settlements (
    difference_id, settling_exchange_id, quantity_settled, created_by
  ) VALUES (
    p_difference_id, p_settling_exchange_id, p_quantity, COALESCE(p_created_by, auth.uid())
  );

  v_status := CASE
    WHEN v_new_settled >= v_diff.quantity THEN 'closed'::public.circulation_difference_status
    ELSE 'partially_settled'::public.circulation_difference_status
  END;

  UPDATE public.circulation_differences
  SET quantity_settled = v_new_settled, status = v_status
  WHERE id = p_difference_id;
END;
$$;

-- Nyitott eltérések rendezése egy cserével (fordított körforgás-áramlás)
CREATE OR REPLACE FUNCTION public.settle_circulation_differences_for_exchange(
  p_partner_id uuid,
  p_exchange_id uuid,
  p_incoming_key text,
  p_outgoing_key text,
  p_incoming_gas text,
  p_outgoing_gas text,
  p_size text,
  p_quantity integer DEFAULT 1
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_diff public.circulation_differences;
  v_remaining integer := p_quantity;
  v_settle integer;
  v_count integer := 0;
  v_uid uuid := auth.uid();
BEGIN
  IF v_remaining <= 0 THEN RETURN 0; END IF;

  FOR v_diff IN
    SELECT *
    FROM public.circulation_differences
    WHERE partner_id = p_partner_id
      AND status IN ('open', 'partially_settled')
      AND outgoing_exchange_circulation = p_incoming_key
      AND incoming_exchange_circulation = p_outgoing_key
      AND outgoing_gas_type = p_incoming_gas
      AND incoming_gas_type = p_outgoing_gas
      AND size = p_size
    ORDER BY created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_settle := LEAST(v_remaining, v_diff.quantity - v_diff.quantity_settled);
    IF v_settle <= 0 THEN CONTINUE; END IF;

    PERFORM public.apply_circulation_difference_settlement(
      v_diff.id, p_exchange_id, v_settle, v_uid
    );
    v_remaining := v_remaining - v_settle;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Körforgás-eltérés létrehozása kényszerhelyettesítéskor
CREATE OR REPLACE FUNCTION public.create_circulation_difference(
  p_partner_id uuid,
  p_exchange_id uuid,
  p_incoming_key text,
  p_outgoing_key text,
  p_incoming_gas text,
  p_outgoing_gas text,
  p_size text,
  p_quantity integer DEFAULT 1,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF p_incoming_key = p_outgoing_key
     AND p_incoming_gas = p_outgoing_gas THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.circulation_differences (
    partner_id, incoming_exchange_circulation, outgoing_exchange_circulation,
    incoming_gas_type, outgoing_gas_type, size, quantity, note, exchange_id, created_by
  ) VALUES (
    p_partner_id, p_incoming_key, p_outgoing_key,
    p_incoming_gas, p_outgoing_gas, p_size, COALESCE(p_quantity, 1),
    p_note, p_exchange_id, v_uid
  ) RETURNING id INTO v_id;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_uid,
    'Körforgás-eltérés létrehozva',
    'circulation_difference',
    v_id,
    jsonb_build_object(
      'partner_id', p_partner_id,
      'exchange_id', p_exchange_id,
      'incoming_key', p_incoming_key,
      'outgoing_key', p_outgoing_key,
      'incoming_gas', p_incoming_gas,
      'outgoing_gas', p_outgoing_gas,
      'size', p_size,
      'quantity', COALESCE(p_quantity, 1)
    )
  );

  RETURN v_id;
END;
$$;

-- Frissített csere RPC: finom körforgás, eltérés, rendezés (indoklás opcionális)
CREATE OR REPLACE FUNCTION public.record_exchange(
  p_partner_id uuid,
  p_incoming_id uuid,
  p_outgoing_id uuid,
  p_reason text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_rental_id uuid DEFAULT NULL,
  p_reassign_rental boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_in public.cylinders;
  v_out public.cylinders;
  v_uid uuid := auth.uid();
  v_forced boolean;
  v_in_key text;
  v_out_key text;
  v_exchange_id uuid;
  v_diff_id uuid;
BEGIN
  SELECT * INTO v_in FROM public.cylinders WHERE id = p_incoming_id FOR UPDATE;
  SELECT * INTO v_out FROM public.cylinders WHERE id = p_outgoing_id FOR UPDATE;
  IF v_in.id IS NULL OR v_out.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;

  v_in_key := public.derive_exchange_circulation_key(v_in.circulation, v_in.manufacturer::text);
  v_out_key := public.derive_exchange_circulation_key(v_out.circulation, v_out.manufacturer::text);
  v_forced := v_in_key <> v_out_key OR v_in.gas_type <> v_out.gas_type;

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    incoming_exchange_circulation, outgoing_exchange_circulation,
    is_forced_substitution, reason, rental_reassigned, rental_id, note, created_by, operation_type
  ) VALUES (
    p_partner_id, v_in.id, v_in.circulation, v_out.id, v_out.circulation,
    v_in_key, v_out_key,
    v_forced, NULLIF(trim(COALESCE(p_reason,'')), ''), COALESCE(p_reassign_rental,false), p_rental_id, p_note, v_uid, 'exchange'
  ) RETURNING id INTO v_exchange_id;

  INSERT INTO public.movements (cylinder_id, from_location, from_partner_id, to_location, status_after, note, created_by)
  VALUES (v_in.id, v_in.location_type, v_in.location_partner_id, 'warehouse_empty', 'empty', 'Gyors csere – üres beérkezett', v_uid);

  INSERT INTO public.movements (cylinder_id, from_location, to_location, to_partner_id, status_after, note, created_by)
  VALUES (v_out.id, v_out.location_type, 'customer', p_partner_id, 'full', 'Gyors csere – teli kiadva', v_uid);

  UPDATE public.cylinders SET status = 'empty', location_type = 'warehouse_empty', location_partner_id = NULL, location_supplier_id = NULL WHERE id = v_in.id;
  UPDATE public.cylinders SET status = 'full', location_type = 'customer', location_partner_id = p_partner_id, location_supplier_id = NULL WHERE id = v_out.id;

  IF p_reassign_rental AND p_rental_id IS NOT NULL THEN
    INSERT INTO public.rental_reassignments(rental_id, old_cylinder_id, new_cylinder_id, note, created_by)
    SELECT p_rental_id, current_cylinder_id, v_out.id, 'Gyors csere során', v_uid FROM public.rentals WHERE id = p_rental_id;
    UPDATE public.rentals SET current_cylinder_id = v_out.id, updated_at = now() WHERE id = p_rental_id;
  END IF;

  -- Rendezés (fordított áramlás)
  PERFORM public.settle_circulation_differences_for_exchange(
    p_partner_id, v_exchange_id,
    v_in_key, v_out_key, v_in.gas_type, v_out.gas_type, v_in.size, 1
  );

  -- Új eltérés kényszerhelyettesítéskor
  IF v_forced THEN
    v_diff_id := public.create_circulation_difference(
      p_partner_id, v_exchange_id,
      v_in_key, v_out_key, v_in.gas_type, v_out.gas_type, v_in.size, 1, p_note
    );
  END IF;

  RETURN v_exchange_id;
END;
$$;

-- Hozott kínai: üres kínai be (darabszám), nincs vonalkód
CREATE OR REPLACE FUNCTION public.record_chinese_brought(
  p_partner_id uuid,
  p_gas_type text,
  p_size text,
  p_quantity integer,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_exchange_id uuid;
  v_mov_id uuid;
BEGIN
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'A mennyiségnek pozitívnak kell lennie'; END IF;

  v_mov_id := public.adjust_chinese_stock(trim(p_gas_type), trim(p_size), 'empty_return', p_quantity,
    COALESCE(NULLIF(trim(p_note), ''), 'Hozott kínai – üres be'));

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    incoming_exchange_circulation, outgoing_exchange_circulation,
    is_forced_substitution, note, created_by, operation_type
  ) VALUES (
    p_partner_id, NULL, 'own', NULL, 'own',
    'chinese', 'chinese',
    false,
    format('%s× %s %s · Hozott kínai', p_quantity, trim(p_gas_type), trim(p_size)) ||
      CASE WHEN p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN ' · ' || trim(p_note) ELSE '' END,
    v_uid, 'chinese_brought'
  ) RETURNING id INTO v_exchange_id;

  -- Partner kínai készlet csökken, ha van nyilvántartott készlet
  UPDATE public.partner_quantity_stock
  SET quantity = GREATEST(0, quantity - p_quantity), updated_at = now()
  WHERE partner_id = p_partner_id
    AND stock_kind = 'chinese'
    AND gas_type = trim(p_gas_type)
    AND size = trim(p_size)
    AND quantity > 0;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_uid, 'Hozott kínai', 'exchange', v_exchange_id,
    jsonb_build_object('partner_id', p_partner_id, 'gas_type', p_gas_type, 'size', p_size, 'quantity', p_quantity, 'movement_id', v_mov_id)
  );

  RETURN v_exchange_id;
END;
$$;

-- Kínait visz: sorszámos üres be + kínai teli ki (darabszám)
CREATE OR REPLACE FUNCTION public.record_chinese_take(
  p_partner_id uuid,
  p_incoming_id uuid,
  p_gas_type text,
  p_size text,
  p_quantity integer,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_in public.cylinders;
  v_uid uuid := auth.uid();
  v_exchange_id uuid;
  v_in_key text;
  v_mov_id uuid;
BEGIN
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Missing partner'; END IF;
  SELECT * INTO v_in FROM public.cylinders WHERE id = p_incoming_id FOR UPDATE;
  IF v_in.id IS NULL THEN RAISE EXCEPTION 'Missing cylinder'; END IF;
  IF v_in.status <> 'empty' THEN RAISE EXCEPTION 'A beérkező palacknak üresnek kell lennie'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'A mennyiségnek pozitívnak kell lennie'; END IF;

  v_in_key := public.derive_exchange_circulation_key(v_in.circulation, v_in.manufacturer::text);

  v_mov_id := public.adjust_chinese_stock(trim(p_gas_type), trim(p_size), 'sale', p_quantity,
    COALESCE(NULLIF(trim(p_note), ''), 'Kínait visz – teli ki'));

  INSERT INTO public.exchanges (
    partner_id, incoming_cylinder_id, incoming_circulation, outgoing_cylinder_id, outgoing_circulation,
    incoming_exchange_circulation, outgoing_exchange_circulation,
    is_forced_substitution, reason, note, created_by, operation_type
  ) VALUES (
    p_partner_id, v_in.id, v_in.circulation, NULL, 'own',
    v_in_key, 'chinese',
    v_in_key <> 'chinese',
    NULL, p_note, v_uid, 'chinese_take'
  ) RETURNING id INTO v_exchange_id;

  INSERT INTO public.movements (cylinder_id, from_location, from_partner_id, to_location, status_after, note, created_by)
  VALUES (v_in.id, COALESCE(v_in.location_type, 'customer'), v_in.location_partner_id, 'warehouse_empty', 'empty', 'Kínait visz – üres be', v_uid);

  UPDATE public.cylinders
  SET status = 'empty', location_type = 'warehouse_empty', location_partner_id = NULL, location_supplier_id = NULL
  WHERE id = v_in.id;

  PERFORM public.adjust_partner_quantity_stock(p_partner_id, 'chinese', p_gas_type, p_size, p_quantity);

  -- Rendezés + esetleges eltérés
  PERFORM public.settle_circulation_differences_for_exchange(
    p_partner_id, v_exchange_id,
    v_in_key, 'chinese', v_in.gas_type, trim(p_gas_type), trim(p_size), p_quantity
  );

  IF v_in_key <> 'chinese' OR v_in.gas_type <> trim(p_gas_type) THEN
    PERFORM public.create_circulation_difference(
      p_partner_id, v_exchange_id,
      v_in_key, 'chinese', v_in.gas_type, trim(p_gas_type), trim(p_size), p_quantity, p_note
    );
  END IF;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_uid, 'Kínait visz', 'exchange', v_exchange_id,
    jsonb_build_object(
      'partner_id', p_partner_id, 'incoming_id', p_incoming_id,
      'gas_type', p_gas_type, 'size', p_size, 'quantity', p_quantity, 'movement_id', v_mov_id
    )
  );

  RETURN v_exchange_id;
END;
$$;

-- AI: nyitott eltérések partnerenként
CREATE OR REPLACE VIEW public.partner_open_circulation_differences_v
WITH (security_invoker = true) AS
SELECT
  cd.partner_id,
  p.name AS partner_name,
  count(*)::integer AS open_count,
  sum(cd.quantity - cd.quantity_settled)::integer AS open_quantity
FROM public.circulation_differences cd
JOIN public.partners p ON p.id = cd.partner_id
WHERE cd.status IN ('open', 'partially_settled')
GROUP BY cd.partner_id, p.name;

COMMENT ON VIEW public.partner_open_circulation_differences_v IS
  'AI: nyitott körforgás-eltérések száma és darabszám partnerenként.';

-- RLS + GRANT
GRANT SELECT, INSERT, UPDATE ON public.circulation_differences TO authenticated;
GRANT ALL ON public.circulation_differences TO service_role;
ALTER TABLE public.circulation_differences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "circulation_differences auth all" ON public.circulation_differences;
CREATE POLICY "circulation_differences auth all"
  ON public.circulation_differences FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON public.circulation_difference_settlements TO authenticated;
GRANT ALL ON public.circulation_difference_settlements TO service_role;
ALTER TABLE public.circulation_difference_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "circulation_diff_settlements auth all" ON public.circulation_difference_settlements;
CREATE POLICY "circulation_diff_settlements auth all"
  ON public.circulation_difference_settlements FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.partner_quantity_stock TO authenticated;
GRANT ALL ON public.partner_quantity_stock TO service_role;
ALTER TABLE public.partner_quantity_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_quantity_stock auth all" ON public.partner_quantity_stock;
CREATE POLICY "partner_quantity_stock auth all"
  ON public.partner_quantity_stock FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT ON public.partner_open_circulation_differences_v TO authenticated;
GRANT ALL ON public.partner_open_circulation_differences_v TO service_role;

GRANT EXECUTE ON FUNCTION public.derive_exchange_circulation_key(public.circulation, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_circulation_difference(uuid, uuid, text, text, text, text, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_circulation_difference_settlement(uuid, uuid, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_circulation_differences_for_exchange(uuid, uuid, text, text, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_partner_quantity_stock(uuid, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_chinese_brought(uuid, text, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_chinese_take(uuid, uuid, text, text, integer, text) TO authenticated;
