-- Eszköz/fogyóanyag B fázis: értékesítési pillanatkép mezők

ALTER TABLE public.supply_sale_items
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS specification text,
  ADD COLUMN IF NOT EXISTS packaging text,
  ADD COLUMN IF NOT EXISTS purchase_unit_price numeric,
  ADD COLUMN IF NOT EXISTS profit_per_unit numeric,
  ADD COLUMN IF NOT EXISTS line_purchase_value numeric,
  ADD COLUMN IF NOT EXISTS line_profit numeric,
  ADD COLUMN IF NOT EXISTS margin_percent numeric;

ALTER TABLE public.supply_sales
  ADD COLUMN IF NOT EXISTS total_purchase_value numeric,
  ADD COLUMN IF NOT EXISTS total_profit numeric,
  ADD COLUMN IF NOT EXISTS event_group_id uuid;

ALTER TABLE public.supply_billing_queue
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS purchase_unit_price numeric,
  ADD COLUMN IF NOT EXISTS line_profit numeric;

COMMENT ON COLUMN public.supply_sale_items.product_name IS 'Pillanatkép: terméknév az eladáskor.';
COMMENT ON COLUMN public.supply_sale_items.purchase_unit_price IS 'Pillanatkép: beszerzési egységár az eladáskor.';
