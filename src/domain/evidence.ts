import { CATEGORIES, CategoryId, coerceSpec, NATIVE_TO_OFFER, specDef } from "./categories";
import { foldDigits } from "./evidence-text";
import type { Evidence, FieldVersion, OfferState, VersionFlag } from "./offer-state";
import { SCALAR_FIELDS } from "./offer-state";
import type { Ambiguity, RawOffer, RawRequirements, Requirements } from "./schemas";

export { foldDigits } from "./evidence-text";

const IGNORABLE = /[ـً-ْ​-‏‪-‮⁦-⁩﻿]/;

/** Whitespace, tashkeel, kashida and direction marks are the only differences a quote may have. */
function normalizeWithMap(text: string): { out: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (IGNORABLE.test(c)) continue;
    if (/\s/.test(c)) { pendingSpace = out.length > 0; continue; }
    if (pendingSpace) { out += " "; map.push(i); pendingSpace = false; }
    out += c;
    map.push(i);
  }
  return { out, map };
}

export function locateQuote(source: string, quote: string): { start: number; end: number } | null {
  const q = normalizeWithMap(quote).out;
  if (!q) return null;
  const { out, map } = normalizeWithMap(source);
  const idx = out.indexOf(q);
  if (idx < 0) return null;
  return { start: map[idx], end: map[idx + q.length - 1] + 1 };
}

const NUMBER_WORDS: [RegExp, number[]][] = [
  [/طبقتين/, [2]], [/طبقة واحدة/, [1]],
  [/(ثلاث|ثلاثة|تلات|تلاتة)\s*(آلاف|الاف)/, [3000]], [/(أربع|اربع|أربعة|اربعة)\s*(آلاف|الاف)/, [4000]], [/(خمس|خمسة)\s*(آلاف|الاف)/, [5000]],
  [/(ست|ستة)\s*(آلاف|الاف)/, [6000]], [/(سبع|سبعة)\s*(آلاف|الاف)/, [7000]], [/(ثمان|ثمانية|تمن)\s*(آلاف|الاف)/, [8000]], [/(تسع|تسعة)\s*(آلاف|الاف)/, [9000]], [/(عشر|عشرة)\s*(آلاف|الاف)/, [10000]],
  [/ألفين|الفين/, [2000]], [/ألف|الف|thousand/i, [1000]], [/مئتين|مئتان|ميتين/, [200]], [/مئة|مائة|ميه|hundred/i, [100]],
  [/نصف|نص/, [0.5]], [/ربع/, [0.25]], [/درزن|دزينة|dozen/i, [12]], [/أسبوعين|اسبوعين/, [14]], [/أسبوع|اسبوع|week/i, [7]],
  [/يومين/, [2]], [/خمسين/, [50]], [/مية/, [100]], [/عشرة|عشر\b/, [10]],
];

