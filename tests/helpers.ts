import { emptyRequirements, Requirements, ResolvedOffer } from "@/domain/schemas";

export const offer = (over: Partial<ResolvedOffer> = {}): ResolvedOffer => ({
  id: "A", label: "مورد أ", cupSizeOz: 8, material: null, wall: null, use: "hot",
  priceAmount: 0.4, priceBasis: "per_item", packageLevels: null, soldByPackageOnly: null, quotedQuantity: null,
  moq: null, moqUnit: null, availableQuantity: null, deliveryKind: "free", deliveryAmount: null, deliveryFreeAbove: null,
  deliveryCities: ["الرياض"], deliveryVat: null, vatStatus: "included", vatRatePercent: null,
  leadTimeDays: 5, leadTimeBusinessDays: null, deliveryDate: null, lids: null, printing: null, tierMechanism: null,
  charges: [], tiers: [], otherRequirements: {}, openAmbiguities: [],
  ...over,
});

export const req = (over: Partial<Requirements> = {}): Requirements => ({
  ...emptyRequirements(), product: "أكواب", quantity: 3000, sizeOz: 8, use: "hot", city: "الرياض", ...over,
});

export const NO_EXTRAS = { lid: null, print: null } as const;
export const TODAY = "2026-11-01";
