-- Eszköz- és fogyóanyag-készlet: induló termékek és készlet (idempotens seed, Fázis A)

INSERT INTO public.supply_products (
  stock_kind, natural_key, name, category, specification, packaging,
  unit_of_measure, current_stock, minimum_stock,
  purchase_price, sale_price, vat_rate, is_sellable, is_rentable
) VALUES
  (
    'quantity', 'supply:mixgas-regulator', 'Kevertgáz reduktor', 'Reduktor',
    NULL, NULL, 'db', 3, 0, NULL, NULL, 27, true, false
  ),
  (
    'quantity', 'supply:welding-wire-1.0-15kg', 'Hegesztőhuzal 1,0 mm', 'Hegesztőhuzal',
    '1,0 mm', '15 kg-os tekercs', 'tekercs', 2, 0, NULL, NULL, 27, true, false
  ),
  (
    'quantity', 'supply:welding-wire-0.8-15kg', 'Hegesztőhuzal 0,8 mm', 'Hegesztőhuzal',
    '0,8 mm', '15 kg-os tekercs', 'tekercs', 2, 0, NULL, NULL, 27, true, false
  )
ON CONFLICT (natural_key) DO NOTHING;

INSERT INTO public.supply_stock_movements (
  product_id, movement_type, quantity, stock_before, stock_after,
  event_group_id, note
)
SELECT p.id, 'receipt', p.current_stock, 0, p.current_stock, gen_random_uuid(), 'Induló készlet (seed)'
FROM public.supply_products p
WHERE p.natural_key = 'supply:mixgas-regulator'
  AND NOT EXISTS (
    SELECT 1 FROM public.supply_stock_movements m WHERE m.product_id = p.id
  );

INSERT INTO public.supply_stock_movements (
  product_id, movement_type, quantity, stock_before, stock_after,
  event_group_id, note
)
SELECT p.id, 'receipt', p.current_stock, 0, p.current_stock, gen_random_uuid(), 'Induló készlet (seed)'
FROM public.supply_products p
WHERE p.natural_key = 'supply:welding-wire-1.0-15kg'
  AND NOT EXISTS (
    SELECT 1 FROM public.supply_stock_movements m WHERE m.product_id = p.id
  );

INSERT INTO public.supply_stock_movements (
  product_id, movement_type, quantity, stock_before, stock_after,
  event_group_id, note
)
SELECT p.id, 'receipt', p.current_stock, 0, p.current_stock, gen_random_uuid(), 'Induló készlet (seed)'
FROM public.supply_products p
WHERE p.natural_key = 'supply:welding-wire-0.8-15kg'
  AND NOT EXISTS (
    SELECT 1 FROM public.supply_stock_movements m WHERE m.product_id = p.id
  );
