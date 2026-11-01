import { z } from "zod";
import { CategoryId } from "./categories";

/* ---------- What Llama must return (strict structured output) ---------- */

const F = <T extends z.ZodType>(value: T) =>
  z.object({ value: value.nullable(), quote: z.string().nullable() });

export const Material = z.enum(["paper", "plastic", "foam", "biodegradable", "other"]);
export const Wall = z.enum(["single", "double", "ripple"]);
export const Use = z.enum(["hot", "cold", "both"]);
export const PriceBasis = z.enum(["per_item", "per_package", "quoted_lot"]);
export const Vat = z.enum(["included", "excluded"]);
export const Inclusion = z.enum(["included", "extra", "not_available"]);
export const DeliveryKind = z.enum(["amount", "free", "conditional"]);
export const TierMechanism = z.enum(["all_units", "incremental"]);
export const QtyUnit = z.enum(["item", "package"]);

export const PackageLevel = z.object({ label: z.string(), count: z.number() });

export const RawCharge = z.object({
  label: z.string(),
  amount: z.number().nullable(),
  basis: z.enum(["fixed", "per_item"]),
  appliesWhen: z.enum(["always", "if_printing", "if_lids", "optional", "unclear"]),
  vat: Vat.nullable(),
  quote: z.string(),
});

export const RawTier = z.object({
  minQty: z.number(),
  qtyUnit: QtyUnit,
  price: z.number(),
  priceBasis: z.enum(["per_item", "per_package"]),
  condition: z.string().nullable(),
  quote: z.string(),
});

export const AmbiguityKind = z.enum(["packaging", "pricing", "delivery", "vat", "spec", "contradiction", "other"]);

export const RawAmbiguity = z.object({
  kind: AmbiguityKind,
  text: z.string(),
  field: z.string().nullable(),
  quote: z.string().nullable(),
});

const RawSpec = z.object({ key: z.string(), value: z.string(), quote: z.string() });

export const RawOfferSchema = z.object({
  productCategory: F(CategoryId),
  specs: z.array(RawSpec),
  supplierName: F(z.string()),
  productDescription: F(z.string()),
  cupSizeOz: F(z.number()),
  material: F(Material),
  wall: F(Wall),
  use: F(Use),
  priceAmount: F(z.number()),
  priceBasis: F(PriceBasis),
  packageLevels: F(z.array(PackageLevel)),
  soldByPackageOnly: F(z.boolean()),
  quotedQuantity: F(z.number()),
  moq: F(z.number()),
  moqUnit: F(QtyUnit),
  availableQuantity: F(z.number()),
  deliveryKind: F(DeliveryKind),
  deliveryAmount: F(z.number()),
  deliveryFreeAbove: F(z.number()),
  deliveryCondition: F(z.string()),
  deliveryCities: F(z.array(z.string())),
  deliveryVat: F(Vat),
  vatStatus: F(Vat),
  vatRatePercent: F(z.number()),
  leadTimeDays: F(z.number()),
  leadTimeBusinessDays: F(z.boolean()),
  deliveryDate: F(z.string()),
  lids: F(Inclusion),
  printing: F(Inclusion),
  paymentTerms: F(z.string()),
  validity: F(z.string()),
  tierMechanism: F(TierMechanism),
  charges: z.array(RawCharge),
  tiers: z.array(RawTier),
  otherRequirements: z.array(
    z.object({ id: z.string(), status: z.enum(["meets", "not"]), quote: z.string() }),
  ),
  ambiguities: z.array(RawAmbiguity),
});
export type RawOffer = z.infer<typeof RawOfferSchema>;

