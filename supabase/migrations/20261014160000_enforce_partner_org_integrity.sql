ALTER TABLE public.circulation_differences
ADD CONSTRAINT circulation_differences_org_partner_fkey
FOREIGN KEY (organization_id, partner_id)
REFERENCES public.partners (organization_id, id)
ON DELETE RESTRICT;

ALTER TABLE public.cylinder_history
ADD CONSTRAINT cylinder_history_org_partner_fkey
FOREIGN KEY (organization_id, partner_id)
REFERENCES public.partners (organization_id, id)
ON DELETE SET NULL (partner_id);

ALTER TABLE public.cylinder_history
ADD CONSTRAINT cylinder_history_org_related_partner_fkey
FOREIGN KEY (organization_id, related_partner_id)
REFERENCES public.partners (organization_id, id)
ON DELETE SET NULL (related_partner_id);

ALTER TABLE public.cylinder_loans
ADD CONSTRAINT cylinder_loans_org_partner_fkey
FOREIGN KEY (organization_id, partner_id)
REFERENCES public.partners (organization_id, id)
ON DELETE RESTRICT;

ALTER TABLE public.events
ADD CONSTRAINT events_org_partner_fkey
FOREIGN KEY (organization_id, partner_id)
REFERENCES public.partners (organization_id, id)
ON DELETE SET NULL (partner_id);

ALTER TABLE public.exchanges
ADD CONSTRAINT exchanges_org_partner_fkey
FOREIGN KEY (organization_id, partner_id)
REFERENCES public.partners (organization_id, id)
ON DELETE RESTRICT;

ALTER TABLE public.invoice_documents
ADD CONSTRAINT invoice_documents_org_partner_fkey
FOREIGN KEY (organization_id, partner_id)
REFERENCES public.partners (organization_id, id);

ALTER TABLE public.partner_quantity_stock
ADD CONSTRAINT partner_quantity_stock_org_partner_fkey
FOREIGN KEY (organization_id, partner_id)
REFERENCES public.partners (organization_id, id)
ON DELETE CASCADE;

ALTER TABLE public.quotes
ADD CONSTRAINT quotes_org_partner_fkey
FOREIGN KEY (organization_id, partner_id)
REFERENCES public.partners (organization_id, id)
ON DELETE RESTRICT;

ALTER TABLE public.rentals
ADD CONSTRAINT rentals_org_partner_fkey
FOREIGN KEY (organization_id, partner_id)
REFERENCES public.partners (organization_id, id)
ON DELETE RESTRICT;

ALTER TABLE public.supply_billing_queue
ADD CONSTRAINT supply_billing_queue_org_partner_fkey
FOREIGN KEY (organization_id, partner_id)
REFERENCES public.partners (organization_id, id)
ON DELETE RESTRICT;

ALTER TABLE public.supply_sales
ADD CONSTRAINT supply_sales_org_partner_fkey
FOREIGN KEY (organization_id, partner_id)
REFERENCES public.partners (organization_id, id)
ON DELETE RESTRICT;

ALTER TABLE public.supply_stock_movements
ADD CONSTRAINT supply_stock_movements_org_partner_fkey
FOREIGN KEY (organization_id, partner_id)
REFERENCES public.partners (organization_id, id)
ON DELETE RESTRICT;
