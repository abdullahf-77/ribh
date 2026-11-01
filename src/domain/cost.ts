import Big from "big.js";
import type { Charge, Requirements, ResolvedOffer, Tier } from "./schemas";

/** All money leaves this module as integer halalas. Arithmetic in between uses Big. */
export const toHalalas = (sar: Big) => Number(sar.times(100).round(0, Big.roundHalfUp).toString());
export const sarToHalalas = (sar: number) => toHalalas(new Big(sar));

export type MissingCode =
  | "price" | "price_basis" | "package_size" | "lot_quantity" | "moq_unit" | "partial_package"
  | "delivery" | "delivery_conditional" | "delivery_vat" | "vat" | "vat_rate"
  | "lids_cost" | "print_cost" | "tier_mechanism" | "tier_condition"
  | `charge_amount:${string}` | `charge_vat:${string}` | `charge_unclear:${string}`;

export type LineItem = { label: string; amountHalalas: number; vat: "included" | "excluded" };

export type CostResult = {
  requested: number;
  purchaseQty: number | null;
  packages: number | null;
  unitsPerPackage: number | null;
  excess: number | null;
  /** The quoted lot is smaller than the request; lots are never repeated or prorated. */
  lotShort: boolean;
  goodsHalalas: number | null;
  /** null = unresolved; 0 = explicitly free or below no threshold. */
  deliveryHalalas: number | null;
  chargesHalalas: number;
  lines: LineItem[];
  vatHalalas: number | null;
  vatTreatment: "included" | "excluded" | null;
  /** Only present when every component is known. */
  totalHalalas: number | null;
  /** Sum of known parts when something is missing. Never a final total. */
  knownSubtotalHalalas: number | null;
  /** All-in cost per purchased unit, VAT-inclusive, 4dp SAR. Only with a complete total. */
  comparableUnitSar: string | null;
  /** All-in cost divided by the units the buyer actually needs. */
  costPerRequiredSar: string | null;
  /** Goods price per unit before delivery, on the offer's quoted tax basis. */
  goodsUnitSar: string | null;
  tierApplied: Tier | null;
  missing: MissingCode[];
  complete: boolean;
};

export function unitsPerPackage(o: Pick<ResolvedOffer, "packageLevels">): number | null {
  if (!o.packageLevels?.length) return null;
  const product = o.packageLevels.reduce((acc, l) => acc * l.count, 1);
  return Number.isInteger(product) && product > 0 ? product : null;
}

type Purchase = { qty: number | null; packages: number | null; upp: number | null; lotShort: boolean; missing: MissingCode[] };

export function resolvePurchase(o: ResolvedOffer, requested: number): Purchase {
  const missing: MissingCode[] = [];
  const upp = unitsPerPackage(o);
  const none = (...codes: MissingCode[]): Purchase => ({ qty: null, packages: null, upp, lotShort: false, missing: codes });

  if (!o.priceBasis) return none("price_basis");

  if (o.priceBasis === "quoted_lot") {
    if (o.quotedQuantity == null) return none("lot_quantity");
    // A lot is evaluated as offered: no scaling down, up, or repeating.
    return { qty: o.quotedQuantity, packages: null, upp, lotShort: o.quotedQuantity < requested, missing };
  }

  if (o.moq != null && o.moqUnit == null && o.priceBasis === "per_package") return none("moq_unit");

  if (o.priceBasis === "per_package") {
    if (upp == null) return none("package_size");
    const moqUnits = o.moq == null ? 0 : o.moqUnit === "package" ? o.moq * upp : o.moq;
    const packages = Math.ceil(Math.max(requested, moqUnits) / upp);
    return { qty: packages * upp, packages, upp, lotShort: false, missing };
  }

  // per_item
  if (o.moq != null && o.moqUnit === "package" && upp == null) return none("package_size");
  const moqUnits = o.moq == null ? 0 : o.moqUnit === "package" ? o.moq * upp! : o.moq;
  const need = Math.max(requested, moqUnits);
  if (upp != null && o.soldByPackageOnly === true) {
    const packages = Math.ceil(need / upp);
    return { qty: packages * upp, packages, upp, lotShort: false, missing };
  }
  if (upp != null && o.soldByPackageOnly == null && need % upp !== 0) {
    // Whether partial packages can be bought changes the quantity; the offer does not say.
    missing.push("partial_package");
    return { qty: null, packages: null, upp, lotShort: false, missing };
  }
  return { qty: need, packages: upp != null ? need / upp : null, upp, lotShort: false, missing };
}

