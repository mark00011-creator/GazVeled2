-- Eszköz- és fogyóanyag-készlet: indexek (Fázis A)

CREATE INDEX IF NOT EXISTS idx_supply_products_natural_key
  ON public.supply_products (natural_key);

CREATE INDEX IF NOT EXISTS idx_supply_products_active_sellable
  ON public.supply_products (is_active, is_sellable, stock_kind)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_supply_products_low_stock
  ON public.supply_products (current_stock, minimum_stock)
  WHERE stock_kind = 'quantity' AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_supply_products_category
  ON public.supply_products (category);

CREATE INDEX IF NOT EXISTS idx_supply_movements_product_created
  ON public.supply_stock_movements (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supply_movements_sale
  ON public.supply_stock_movements (related_sale_id)
  WHERE related_sale_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supply_movements_event_group
  ON public.supply_stock_movements (event_group_id);

CREATE INDEX IF NOT EXISTS idx_supply_sales_partner_date
  ON public.supply_sales (partner_id, sale_date DESC);

CREATE INDEX IF NOT EXISTS idx_supply_sales_idempotency
  ON public.supply_sales (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supply_sale_items_sale
  ON public.supply_sale_items (sale_id);

CREATE INDEX IF NOT EXISTS idx_supply_billing_queue_status
  ON public.supply_billing_queue (status, sale_date DESC);

CREATE INDEX IF NOT EXISTS idx_supply_billing_queue_partner
  ON public.supply_billing_queue (partner_id, created_at DESC);
