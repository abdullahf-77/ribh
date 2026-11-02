import { z } from "zod";
import { foldDigits } from "./evidence-text";

/* The one definition of what Ribh can compare. Validation, prompts, questions, comparison checks and
   forms all read from here, so adding a category never means touching the calculation engine. */

export const CATEGORY_IDS = ["cups", "lids", "bags", "napkins", "takeaway"] as const;
export const CategoryId = z.enum(CATEGORY_IDS);
export type CategoryId = z.infer<typeof CategoryId>;

export type SpecDef = {
  key: string;
  label: string;
  kind: "number" | "enum" | "text";
  options?: Record<string, string>;
  unit?: string;
  question: string;
  /** Asked as a follow-up when missing. The others are only used if the buyer mentions them. */
  ask: boolean;
};

/** Shared requirement fields that apply to a category, with the offer field holding the same fact. */
export type NativeField = "sizeOz" | "use" | "material" | "wall" | "lid" | "print";
export const NATIVE_TO_OFFER: Record<NativeField, string> = { sizeOz: "cupSizeOz", use: "use", material: "material", wall: "wall", lid: "lids", print: "printing" };

export type CategoryDef = {
  id: CategoryId;
  label: string;
  /** Singular noun used in supplier messages, e.g. "3,000 كوب". */
  unit: string;
  native: NativeField[];
  askNative: NativeField[];
  specs: SpecDef[];
  example: string;
};

const YES_NO = { yes: "نعم", no: "لا" };

export const CATEGORIES: Record<CategoryId, CategoryDef> = {
  cups: {
    id: "cups", label: "أكواب", unit: "كوب", native: ["sizeOz", "use", "material", "wall", "lid", "print"], askNative: ["sizeOz", "use", "lid", "print"], specs: [],
    example: "أحتاج ٣٠٠٠ كوب ورقي للمشروبات الساخنة مقاس ٨ أونصات مع أغطية",
  },
  lids: {
    id: "lids", label: "أغطية", unit: "غطاء", native: ["use", "material"], askNative: [],
    specs: [
      { key: "fitsCupOz", label: "يناسب كوب مقاس (أونصة)", kind: "number", unit: "أونصة", question: "لأي مقاس كوب تحتاج الغطاء؟", ask: true },
      { key: "lidType", label: "نوع الغطاء", kind: "enum", options: { flat: "مسطح", dome: "مقبب", sip: "بفتحة شرب", straw: "بفتحة شفاط" }, question: "أي نوع غطاء تريد: مسطح، مقبب، أم بفتحة شرب؟", ask: true },
      { key: "diameterMm", label: "القطر (مم)", kind: "number", unit: "مم", question: "كم قطر الغطاء بالمليمتر؟", ask: false },
    ],
    example: "أبي ٥٠٠٠ غطاء بفتحة شرب لأكواب ٨ أونصات",
  },
  bags: {
    id: "bags", label: "أكياس", unit: "كيس", native: ["material", "print"], askNative: ["print"],
    specs: [
      { key: "bagDimensions", label: "المقاس (سم)", kind: "text", question: "كم مقاس الكيس بالسنتيمتر؟", ask: true },
      { key: "handles", label: "بمقابض", kind: "enum", options: YES_NO, question: "هل تريد الكيس بمقابض؟", ask: true },
    ],
    example: "أحتاج ٢٠٠٠ كيس ورقي بمقابض مقاس ٢٥×٣٢ سم",
  },
  napkins: {
    id: "napkins", label: "مناديل", unit: "منديل", native: ["print"], askNative: [],
    specs: [
      { key: "ply", label: "عدد الطبقات", kind: "number", question: "كم طبقة تريد في المنديل؟", ask: true },
      { key: "napkinSize", label: "المقاس (سم)", kind: "text", question: "كم مقاس المنديل بالسنتيمتر؟", ask: true },
      { key: "color", label: "اللون", kind: "text", question: "هل تشترط لونًا معينًا؟", ask: false },
    ],
    example: "أبي ١٠٠٠٠ منديل طبقتين مقاس ٣٣×٣٣ سم",
  },
  takeaway: {
    id: "takeaway", label: "عبوات سفري", unit: "عبوة", native: ["material", "lid", "print"], askNative: ["lid"],
    specs: [
      { key: "containerType", label: "نوع العبوة", kind: "enum", options: { box: "علبة", tray: "صينية", bowl: "وعاء", clamshell: "علبة بغطاء متصل", sandwich: "علبة ساندويتش" }, question: "أي نوع عبوة تحتاج: علبة، صينية، أم وعاء؟", ask: true },
      { key: "capacityMl", label: "السعة (مل)", kind: "number", unit: "مل", question: "كم سعة العبوة بالمليلتر؟", ask: true },
      { key: "leakproof", label: "مانعة للتسرب", kind: "enum", options: YES_NO, question: "هل تشترط أن تكون مانعة للتسرب؟", ask: false },
    ],
    example: "أحتاج ١٠٠٠ علبة سفري ورق كرافت سعة ٧٥٠ مل مع غطاء",
  },
};

