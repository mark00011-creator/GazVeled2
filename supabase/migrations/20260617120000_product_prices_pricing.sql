-- Árlista: beszerzési ár, árrés, eladási ár + unit_price szinkron

ALTER TABLE public.product_prices
  ADD COLUMN IF NOT EXISTS beszerzesi_ar INTEGER,
  ADD COLUMN IF NOT EXISTS arres INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eladasi_ar INTEGER;

UPDATE public.product_prices
SET beszerzesi_ar = unit_price
WHERE beszerzesi_ar IS NULL;

UPDATE public.product_prices
SET eladasi_ar = beszerzesi_ar + arres
WHERE eladasi_ar IS NULL;

ALTER TABLE public.product_prices
  ALTER COLUMN beszerzesi_ar SET NOT NULL,
  ALTER COLUMN eladasi_ar SET NOT NULL;

ALTER TABLE public.product_prices
  DROP CONSTRAINT IF EXISTS product_prices_beszerzesi_ar_check,
  DROP CONSTRAINT IF EXISTS product_prices_arres_check,
  DROP CONSTRAINT IF EXISTS product_prices_eladasi_ar_check;

ALTER TABLE public.product_prices
  ADD CONSTRAINT product_prices_beszerzesi_ar_check CHECK (beszerzesi_ar >= 0),
  ADD CONSTRAINT product_prices_arres_check CHECK (arres >= 0),
  ADD CONSTRAINT product_prices_eladasi_ar_check CHECK (eladasi_ar >= 0);

CREATE OR REPLACE FUNCTION public.sync_product_price_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.beszerzesi_ar IS NULL AND NEW.unit_price IS NOT NULL THEN
    NEW.beszerzesi_ar := NEW.unit_price;
  END IF;

  IF NEW.beszerzesi_ar IS NOT NULL THEN
    NEW.unit_price := NEW.beszerzesi_ar;
    NEW.eladasi_ar := NEW.beszerzesi_ar + COALESCE(NEW.arres, 0);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_prices ON public.product_prices;
CREATE TRIGGER trg_sync_product_prices
  BEFORE INSERT OR UPDATE ON public.product_prices
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_product_price_columns();
