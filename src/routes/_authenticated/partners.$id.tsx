import { createFileRoute, Link } from "@tanstack/react-router";

import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

import { AppShell } from "@/components/AppShell";

import { Card } from "@/components/ui/card";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import { ArrowLeft, Building2, Cylinder, Mail, MapPin, Phone, StickyNote } from "lucide-react";

import {
  circulationLabels,
  fmtDate,
  isRentalExpired,
  rentalDisplayStatus,
  rentalStatusLabels,
  rentalTypeLabels,
  statusLabels,
  type Circulation,
  type RentalType,
} from "@/lib/labels";

import { fetchRentedCylinderIdsForPartner, rentalNumber } from "@/lib/rental-ops";

export const Route = createFileRoute("/_authenticated/partners/$id")({
  head: () => ({ meta: [{ title: "Partner – Gáz Veled" }] }),

  component: PartnerDetail,
});

type PartnerRow = {
  id: string;

  name: string;

  company_name: string | null;

  tax_number: string | null;

  phone: string | null;

  email: string | null;

  address: string | null;

  contact_person: string | null;

  personal_id_number: string | null;

  address_card_number: string | null;

  id_card_photo_url: string | null;

  address_card_photo_url: string | null;

  gdpr_accepted: boolean;

  gdpr_accepted_at: string | null;

  note: string | null;
};

type CylinderAtPartner = {
  id: string;

  barcode: string;

  gas_type: string;

  size: string;

  circulation: Circulation;

  owner: Circulation;

  status: "full" | "empty" | "service";
};

function circulationColor(circ: Circulation): string {
  if (circ === "siad") return "var(--siad)";

  if (circ === "berpalack") return "var(--warning, #f59e0b)";

  return "var(--own)";
}

