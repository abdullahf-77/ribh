import { describe, expect, it, vi } from "vitest";
import { computeCost } from "@/domain/cost";
import { analyzeDiscount } from "@/domain/discount";
import { NO_EXTRAS, offer, req } from "./helpers";

const carton = { priceBasis: "per_package" as const, priceAmount: 480, packageLevels: [{ label: "كرتون", count: 1000 }], soldByPackageOnly: true };
const tier5 = { minQty: 5, qtyUnit: "package" as const, price: 420, priceBasis: "per_package" as const, condition: null };
const noInv = { currentStock: null, dailyUse: null, maxCoverageDays: null };

describe("tier boundaries", () => {
  const o = offer({ ...carton, tiers: [tier5], tierMechanism: "all_units" });
  it("stays on base price just below the threshold", () => {
    expect(computeCost(o, 4000, NO_EXTRAS).totalHalalas).toBe(192000);
  });
  it("applies the tier exactly at the threshold", () => {
    expect(computeCost(o, 5000, NO_EXTRAS).totalHalalas).toBe(210000);
  });
  it("uses the rounded package quantity to reach the tier", () => {
    const c = computeCost(o, 4001, NO_EXTRAS);
    expect(c.purchaseQty).toBe(5000);
    expect(c.totalHalalas).toBe(210000);
  });
});

describe("all-units versus incremental", () => {
  const item = { minQty: 1000, qtyUnit: "item" as const, price: 0.3, priceBasis: "per_item" as const, condition: null };
  it("all-units reprices the whole purchase", () => {
    expect(computeCost(offer({ priceAmount: 0.4, tiers: [item], tierMechanism: "all_units" }), 3000, NO_EXTRAS).totalHalalas).toBe(90000);
  });
  it("incremental reprices only units from the threshold", () => {
    // 999 x 0.40 + 2001 x 0.30 = 399.60 + 600.30
    expect(computeCost(offer({ priceAmount: 0.4, tiers: [item], tierMechanism: "incremental" }), 3000, NO_EXTRAS).totalHalalas).toBe(99990);
  });
  it("handles several incremental bands", () => {
    const second = { ...item, minQty: 2000, price: 0.2 };
    // 999 x .4 + 1000 x .3 + 1001 x .2 = 399.6 + 300 + 200.2
    expect(computeCost(offer({ priceAmount: 0.4, tiers: [item, second], tierMechanism: "incremental" }), 3000, NO_EXTRAS).totalHalalas).toBe(89980);
  });
  it("leaves cost unknown instead of picking a mechanism", () => {
    const c = computeCost(offer({ priceAmount: 0.4, tiers: [item], tierMechanism: null }), 3000, NO_EXTRAS);
    expect(c.missing).toContain("tier_mechanism");
    expect(c.totalHalalas).toBeNull();
  });
  it("base price still resolves when no break is reached and mechanism is unknown", () => {
    expect(computeCost(offer({ priceAmount: 0.4, tiers: [{ ...item, minQty: 5000 }] }), 3000, NO_EXTRAS).totalHalalas).toBe(120000);
  });
  it("a conditional tier stays unresolved", () => {
    const c = computeCost(offer({ priceAmount: 0.4, tiers: [{ ...item, condition: "للدفع المقدم" }], tierMechanism: "all_units" }), 3000, NO_EXTRAS);
    expect(c.missing).toContain("tier_condition");
  });
});