export const RawRequirementsSchema = z.object({
  category: F(CategoryId),
  specs: z.array(RawSpec),
  product: F(z.string()),
  quantity: F(z.number()),
  sizeOz: F(z.number()),
  material: F(Material),
  wall: F(Wall),
  use: F(Use),
  lid: F(z.enum(["required", "not_required"])),
  print: F(z.enum(["required", "not_required"])),
  city: F(z.string()),
  requiredDate: F(z.string()),
  requiredWithinDays: F(z.number()),
  budgetSar: F(z.number()),
  budgetIncludesDelivery: F(z.boolean()),
  budgetIncludesVat: F(z.boolean()),
  other: z.array(z.object({ text: z.string(), level: z.enum(["mandatory", "preferred"]), quote: z.string() })),
});
export type RawRequirements = z.infer<typeof RawRequirementsSchema>;

export const ComposeSchema = z.object({
  summary: z.string(),
  messages: z.array(z.object({ offerId: z.string(), message: z.string() })),
});
export const RfqDraftSchema = z.object({ message: z.string() });

/* ---------- Requirements as confirmed by the user ---------- */

export const OtherRequirement = z.object({
  id: z.string(),
  text: z.string(),
  level: z.enum(["mandatory", "preferred"]),
});
export type OtherRequirement = z.infer<typeof OtherRequirement>;

export const RequirementsSchema = z.object({
  category: CategoryId.nullable(),
  specs: z.record(z.string(), z.union([z.string(), z.number()])),
  product: z.string().nullable(),
  quantity: z.number().int().positive().nullable(),
  sizeOz: z.number().positive().nullable(),
  material: Material.nullable(),
  wall: Wall.nullable(),
  use: Use.nullable(),
  lid: z.enum(["required", "not_required"]).nullable(),
  print: z.enum(["required", "not_required"]).nullable(),
  city: z.string().nullable(),
  requiredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  budgetSar: z.number().positive().nullable(),
  budgetIncludesDelivery: z.boolean().nullable(),
  budgetIncludesVat: z.boolean().nullable(),
  other: z.array(OtherRequirement),
});
export type Requirements = z.infer<typeof RequirementsSchema>;

export const emptyRequirements = (): Requirements => ({
  category: null, specs: {}, product: null, quantity: null, sizeOz: null, material: null, wall: null, use: null, lid: null, print: null,
  city: null, requiredDate: null, budgetSar: null, budgetIncludesDelivery: null, budgetIncludesVat: null, other: [],
});

/* ---------- Plain values the calculation engine works on ---------- */

export type Charge = Omit<z.infer<typeof RawCharge>, "quote"> & { quote?: string };
export type Tier = Omit<z.infer<typeof RawTier>, "quote"> & { quote?: string };
export type Ambiguity = z.infer<typeof RawAmbiguity> & { id: string; resolved: boolean; flaggedQuote?: boolean };

export type ResolvedOffer = {
  id: string;
  label: string;
  productCategory?: CategoryId | null;
  specs?: Record<string, string | number>;
  cupSizeOz: number | null;
  material: z.infer<typeof Material> | null;
  wall: z.infer<typeof Wall> | null;
  use: z.infer<typeof Use> | null;
  priceAmount: number | null;
  priceBasis: z.infer<typeof PriceBasis> | null;
  packageLevels: { label: string; count: number }[] | null;
  soldByPackageOnly: boolean | null;
  quotedQuantity: number | null;
  moq: number | null;
  moqUnit: "item" | "package" | null;
  availableQuantity: number | null;
  deliveryKind: "amount" | "free" | "conditional" | null;
  deliveryAmount: number | null;
  deliveryFreeAbove: number | null;
  deliveryCities: string[] | null;
  deliveryVat: "included" | "excluded" | null;
  vatStatus: "included" | "excluded" | null;
  vatRatePercent: number | null;
  leadTimeDays: number | null;
  leadTimeBusinessDays: boolean | null;
  deliveryDate: string | null;
  lids: "included" | "extra" | "not_available" | null;
  printing: "included" | "extra" | "not_available" | null;
  tierMechanism: "all_units" | "incremental" | null;
  charges: Charge[];
  tiers: Tier[];
  otherRequirements: Record<string, "meets" | "not" | undefined>;
  openAmbiguities: { kind: string; text: string; field: string | null }[];
};
