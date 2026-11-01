import type { Ambiguity, Charge, RawOffer, ResolvedOffer, Tier } from "./schemas";

/* Every value an offer holds is a list of versions. Nothing is ever overwritten: corrections and
   supplier replies append a version and move the `active` pointer. */

export type Evidence = { sourceId: string; quote: string; start: number; end: number };
export type VersionSource = "offer" | "reply" | "user";
export type VersionFlag = "unsupported_quote" | "value_not_in_quote" | null;

export type FieldVersion = {
  value: unknown;
  source: VersionSource;
  evidence: Evidence | null;
  flag: VersionFlag;
  at: number;
  note?: string;
};
export type Tracked = { versions: FieldVersion[]; active: number };

export type SourceText = { id: string; kind: "offer" | "reply"; text: string; at: number };

export type OfferState = {
  id: string;
  label: string;
  sources: SourceText[];
  fields: Record<string, Tracked>;
  ambiguities: Ambiguity[];
};

export const SCALAR_FIELDS = [
  "productCategory", "supplierName", "productDescription", "cupSizeOz", "material", "wall", "use",
  "priceAmount", "priceBasis", "packageLevels", "soldByPackageOnly", "quotedQuantity", "moq", "moqUnit", "availableQuantity",
  "deliveryKind", "deliveryAmount", "deliveryFreeAbove", "deliveryCondition", "deliveryCities", "deliveryVat",
  "vatStatus", "vatRatePercent", "leadTimeDays", "leadTimeBusinessDays", "deliveryDate",
  "lids", "printing", "paymentTerms", "validity", "tierMechanism",
] as const satisfies readonly (keyof RawOffer)[];
export type ScalarField = (typeof SCALAR_FIELDS)[number];

export const fieldValue = <T = unknown>(o: OfferState, key: string): T | null => {
  const f = o.fields[key];
  return f ? ((f.versions[f.active]?.value ?? null) as T | null) : null;
};
export const activeVersion = (o: OfferState, key: string): FieldVersion | null => {
  const f = o.fields[key];
  return f ? f.versions[f.active] ?? null : null;
};

export function pushVersion(o: OfferState, key: string, version: FieldVersion, activate = true): OfferState {
  const existing = o.fields[key] ?? { versions: [], active: -1 };
  const versions = [...existing.versions, version];
  return {
    ...o,
    fields: { ...o.fields, [key]: { versions, active: activate ? versions.length - 1 : existing.active } },
  };
}

export function correctField(o: OfferState, key: string, value: unknown, at: number, note?: string): OfferState {
  const clean = value === "" || value === undefined ? null : value;
  let next = pushVersion(o, key, { value: clean, source: "user", evidence: null, flag: null, at, note });
  next = resolveAmbiguitiesFor(next, key);
  return next;
}

export function setActive(o: OfferState, key: string, active: number): OfferState {
  return { ...o, fields: { ...o.fields, [key]: { ...o.fields[key], active } } };
}

export function resolveAmbiguitiesFor(o: OfferState, field: string): OfferState {
  return { ...o, ambiguities: o.ambiguities.map((a) => (a.field === field ? { ...a, resolved: true } : a)) };
}

export function resolveOffer(o: OfferState): ResolvedOffer {
  const v = <K extends ScalarField>(k: K) => fieldValue<NonNullable<RawOffer[K]["value"]>>(o, k);
  const specs: NonNullable<ResolvedOffer["specs"]> = {};
  for (const key of Object.keys(o.fields)) {
    if (key.startsWith("spec:")) {
      const s = fieldValue<string | number>(o, key);
      if (s != null) specs[key.slice(5)] = s;
    }
  }
  const other: ResolvedOffer["otherRequirements"] = {};
  for (const key of Object.keys(o.fields)) {
    if (key.startsWith("other:")) {
      const s = fieldValue<"meets" | "not">(o, key);
      if (s) other[key.slice(6)] = s;
    }
  }
  return {
    id: o.id,
    label: v("supplierName") || o.label,
    productCategory: v("productCategory"),
    specs,
    cupSizeOz: v("cupSizeOz"), material: v("material"), wall: v("wall"), use: v("use"),
    priceAmount: v("priceAmount"), priceBasis: v("priceBasis"), packageLevels: v("packageLevels"), soldByPackageOnly: v("soldByPackageOnly"),
    quotedQuantity: v("quotedQuantity"), moq: v("moq"), moqUnit: v("moqUnit"), availableQuantity: v("availableQuantity"),
    deliveryKind: v("deliveryKind"), deliveryAmount: v("deliveryAmount"), deliveryFreeAbove: v("deliveryFreeAbove"),
    deliveryCities: v("deliveryCities"), deliveryVat: v("deliveryVat"),
    vatStatus: v("vatStatus"), vatRatePercent: v("vatRatePercent"),
    leadTimeDays: v("leadTimeDays"), leadTimeBusinessDays: v("leadTimeBusinessDays"), deliveryDate: v("deliveryDate"),
    lids: v("lids"), printing: v("printing"), tierMechanism: v("tierMechanism"),
    charges: fieldValue<Charge[]>(o, "charges") ?? [],
    tiers: fieldValue<Tier[]>(o, "tiers") ?? [],
    otherRequirements: other,
    // A contradiction always needs a decision. Any other note only blocks while the field it concerns is still unknown,
    // so a passing remark from the model cannot hold back an offer whose facts are clear.
    openAmbiguities: o.ambiguities
      .filter((a) => !a.resolved && (a.kind === "contradiction" || (a.field != null && o.fields[a.field] != null && fieldValue(o, a.field) == null)))
      .map(({ kind, text, field }) => ({ kind, text, field })),
  };
}

export type HistoryEntry = { field: string; value: unknown; source: VersionSource; sourceId: string | null; quote: string | null; at: number; adopted: boolean; note?: string };

export function changeHistory(o: OfferState): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const [field, t] of Object.entries(o.fields)) {
    t.versions.forEach((v, i) => {
      if (v.value == null && v.source === "offer" && !v.flag) return;
      out.push({ field, value: v.value, source: v.source, sourceId: v.evidence?.sourceId ?? null, quote: v.evidence?.quote ?? null, at: v.at, adopted: i === t.active, note: v.note });
    });
  }
  return out.sort((a, b) => a.at - b.at);
}
