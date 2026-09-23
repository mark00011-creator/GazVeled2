/**
 * ADR 2025 – 1.1.3.6 mennyiségi könnyítés számítómotor.
 * ADR adatot TILOS terméknévből kitalálni; csak AdrProductData (verified) alapján.
 */

export const ADR_RULESET_VERSION = "ADR-2025" as const;

export type AdrQuantityBasis =
  | "water_capacity_l"
  | "net_mass_kg"
  | "volume_l"
  | "not_applicable";

export type AdrCylinderState = "FULL" | "PARTIAL" | "EMPTY_UNCLEANED" | "EMPTY_CLEAN";

export type AdrTransportCategory = 0 | 1 | 2 | 3 | 4;

export type AdrProductData = {
  rulesetVersion: string;
  unNumber: string | null;
  properShippingNameHu: string | null;
  technicalNameHu: string | null;
  adrClass: string | null;
  classificationCode: string | null;
  hazardLabels: string[];
  packingGroup: string | null;
  tunnelRestrictionCode: string | null;
  transportCategory: AdrTransportCategory | null;
  multiplier: number | null;
  quantityBasis: AdrQuantityBasis;
  verified: boolean;
  verifiedAt: string | null;
  source: string | null;
  /** Fuvarokmány-szöveg; ha null, formatter állítja elő */
  transportDocumentText?: string | null;
};

export type AdrCylinderPhysical = {
  waterCapacityLitres: number | null;
  netGasMassKg: number | null;
};

export type AdrLineInput = {
  id: string;
  state: AdrCylinderState;
  quantity: number;
  product: AdrProductData;
  physical: AdrCylinderPhysical;
  /** Üzleti megjelenítés (nem ADR megnevezés) */
  businessLabel?: string;
};

export type AdrLineResult = {
  id: string;
  state: AdrCylinderState;
  quantity: number;
  includedInDangerousGoods: boolean;
  adrQuantity: number;
  adrQuantityUnit: "L" | "kg" | null;
  transportCategory: AdrTransportCategory | null;
  multiplier: number;
  points: number;
  documentLineText: string | null;
  businessLabel?: string;
  warning?: string;
};

export type AdrCalculationResult = {
  rulesetVersion: string;
  lines: AdrLineResult[];
  pointsByCategory: { cat1: number; cat2: number; cat3: number };
  emptyUncleanedCount: number;
  totalPoints: number;
  within116Exemption: boolean;
  statusLabelHu: string;
  emptyTankAggregateText: string | null;
  blockingWarnings: string[];
};

const DEFAULT_MULTIPLIER: Record<AdrTransportCategory, number> = {
  0: 0,
  1: 50,
  2: 3,
  3: 1,
  4: 0,
};

export function formatAdrTransportDocumentText(product: AdrProductData): string | null {
  if (product.transportDocumentText?.trim()) return product.transportDocumentText.trim();
  if (!product.unNumber || !product.properShippingNameHu) return null;
  const labels = product.hazardLabels.length
    ? product.hazardLabels.length === 1
      ? product.hazardLabels[0]
      : `${product.hazardLabels[0]} (${product.hazardLabels.slice(1).join(", ")})`
    : "";
  const tunnel = product.tunnelRestrictionCode ? `, (${product.tunnelRestrictionCode})` : "";
  const labelPart = labels ? `, ${labels}` : "";
  return `UN ${product.unNumber} ${product.properShippingNameHu}${labelPart}${tunnel}`;
}

function resolveAdrQuantity(
  product: AdrProductData,
  physical: AdrCylinderPhysical,
): { value: number; unit: "L" | "kg" } | null {
  if (product.quantityBasis === "water_capacity_l") {
    if (physical.waterCapacityLitres == null || physical.waterCapacityLitres <= 0) return null;
    return { value: physical.waterCapacityLitres, unit: "L" };
  }
  if (product.quantityBasis === "net_mass_kg") {
    if (physical.netGasMassKg == null || physical.netGasMassKg <= 0) return null;
    return { value: physical.netGasMassKg, unit: "kg" };
  }
  if (product.quantityBasis === "volume_l") {
    if (physical.waterCapacityLitres == null || physical.waterCapacityLitres <= 0) return null;
    return { value: physical.waterCapacityLitres, unit: "L" };
  }
  return null;
}

