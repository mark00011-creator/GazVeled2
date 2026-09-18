-- Cégenkénti ÁFA / adózás beállítás (settings.tax)
-- Production: snmiwsgtnokvqlnwvfwf
-- Alapértelmezés: alanyi adómentes; árak mindig nettóban tárolódnak.

COMMENT ON COLUMN public.organizations.settings IS
  'modules, circulations, warehouse_bins, invoicing, tax (regime, default_rate, price_entry).';

UPDATE public.organizations
SET
  settings = jsonb_set(
    COALESCE(settings, '{}'::jsonb),
    '{tax}',
    COALESCE(
      settings->'tax',
      jsonb_build_object(
        'regime', 'vat_exempt',
        'default_rate', 27,
        'price_entry', 'net'
      )
    ),
    true
  ),
  updated_at = now()
WHERE NOT (COALESCE(settings, '{}'::jsonb) ? 'tax');
