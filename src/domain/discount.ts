import Big from "big.js";
import { computeCost, CostResult, unitsPerPackage } from "./cost";
import type { Requirements, ResolvedOffer, Tier } from "./schemas";

export type InventoryInputs = { currentStock: number | null; dailyUse: number | null; maxCoverageDays: number | null };

export type DiscountScenario = {
  key: string;
  label: string;
  isBaseline: boolean;
  orderQty: number;
  cost: CostResult;
  /** Extra immediate payment compared with the baseline. Never a saving when positive. */
  extraPaymentHalalas: number | null;
  /** Reduction in all-in comparable unit cost vs baseline (SAR, 4dp). Null when not comparable. */
  unitReductionSar: string | null;
  unitReductionPercent: string | null;
  /** Estimate from the buyer's inputs only. Null when no consumption was supplied. */
  coverageDays: number | null;
  exceedsMaxCoverage: boolean | null;
  /** Available only with the stated assumption shown next to it. */
  hypotheticalSavingHalalas: number | null;
  unavailable: boolean;
};

export type DiscountConclusion =
  | "ambiguous"
  | "incomplete"
  | "no_larger_option"
  | "lower_unit_higher_payment"
  | "lower_unit_lower_payment"
  | "no_unit_benefit";

export type DiscountAnalysis = {
  offerId: string;
  applicable: boolean;
  ambiguousReasons: ("mechanism" | "condition")[];
  scenarios: DiscountScenario[];
  conclusion: DiscountConclusion | null;
};

function tierOrderQty(t: Tier, upp: number | null): number | null {
  return t.qtyUnit === "package" ? (upp == null ? null : t.minQty * upp) : t.minQty;
}

export function coverageDays(purchaseQty: number, inputs: InventoryInputs): number | null {
  if (!inputs.dailyUse || inputs.dailyUse <= 0) return null;
  return Math.floor(((inputs.currentStock ?? 0) + purchaseQty) / inputs.dailyUse);
}

/**
 * Compares only purchasing scenarios the offer explicitly supports: the requested quantity and the
 * smallest order reaching each stated tier. Prices come from the same cost engine as the main comparison.
 */
export function analyzeDiscount(o: ResolvedOffer, req: Requirements, inputs: InventoryInputs): DiscountAnalysis {
  const empty: DiscountAnalysis = { offerId: o.id, applicable: false, ambiguousReasons: [], scenarios: [], conclusion: null };
  if (!o.tiers.length || req.quantity == null || o.priceBasis === "quoted_lot") return empty;

  const ambiguousReasons: DiscountAnalysis["ambiguousReasons"] = [];
  if (!o.tierMechanism) ambiguousReasons.push("mechanism");
  if (o.tiers.some((t) => t.condition)) ambiguousReasons.push("condition");

  const upp = unitsPerPackage(o);
  const baselineCost = computeCost(o, req.quantity, req);

  const build = (key: string, label: string, orderQty: number, isBaseline: boolean): DiscountScenario => {
    const priced = isBaseline ? baselineCost : computeCost(o, orderQty, req);
    // Excess always means units beyond what the buyer actually needs, not beyond the tier order.
    const cost: CostResult = { ...priced, excess: priced.purchaseQty == null ? null : Math.max(0, priced.purchaseQty - req.quantity!) };
    const bothComplete = cost.totalHalalas != null && baselineCost.totalHalalas != null;
    const extra = bothComplete ? cost.totalHalalas! - baselineCost.totalHalalas! : null;
    let unitReductionSar: string | null = null;
    let unitReductionPercent: string | null = null;
    let hypothetical: number | null = null;
    if (!isBaseline && cost.comparableUnitSar && baselineCost.comparableUnitSar) {
      const base = new Big(baselineCost.comparableUnitSar);
      const diff = base.minus(cost.comparableUnitSar);
      unitReductionSar = diff.toFixed(4);
      unitReductionPercent = base.gt(0) ? diff.div(base).times(100).toFixed(1) : null;
      // What the extra units would have cost at the baseline's all-in rate, less what they actually add now.
      const extraUnits = cost.purchaseQty! - baselineCost.purchaseQty!;
      if (extraUnits > 0) {
        hypothetical = Number(base.times(extraUnits).times(100).round(0).toString()) - extra!;
      }
    }
    const qty = cost.purchaseQty;
    const coverage = qty == null ? null : coverageDays(qty, inputs);
    return {
      key, label, isBaseline, orderQty, cost,
      extraPaymentHalalas: isBaseline ? 0 : extra,
      unitReductionSar, unitReductionPercent,
      coverageDays: coverage,
      exceedsMaxCoverage: coverage != null && inputs.maxCoverageDays != null ? coverage > inputs.maxCoverageDays : null,
      hypotheticalSavingHalalas: hypothetical,
      unavailable: qty != null && o.availableQuantity != null && qty > o.availableQuantity,
    };
  };

  const scenarios: DiscountScenario[] = [build("requested", "الكمية المطلوبة", req.quantity, true)];
  const seen = new Set([baselineCost.purchaseQty ?? req.quantity]);
  const tiers = [...o.tiers].sort((a, b) => (tierOrderQty(a, upp) ?? 0) - (tierOrderQty(b, upp) ?? 0));
  for (const t of tiers) {
    const q = tierOrderQty(t, upp);
    if (q == null) continue;
    if (q <= (baselineCost.purchaseQty ?? req.quantity)) continue;
    const s = build(`tier:${q}`, `شريحة ${q.toLocaleString("en-US")} كوب فأكثر`, q, false);
    const actual = s.cost.purchaseQty ?? q;
    if (seen.has(actual)) continue;
    seen.add(actual);
    scenarios.push(s);
  }

  const larger = scenarios.filter((s) => !s.isBaseline);
  let conclusion: DiscountConclusion;
  const crossesBreak = larger.length > 0 || baselineCost.tierApplied != null;
  if (ambiguousReasons.length && crossesBreak) conclusion = "ambiguous";
  else if (!larger.length) conclusion = "no_larger_option";
  else {
    const usable = larger.filter((s) => s.extraPaymentHalalas != null && s.unitReductionSar != null && !s.unavailable);
    if (!usable.length) conclusion = "incomplete";
    else {
      const best = usable[0];
      const lowerUnit = new Big(best.unitReductionSar!).gt(0);
      if (!lowerUnit) conclusion = "no_unit_benefit";
      else conclusion = best.extraPaymentHalalas! > 0 ? "lower_unit_higher_payment" : "lower_unit_lower_payment";
    }
  }
  return { offerId: o.id, applicable: true, ambiguousReasons, scenarios, conclusion };
}