function PartnerDetail() {
  const { id } = Route.useParams();

  const {
    data: partner,

    isLoading: partnerLoading,

    isError: partnerError,
  } = useQuery({
    queryKey: ["partner", id],

    queryFn: async () => {
      const { data, error } = await supabase
        .from("partners")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) throw error;

      return data as PartnerRow | null;
    },

    retry: false,
  });

  const { data: cylinders } = useQuery({
    queryKey: ["partner-cylinders", id],

    enabled: !!partner,

    queryFn: async () => {
      const { data, error } = await supabase

        .from("cylinders")

        .select("id, barcode, gas_type, size, circulation, owner, status")

        .eq("location_partner_id", id)

        .eq("active", true)

        .order("barcode");

      if (error) throw error;

      return (data ?? []) as CylinderAtPartner[];
    },
  });

  const { data: rentedIds } = useQuery({
    queryKey: ["partner-rented-cyl-ids", id],

    enabled: !!partner,

    queryFn: () => fetchRentedCylinderIdsForPartner(id),
  });

  const { data: allRentals } = useQuery({
    queryKey: ["partner-rentals", id],

    enabled: !!partner,

    queryFn: async () => {
      const { data, error } = await supabase

        .from("rentals")

        .select("id, monthly_fee, next_invoice_date, expiry_date, rental_type, start_date, status")

        .eq("partner_id", id)

        .order("start_date", { ascending: false });

      if (error) throw error;

      return data ?? [];
    },
  });

  const activeRentals = (allRentals ?? []).filter(
    (r) => rentalDisplayStatus(r.status, r.expiry_date) === "active",
  );
  const expiredRentals = (allRentals ?? []).filter((r) => {
    if (r.status === "closed" || r.status === "cancelled") return false;
    return rentalDisplayStatus(r.status, r.expiry_date) === "expired";
  });
  const closedRentals = (allRentals ?? []).filter((r) => r.status === "closed");

  const rentedIdSet = useMemo(() => rentedIds ?? new Set<string>(), [rentedIds]);

  const rentalCylinders = useMemo(
    () => (cylinders ?? []).filter((c) => rentedIdSet.has(c.id)),

    [cylinders, rentedIdSet],
  );

  const partnerCylinders = useMemo(
    () => (cylinders ?? []).filter((c) => !rentedIdSet.has(c.id)),

    [cylinders, rentedIdSet],
  );

  const summary = useMemo(() => {
    const list = cylinders ?? [];

    const count = (c: Circulation) => list.filter((x) => (x.owner ?? x.circulation) === c).length;

    return {
      own: count("own"),

      siad: count("siad"),

      berpalack: count("berpalack"),

      total: list.length,

      rented: rentalCylinders.length,
    };
  }, [cylinders, rentalCylinders.length]);

  if (partnerLoading) {
    return (
      <AppShell title="Partner">
        <div className="py-8 text-center text-sm text-muted-foreground">Betöltés…</div>
      </AppShell>
    );
  }

  if (partnerError || !partner) {
    return (
      <AppShell title="Partner">
        <Link to="/partners">
          <Button variant="ghost" size="sm" className="mb-3">
            <ArrowLeft className="mr-1 h-4 w-4" /> Vissza
          </Button>
        </Link>

        <div className="py-8 text-center text-sm text-destructive">
          {partnerError ? "Hiba a partner betöltésekor" : "Partner nem található"}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={partner.name}>
      <Link to="/partners">
        <Button variant="ghost" size="sm" className="mb-3">
          <ArrowLeft className="mr-1 h-4 w-4" /> Vissza a partnerekhez
        </Button>
      </Link>

      <Link to="/partners/$id/rentals" params={{ id }}>
        <Button variant="outline" size="sm" className="mb-3 w-full">
          Bérleti áttekintés – palackok kezelése
        </Button>
      </Link>

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Partner adatok
        </h2>

        <div className="space-y-2 text-sm">
          <DetailRow label="Név" value={partner.name} />

          <DetailRow
            label="Cégnév"
            value={partner.company_name}
            icon={<Building2 className="h-3.5 w-3.5" />}
          />

          <DetailRow label="Adószám" value={partner.tax_number} />
          <DetailRow label="Kapcsolattartó" value={partner.contact_person} />
          <DetailRow label="Személyi igazolvány szám" value={partner.personal_id_number} />
          <DetailRow label="Lakcímkártya szám" value={partner.address_card_number} />
          <DetailRow label="Személyi igazolvány fotó" value={partner.id_card_photo_url} />
          <DetailRow label="Lakcímkártya fotó" value={partner.address_card_photo_url} />
          <DetailRow
            label="GDPR"
            value={
              partner.gdpr_accepted
                ? `Elfogadva${partner.gdpr_accepted_at ? ` (${fmtDate(partner.gdpr_accepted_at)})` : ""}`
                : "Nincs elfogadva"
            }
          />

          <DetailRow
            label="Telefon"
            value={partner.phone}
            icon={<Phone className="h-3.5 w-3.5" />}
          />

          <DetailRow label="Email" value={partner.email} icon={<Mail className="h-3.5 w-3.5" />} />

          <DetailRow
            label="Cím"
            value={partner.address}
            icon={<MapPin className="h-3.5 w-3.5" />}
          />

          {partner.note && (
            <div className="flex gap-2 rounded-md bg-muted/40 p-2 text-xs">
              <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />

              <span>{partner.note}</span>
            </div>
          )}
        </div>
      </Card>

      {activeRentals.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold">Aktív bérletek</h2>

          <div className="mb-4 space-y-2">
            {activeRentals.map((r) => (
              <RentalBlock key={r.id} rental={r} />
            ))}
          </div>
        </>
      )}

      {expiredRentals.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold">Lejárt bérletek</h2>

          <div className="mb-4 space-y-2">
            {expiredRentals.map((r) => (
              <RentalBlock key={r.id} rental={r} expired />
            ))}
          </div>
        </>
      )}

      {closedRentals.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold">Lezárt bérletek</h2>

          <div className="mb-4 space-y-2">
            {closedRentals.map((r) => (
              <RentalBlock key={r.id} rental={r} />
            ))}
          </div>
        </>
      )}

      {rentalCylinders.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold">Bérpalackok ({rentalCylinders.length})</h2>

          <div className="mb-4 space-y-2">
            {rentalCylinders.map((c) => (
              <Link key={c.id} to="/cylinders/$id" params={{ id: c.id }}>
                <Card className="p-3 transition-colors hover:bg-accent/50">
                  <div className="font-mono font-semibold">{c.barcode}</div>

                  <div className="text-xs text-muted-foreground">
                    {c.gas_type} · {c.size}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}

      <Card className="mb-3 p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Cylinder className="h-4 w-4" />
          Összesítés
        </h2>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryTile label="Saját" value={summary.own} />

          <SummaryTile label="SIAD" value={summary.siad} tint="siad" />

          <SummaryTile label="Egyéb" value={summary.berpalack} tint="other" />

          <SummaryTile label="Összes" value={summary.total} bold />
        </div>
      </Card>

      <h2 className="mb-2 text-sm font-semibold">
        Palackok a partnernél ({partnerCylinders.length})
      </h2>

      <div className="space-y-2">
        {partnerCylinders.map((c) => {
          const owner = (c.owner ?? c.circulation) as Circulation;

          return (
            <Link key={c.id} to="/cylinders/$id" params={{ id: c.id }}>
              <Card className="p-3 transition-colors hover:bg-accent/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono font-semibold">{c.barcode}</div>

                    <div className="mt-1 text-xs text-muted-foreground">
                      {c.gas_type} · {c.size}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <Badge
                      style={{ backgroundColor: circulationColor(owner) }}
                      className="text-background text-[10px]"
                    >
                      {circulationLabels[owner] ?? owner}
                    </Badge>

                    <Badge variant="outline" className="text-[10px]">
                      {statusLabels[c.status] ?? c.status}
                    </Badge>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}

        {partnerCylinders.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Nincs nem bérelt palack ennél a partnernél
          </div>
        )}
      </div>
    </AppShell>
  );
}

function RentalBlock({
  rental,
  expired,
}: {
  rental: {
    id: string;
    monthly_fee: number;
    next_invoice_date: string | null;
    expiry_date: string | null;
    rental_type: string | null;
    start_date: string;
    status: string;
  };
  expired?: boolean;
}) {
  const type = (rental.rental_type ?? "yearly") as RentalType;
  const displayStatus = rentalDisplayStatus(rental.status, rental.expiry_date);
  return (
    <Link to="/rentals/$id" params={{ id: rental.id }}>
      <Card className="p-3 transition-colors hover:bg-accent/50">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm font-semibold">{rentalNumber(rental.id)}</span>
          <div className="flex gap-1">
            <Badge variant={expired || displayStatus === "expired" ? "destructive" : "default"}>
              {rentalStatusLabels[displayStatus] ?? displayStatus}
            </Badge>
            <Badge variant="outline">{rentalTypeLabels[type]}</Badge>
          </div>
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>Kezdés: {fmtDate(rental.start_date)}</span>
          {rental.expiry_date && (
            <span className={isRentalExpired(rental.expiry_date) ? "text-destructive" : ""}>
              Lejárat: {fmtDate(rental.expiry_date)}
            </span>
          )}
          {type === "monthly" && (
            <span>{Number(rental.monthly_fee).toLocaleString("hu-HU")} Ft/hó</span>
          )}
          {rental.next_invoice_date && (
            <span>Köv. számlázás: {fmtDate(rental.next_invoice_date)}</span>
          )}
        </div>
      </Card>
    </Link>
  );
}

function DetailRow({
  label,

  value,

  icon,
}: {
  label: string;

  value: string | null | undefined;

  icon?: React.ReactNode;
}) {
  if (!value) return null;

  return (
    <div className="flex items-start gap-2">
      {icon && <span className="mt-0.5 text-muted-foreground">{icon}</span>}

      <div>
        <span className="text-xs text-muted-foreground">{label}: </span>

        <span>{value}</span>
      </div>
    </div>
  );
}

function SummaryTile({
  label,

  value,

  tint,

  bold,
}: {
  label: string;

  value: number;

  tint?: "siad" | "other";

  bold?: boolean;
}) {
  const bg =
    tint === "siad"
      ? "bg-[color:var(--siad)]/15"
      : tint === "other"
        ? "bg-warning/15"
        : "bg-muted/50";

  return (
    <div className={`rounded-lg p-3 text-center ${bg}`}>
      <div className={`text-xl ${bold ? "font-bold" : "font-semibold"}`}>{value}</div>

      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
