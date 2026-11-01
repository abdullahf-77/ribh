import { describe, expect, it } from "vitest";
import { budgetFit, computeCost, unitsPerPackage } from "@/domain/cost";
import { NO_EXTRAS, offer } from "./helpers";

const cost = (over: Parameters<typeof offer>[0], q = 3000, extras: { lid: "required" | "not_required" | null; print: "required" | "not_required" | null } = NO_EXTRAS) =>
  computeCost(offer(over), q, extras);

describe("packaging", () => {
  it("multiplies nested package levels in code", () => {
    expect(unitsPerPackage({ packageLevels: [{ label: "كرتون", count: 20 }, { label: "باكيت", count: 50 }] })).toBe(1000);
  });

  it("rounds up to complete packages and reports excess", () => {
    const c = cost({ priceBasis: "per_package", priceAmount: 700, packageLevels: [{ label: "كرتون", count: 1600 }] });
    expect(c.packages).toBe(2);
    expect(c.purchaseQty).toBe(3200);
    expect(c.excess).toBe(200);
    expect(c.totalHalalas).toBe(140000);
  });

  it("does not round when the requested quantity is an exact multiple", () => {
    const c = cost({ priceBasis: "per_package", priceAmount: 450, packageLevels: [{ label: "كرتون", count: 1000 }] });
    expect(c.packages).toBe(3);
    expect(c.excess).toBe(0);
  });

  it("leaves the total unknown when package size is missing", () => {
    const c = cost({ priceBasis: "per_package", priceAmount: 450 });
    expect(c.missing).toContain("package_size");
    expect(c.totalHalalas).toBeNull();
    expect(c.complete).toBe(false);
  });

  it("flags per-item pricing when partial package purchase is unstated", () => {
    const c = cost({ packageLevels: [{ label: "كرتون", count: 1000 }] }, 2500);
    expect(c.missing).toContain("partial_package");
    expect(c.totalHalalas).toBeNull();
  });
});

describe("minimum orders", () => {
  it("raises purchase to item MOQ", () => {
    const c = cost({ priceAmount: 0.35, moq: 5000, moqUnit: "item" });
    expect(c.purchaseQty).toBe(5000);
    expect(c.excess).toBe(2000);
    expect(c.totalHalalas).toBe(175000);
  });

  it("handles MOQ in packages", () => {
    const c = cost({ priceBasis: "per_package", priceAmount: 100, packageLevels: [{ label: "ك", count: 500 }], moq: 10, moqUnit: "package" });
    expect(c.purchaseQty).toBe(5000);
    expect(c.goodsHalalas).toBe(100000);
  });

  it("refuses to guess the MOQ unit on package pricing", () => {
    const c = cost({ priceBasis: "per_package", priceAmount: 100, packageLevels: [{ label: "ك", count: 500 }], moq: 10 });
    expect(c.missing).toContain("moq_unit");
    expect(c.totalHalalas).toBeNull();
  });
});

describe("fixed lots", () => {
  it("evaluates the lot as offered when larger than request", () => {
    const c = cost({ priceBasis: "quoted_lot", priceAmount: 2000, quotedQuantity: 5000 });
    expect(c.purchaseQty).toBe(5000);
    expect(c.excess).toBe(2000);
    expect(c.totalHalalas).toBe(200000);
    expect(c.lotShort).toBe(false);
  });

  it("does not prorate or repeat a smaller lot", () => {
    const c = cost({ priceBasis: "quoted_lot", priceAmount: 500, quotedQuantity: 2000 });
    expect(c.purchaseQty).toBe(2000);
    expect(c.lotShort).toBe(true);
    expect(c.goodsHalalas).toBe(50000);
  });

  it("needs the lot quantity", () => {
    expect(cost({ priceBasis: "quoted_lot", priceAmount: 500 }).missing).toContain("lot_quantity");
  });
});

describe("VAT", () => {
  it("never adds VAT to an inclusive price", () => {
    const c = cost({ vatStatus: "included", vatRatePercent: 15 });
    expect(c.vatHalalas).toBe(0);
    expect(c.totalHalalas).toBe(120000);
  });

  it("adds VAT once on an exclusive price with a stated rate", () => {
    const c = cost({ vatStatus: "excluded", vatRatePercent: 15 });
    expect(c.vatHalalas).toBe(18000);
    expect(c.totalHalalas).toBe(138000);
  });

  it("does not assume a rate", () => {
    const c = cost({ vatStatus: "excluded" });
    expect(c.missing).toContain("vat_rate");
    expect(c.totalHalalas).toBeNull();
    expect(c.knownSubtotalHalalas).toBe(120000);
  });

  it("treats unknown VAT as unresolved, not zero", () => {
    const c = cost({ vatStatus: null });
    expect(c.missing).toContain("vat");
    expect(c.vatHalalas).toBeNull();
    expect(c.totalHalalas).toBeNull();
  });

  it("does not assume the tax treatment of delivery", () => {
    const c = cost({ deliveryKind: "amount", deliveryAmount: 100, deliveryVat: null });
    expect(c.missing).toContain("delivery_vat");
    expect(c.totalHalalas).toBeNull();
  });

  it("taxes an exclusive delivery fee separately", () => {
    const c = cost({ deliveryKind: "amount", deliveryAmount: 100, deliveryVat: "excluded", vatRatePercent: 15 });
    expect(c.vatHalalas).toBe(1500);
    expect(c.totalHalalas).toBe(131500);
  });
});