describe("analysis", () => {
  const o = offer({ ...carton, tiers: [tier5], tierMechanism: "all_units" });

  it("shows lower unit cost and higher immediate payment separately", () => {
    const a = analyzeDiscount(o, req(), noInv);
    expect(a.conclusion).toBe("lower_unit_higher_payment");
    const [base, tier] = a.scenarios;
    expect(base.cost.totalHalalas).toBe(144000);
    expect(tier.cost.totalHalalas).toBe(210000);
    expect(tier.extraPaymentHalalas).toBe(66000);
    expect(tier.cost.purchaseQty).toBe(5000);
    expect(tier.cost.excess).toBe(2000);
    expect(tier.unitReductionSar).toBe("0.0600");
  });

  it("detects an order that costs less in total", () => {
    const flip = offer({ ...carton, priceAmount: 500, tiers: [{ ...tier5, minQty: 4, price: 300 }], tierMechanism: "all_units" });
    const a = analyzeDiscount(flip, req(), noInv);
    expect(a.conclusion).toBe("lower_unit_lower_payment");
    expect(a.scenarios[1].extraPaymentHalalas).toBeLessThan(0);
  });

  it("states hypothetical saving only as the difference on a stated rate", () => {
    const tier = analyzeDiscount(o, req(), noInv).scenarios[1];
    // 2000 extra units at 0.48 all-in = 960; actual extra payment = 660.
    expect(tier.hypotheticalSavingHalalas).toBe(30000);
  });

  it("blocks a conclusion on an ambiguous mechanism", () => {
    const a = analyzeDiscount(offer({ ...carton, tiers: [tier5], tierMechanism: null }), req(), noInv);
    expect(a.conclusion).toBe("ambiguous");
    expect(a.ambiguousReasons).toContain("mechanism");
    expect(a.scenarios[1].cost.totalHalalas).toBeNull();
    expect(a.scenarios[1].hypotheticalSavingHalalas).toBeNull();
  });

  it("blocks a conclusion on an unclear condition", () => {
    const a = analyzeDiscount(offer({ ...carton, tiers: [{ ...tier5, condition: "حسب التوفر" }], tierMechanism: "all_units" }), req(), noInv);
    expect(a.conclusion).toBe("ambiguous");
  });

  it("does not extrapolate tiers", () => {
    const a = analyzeDiscount(o, req({ quantity: 6000 }), noInv);
    expect(a.scenarios).toHaveLength(1);
    expect(a.conclusion).toBe("no_larger_option");
  });

  it("does not apply to offers without tiers or to fixed lots", () => {
    expect(analyzeDiscount(offer(), req(), noInv).applicable).toBe(false);
    expect(analyzeDiscount(offer({ priceBasis: "quoted_lot", quotedQuantity: 3000, tiers: [tier5] }), req(), noInv).applicable).toBe(false);
  });

  it("respects unknown delivery", () => {
    const a = analyzeDiscount(offer({ ...carton, tiers: [tier5], tierMechanism: "all_units", deliveryKind: null }), req(), noInv);
    expect(a.conclusion).toBe("incomplete");
  });

  it("marks tier scenario unavailable when stock is stated below it", () => {
    const a = analyzeDiscount(offer({ ...carton, tiers: [tier5], tierMechanism: "all_units", availableQuantity: 4000 }), req(), noInv);
    expect(a.scenarios[1].unavailable).toBe(true);
    expect(a.conclusion).toBe("incomplete");
  });

  it("recalculates on quantity change with no external call", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const a = analyzeDiscount(o, req({ quantity: 4500 }), noInv);
    expect(a.scenarios[0].cost.purchaseQty).toBe(5000);
    expect(a.scenarios).toHaveLength(1);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("inventory coverage", () => {
  const o = offer({ ...carton, tiers: [tier5], tierMechanism: "all_units" });
  it("is absent without consumption, even with other inputs", () => {
    const a = analyzeDiscount(o, req(), { currentStock: 500, dailyUse: null, maxCoverageDays: 30 });
    expect(a.scenarios.every((s) => s.coverageDays === null && s.exceedsMaxCoverage === null)).toBe(true);
  });
  it("treats zero consumption as absent", () => {
    expect(analyzeDiscount(o, req(), { currentStock: null, dailyUse: 0, maxCoverageDays: null }).scenarios[0].coverageDays).toBeNull();
  });
  it("estimates from user inputs and compares with the limit", () => {
    const a = analyzeDiscount(o, req(), { currentStock: 500, dailyUse: 100, maxCoverageDays: 40 });
    expect(a.scenarios[0].coverageDays).toBe(35);
    expect(a.scenarios[0].exceedsMaxCoverage).toBe(false);
    expect(a.scenarios[1].coverageDays).toBe(55);
    expect(a.scenarios[1].exceedsMaxCoverage).toBe(true);
  });
});
