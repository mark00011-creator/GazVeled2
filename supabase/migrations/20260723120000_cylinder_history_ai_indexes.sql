-- Palack előélet: AI / analitika lekérdezésekhez indexek (idempotens)

CREATE INDEX IF NOT EXISTS idx_cylinder_history_metadata_gin
  ON public.cylinder_history USING gin (metadata);

CREATE INDEX IF NOT EXISTS idx_cylinder_history_cylinder_event
  ON public.cylinder_history (cylinder_id, event_type, created_at DESC);

COMMENT ON COLUMN public.cylinder_history.metadata IS
  'Strukturált mezők: barcode, user_label, partner_name, supplier_id, supplier_name, rental_id, loan_id, supplier_exchange_id, related_cylinder_id, paired_barcodes, note.';
