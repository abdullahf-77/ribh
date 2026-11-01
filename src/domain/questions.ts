import { specDef } from "./categories";
import { qty } from "./explain";
import type { Evaluation } from "./decision";
import type { Requirements, ResolvedOffer } from "./schemas";

export type ClarifyQuestion = { code: string; text: string; decisive: boolean };

/** Questions come only from what is actually unresolved for this offer and this request. */
export function offerQuestions(o: ResolvedOffer, e: Evaluation, req: Requirements): ClarifyQuestion[] {
  const out: ClarifyQuestion[] = [];
  const add = (code: string, text: string, decisive = true) => out.push({ code, text, decisive });

  for (const c of e.checks) {
    if (c.status !== "unknown") continue;
    if (c.id === "lid") add(c.id, "هل يشمل السعر الأغطية؟ وإن لم يشملها، فكم سعرها؟", c.mandatory);
    else if (c.id === "print") add(c.id, "هل تشمل التسعيرة الطباعة المخصصة؟ وإن لم تشملها، فكم تكلفتها؟", c.mandatory);
    else if (c.id === "size") add(c.id, `هل المقاس المعروض ${req.sizeOz} أونصة؟`, c.mandatory);
    else if (c.id === "use") add(c.id, "هل المنتج مناسب للمشروبات الساخنة أم الباردة؟", c.mandatory);
    else if (c.id === "material") add(c.id, "ما مادة المنتج المعروض؟", c.mandatory);
    else if (c.id === "wall") add(c.id, "هل المنتج بجدار واحد أم مزدوج؟", c.mandatory);
    else if (c.id === "city") add(c.id, `هل توصلون إلى ${req.city}؟`, c.mandatory);
    else if (c.id.startsWith("spec:")) add(c.id, specDef(c.id.slice(5))?.question.replace("تريد", "توفرون").replace("تحتاج", "توفرون") ?? `ما قيمة ${c.label}؟`, c.mandatory);
    else add(c.id, `هل يتوفر الشرط التالي: ${c.label}؟`, c.mandatory);
  }

  for (const m of e.cost.missing) {
    const [head, rest] = m.split(":");
    if (m === "price") add(m, "كم السعر، وهل هو للحبة أم للكرتون؟");
    else if (m === "price_basis") add(m, "هل السعر المذكور للحبة أم للكرتون أم للكمية كاملة؟");
    else if (m === "package_size") add(m, "كم عدد الوحدات في الكرتون أو العبوة؟");
    else if (m === "lot_quantity") add(m, "كم عدد الوحدات المشمولة في السعر المذكور؟");
    else if (m === "moq_unit") add(m, "هل الحد الأدنى للطلب بالحبة أم بالكرتون؟");
    else if (m === "partial_package") add(m, "هل يمكن الشراء بأقل من كرتون كامل؟");
    else if (m === "delivery") add(m, `كم رسوم التوصيل${req.city ? ` إلى ${req.city}` : ""}؟`);
    else if (m === "delivery_conditional") add(m, `ما شروط التوصيل المجاني، وكم الرسوم لطلب ${req.quantity ? qty(req.quantity) : "بهذه الكمية"} وحدة؟`);
    else if (m === "delivery_vat") add(m, "هل رسوم التوصيل شاملة ضريبة القيمة المضافة؟");
    else if (m === "vat") add(m, "هل السعر شامل ضريبة القيمة المضافة؟");
    else if (m === "vat_rate") add(m, "كم نسبة الضريبة التي ستضاف على الفاتورة؟");
    else if (m === "lids_cost") add(m, "كم سعر الأغطية لهذه الكمية؟");
    else if (m === "print_cost") add(m, "كم تكلفة الطباعة المخصصة لهذه الكمية؟");
    else if (m === "tier_mechanism") add(m, "هل سعر الخصم يطبَّق على كل الكمية أم فقط على الوحدات الزائدة عن حد الشريحة؟");
    else if (m === "tier_condition") add(m, "ما الشروط اللازمة لتطبيق سعر الخصم بالضبط؟");
    else if (head === "charge_amount") add(m, `كم مبلغ «${rest}»؟`);
    else if (head === "charge_vat") add(m, `هل «${rest}» شاملة الضريبة؟`);
    else if (head === "charge_unclear") add(m, `هل تنطبق «${rest}» على طلبي؟`);
  }

  if (e.delivery.status === "unknown") {
    add("deadline", `هل يمكنكم تأكيد التسليم قبل ${req.requiredDate}؟`);
  }
  if (e.availability === "unknown" && req.quantity) {
    add("availability", `هل الكمية ${qty(e.cost.purchaseQty ?? req.quantity)} وحدة متوفرة بالسعر نفسه؟`, false);
  }
  if (e.cost.lotShort && req.quantity) {
    add("lot_short", `أحتاج ${qty(req.quantity)} وحدة، هل يمكنكم توفيرها، وبأي سعر؟`);
  }
  if (o.quotedQuantity != null && o.priceBasis !== "quoted_lot" && req.quantity && o.quotedQuantity < req.quantity) {
    add("scale", `السعر مذكور لكمية ${qty(o.quotedQuantity)}؛ هل ينطبق على ${qty(req.quantity)} وحدة؟`, false);
  }
  for (const a of o.openAmbiguities) {
    if (a.kind === "contradiction" || a.kind === "pricing" || a.kind === "packaging") {
      add(`ambiguity:${a.text}`, `نرجو توضيح النقطة التالية: ${a.text}`);
    }
  }
  return out.filter((q, i) => out.findIndex((x) => x.code === q.code) === i);
}

export function deterministicMessage(label: string, questions: ClarifyQuestion[]): string {
  if (!questions.length) return "";
  return [
    `السلام عليكم ${label}،`,
    "بخصوص عرض السعر الذي وصلني، أحتاج توضيح النقاط التالية قبل اتخاذ قرار الشراء:",
    ...questions.map((q, i) => `${i + 1}. ${q.text}`),
    "وشكرًا لكم.",
  ].join("\n");
}
