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

/** Android soft keyboard: Drawer a visual viewporthoz igazítva. */
function useVisualViewportBox(active: boolean) {
  const [box, setBox] = useState({ height: 0, bottom: 0 });

  useEffect(() => {
    if (!active || typeof window === "undefined") return;

    const update = () => {
      const vv = window.visualViewport;
      if (!vv) {
        setBox({ height: window.innerHeight, bottom: 0 });
        return;
      }
      const bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setBox({ height: vv.height, bottom });
    };

    update();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [active]);

  return box;
}

function PartnerSearchPanel({
  partners,
  value,
  query,
  onQueryChange,
  onSelect,
  listClassName,
  autoFocus,
  stickySearch,
}: {
  partners: PartnerOption[];
  value: string;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (partnerId: string) => void;
  listClassName?: string;
  autoFocus?: boolean;
  stickySearch?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => filterPartners(partners, query), [partners, query]);

  useEffect(() => {
    if (!autoFocus) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [autoFocus]);

  const searchBlock = (
    <div
      className={cn(
        "relative shrink-0 border-b bg-background px-3 py-2",
        stickySearch && "sticky top-0 z-10",
      )}
    >
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
  );

  return (
    <Command shouldFilter={false} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {searchBlock}
      <CommandList
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain",
          listClassName,
        )}
      >
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
                  className={cn(
                    "mr-2 h-4 w-4 shrink-0",
                    value === partner.id ? "opacity-100" : "opacity-0",
                  )}
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
  const viewport = useVisualViewportBox(isMobile && open);

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

  if (isMobile) {
    const maxHeight =
      viewport.height > 0 ? Math.min(viewport.height * 0.92, viewport.height - 8) : undefined;

    return (
      <>
        {trigger}
        <Drawer open={open} onOpenChange={setOpen} repositionInputs={false}>
          <DrawerContent
            className="mt-0 flex flex-col overflow-hidden p-0 pb-[env(safe-area-inset-bottom)]"
            style={{
              bottom: viewport.bottom,
              maxHeight: maxHeight ? `${maxHeight}px` : "92dvh",
              height: maxHeight ? `${maxHeight}px` : undefined,
            }}
          >
            <DrawerHeader className="shrink-0 border-b pb-2 text-left">
              <DrawerTitle>Partner</DrawerTitle>
            </DrawerHeader>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2">
              <PartnerSearchPanel
                partners={partners}
                value={value}
                query={query}
                onQueryChange={setQuery}
                onSelect={handleSelect}
                autoFocus={open}
                stickySearch
                listClassName="max-h-none"
              />
            </div>
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
        <PartnerSearchPanel
          partners={partners}
          value={value}
          query={query}
          onQueryChange={setQuery}
          onSelect={handleSelect}
          autoFocus={open}
          listClassName="max-h-[min(300px,50dvh)]"
        />
      </PopoverContent>
    </Popover>
  );
}