const tierUnits = (t: Tier, upp: number | null) => (t.qtyUnit === "package" ? (upp == null ? null : t.minQty * upp) : t.minQty);

function perItem(price: number, basis: "per_item" | "per_package", upp: number | null): Big | null {
  if (basis === "per_item") return new Big(price);
  return upp == null ? null : new Big(price).div(upp);
}

type GoodsResult = { goods: Big | null; tier: Tier | null; missing: MissingCode[] };

function priceGoods(o: ResolvedOffer, p: { qty: number; packages: number | null; upp: number | null }): GoodsResult {
  if (o.priceBasis === "quoted_lot") {
    return o.priceAmount == null ? { goods: null, tier: null, missing: ["price"] } : { goods: new Big(o.priceAmount), tier: null, missing: [] };
  }
  const base = (): Big | null => {
    if (o.priceAmount == null) return null;
    if (o.priceBasis === "per_package") return p.packages == null ? null : new Big(o.priceAmount).times(p.packages);
    return new Big(o.priceAmount).times(p.qty);
  };

  if (!o.tiers.length) {
    const goods = base();
    return { goods, tier: null, missing: goods == null ? ["price"] : [] };
  }

  const tiers = o.tiers
    .map((t) => ({ t, units: tierUnits(t, p.upp) }))
    .sort((a, b) => (a.units ?? 0) - (b.units ?? 0));
  if (tiers.some((x) => x.units == null)) return { goods: null, tier: null, missing: ["package_size"] };
  const applicable = tiers.filter((x) => x.units! <= p.qty);

  if (!applicable.length) {
    const goods = base();
    return { goods, tier: null, missing: goods == null ? ["price"] : [] };
  }
  const top = applicable[applicable.length - 1].t;
  // A first tier starting at 1 is just the base price; mechanism does not matter when no break was crossed.
  const crossedBreak = applicable.length > 1 || (o.priceAmount != null) || applicable[0].units! > 1;
  if (applicable.some((x) => x.t.condition)) return { goods: null, tier: top, missing: ["tier_condition"] };
  if (crossedBreak && !o.tierMechanism) return { goods: null, tier: top, missing: ["tier_mechanism"] };

  if (o.tierMechanism === "incremental") {
    const basePerItem = o.priceAmount != null && o.priceBasis ? perItem(o.priceAmount, o.priceBasis as "per_item" | "per_package", p.upp) : null;
    let goods = new Big(0);
    let cursor = 0;
    const firstUnits = applicable[0].units!;
    if (firstUnits > 1) {
      if (basePerItem == null) return { goods: null, tier: top, missing: ["price"] };
      const baseUnits = firstUnits - 1;
      goods = goods.plus(basePerItem.times(baseUnits));
      cursor = baseUnits;
    }
    for (let i = 0; i < applicable.length; i++) {
      const rate = perItem(applicable[i].t.price, applicable[i].t.priceBasis, p.upp);
      if (rate == null) return { goods: null, tier: top, missing: ["package_size"] };
      const end = i + 1 < applicable.length ? applicable[i + 1].units! - 1 : p.qty;
      goods = goods.plus(rate.times(end - cursor));
      cursor = end;
    }
    return { goods, tier: top, missing: [] };
  }

  // all_units (or a single base tier)
  const goods = top.priceBasis === "per_item"
    ? new Big(top.price).times(p.qty)
    : p.packages == null ? null : new Big(top.price).times(p.packages);
  return { goods, tier: top, missing: goods == null ? ["package_size"] : [] };
}

