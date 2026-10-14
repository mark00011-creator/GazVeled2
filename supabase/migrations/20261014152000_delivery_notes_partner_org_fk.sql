ALTER TABLE public.partners
ADD CONSTRAINT partners_organization_id_id_key
UNIQUE (organization_id, id);

ALTER TABLE public.delivery_notes
ADD CONSTRAINT delivery_notes_organization_id_partner_id_fkey
FOREIGN KEY (organization_id, partner_id)
REFERENCES public.partners (organization_id, id);
