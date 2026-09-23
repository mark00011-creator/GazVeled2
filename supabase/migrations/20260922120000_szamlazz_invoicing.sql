-- Számlázz.hu számlázási draftok + org Agent kulcs (titok)
-- Production: snmiwsgtnokvqlnwvfwf
-- Agent kulcs soha nem SELECT-elhető authenticated szereppel.

-- ---------------------------------------------------------------------------
-- 1) Titkos Agent kulcs tábla (csak service_role / SECURITY DEFINER olvashatja)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_invoicing_secrets (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('szamlazz', 'billingo')),
  agent_key text NOT NULL,
  invoice_prefix text,
  eszamla boolean NOT NULL DEFAULT false,
  payment_method text NOT NULL DEFAULT 'Átutalás',
  due_days integer NOT NULL DEFAULT 8 CHECK (due_days >= 0 AND due_days <= 365),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE public.organization_invoicing_secrets IS
  'Számlázó API kulcsok – authenticated szerepnek nincs SELECT joga.';

ALTER TABLE public.organization_invoicing_secrets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.organization_invoicing_secrets FROM PUBLIC;
REVOKE ALL ON TABLE public.organization_invoicing_secrets FROM anon;
REVOKE ALL ON TABLE public.organization_invoicing_secrets FROM authenticated;
GRANT ALL ON TABLE public.organization_invoicing_secrets TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Admin: kulcs mentés / törlés / van-e kulcs (kulcs soha nem jön vissza)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_szamlazz_agent_key(
  p_agent_key text,
  p_invoice_prefix text DEFAULT NULL,
  p_eszamla boolean DEFAULT false,
  p_payment_method text DEFAULT 'Átutalás',
  p_due_days integer DEFAULT 8
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_key text := trim(COALESCE(p_agent_key, ''));
BEGIN
  PERFORM public.require_admin();
  v_org := public.require_active_organization();
  IF length(v_key) < 10 THEN
    RAISE EXCEPTION 'Érvénytelen Számla Agent kulcs';
  END IF;

  INSERT INTO public.organization_invoicing_secrets (
    organization_id, provider, agent_key, invoice_prefix, eszamla,
    payment_method, due_days, updated_at, updated_by
  ) VALUES (
    v_org, 'szamlazz', v_key, NULLIF(trim(COALESCE(p_invoice_prefix, '')), ''),
    COALESCE(p_eszamla, false),
    COALESCE(NULLIF(trim(COALESCE(p_payment_method, '')), ''), 'Átutalás'),
    COALESCE(p_due_days, 8),
    now(), auth.uid()
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    provider = 'szamlazz',
    agent_key = EXCLUDED.agent_key,
    invoice_prefix = EXCLUDED.invoice_prefix,
    eszamla = EXCLUDED.eszamla,
    payment_method = EXCLUDED.payment_method,
    due_days = EXCLUDED.due_days,
    updated_at = now(),
    updated_by = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_szamlazz_agent_key()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  PERFORM public.require_admin();
  v_org := public.require_active_organization();
  DELETE FROM public.organization_invoicing_secrets WHERE organization_id = v_org;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_szamlazz_agent_key()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.auth_organization_id();
BEGIN
  IF v_org IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.organization_invoicing_secrets s
    WHERE s.organization_id = v_org AND length(trim(s.agent_key)) >= 10
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_szamlazz_invoicing_public_settings()
RETURNS TABLE (
  has_agent_key boolean,
  invoice_prefix text,
  eszamla boolean,
  payment_method text,
  due_days integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.auth_organization_id();
BEGIN
  IF v_org IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT
    (s.agent_key IS NOT NULL AND length(trim(s.agent_key)) >= 10),
    s.invoice_prefix,
    COALESCE(s.eszamla, false),
    COALESCE(s.payment_method, 'Átutalás'),
    COALESCE(s.due_days, 8)
  FROM public.organization_invoicing_secrets s
  WHERE s.organization_id = v_org;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_szamlazz_agent_key(text, text, boolean, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_szamlazz_agent_key() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_szamlazz_agent_key() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_szamlazz_invoicing_public_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_szamlazz_agent_key(text, text, boolean, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_szamlazz_agent_key() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_szamlazz_agent_key() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_szamlazz_invoicing_public_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.update_szamlazz_invoicing_settings(
  p_invoice_prefix text DEFAULT NULL,
  p_eszamla boolean DEFAULT false,
  p_payment_method text DEFAULT 'Átutalás',
  p_due_days integer DEFAULT 8
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  PERFORM public.require_admin();
  v_org := public.require_active_organization();
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_invoicing_secrets WHERE organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'Előbb add meg a Számla Agent kulcsot';
  END IF;
  UPDATE public.organization_invoicing_secrets SET
    invoice_prefix = NULLIF(trim(COALESCE(p_invoice_prefix, '')), ''),
    eszamla = COALESCE(p_eszamla, false),
    payment_method = COALESCE(NULLIF(trim(COALESCE(p_payment_method, '')), ''), 'Átutalás'),
    due_days = COALESCE(p_due_days, 8),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE organization_id = v_org;
END;
$$;

REVOKE ALL ON FUNCTION public.update_szamlazz_invoicing_settings(text, boolean, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_szamlazz_invoicing_settings(text, boolean, text, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) invoice_documents + items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  partner_id uuid NOT NULL REFERENCES public.partners(id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'finalizing', 'finalized', 'failed')),
  provider text NOT NULL DEFAULT 'szamlazz' CHECK (provider IN ('szamlazz', 'billingo')),
  batch_id uuid,
  currency text NOT NULL DEFAULT 'HUF',
  payment_method text NOT NULL DEFAULT 'Átutalás',
  note text,
  issue_date date,
  fulfillment_date date,
  due_date date,
  net_total integer NOT NULL DEFAULT 0,
  vat_total integer NOT NULL DEFAULT 0,
  gross_total integer NOT NULL DEFAULT 0,
  external_invoice_number text,
  external_invoice_ref text,
  pdf_base64 text,
  last_error text,
  created_by uuid REFERENCES auth.users(id),
  finalized_by uuid REFERENCES auth.users(id),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_document_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  document_id uuid NOT NULL REFERENCES public.invoice_documents(id) ON DELETE CASCADE,
  exchange_id uuid REFERENCES public.exchanges(id) ON DELETE SET NULL,
  line_no integer NOT NULL DEFAULT 1,
  name text NOT NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'db',
  net_unit_price integer NOT NULL DEFAULT 0,
  vat_rate text NOT NULL DEFAULT 'AAM',
  net_amount integer NOT NULL DEFAULT 0,
  vat_amount integer NOT NULL DEFAULT 0,
  gross_amount integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_documents_org_status
  ON public.invoice_documents (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_documents_partner
  ON public.invoice_documents (organization_id, partner_id);
CREATE INDEX IF NOT EXISTS idx_invoice_document_items_doc
  ON public.invoice_document_items (document_id, line_no);
CREATE INDEX IF NOT EXISTS idx_invoice_document_items_exchange
  ON public.invoice_document_items (exchange_id)
  WHERE exchange_id IS NOT NULL;

ALTER TABLE public.invoice_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_document_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_documents_select ON public.invoice_documents;
CREATE POLICY invoice_documents_select ON public.invoice_documents
  FOR SELECT TO authenticated
  USING (public.can_exchange() AND public.same_org(organization_id));

DROP POLICY IF EXISTS invoice_documents_insert ON public.invoice_documents;
CREATE POLICY invoice_documents_insert ON public.invoice_documents
  FOR INSERT TO authenticated
  WITH CHECK (public.can_exchange() AND public.same_org(organization_id));

DROP POLICY IF EXISTS invoice_documents_update ON public.invoice_documents;
CREATE POLICY invoice_documents_update ON public.invoice_documents
  FOR UPDATE TO authenticated
  USING (public.can_exchange() AND public.same_org(organization_id))
  WITH CHECK (public.can_exchange() AND public.same_org(organization_id));

DROP POLICY IF EXISTS invoice_document_items_select ON public.invoice_document_items;
CREATE POLICY invoice_document_items_select ON public.invoice_document_items
  FOR SELECT TO authenticated
  USING (public.can_exchange() AND public.same_org(organization_id));

DROP POLICY IF EXISTS invoice_document_items_insert ON public.invoice_document_items;
CREATE POLICY invoice_document_items_insert ON public.invoice_document_items
  FOR INSERT TO authenticated
  WITH CHECK (public.can_exchange() AND public.same_org(organization_id));

DROP POLICY IF EXISTS invoice_document_items_update ON public.invoice_document_items;
CREATE POLICY invoice_document_items_update ON public.invoice_document_items
  FOR UPDATE TO authenticated
  USING (public.can_exchange() AND public.same_org(organization_id))
  WITH CHECK (public.can_exchange() AND public.same_org(organization_id));

DROP POLICY IF EXISTS invoice_document_items_delete ON public.invoice_document_items;
CREATE POLICY invoice_document_items_delete ON public.invoice_document_items
  FOR DELETE TO authenticated
  USING (public.can_write() AND public.same_org(organization_id));

DROP TRIGGER IF EXISTS trg_invoice_documents_org ON public.invoice_documents;
CREATE TRIGGER trg_invoice_documents_org
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_isolation();

DROP TRIGGER IF EXISTS trg_invoice_document_items_org ON public.invoice_document_items;
CREATE TRIGGER trg_invoice_document_items_org
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_document_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_isolation();

GRANT SELECT, INSERT, UPDATE ON public.invoice_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_document_items TO authenticated;
GRANT ALL ON public.invoice_documents TO service_role;
GRANT ALL ON public.invoice_document_items TO service_role;

-- ---------------------------------------------------------------------------
-- 4) exchanges: külső számlaszám mező
-- ---------------------------------------------------------------------------
ALTER TABLE public.exchanges
  ADD COLUMN IF NOT EXISTS external_invoice_number text;

COMMENT ON COLUMN public.exchanges.external_invoice_number IS
  'Számlázz.hu / Billingo számlaszám a véglegesítés után.';
