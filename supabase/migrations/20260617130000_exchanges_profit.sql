-- Csere nyereség rögzítése tranzakció időpontjában (nem változik később)

ALTER TABLE public.exchanges
  ADD COLUMN IF NOT EXISTS beszerzesi_ar INTEGER,
  ADD COLUMN IF NOT EXISTS eladasi_ar INTEGER,
  ADD COLUMN IF NOT EXISTS profit INTEGER;

CREATE INDEX IF NOT EXISTS idx_exchanges_created_at ON public.exchanges (created_at DESC);
