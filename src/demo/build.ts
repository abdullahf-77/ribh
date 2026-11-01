import type { RawOffer, RawRequirements } from "@/domain/schemas";

/* Terse builders for hand-written fictional fixtures. Fixtures go through the same evidence checks as
   live model output, so every quote below must really occur in the scenario's text. */

type OfferInit = Partial<Omit<RawOffer, "charges" | "tiers" | "otherRequirements" | "ambiguities">> &
  Partial<Pick<RawOffer, "charges" | "tiers" | "otherRequirements" | "ambiguities">>;

export const v = <T,>(value: T, quote: string) => ({ value, quote });
const n = { value: null, quote: null };

export function rawOffer(init: OfferInit): RawOffer {
  return {
    productCategory: n, specs: [], supplierName: n, productDescription: n, cupSizeOz: n, material: n, wall: n, use: n, priceAmount: n, priceBasis: n, packageLevels: n,
    soldByPackageOnly: n, quotedQuantity: n, moq: n, moqUnit: n, availableQuantity: n, deliveryKind: n, deliveryAmount: n, deliveryFreeAbove: n,
    deliveryCondition: n, deliveryCities: n, deliveryVat: n, vatStatus: n, vatRatePercent: n, leadTimeDays: n, leadTimeBusinessDays: n,
    deliveryDate: n, lids: n, printing: n, paymentTerms: n, validity: n, tierMechanism: n, charges: [], tiers: [], otherRequirements: [], ambiguities: [],
    ...init,
  };
}

export function rawRequirements(init: Partial<RawRequirements>): RawRequirements {
  return {
    category: n, specs: [], product: n, quantity: n, sizeOz: n, material: n, wall: n, use: n, lid: n, print: n, city: n, requiredDate: n, requiredWithinDays: n,
    budgetSar: n, budgetIncludesDelivery: n, budgetIncludesVat: n, other: [],
    ...init,
  };
}