describe("delivery and fees", () => {
  it("separates unknown delivery from free", () => {
    expect(cost({ deliveryKind: null }).missing).toContain("delivery");
    expect(cost({ deliveryKind: "free" }).deliveryHalalas).toBe(0);
  });

  it("resolves a threshold when its numbers are stated", () => {
    const below = cost({ deliveryKind: "conditional", deliveryFreeAbove: 2000, deliveryAmount: 150, deliveryVat: "included" });
    expect(below.deliveryHalalas).toBe(15000);
    const above = cost({ deliveryKind: "conditional", deliveryFreeAbove: 1000, deliveryAmount: 150, deliveryVat: "included" });
    expect(above.deliveryHalalas).toBe(0);
  });

  it("does not guess vague conditional delivery", () => {
    expect(cost({ deliveryKind: "conditional" }).missing).toContain("delivery_conditional");
  });

  it("marks an unknown fee as missing rather than zero", () => {
    const c = cost({ charges: [{ label: "رسوم تجهيز", amount: null, basis: "fixed", appliesWhen: "always", vat: "included" }] });
    expect(c.missing).toContain("charge_amount:رسوم تجهيز");
    expect(c.totalHalalas).toBeNull();
  });

  it("adds a printing fee only when printing is required", () => {
    const charges = [{ label: "قالب طباعة", amount: 200, basis: "fixed" as const, appliesWhen: "if_printing" as const, vat: "included" as const }];
    expect(cost({ charges, printing: "extra" }, 3000, { lid: null, print: "required" }).totalHalalas).toBe(140000);
    expect(cost({ charges, printing: "extra" }, 3000, NO_EXTRAS).totalHalalas).toBe(120000);
  });

  it("needs a price for lids sold separately", () => {
    expect(cost({ lids: "extra" }, 3000, { lid: "required", print: null }).missing).toContain("lids_cost");
  });

  it("is decimal-safe", () => {
    const c = cost({ priceAmount: 0.07 }, 3);
    expect(c.goodsHalalas).toBe(21);
    const d = cost({ priceAmount: 1.15 }, 100, NO_EXTRAS);
    expect(d.goodsHalalas).toBe(11500);
  });
});

describe("budget", () => {
  const complete = cost({ deliveryKind: "amount", deliveryAmount: 100, deliveryVat: "included" }); // 1200 + 100
  it("applies stated basis", () => {
    expect(budgetFit(complete, { budgetSar: 1250, budgetIncludesDelivery: false, budgetIncludesVat: true }).status).toBe("within");
    expect(budgetFit(complete, { budgetSar: 1250, budgetIncludesDelivery: true, budgetIncludesVat: true }).status).toBe("over");
  });
  it("is unknown when the verdict depends on an unstated basis", () => {
    expect(budgetFit(complete, { budgetSar: 1250, budgetIncludesDelivery: null, budgetIncludesVat: null })).toMatchObject({ status: "unknown", reason: "basis_unknown" });
  });
  it("is decided when true on every basis", () => {
    expect(budgetFit(complete, { budgetSar: 2000, budgetIncludesDelivery: null, budgetIncludesVat: null }).status).toBe("within");
    expect(budgetFit(complete, { budgetSar: 1000, budgetIncludesDelivery: null, budgetIncludesVat: null }).status).toBe("over");
  });
  it("exact budget fits", () => {
    expect(budgetFit(complete, { budgetSar: 1300, budgetIncludesDelivery: true, budgetIncludesVat: true }).status).toBe("within");
  });
  it("flags overrun from goods alone even when total is incomplete", () => {
    const c = cost({ vatStatus: null });
    expect(budgetFit(c, { budgetSar: 1000, budgetIncludesDelivery: true, budgetIncludesVat: true }).status).toBe("over");
    expect(budgetFit(c, { budgetSar: 1500, budgetIncludesDelivery: true, budgetIncludesVat: true }).status).toBe("unknown");
  });
});