function chargeApplies(c: Charge, req: Pick<Requirements, "lid" | "print">, o: ResolvedOffer): boolean | "unclear" {
  switch (c.appliesWhen) {
    case "always": return true;
    case "optional": return false;
    case "unclear": return "unclear";
    case "if_printing": return req.print === "required" && o.printing !== "included";
    case "if_lids": return req.lid === "required" && o.lids !== "included";
  }
}

const sar4 = (b: Big) => b.round(4, Big.roundHalfUp).toFixed(4);

export function computeCost(
  o: ResolvedOffer,
  requested: number,
  req: Pick<Requirements, "lid" | "print">,
): CostResult {
  const purchase = resolvePurchase(o, requested);
  const missing: MissingCode[] = [...purchase.missing];
  const shell: CostResult = {
    requested,
    purchaseQty: purchase.qty,
    packages: purchase.packages,
    unitsPerPackage: purchase.upp,
    excess: purchase.qty == null ? null : Math.max(0, purchase.qty - requested),
    lotShort: purchase.lotShort,
    goodsHalalas: null, deliveryHalalas: null, chargesHalalas: 0, lines: [], vatHalalas: null, vatTreatment: o.vatStatus,
    totalHalalas: null, knownSubtotalHalalas: null, comparableUnitSar: null, costPerRequiredSar: null, goodsUnitSar: null,
    tierApplied: null, missing, complete: false,
  };

  let goods: Big | null = null;
  if (purchase.qty != null) {
    const g = priceGoods(o, { qty: purchase.qty, packages: purchase.packages, upp: purchase.upp });
    goods = g.goods;
    shell.tierApplied = g.tier;
    missing.push(...g.missing);
  } else if (o.priceAmount == null && o.priceBasis !== "quoted_lot" && !o.tiers.length) {
    missing.push("price");
  }
  if (goods != null) {
    shell.goodsHalalas = toHalalas(goods);
    if (purchase.qty) shell.goodsUnitSar = sar4(goods.div(purchase.qty));
  }

  // Lids and printing sold separately must have a stated price before the total can be trusted.
  if (req.lid === "required" && o.lids === "extra" && !o.charges.some((c) => c.appliesWhen === "if_lids")) missing.push("lids_cost");
  if (req.print === "required" && o.printing === "extra" && !o.charges.some((c) => c.appliesWhen === "if_printing")) missing.push("print_cost");

  // Delivery
  let deliveryVatKnown: "included" | "excluded" | null | "none" = "none";
  const kind = o.deliveryKind ?? (o.deliveryAmount != null ? "amount" : null);
  if (kind === "free") shell.deliveryHalalas = 0;
  else if (kind === "amount") {
    if (o.deliveryAmount == null) missing.push("delivery");
    else {
      shell.deliveryHalalas = sarToHalalas(o.deliveryAmount);
      deliveryVatKnown = o.deliveryVat;
    }
  } else if (kind === "conditional") {
    if (o.deliveryFreeAbove != null && o.deliveryAmount != null && goods != null) {
      if (goods.gte(o.deliveryFreeAbove)) shell.deliveryHalalas = 0;
      else {
        shell.deliveryHalalas = sarToHalalas(o.deliveryAmount);
        deliveryVatKnown = o.deliveryVat;
      }
    } else missing.push("delivery_conditional");
  } else missing.push("delivery");

  // Additional charges
  let chargesTotal = 0;
  const excludedBases: number[] = [];
  for (const c of o.charges) {
    const applies = chargeApplies(c, req, o);
    if (applies === "unclear") { missing.push(`charge_unclear:${c.label}`); continue; }
    if (!applies) continue;
    if (c.amount == null) { missing.push(`charge_amount:${c.label}`); continue; }
    if (c.basis === "per_item" && purchase.qty == null) continue;
    const amount = toHalalas(c.basis === "per_item" ? new Big(c.amount).times(purchase.qty!) : new Big(c.amount));
    chargesTotal += amount;
    if (c.vat == null) { missing.push(`charge_vat:${c.label}`); continue; }
    shell.lines.push({ label: c.label, amountHalalas: amount, vat: c.vat });
    if (c.vat === "excluded") excludedBases.push(amount);
  }
  shell.chargesHalalas = chargesTotal;

  // VAT: included components add nothing; excluded components need a stated or user-applied rate.
  if (o.vatStatus == null) missing.push("vat");
  if (deliveryVatKnown === null) missing.push("delivery_vat");
  const needsRate = o.vatStatus === "excluded" || deliveryVatKnown === "excluded" || excludedBases.length > 0;
  if (needsRate && o.vatRatePercent == null) missing.push("vat_rate");

  if (o.vatRatePercent != null || !needsRate) {
    const rate = new Big(o.vatRatePercent ?? 0).div(100);
    const part = (h: number) => toHalalas(new Big(h).div(100).times(rate));
    let vat = 0;
    let known = true;
    if (o.vatStatus === "excluded") {
      if (shell.goodsHalalas == null) known = false; else vat += part(shell.goodsHalalas);
    } else if (o.vatStatus == null) known = false;
    if (deliveryVatKnown === "excluded" && shell.deliveryHalalas != null) vat += part(shell.deliveryHalalas);
    if (deliveryVatKnown === null) known = false;
    for (const b of excludedBases) vat += part(b);
    shell.vatHalalas = known ? vat : null;
  }

  const known = [shell.goodsHalalas, shell.deliveryHalalas, chargesTotal, shell.vatHalalas].filter((x): x is number => x != null);
  shell.knownSubtotalHalalas = known.length && (shell.goodsHalalas != null) ? known.reduce((a, b) => a + b, 0) : null;

  shell.complete = missing.length === 0 && shell.goodsHalalas != null && shell.deliveryHalalas != null && shell.vatHalalas != null && purchase.qty != null;
  if (shell.complete) {
    const total = shell.goodsHalalas! + shell.deliveryHalalas! + chargesTotal + shell.vatHalalas!;
    shell.totalHalalas = total;
    shell.knownSubtotalHalalas = null;
    shell.comparableUnitSar = sar4(new Big(total).div(100).div(purchase.qty!));
    shell.costPerRequiredSar = sar4(new Big(total).div(100).div(requested));
  }
  return shell;
}

