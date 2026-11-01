import { materialLabels, useLabels, wallLabels } from "@/domain/decision";
import { CATEGORIES, CategoryId, NATIVE_TO_OFFER, specDef, specLabelValue, SpecValue } from "@/domain/categories";
import type { Charge, Tier } from "@/domain/schemas";

export type FieldType = "number" | "text" | "date" | "bool" | "levels" | "cities" | { options: Record<string, string> };
export type FieldSpec = { key: string; label: string; type: FieldType; group: string };

const inclusion = { included: "مشمول في السعر", extra: "برسوم إضافية", not_available: "غير متوفر" };
const vat = { included: "شامل الضريبة", excluded: "غير شامل الضريبة" };

export const FIELD_GROUPS = ["المنتج", "السعر والعبوة", "التوصيل", "الضريبة", "شروط أخرى"];

export const FIELDS: FieldSpec[] = [
  { key: "supplierName", label: "اسم المورد", type: "text", group: "المنتج" },
  { key: "productCategory", label: "فئة المنتج", type: { options: Object.fromEntries(Object.values(CATEGORIES).map((c) => [c.id, c.label])) }, group: "المنتج" },
  { key: "productDescription", label: "وصف المنتج", type: "text", group: "المنتج" },
  { key: "cupSizeOz", label: "المقاس (أونصة)", type: "number", group: "المنتج" },
  { key: "use", label: "الاستخدام", type: { options: useLabels }, group: "المنتج" },
  { key: "material", label: "المادة", type: { options: materialLabels }, group: "المنتج" },
  { key: "wall", label: "نوع الجدار", type: { options: wallLabels }, group: "المنتج" },
  { key: "lids", label: "الغطاء", type: { options: inclusion }, group: "المنتج" },
  { key: "printing", label: "الطباعة المخصصة", type: { options: inclusion }, group: "المنتج" },
  { key: "priceAmount", label: "السعر (ريال)", type: "number", group: "السعر والعبوة" },
  { key: "priceBasis", label: "أساس السعر", type: { options: { per_item: "للحبة", per_package: "للعبوة أو الكرتون", quoted_lot: "إجمالي لكمية محددة" } }, group: "السعر والعبوة" },
  { key: "packageLevels", label: "تركيب العبوة", type: "levels", group: "السعر والعبوة" },
  { key: "soldByPackageOnly", label: "البيع بالعبوة الكاملة فقط", type: "bool", group: "السعر والعبوة" },
  { key: "quotedQuantity", label: "الكمية المذكورة في السعر", type: "number", group: "السعر والعبوة" },
  { key: "moq", label: "الحد الأدنى للطلب", type: "number", group: "السعر والعبوة" },
  { key: "moqUnit", label: "وحدة الحد الأدنى", type: { options: { item: "وحدة", package: "عبوة" } }, group: "السعر والعبوة" },
  { key: "availableQuantity", label: "الكمية المتوفرة", type: "number", group: "السعر والعبوة" },
  { key: "tierMechanism", label: "تطبيق خصم الكمية", type: { options: { all_units: "على كامل الكمية", incremental: "على الزيادة فقط" } }, group: "السعر والعبوة" },
  { key: "deliveryKind", label: "نوع التوصيل", type: { options: { amount: "بمبلغ محدد", free: "مجاني", conditional: "حسب شرط" } }, group: "التوصيل" },
  { key: "deliveryAmount", label: "رسوم التوصيل (ريال)", type: "number", group: "التوصيل" },
  { key: "deliveryFreeAbove", label: "مجاني فوق (ريال)", type: "number", group: "التوصيل" },
  { key: "deliveryCondition", label: "شرط التوصيل", type: "text", group: "التوصيل" },
  { key: "deliveryCities", label: "مدن التوصيل", type: "cities", group: "التوصيل" },
  { key: "leadTimeDays", label: "مدة التسليم (أيام)", type: "number", group: "التوصيل" },
  { key: "leadTimeBusinessDays", label: "المدة بأيام عمل", type: "bool", group: "التوصيل" },
  { key: "deliveryDate", label: "تاريخ تسليم صريح", type: "date", group: "التوصيل" },
  { key: "vatStatus", label: "ضريبة السعر", type: { options: vat }, group: "الضريبة" },
  { key: "vatRatePercent", label: "نسبة الضريبة %", type: "number", group: "الضريبة" },
  { key: "deliveryVat", label: "ضريبة رسوم التوصيل", type: { options: vat }, group: "الضريبة" },
  { key: "paymentTerms", label: "شروط الدفع", type: "text", group: "شروط أخرى" },
  { key: "validity", label: "صلاحية العرض", type: "text", group: "شروط أخرى" },
];

/** The review form for one offer: shared fields, this category's fields, and nothing from other products. */
export function fieldsFor(category: CategoryId | null): FieldSpec[] {
  if (!category) return FIELDS;
  const c = CATEGORIES[category];
  const excluded = new Set(Object.values(NATIVE_TO_OFFER).filter((f) => !c.native.some((n) => NATIVE_TO_OFFER[n] === f)));
  const own: FieldSpec[] = c.specs.map((s) => ({ key: `spec:${s.key}`, label: s.label, group: "المنتج", type: s.kind === "number" ? "number" : s.kind === "enum" ? { options: s.options! } : "text" }));
  const base = FIELDS.filter((f) => !excluded.has(f.key));
  const firstPrice = base.findIndex((f) => f.group !== "المنتج");
  return [...base.slice(0, firstPrice), ...own, ...base.slice(firstPrice)];
}

export function fieldLabel(key: string, otherLabels?: Record<string, string>): string {
  if (key.startsWith("spec:")) return specDef(key.slice(5))?.label ?? key;
  if (key === "charges") return "الرسوم الإضافية";
  if (key === "tiers") return "شرائح خصم الكمية";
  if (key.startsWith("other:")) return otherLabels?.[key.slice(6)] ?? "شرط إضافي";
  return FIELDS.find((f) => f.key === key)?.label ?? key;
}

export function displayValue(key: string, value: unknown): string {
  if (value == null) return "غير معروف";
  if (key.startsWith("spec:")) { const d = specDef(key.slice(5)); return d ? specLabelValue(d, value as SpecValue) : String(value); }
  if (key === "charges") return (value as Charge[]).map((c) => `${c.label}: ${c.amount == null ? "مبلغ غير معروف" : `${c.amount} ريال`}`).join("، ");
  if (key === "tiers") return (value as Tier[]).map((t) => `من ${t.minQty} ${t.qtyUnit === "package" ? "عبوة" : "وحدة"}: ${t.price} ريال`).join("، ");
  if (key === "packageLevels") return (value as { label: string; count: number }[]).map((l) => `${l.label} = ${l.count}`).join(" × ");
  if (key === "deliveryCities") return (value as string[]).map((c) => (c === "*" ? "كل المملكة" : c)).join("، ");
  if (key.startsWith("other:")) return value === "meets" ? "يستوفي" : "لا يستوفي";
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  const spec = FIELDS.find((f) => f.key === key);
  if (spec && typeof spec.type === "object") return spec.type.options[String(value)] ?? String(value);
  return String(value);
}