export const SUPPORTED_LABELS = CATEGORY_IDS.map((c) => CATEGORIES[c].label).join("، ");
export const unitFor = (c: CategoryId | null) => (c ? CATEGORIES[c].unit : "وحدة");

const allSpecs = () => CATEGORY_IDS.flatMap((c) => CATEGORIES[c].specs);
export const specDef = (key: string, category: CategoryId | null = null): SpecDef | null =>
  (category ? CATEGORIES[category].specs : allSpecs()).find((s) => s.key === key) ?? null;

export type SpecValue = string | number;

/** Models sometimes return a count as the word the buyer used. */
const SPOKEN_COUNTS: Record<string, number> = { "طبقة": 1, "طبقة واحدة": 1, "طبقتين": 2, "طبقتان": 2, "ثلاث طبقات": 3, "٣ طبقات": 3 };

/** A validated schema per category: only its own keys, each with the right type and allowed values. */
export function specSchema(category: CategoryId) {
  const shape: Record<string, z.ZodType> = {};
  for (const s of CATEGORIES[category].specs) {
    if (s.kind === "number") shape[s.key] = z.number().positive().optional();
    else if (s.kind === "enum") shape[s.key] = z.enum(Object.keys(s.options!) as [string, ...string[]]).optional();
    else shape[s.key] = z.string().trim().min(1).max(120).optional();
  }
  return z.strictObject(shape);
}

/** Turns the model's text into a typed value, or null if it is not valid for this spec. */
export function coerceSpec(def: SpecDef, raw: string): SpecValue | null {
  const value = raw.trim();
  if (!value) return null;
  if (def.kind === "number") {
    const n = Number(foldDigits(value).replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
    return SPOKEN_COUNTS[value] ?? null;
  }
  if (def.kind === "enum") return Object.keys(def.options!).includes(value) ? value : null;
  return value.slice(0, 120);
}

export function specLabelValue(def: SpecDef, value: SpecValue): string {
  if (def.kind === "enum") return def.options![String(value)] ?? String(value);
  return def.unit ? `${value} ${def.unit}` : String(value);
}

/** Text specs such as sizes compare by their numbers, so "33×33" matches "33 x 33 سم". */
export function compareSpec(def: SpecDef, want: SpecValue, got: SpecValue | null | undefined): "meets" | "not" | "unknown" {
  if (got == null) return "unknown";
  if (def.kind !== "text") return String(want) === String(got) ? "meets" : "not";
  const nums = (v: SpecValue) => foldDigits(String(v)).match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const a = nums(want), b = nums(got);
  if (a.length && b.length) return a.join("x") === b.join("x") ? "meets" : "not";
  // Free words such as colours cannot be judged by code unless they match exactly.
  return String(want).trim() === String(got).trim() ? "meets" : "unknown";
}

/** Describes the catalogue to Llama. Keys and options come from the same data code validates against. */
export function catalogForPrompt(category: CategoryId | null = null): string {
  const ids = category ? [category] : CATEGORY_IDS;
  return ids.map((id) => {
    const c = CATEGORIES[id];
    const specs = c.specs.map((s) => `${s.key} (${s.label}${s.options ? `؛ القيم: ${Object.keys(s.options).join("|")}` : s.kind === "number" ? "؛ رقم" : "؛ نص"})`).join("، ");
    return `- ${id} = ${c.label}. الحقول المشتركة المناسبة: ${c.native.join("، ") || "لا يوجد"}. specs: ${specs || "لا يوجد"}.`;
  }).join("\n");
}