/** Does the quote plausibly state this number? Used to flag, not to silently repair. */
export function numberSupported(quote: string, value: number): boolean {
  const folded = foldDigits(quote).replace(/(\d),(?=\d{3})/g, "$1");
  const numbers = (folded.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (numbers.some((n) => Math.abs(n - value) < 1e-9)) return true;
  // "٣ آلاف" or "1.5k" style multiples.
  if (/آلاف|الاف|ألف|الف|k\b/i.test(folded) && numbers.some((n) => Math.abs(n * 1000 - value) < 1e-9)) return true;
  const fromWords = NUMBER_WORDS.flatMap(([re, values]) => (re.test(folded) ? values : []));
  if (fromWords.includes(value)) return true;
  // Weeks and halalas: "اسبوعين", "٤٥ هللة" = 0.45.
  if (/هلل/.test(folded) && numbers.some((n) => Math.abs(n / 100 - value) < 1e-9)) return true;
  if (/أسابيع|اسابيع|weeks/i.test(folded) && numbers.some((n) => n * 7 === value)) return true;
  return false;
}

type Checked = { value: unknown; evidence: Evidence | null; flag: VersionFlag };

export function checkField(sourceId: string, text: string, field: { value: unknown; quote: string | null }): Checked {
  if (field.value == null) return { value: null, evidence: null, flag: null };
  const loc = field.quote ? locateQuote(text, field.quote) : null;
  // No verifiable quote: the value is rejected and stays unknown.
  if (!loc) return { value: null, evidence: null, flag: "unsupported_quote" };
  const evidence = { sourceId, quote: field.quote!, ...loc };
  if (typeof field.value === "number" && !numberSupported(field.quote!, field.value)) {
    return { value: field.value, evidence, flag: "value_not_in_quote" };
  }
  return { value: field.value, evidence, flag: null };
}

export type ValidatedOffer = {
  fields: Record<string, Omit<FieldVersion, "source" | "at">>;
  ambiguities: Ambiguity[];
  rejected: { field: string; quote: string | null }[];
};

/** Applies the evidence rules to a raw model response from one source text. */
export function validateRawOffer(raw: RawOffer, sourceId: string, text: string, knownRequirementIds: string[], category: CategoryId | null = null): ValidatedOffer {
  const fields: ValidatedOffer["fields"] = {};
  const rejected: ValidatedOffer["rejected"] = [];

  for (const key of SCALAR_FIELDS) {
    const checked = checkField(sourceId, text, raw[key]);
    if (checked.flag === "unsupported_quote") rejected.push({ field: key, quote: raw[key].quote });
    fields[key] = checked;
  }

  for (const key of ["charges", "tiers"] as const) {
    const kept: unknown[] = [];
    let firstEvidence: Evidence | null = null;
    for (const item of raw[key]) {
      const loc = locateQuote(text, item.quote);
      if (!loc) { rejected.push({ field: key, quote: item.quote }); continue; }
      firstEvidence ??= { sourceId, quote: item.quote, ...loc };
      kept.push(item);
    }
    fields[key] = { value: kept.length ? kept : null, evidence: firstEvidence, flag: null };
  }

  for (const r of raw.otherRequirements) {
    if (!knownRequirementIds.includes(r.id)) continue;
    const checked = checkField(sourceId, text, { value: r.status, quote: r.quote });
    if (checked.flag) rejected.push({ field: `other:${r.id}`, quote: r.quote });
    fields[`other:${r.id}`] = checked;
  }

  for (const s of raw.specs) {
    // Only keys of this category survive, so another product's specification cannot leak in.
    const def = specDef(s.key, category);
    const value = def ? coerceSpec(def, s.value) : null;
    if (!def || value == null) { rejected.push({ field: `spec:${s.key}`, quote: s.quote }); continue; }
    const checked = checkField(sourceId, text, { value, quote: s.quote });
    if (checked.flag === "unsupported_quote") rejected.push({ field: `spec:${s.key}`, quote: s.quote });
    fields[`spec:${s.key}`] = checked;
  }

  if (category) {
    const allowed = new Set(CATEGORIES[category].native.map((n) => NATIVE_TO_OFFER[n]));
    for (const f of Object.values(NATIVE_TO_OFFER)) if (!allowed.has(f)) fields[f] = { value: null, evidence: null, flag: null };
  }

  const ambiguities: Ambiguity[] = raw.ambiguities.map((a, i) => {
    const located = a.quote ? locateQuote(text, a.quote) : null;
    return { ...a, quote: located ? a.quote : null, id: `${sourceId}#${i}`, resolved: false, flaggedQuote: !!a.quote && !located };
  });

  return { fields, ambiguities, rejected };
}

export function newOfferState(id: string, label: string, text: string, validated: ValidatedOffer, at: number): OfferState {
  const fields: OfferState["fields"] = {};
  for (const [key, v] of Object.entries(validated.fields)) {
    fields[key] = { versions: [{ ...v, source: "offer", at }], active: 0 };
  }
  return {
    id,
    label,
    sources: [{ id: `offer:${id}`, kind: "offer", text, at }],
    fields,
    ambiguities: validated.ambiguities,
  };
}

export type RequirementEvidence = Partial<Record<keyof Requirements, string>>;

/** Validates quotes against the buyer's text. Relative deadlines become dates here, in code. */
export function validateRawRequirements(raw: RawRequirements, text: string, today: string, knownCategory: CategoryId | null = null) {
  const req: Requirements = {
    category: null, specs: {}, product: null, quantity: null, sizeOz: null, material: null, wall: null, use: null, lid: null, print: null, city: null,
    requiredDate: null, budgetSar: null, budgetIncludesDelivery: null, budgetIncludesVat: null, other: [],
  };
  const evidence: RequirementEvidence = {};
  const specEvidence: Record<string, string> = {};
  const rejected: string[] = [];
  const keys = ["category", "product", "quantity", "sizeOz", "material", "wall", "use", "lid", "print", "city", "requiredDate", "budgetSar", "budgetIncludesDelivery", "budgetIncludesVat"] as const;
  for (const key of keys) {
    const checked = checkField("requirement", text, raw[key]);
    if (checked.flag === "unsupported_quote") rejected.push(key);
    if (checked.value == null) continue;
    if (checked.flag === "value_not_in_quote") { rejected.push(key); continue; }
    (req as Record<string, unknown>)[key] = checked.value;
    evidence[key] = raw[key].quote!;
  }
  if (req.requiredDate && !/^\d{4}-\d{2}-\d{2}$/.test(req.requiredDate)) req.requiredDate = null;
  if (!req.requiredDate && raw.requiredWithinDays.value != null) {
    const checked = checkField("requirement", text, raw.requiredWithinDays);
    if (checked.value != null && !checked.flag) {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + (checked.value as number));
      req.requiredDate = d.toISOString().slice(0, 10);
      evidence.requiredDate = raw.requiredWithinDays.quote!;
    }
  }
  if (req.quantity != null && (!Number.isInteger(req.quantity) || req.quantity <= 0)) { req.quantity = null; rejected.push("quantity"); }
  for (const s of raw.specs) {
    const def = specDef(s.key, knownCategory ?? req.category);
    const value = def ? coerceSpec(def, s.value) : null;
    if (!def || value == null) { rejected.push(`spec:${s.key}`); continue; }
    const checked = checkField("requirement", text, { value, quote: s.quote });
    if (checked.value == null || checked.flag) { rejected.push(`spec:${s.key}`); continue; }
    req.specs[s.key] = value;
    specEvidence[s.key] = s.quote;
  }
  const effective = knownCategory ?? req.category;
  if (effective) {
    const allowed = CATEGORIES[effective].native as string[];
    for (const f of ["sizeOz", "use", "material", "wall", "lid", "print"]) {
      if (!allowed.includes(f) && (req as Record<string, unknown>)[f] != null) { (req as Record<string, unknown>)[f] = null; delete evidence[f as keyof Requirements]; }
    }
  }
  raw.other.forEach((o, i) => {
    if (locateQuote(text, o.quote)) req.other.push({ id: `R${i + 1}`, text: o.text, level: o.level });
  });
  return { requirements: req, evidence, specEvidence, rejected };
}