function effectiveCategoryForState(
  state: AdrCylinderState,
  product: AdrProductData,
): { category: AdrTransportCategory | null; multiplier: number; includeDangerous: boolean; docText: string | null; warning?: string } {
  if (state === "EMPTY_CLEAN") {
    return { category: null, multiplier: 0, includeDangerous: false, docText: null };
  }
  if (state === "EMPTY_UNCLEANED") {
    // Normál 2. osztályú korábbi tartalom: üres szállítás → kategória 4, ×0
    return {
      category: 4,
      multiplier: 0,
      includeDangerous: true,
      docText: "ÜRES TARTÁLY, 2",
    };
  }
  // FULL / PARTIAL
  if (!product.verified) {
    return {
      category: product.transportCategory,
      multiplier: product.multiplier ?? (product.transportCategory != null ? DEFAULT_MULTIPLIER[product.transportCategory] : 0),
      includeDangerous: true,
      docText: formatAdrTransportDocumentText(product),
      warning: "A termék ADR törzsadata nincs hitelesítve.",
    };
  }
  const cat = product.transportCategory;
  if (cat == null) {
    return {
      category: null,
      multiplier: 0,
      includeDangerous: true,
      docText: formatAdrTransportDocumentText(product),
      warning: "Hiányzó szállítási kategória az ADR törzsben.",
    };
  }
  return {
    category: cat,
    multiplier: product.multiplier ?? DEFAULT_MULTIPLIER[cat],
    includeDangerous: true,
    docText: formatAdrTransportDocumentText(product),
  };
}

export function calculateAdr1136(lines: AdrLineInput[]): AdrCalculationResult {
  const results: AdrLineResult[] = [];
  const blockingWarnings: string[] = [];
  let cat1 = 0;
  let cat2 = 0;
  let cat3 = 0;
  let emptyUncleanedCount = 0;

  for (const line of lines) {
    if (line.quantity <= 0) continue;
    const eff = effectiveCategoryForState(line.state, line.product);
    if (eff.warning) blockingWarnings.push(`${line.businessLabel ?? line.id}: ${eff.warning}`);

    if (line.state === "EMPTY_CLEAN") {
      results.push({
        id: line.id,
        state: line.state,
        quantity: line.quantity,
        includedInDangerousGoods: false,
        adrQuantity: 0,
        adrQuantityUnit: null,
        transportCategory: null,
        multiplier: 0,
        points: 0,
        documentLineText: null,
        businessLabel: line.businessLabel,
      });
      continue;
    }

    if (line.state === "EMPTY_UNCLEANED") {
      emptyUncleanedCount += line.quantity;
      results.push({
        id: line.id,
        state: line.state,
        quantity: line.quantity,
        includedInDangerousGoods: true,
        adrQuantity: 0,
        adrQuantityUnit: null,
        transportCategory: 4,
        multiplier: 0,
        points: 0,
        documentLineText: "ÜRES TARTÁLY, 2",
        businessLabel: line.businessLabel,
      });
      continue;
    }

    const qty = resolveAdrQuantity(line.product, line.physical);
    if (!qty) {
      blockingWarnings.push(
        `${line.businessLabel ?? line.id}: hiányzó víztérfogat/nettó töltet az ADR számításhoz.`,
      );
    }
    const perUnit = qty?.value ?? 0;
    const points = perUnit * (eff.multiplier ?? 0) * line.quantity;
    if (eff.category === 1) cat1 += points;
    if (eff.category === 2) cat2 += points;
    if (eff.category === 3) cat3 += points;

    results.push({
      id: line.id,
      state: line.state,
      quantity: line.quantity,
      includedInDangerousGoods: eff.includeDangerous,
      adrQuantity: perUnit * line.quantity,
      adrQuantityUnit: qty?.unit ?? null,
      transportCategory: eff.category,
      multiplier: eff.multiplier,
      points,
      documentLineText: eff.docText,
      businessLabel: line.businessLabel,
      warning: eff.warning,
    });
  }

  const totalPoints = cat1 + cat2 + cat3;
  const within = totalPoints <= 1000;

  return {
    rulesetVersion: ADR_RULESET_VERSION,
    lines: results,
    pointsByCategory: { cat1, cat2, cat3 },
    emptyUncleanedCount,
    totalPoints,
    within116Exemption: within,
    statusLabelHu: within
      ? "Mennyiségi állapot: ADR 1.1.3.6 határán belül"
      : "FIGYELEM: ADR 1.1.3.6 mennyiségi határ túllépve",
    emptyTankAggregateText:
      emptyUncleanedCount > 0
        ? `ÜRES TARTÁLY, 2 (összesen ${emptyUncleanedCount} db üres, tisztítatlan gáztartály)`
        : null,
    blockingWarnings: [...new Set(blockingWarnings)],
  };
}

