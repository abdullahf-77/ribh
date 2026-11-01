import { foldDigits } from "./evidence";
import type { Decision, Evaluation, Priority } from "./decision";

const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const sar = (halalas: number) => `${fmt.format(halalas / 100)} ريال`;
export const qty = (n: number) => n.toLocaleString("en-US");

/** Arabic counted nouns: 3 to 10 take the plural form. */
export const counted = (n: number, singular: string, plural: string) => `${qty(n)} ${n >= 3 && n <= 10 ? plural : singular}`;
export const ozLabel = (n: number) => counted(n, "أونصة", "أونصات");
export const daysLabel = (n: number) => counted(n, "يومًا", "أيام");

export const priorityLabels: Record<Priority, string> = {
  cash: "أقل مبلغ تدفعه الآن",
  unit: "أقل تكلفة للوحدة",
  earliest: "أقرب تسليم مؤكد",
};

export function reasonText(code: string, e: Evaluation): string {
  if (code.startsWith("spec:")) {
    const c = e.checks.find((x) => x.id === code.slice(5));
    if (!c) return "مواصفة غير محددة";
    return c.status === "not"
      ? `${c.label}: المطلوب ${c.required}، والعرض ${c.offered ?? "غير واضح"}`
      : `${c.label}: لم يذكره العرض`;
  }
  if (code.startsWith("ambiguity:")) return "في العرض نقطة ملتبسة تحتاج توضيحًا";
  switch (code) {
    case "lot_short": return `الكمية المعروضة (${qty(e.cost.purchaseQty ?? 0)}) أقل من المطلوب، ولا يمكن افتراض تكرارها بالسعر نفسه`;
    case "stock_short": return "الكمية المتوفرة المذكورة أقل مما تحتاج شراءه";
    case "deadline": return e.delivery.arrival ? `التسليم المتوقع ${e.delivery.arrival} بعد موعدك` : "لا يوجد موعد تسليم مؤكد";
    case "budget": return `يتجاوز ميزانيتك بمقدار ${sar(e.budget.overByHalalas ?? 0)}`;
    case "budget_basis": return "حدد هل تشمل ميزانيتك التوصيل والضريبة، فالنتيجة تتغير بحسب ذلك";
    case "cost": return "التكلفة النهائية غير مكتملة";
    default: return code;
  }
}

export const missingLabels: Record<string, string> = {
  price: "السعر",
  price_basis: "أساس السعر (للحبة أو للكرتون أو للكمية كاملة)",
  package_size: "عدد الوحدات في العبوة",
  lot_quantity: "الكمية المشمولة في السعر",
  moq_unit: "وحدة الحد الأدنى للطلب",
  partial_package: "هل يمكن الشراء بأقل من عبوة كاملة",
  delivery: "رسوم التوصيل",
  delivery_conditional: "شروط التوصيل",
  delivery_vat: "ضريبة رسوم التوصيل",
  vat: "هل السعر شامل الضريبة",
  vat_rate: "نسبة الضريبة",
  lids_cost: "سعر الأغطية",
  print_cost: "سعر الطباعة",
  tier_mechanism: "طريقة تطبيق خصم الكمية",
  tier_condition: "شرط خصم الكمية",
};

export function missingText(code: string): string {
  const [head, rest] = code.split(":");
  if (head === "charge_amount") return `مبلغ «${rest}»`;
  if (head === "charge_vat") return `ضريبة «${rest}»`;
  if (head === "charge_unclear") return `هل تنطبق «${rest}» على طلبك`;
  return missingLabels[code] ?? code;
}

function winnerSentence(e: Evaluation, d: Decision): string {
  const metric =
    d.priority === "cash" ? `بإجمالي ${sar(e.cost.totalHalalas!)}`
    : d.priority === "unit" ? `بتكلفة ${e.cost.comparableUnitSar} ريال للوحدة شاملة الرسوم`
    : e.delivery.arrival ? `بتسليم متوقع في ${e.delivery.arrival}` : `بإجمالي ${sar(e.cost.totalHalalas!)}`;
  return `يتقدم ${e.label} حسب أولويتك (${priorityLabels[d.priority]}) ${metric}.`;
}

