import { CATEGORIES, CategoryId, specDef } from "@/domain/categories";
import { decide, Decision } from "@/domain/decision";
import { fieldValue, resolveOffer, SCALAR_FIELDS } from "@/domain/offer-state";
import { emptyRequirements, Requirements } from "@/domain/schemas";
import type { ConversationState } from "./types";

export const initialState = (today: string): ConversationState => ({
  requirements: emptyRequirements(), reqEvidence: {}, waived: [], offers: [], confirmedOfferIds: [], rejected: {},
  priority: "cash", orderDate: today, analyzedOtherKey: "[]", scenarioQuantity: null,
});

export const otherKey = (r: Requirements) => JSON.stringify(r.other.map((o) => [o.id, o.text]));

const SHARED_QUESTIONS: Record<string, string> = {
  category: "أي منتج تريد مقارنته: أكواب، أغطية، أكياس، مناديل، أم عبوات سفري؟",
  product: "ما المنتج الذي تريد شراءه؟",
  quantity: "كم الكمية التي تحتاجها؟",
  sizeOz: "ما مقاس الكوب بالأونصة؟",
  use: "هل المنتج للمشروبات الساخنة أم الباردة؟",
  material: "هل تشترط مادة معينة؟",
  lid: "هل تحتاج الغطاء ضمن الطلب؟",
  print: "هل تحتاج طباعة مخصصة؟",
  city: "إلى أي مدينة يكون التوصيل؟",
  requiredDate: "متى تحتاج الاستلام؟",
  budgetSar: "كم ميزانيتك بالريال؟",
  budgetIncludesDelivery: "هل تشمل ميزانيتك التوصيل؟",
  budgetIncludesVat: "هل تشمل ميزانيتك الضريبة؟",
};

export const questionFor = (field: string) =>
  field.startsWith("spec:") ? specDef(field.slice(5))?.question ?? "" : SHARED_QUESTIONS[field] ?? "";

const valueOf = (r: Requirements, field: string) =>
  field.startsWith("spec:") ? r.specs[field.slice(5)] : r[field as keyof Requirements];

/** Fields that belong in this conversation. A napkin buyer is never asked about cup sizes or lids. */
export function applicableFields(category: CategoryId | null): string[] {
  if (!category) return ["category", "quantity", "city", "requiredDate", "budgetSar"];
  const c = CATEGORIES[category];
  return ["quantity", ...c.askNative, ...c.specs.filter((s) => s.ask).map((s) => `spec:${s.key}`), "city", "requiredDate", "budgetSar"];
}

/** What is still open, in asking order. Budget basis is only relevant once there is a budget. */
export function missingFields(s: Pick<ConversationState, "requirements" | "waived">): string[] {
  const r = s.requirements;
  const out = applicableFields(r.category).filter((f) => valueOf(r, f) == null);
  if (r.budgetSar != null) {
    if (r.budgetIncludesDelivery == null) out.push("budgetIncludesDelivery");
    if (r.budgetIncludesVat == null) out.push("budgetIncludesVat");
  }
  return out.filter((f) => !s.waived.includes(f));
}

export function knownFields(s: Pick<ConversationState, "requirements">): string[] {
  const r = s.requirements;
  const shared = ["category", "product", "quantity", "sizeOz", "use", "material", "wall", "lid", "print", "city", "requiredDate", "budgetSar", "budgetIncludesDelivery", "budgetIncludesVat"];
  return [...shared.filter((f) => r[f as keyof Requirements] != null), ...Object.keys(r.specs).map((k) => `spec:${k}`)];
}

export const confirmedOffers = (s: Pick<ConversationState, "offers" | "confirmedOfferIds">) =>
  s.offers.filter((o) => s.confirmedOfferIds.includes(o.id));

/** The quantity results are shown at: an active scenario, otherwise the confirmed order. */
export const activeQuantity = (s: Pick<ConversationState, "requirements" | "scenarioQuantity">) => s.scenarioQuantity ?? s.requirements.quantity;