/** Hitelesített seed – csak biztos ADR adatok */
export const ADR_VERIFIED_SEEDS: Record<string, AdrProductData> = {
  ARGON_COMPRESSED: {
    rulesetVersion: ADR_RULESET_VERSION,
    unNumber: "1006",
    properShippingNameHu: "ARGON, SŰRÍTETT",
    technicalNameHu: null,
    adrClass: "2",
    classificationCode: "1A",
    hazardLabels: ["2.2"],
    packingGroup: null,
    tunnelRestrictionCode: "E",
    transportCategory: 3,
    multiplier: 1,
    quantityBasis: "water_capacity_l",
    verified: true,
    verifiedAt: "2026-09-23",
    source: "ADR 2025 / UN 1006",
    transportDocumentText: "UN 1006 ARGON, SŰRÍTETT, 2.2, (E)",
  },
  OXYGEN_COMPRESSED: {
    rulesetVersion: ADR_RULESET_VERSION,
    unNumber: "1072",
    properShippingNameHu: "OXIGÉN, SŰRÍTETT",
    technicalNameHu: null,
    adrClass: "2",
    classificationCode: "1O",
    hazardLabels: ["2.2", "5.1"],
    packingGroup: null,
    tunnelRestrictionCode: "E",
    transportCategory: 3,
    multiplier: 1,
    quantityBasis: "water_capacity_l",
    verified: true,
    verifiedAt: "2026-09-23",
    source: "ADR 2025 / UN 1072",
    transportDocumentText: "UN 1072 OXIGÉN, SŰRÍTETT, 2.2 (5.1), (E)",
  },
  NITROGEN_COMPRESSED: {
    rulesetVersion: ADR_RULESET_VERSION,
    unNumber: "1066",
    properShippingNameHu: "NITROGÉN, SŰRÍTETT",
    technicalNameHu: null,
    adrClass: "2",
    classificationCode: "1A",
    hazardLabels: ["2.2"],
    packingGroup: null,
    tunnelRestrictionCode: "E",
    transportCategory: 3,
    multiplier: 1,
    quantityBasis: "water_capacity_l",
    verified: true,
    verifiedAt: "2026-09-23",
    source: "ADR 2025 / UN 1066",
    transportDocumentText: "UN 1066 NITROGÉN, SŰRÍTETT, 2.2, (E)",
  },
  HELIUM_COMPRESSED: {
    rulesetVersion: ADR_RULESET_VERSION,
    unNumber: "1046",
    properShippingNameHu: "HÉLIUM, SŰRÍTETT",
    technicalNameHu: null,
    adrClass: "2",
    classificationCode: "1A",
    hazardLabels: ["2.2"],
    packingGroup: null,
    tunnelRestrictionCode: "E",
    transportCategory: 3,
    multiplier: 1,
    quantityBasis: "water_capacity_l",
    verified: true,
    verifiedAt: "2026-09-23",
    source: "ADR 2025 / UN 1046",
    transportDocumentText: "UN 1046 HÉLIUM, SŰRÍTETT, 2.2, (E)",
  },
  CARBON_DIOXIDE: {
    rulesetVersion: ADR_RULESET_VERSION,
    unNumber: "1013",
    properShippingNameHu: "SZÉN-DIOXID",
    technicalNameHu: null,
    adrClass: "2",
    classificationCode: "2A",
    hazardLabels: ["2.2"],
    packingGroup: null,
    tunnelRestrictionCode: "C/E",
    transportCategory: 3,
    multiplier: 1,
    quantityBasis: "net_mass_kg",
    verified: true,
    verifiedAt: "2026-09-23",
    source: "ADR 2025 / UN 1013",
    transportDocumentText: "UN 1013 SZÉN-DIOXID, 2.2, (C/E)",
  },
};

/** Nem hitelesített stub – SIAD SDS 14. fejezet ellenőrzésig */
export const ADR_UNVERIFIED_STARGON_C18: AdrProductData = {
  rulesetVersion: ADR_RULESET_VERSION,
  unNumber: "1956",
  properShippingNameHu: "SŰRÍTETT GÁZ, M.N.N.",
  technicalNameHu: "Stargon C18 (várható)",
  adrClass: "2",
  classificationCode: null,
  hazardLabels: ["2.2"],
  packingGroup: null,
  tunnelRestrictionCode: "E",
  transportCategory: 3,
  multiplier: 1,
  quantityBasis: "water_capacity_l",
  verified: false,
  verifiedAt: null,
  source: "Előzetes stub – SIAD SDS Ch.14 hiányzik",
};
