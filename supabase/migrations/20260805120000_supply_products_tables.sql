-- Eszköz- és fogyóanyag-készlet: táblák és constraint-ek (Fázis A)
-- Production: snmiwsgtnokvqlnwvfwf

CREATE TABLE IF NOT EXISTS public.supply_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_kind text NOT NULL,
  natural_key text NOT NULL,
  name text NOT NULL,
  category text,
  brand text,
  product_type text,
  specification text,
  packaging text,
  unit_of_measure text NOT NULL,
  current_stock integer,
  minimum_stock integer NOT NULL DEFAULT 0,
  purchase_price numeric,
  sale_price numeric,
  vat_rate numeric NOT NULL DEFAULT 27,
  is_active boolean NOT NULL DEFAULT true,
  is_sellable boolean NOT NULL DEFAULT false,
  is_rentable boolean NOT NULL DEFAULT false,
  photo_url text,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supply_products_natural_key_nonempty CHECK (length(trim(natural_key)) > 0),
  CONSTRAINT supply_products_stock_kind_check CHECK (stock_kind IN ('unit', 'quantity')),
  CONSTRAINT supply_products_minimum_stock_check CHECK (minimum_stock >= 0),
  CONSTRAINT supply_products_purchase_price_check CHECK (purchase_price IS NULL OR purchase_price >= 0),
  CONSTRAINT supply_products_sale_price_check CHECK (sale_price IS NULL OR sale_price > 0),
  CONSTRAINT supply_products_vat_rate_check CHECK (vat_rate >= 0),
  CONSTRAINT supply_products_quantity_stock_check CHECK (
    (stock_kind = 'quantity' AND current_stock IS NOT NULL AND current_stock >= 0)
    OR (stock_kind = 'unit' AND current_stock IS NULL)
  ),
  CONSTRAINT supply_products_natural_key_unique UNIQUE (natural_key)
);

CREATE TABLE IF NOT EXISTS public.supply_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE RESTRICT,
  sale_date date NOT NULL DEFAULT CURRENT_DATE,
  total_net numeric NOT NULL DEFAULT 0 CHECK (total_net >= 0),
  total_vat numeric NOT NULL DEFAULT 0 CHECK (total_vat >= 0),
  total_gross numeric NOT NULL DEFAULT 0 CHECK (total_gross >= 0),
  note text,
  idempotency_key uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supply_sales_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.supply_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.supply_products(id) ON DELETE RESTRICT,
  movement_type text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  stock_before integer NOT NULL,
  stock_after integer NOT NULL CHECK (stock_after >= 0),
  partner_id uuid REFERENCES public.partners(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  related_sale_id uuid REFERENCES public.supply_sales(id) ON DELETE RESTRICT,
  related_rental_id uuid REFERENCES public.rentals(id) ON DELETE RESTRICT,
  unit_price numeric CHECK (unit_price IS NULL OR unit_price >= 0),
  total_amount numeric CHECK (total_amount IS NULL OR total_amount >= 0),
  document_number text,
  purchase_date date,
  event_group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key uuid,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supply_stock_movements_type_check CHECK (
    movement_type IN (
      'receipt',
      'sale',
      'customer_return',
      'correction_increase',
      'correction_decrease',
      'scrap',
      'internal_use',
      'stocktake_delta',
      'rental_out',
      'rental_return'
    )
  ),
  CONSTRAINT supply_stock_movements_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.supply_sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.supply_sales(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.supply_products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_of_measure text NOT NULL,
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  line_net numeric NOT NULL CHECK (line_net >= 0),
  vat_rate numeric NOT NULL CHECK (vat_rate >= 0),
  line_vat numeric NOT NULL CHECK (line_vat >= 0),
  line_gross numeric NOT NULL CHECK (line_gross >= 0),
  note text
);

CREATE TABLE IF NOT EXISTS public.supply_billing_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.supply_sales(id) ON DELETE RESTRICT,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.supply_products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_of_measure text NOT NULL,
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  net_amount numeric NOT NULL CHECK (net_amount >= 0),
  vat_rate numeric NOT NULL CHECK (vat_rate >= 0),
  vat_amount numeric NOT NULL CHECK (vat_amount >= 0),
  gross_amount numeric NOT NULL CHECK (gross_amount >= 0),
  sale_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  external_invoice_ref text,
  exported_at timestamptz,
  invoiced_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supply_billing_queue_status_check CHECK (
    status IN ('pending', 'exported', 'invoiced', 'cancelled')
  )
);

DROP TRIGGER IF EXISTS trg_supply_products_updated ON public.supply_products;
CREATE TRIGGER trg_supply_products_updated
  BEFORE UPDATE ON public.supply_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.guard_supply_product_stock_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  IF NEW.current_stock IS DISTINCT FROM OLD.current_stock THEN
    IF current_setting('supply.internal_stock_update', true) IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'A készlet közvetlen módosítása tiltott. Használd a supply RPC-ket.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supply_products_stock_guard ON public.supply_products;
CREATE TRIGGER trg_supply_products_stock_guard
  BEFORE UPDATE ON public.supply_products
  FOR EACH ROW EXECUTE FUNCTION public.guard_supply_product_stock_update();

COMMENT ON TABLE public.supply_products IS 'Eszköz- és fogyóanyag-készlet termékkatalógus (unit + quantity).';
COMMENT ON TABLE public.supply_stock_movements IS 'Darabszámos készletmozgások – minden készletváltozás auditálva.';
COMMENT ON TABLE public.supply_sales IS 'Eladható készlet értékesítési fej rekordok.';
COMMENT ON TABLE public.supply_sale_items IS 'Értékesítési tételek.';
COMMENT ON TABLE public.supply_billing_queue IS 'Számlázásra váró eszköz/fogyóanyag tételek.';
