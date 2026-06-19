-- Számlázási emlékeztető: gyors cserék kiszámlázásának nyomon követése

ALTER TABLE public.exchanges
  ADD COLUMN IF NOT EXISTS invoiced BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_exchanges_uninvoiced
  ON public.exchanges (created_at DESC)
  WHERE invoiced = FALSE AND profit IS NOT NULL;
