-- Production: snmiwsgtnokvqlnwvfwf
-- Beszállító cím + adószám; saját beszállító → TGas Kft.

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS tax_number text;

UPDATE public.suppliers
SET
  name = 'TGas Kft.',
  address = '9024 Győr, Pápai út 46. fsz. 5/a.',
  tax_number = '26631282-2-08',
  note = coalesce(note, 'Saját beszállító')
WHERE id = 'f1e5d467-1850-473a-b821-520e748d933c'
  AND kind = 'own_supplier';