export function currentDecision(s: ConversationState, quantity?: number): Decision | null {
  const q = quantity ?? activeQuantity(s);
  const offers = confirmedOffers(s);
  if (!q || offers.length < 2) return null;
  return decide(offers.map(resolveOffer), { ...s.requirements, quantity: q }, s.orderDate, s.priority);
}

export type RequirementConflict = { field: string; current: unknown; proposed: unknown; quote: string | null };

/** New information fills blanks. It never replaces something already held: that becomes a conflict for the user. */
export function mergeRequirements(
  current: Requirements, evidence: Record<string, string>, incoming: Requirements, incomingEvidence: Record<string, string>, incomingSpecEvidence: Record<string, string> = {},
) {
  const next: Requirements = { ...current, specs: { ...current.specs } };
  const nextEvidence = { ...evidence };
  const conflicts: RequirementConflict[] = [];
  const filled: string[] = [];
  for (const key of Object.keys(incoming) as (keyof Requirements)[]) {
    if (key === "other" || key === "specs") continue;
    const value = incoming[key];
    if (value == null) continue;
    // A product name we filled in from the category was never confirmed by anyone, so it is not a conflict.
    const autoLabel = key === "product" && current.category != null && current.product === CATEGORIES[current.category].label;
    if (current[key] == null || autoLabel) {
      (next as Record<string, unknown>)[key] = value;
      if (incomingEvidence[key]) nextEvidence[key] = incomingEvidence[key];
      filled.push(key);
    } else if (current[key] !== value) {
      conflicts.push({ field: key, current: current[key], proposed: value, quote: incomingEvidence[key] ?? null });
    }
  }
  for (const [key, value] of Object.entries(incoming.specs)) {
    const field = `spec:${key}`;
    if (current.specs[key] == null) {
      next.specs[key] = value;
      if (incomingSpecEvidence[key]) nextEvidence[field] = incomingSpecEvidence[key];
      filled.push(field);
    } else if (String(current.specs[key]) !== String(value)) {
      conflicts.push({ field, current: current.specs[key], proposed: value, quote: incomingSpecEvidence[key] ?? null });
    }
  }
  if (!next.product && next.category) next.product = CATEGORIES[next.category].label;
  const known = new Set(current.other.map((o) => o.text));
  let counter = current.other.length;
  const added = incoming.other.filter((o) => !known.has(o.text)).map((o) => ({ ...o, id: `R${++counter}` }));
  next.other = [...current.other, ...added];
  return { next, nextEvidence, conflicts, filled };
}

export function setRequirementValue(r: Requirements, field: string, value: unknown): Requirements {
  if (field.startsWith("spec:")) return { ...r, specs: { ...r.specs, [field.slice(5)]: value as string | number } };
  return { ...r, [field]: value };
}

/** A new product starts clean: quantity, budget, specs and offers never carry over. The city stays only if no new message is about to state it. */
export function resetForCategory(s: ConversationState, category: CategoryId, keepCity = true): ConversationState {
  return {
    ...s,
    requirements: { ...emptyRequirements(), category, product: CATEGORIES[category].label, city: keepCity ? s.requirements.city : null },
    reqEvidence: {}, waived: [], offers: [], confirmedOfferIds: [], rejected: {}, analyzedOtherKey: "[]", scenarioQuantity: null,
  };
}

/** The structured context Llama sees each turn. Pasted offer text is deliberately left out. */
export function stateForPrompt(s: ConversationState) {
  return {
    requirements: s.requirements,
    knownFields: knownFields(s),
    missingFields: missingFields(s),
    waivedFields: s.waived,
    priority: s.priority,
    scenarioQuantity: s.scenarioQuantity,
    offers: s.offers.map((o) => ({
      id: o.id,
      supplier: fieldValue<string>(o, "supplierName") || o.label,
      confirmedByUser: s.confirmedOfferIds.includes(o.id),
      values: Object.fromEntries([...SCALAR_FIELDS, ...Object.keys(o.fields).filter((k) => k.startsWith("spec:"))].map((k) => [k, fieldValue(o, k)]).filter(([, v]) => v != null)),
      hasTiers: !!fieldValue(o, "tiers"),
      openPoints: o.ambiguities.filter((a) => !a.resolved).map((a) => a.text),
    })),
  };
}
