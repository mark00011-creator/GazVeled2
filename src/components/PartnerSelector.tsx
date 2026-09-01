import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  filterPartners,
  partnerDisplayLabel,
  type PartnerSearchable,
} from "@/lib/partner-search";

export type PartnerOption = PartnerSearchable & {
  id: string;
  phone?: string | null;
};

type PartnerSelectorProps = {
  partners: PartnerOption[];
  value: string;
  onValueChange: (partnerId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

function PartnerSearchPanel({
  partners,
  value,
  query,
  onQueryChange,
  onSelect,
  listClassName,
  autoFocus,
}: {
  partners: PartnerOption[];
  value: string;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (partnerId: string) => void;
  listClassName?: string;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => filterPartners(partners, query), [partners, query]);

  useEffect(() => {
    if (!autoFocus) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [autoFocus]);

  return (
    <Command shouldFilter={false} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="relative shrink-0 border-b px-3 py-2">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Partner keresése..."
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="search"
          enterKeyHint="search"
          className="pr-9"
        />
        {query.length > 0 && (
          <button
            type="button"
            aria-label="Keresés törlése"
            className="absolute top-1/2 right-5 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
            onClick={() => {
              onQueryChange("");
              inputRef.current?.focus();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <CommandList className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", listClassName)}>
        {filtered.length === 0 ? (
          <CommandEmpty>Nincs találat</CommandEmpty>
        ) : (
          <CommandGroup>
            {filtered.map((partner) => (
              <CommandItem
                key={partner.id}
                value={partner.id}
                onSelect={() => onSelect(partner.id)}
                className="min-h-11 cursor-pointer py-3"
              >
                <Check
                  className={cn("mr-2 h-4 w-4 shrink-0", value === partner.id ? "opacity-100" : "opacity-0")}
                />
                <span className="line-clamp-2 text-left">{partnerDisplayLabel(partner)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

export function PartnerSelector({
  partners,
  value,
  onValueChange,
  placeholder = "Válassz partnert…",
  disabled = false,
  className,
}: PartnerSelectorProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => partners.find((partner) => partner.id === value) ?? null,
    [partners, value],
  );

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const handleSelect = (partnerId: string) => {
    onValueChange(partnerId);
    setOpen(false);
  };

  const trigger = (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      disabled={disabled}
      onClick={isMobile ? () => setOpen(true) : undefined}
      className={cn(
        "h-9 w-full justify-between px-3 font-normal shadow-sm",
        !selected && "text-muted-foreground",
        className,
      )}
    >
      <span className="line-clamp-1 text-left">
        {selected ? partnerDisplayLabel(selected) : placeholder}
      </span>
      <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
    </Button>
  );

  const panel = (
    <PartnerSearchPanel
      partners={partners}
      value={value}
      query={query}
      onQueryChange={setQuery}
      onSelect={handleSelect}
      autoFocus={open}
      listClassName={isMobile ? "max-h-[min(55dvh,420px)]" : "max-h-[min(300px,50dvh)]"}
    />
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Drawer open={open} onOpenChange={setOpen} repositionInputs={false}>
          <DrawerContent className="flex max-h-[min(92dvh,100%)] flex-col pb-[env(safe-area-inset-bottom)]">
            <DrawerHeader className="pb-0 text-left">
              <DrawerTitle>Partner</DrawerTitle>
            </DrawerHeader>
            <div className="flex min-h-0 flex-1 flex-col px-2 pb-4">{panel}</div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        sideOffset={4}
      >
        {panel}
      </PopoverContent>
    </Popover>
  );
}