/** Plain reasons for one offer, from computed checks only. */
export function whyOffer(e: Evaluation): string {
  const status = { confirmed: "مؤكد مناسب", clarify: "يحتاج توضيحًا", fail: "لا يستوفي شروطك" }[e.category];
  const parts = [`${e.label}: ${status}${e.rank ? `، وترتيبه ${e.rank}` : ""}.`];
  if (e.cost.totalHalalas != null) parts.push(`إجماليه ${sar(e.cost.totalHalalas)}.`);
  const reasons = [...e.failReasons, ...e.blockers.filter((b) => b !== "cost")].map((r) => reasonText(r, e));
  if (reasons.length) parts.push(`السبب: ${reasons.join("؛ ")}.`);
  if (e.cost.missing.length) parts.push(`ينقص: ${e.cost.missing.map(missingText).join("، ")}.`);
  return parts.join(" ");
}

export function deterministicSummary(d: Decision): string {
  const byId = (id: string) => d.evaluations.find((e) => e.offerId === id)!;
  const v = d.verdict;
  switch (v.kind) {
    case "recommend": {
      const e = byId(v.winnerId);
      const parts = [winnerSentence(e, d)];
      const runner = d.evaluations.find((x) => x.rank === 2);
      if (runner?.cost.totalHalalas != null && e.cost.totalHalalas != null) {
        parts.push(`الفرق عن ${runner.label} في المبلغ المدفوع: ${sar(Math.abs(runner.cost.totalHalalas - e.cost.totalHalalas))}.`);
      }
      if (e.availability === "unknown") parts.push("تأكد من توفر الكمية قبل الشراء، فالعرض لم يذكرها.");
      return parts.join(" ");
    }
    case "recommend_open": {
      const e = byId(v.winnerId);
      const names = v.openIds.map((id) => byId(id).label).join(" و");
      return `${winnerSentence(e, d)} لكنه الأفضل بين العروض المؤكدة فقط؛ قد تتغير النتيجة بعد توضيح ما ينقص في ${names}، فلا يمكن الجزم بأنه الأرخص.`;
    }
    case "tie":
      return `${v.ids.map((id) => byId(id).label).join(" و")} متساويان في الأولوية والمبلغ المدفوع. الاختيار بينهما يعود إلى شروط أخرى كطريقة الدفع.`;
    case "clarify":
      return `لا يوجد عرض مؤكد بعد. وضّح ما ينقص في ${v.openIds.map((id) => byId(id).label).join(" و")} لتحصل على قرار.`;
    case "none_eligible":
      return "لا يوجد عرض يستوفي شروطك الإلزامية بصيغتها الحالية. راجع أسباب الاستبعاد أو عدّل شروطك.";
    case "not_comparable":
      return "العروض المؤكدة تختلف في المواصفات، لذا لا تصح مقارنة أسعارها مباشرة. حدد المقاس أو المادة المطلوبة أولًا.";
  }
}

/** Numbers the model is allowed to mention: only computed or user-given values. */
export function allowedNumbers(d: Decision): Set<string> {
  const out = new Set<string>();
  const add = (n: string | number | null | undefined) => {
    if (n == null) return;
    const s = String(n);
    const v = Number(s);
    if (Number.isFinite(v)) {
      out.add(String(v));
      out.add(v.toFixed(2));
    }
  };
  for (const e of d.evaluations) {
    const c = e.cost;
    [c.requested, c.purchaseQty, c.packages, c.excess, c.unitsPerPackage, c.comparableUnitSar, c.goodsUnitSar, c.costPerRequiredSar].forEach(add);
    [c.totalHalalas, c.goodsHalalas, c.deliveryHalalas, c.vatHalalas, c.knownSubtotalHalalas, c.chargesHalalas, e.budget.overByHalalas].forEach((h) => h != null && add(h / 100));
    for (const k of e.checks) (`${k.required} ${k.offered ?? ""}`.match(/\d+(?:\.\d+)?/g) ?? []).forEach(add);
    (e.delivery.arrival?.split("-") ?? []).forEach((p) => add(Number(p)));
  }
  const totals = d.evaluations.map((e) => e.cost.totalHalalas).filter((t): t is number => t != null);
  for (const a of totals) for (const b of totals) add(Math.abs(a - b) / 100);
  return out;
}