export type BudgetFit = {
  status: "within" | "over" | "unknown" | "not_set";
  overByHalalas?: number;
  reason?: "cost_incomplete" | "basis_unknown";
};

/** Compares against the budget on the basis the user stated. When the basis is unknown, only a verdict that holds on every basis is given. */
export function budgetFit(cost: CostResult, req: Pick<Requirements, "budgetSar" | "budgetIncludesDelivery" | "budgetIncludesVat">): BudgetFit {
  if (req.budgetSar == null) return { status: "not_set" };
  const budget = sarToHalalas(req.budgetSar);

  if (!cost.complete || cost.totalHalalas == null) {
    // Even an incomplete known subtotal already above the budget is an overrun on any basis.
    const floor = cost.goodsHalalas;
    if (floor != null && floor > budget) return { status: "over", overByHalalas: floor - budget };
    return { status: "unknown", reason: "cost_incomplete" };
  }

  const goods = cost.goodsHalalas! + cost.chargesHalalas;
  const delivery = cost.deliveryHalalas!;
  const vat = cost.vatHalalas!;
  const options = (flag: boolean | null) => (flag == null ? [true, false] : [flag]);
  const amounts: number[] = [];
  for (const d of options(req.budgetIncludesDelivery)) {
    for (const v of options(req.budgetIncludesVat)) amounts.push(goods + (d ? delivery : 0) + (v ? vat : 0));
  }
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  if (high <= budget) return { status: "within" };
  if (low > budget) return { status: "over", overByHalalas: high - budget };
  return { status: "unknown", reason: "basis_unknown" };
}
