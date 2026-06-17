-- Egységes termékárlista (gáz rendelés, később számlázás)
CREATE TABLE public.product_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gas_type TEXT NOT NULL,
  size TEXT NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  currency TEXT NOT NULL DEFAULT 'HUF',
  product_code TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gas_type, size)
);

CREATE INDEX product_prices_active_idx ON public.product_prices (active);
CREATE INDEX product_prices_gas_type_idx ON public.product_prices (gas_type);

CREATE TRIGGER trg_product_prices_updated
  BEFORE UPDATE ON public.product_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_prices TO authenticated;
GRANT ALL ON public.product_prices TO service_role;

ALTER TABLE public.product_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_prices auth all"
  ON public.product_prices FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

INSERT INTO public.product_prices (gas_type, size, unit_price) VALUES
  ('Argon', '40 L', 34400),
  ('Széndioxid', '10 kg', 12600)
ON CONFLICT (gas_type, size) DO NOTHING;