export function numbersIn(text: string): string[] {
  return (foldDigits(text).replace(/(\d),(?=\d{3})/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
}

const FORBIDDEN = /(ثقة\s*\d|نسبة الثقة|جودة أعلى|أعلى جودة|أكثر موثوقية|موثوق|سعر السوق|confidence|better quality)/i;

export function validateSummary(text: string, d: Decision, extraAllowed?: Set<string>): boolean {
  if (!text.trim() || text.length > 900) return false;
  if (FORBIDDEN.test(text)) return false;
  const allowed = allowedNumbers(d);
  if (numbersIn(text).some((n) => !allowed.has(n) && !extraAllowed?.has(n))) return false;
  const v = d.verdict;
  const labels = d.evaluations.map((e) => e.label);
  if (v.kind === "recommend" || v.kind === "recommend_open") {
    const winner = d.evaluations.find((e) => e.offerId === v.winnerId)!.label;
    if (!text.includes(winner)) return false;
    // The model may not crown a different offer as the choice.
    for (const l of labels) if (l !== winner && new RegExp(`(نوصي|ننصح|الأفضل|الخيار الأفضل)[^.]{0,20}${l}`).test(text)) return false;
  } else if (/(نوصي ب|ننصح ب|الخيار الأفضل هو)/.test(text)) return false;
  return true;
}

export function decisionFingerprint(d: Decision): string {
  return JSON.stringify([d.priority, d.verdict, d.evaluations.map((e) => [e.offerId, e.category, e.cost.totalHalalas, e.cost.purchaseQty, e.delivery.status, e.budget.status])]);
}

/** Facts about a before/after pair. Each sentence states a verified change; price only if it really moved. */
export function explainDecisionChange(before: Decision, after: Decision, offerId?: string): string[] {
  const out: string[] = [];
  for (const a of after.evaluations) {
    if (offerId && a.offerId !== offerId) continue;
    const b = before.evaluations.find((x) => x.offerId === a.offerId);
    if (!b) continue;
    for (const c of a.checks) {
      const old = b.checks.find((x) => x.id === c.id);
      if (!old || old.status === c.status) continue;
      if (c.status === "meets") out.push(`أصبح ${a.label} مستوفيًا لشرط «${c.label}» (${c.offered ?? ""}).`);
      else if (c.status === "not") out.push(`تبيّن أن ${a.label} لا يستوفي شرط «${c.label}».`);
      else out.push(`أصبح شرط «${c.label}» غير مؤكد في ${a.label}.`);
    }
    const bt = b.cost.totalHalalas;
    const at = a.cost.totalHalalas;
    if (bt != null && at != null && bt !== at) out.push(`تغيّر إجمالي ${a.label} من ${sar(bt)} إلى ${sar(at)}.`);
    else if (bt == null && at != null) out.push(`اكتملت تكلفة ${a.label}: الإجمالي ${sar(at)}.`);
    else if (bt != null && at == null) out.push(`لم يعد إجمالي ${a.label} محددًا بعد هذا التعديل.`);
    if (b.delivery.status !== a.delivery.status) {
      if (a.delivery.status === "meets") out.push(`أصبح تسليم ${a.label} مؤكدًا قبل موعدك.`);
      if (a.delivery.status === "not") out.push(`تسليم ${a.label} لا يلحق بموعدك.`);
    }
    const categories = { confirmed: "العروض المؤكدة", clarify: "العروض التي تحتاج توضيحًا", fail: "العروض غير المستوفية" };
    if (b.category !== a.category) out.push(`انتقل ${a.label} إلى ${categories[a.category]}.`);
  }
  const winner = (d: Decision) => (d.verdict.kind === "recommend" || d.verdict.kind === "recommend_open" ? d.verdict.winnerId : null);
  const wb = winner(before);
  const wa = winner(after);
  const name = (d: Decision, id: string) => d.evaluations.find((e) => e.offerId === id)!.label;
  if (wb !== wa) {
    if (wa && wb) out.push(`تغيّرت التوصية من ${name(before, wb)} إلى ${name(after, wa)}.`);
    else if (wa) out.push(`أصبحت هناك توصية: ${name(after, wa)}.`);
    else if (wb) out.push(`لم تعد هناك توصية مؤكدة بعد أن كانت ${name(before, wb)}.`);
  } else out.push(wa ? `لم تتغير التوصية: ${name(after, wa)}.` : "لا توجد توصية مؤكدة حتى الآن.");
  return out;
}
