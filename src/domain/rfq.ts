import { materialLabels, useLabels, wallLabels } from "./decision";
import { numbersIn, qty } from "./explain";
import type { Requirements } from "./schemas";

export type RfqGap = { field: keyof Requirements; question: string; blocking: boolean };

export function rfqGaps(req: Requirements): RfqGap[] {
  const gaps: RfqGap[] = [];
  if (!req.product) gaps.push({ field: "product", question: "ما المنتج المطلوب؟", blocking: true });
  if (!req.quantity) gaps.push({ field: "quantity", question: "كم الكمية المطلوبة؟", blocking: true });
  if (!req.sizeOz) gaps.push({ field: "sizeOz", question: "ما مقاس الكوب بالأونصة؟", blocking: true });
  if (!req.use) gaps.push({ field: "use", question: "هل الأكواب للمشروبات الساخنة أم الباردة؟", blocking: false });
  if (!req.lid) gaps.push({ field: "lid", question: "هل تحتاج الأغطية ضمن الطلب؟", blocking: false });
  if (!req.print) gaps.push({ field: "print", question: "هل تحتاج طباعة مخصصة؟", blocking: false });
  if (!req.city) gaps.push({ field: "city", question: "إلى أي مدينة يكون التوصيل؟", blocking: false });
  if (!req.requiredDate) gaps.push({ field: "requiredDate", question: "متى تحتاج استلام الطلب؟", blocking: false });
  return gaps;
}

export type RfqFacts = {
  product: string;
  quantity: number;
  sizeOz: number;
  use: string | null;
  material: string | null;
  wall: string | null;
  lid: "مطلوبة" | "غير مطلوبة" | null;
  print: "مطلوبة" | "غير مطلوبة" | null;
  city: string | null;
  requiredDate: string | null;
  mandatoryOther: string[];
  preferredOther: string[];
  /** Absent unless the buyer explicitly opted in. */
  budgetSar: number | null;
};

export const RFQ_REQUESTS = [
  { key: "packaging", text: "عدد الأكواب في كل عبوة أو كرتون", pattern: /عبو|كرتون|تغليف/ },
  { key: "moq", text: "الحد الأدنى للطلب", pattern: /الحد الأدنى|الحد الادنى/ },
  { key: "vat", text: "هل السعر شامل ضريبة القيمة المضافة", pattern: /ضريبة/ },
  { key: "shipping", text: "رسوم التوصيل وموعد التسليم", pattern: /توصيل|شحن/ },
  { key: "charges", text: "أي رسوم إضافية", pattern: /رسوم/ },
  { key: "payment", text: "شروط الدفع", pattern: /الدفع/ },
  { key: "validity", text: "مدة صلاحية العرض", pattern: /صلاحية/ },
] as const;

/** The only data that reaches the drafting model. Budget stays out unless includeBudget is true. */
export function rfqFacts(req: Requirements, includeBudget: boolean): RfqFacts {
  if (!req.product || !req.quantity || !req.sizeOz) throw new Error("incomplete requirements");
  const yes = (v: "required" | "not_required" | null) => (v === "required" ? "مطلوبة" : v === "not_required" ? "غير مطلوبة" : null);
  return {
    product: req.product,
    quantity: req.quantity,
    sizeOz: req.sizeOz,
    use: req.use && useLabels[req.use],
    material: req.material && materialLabels[req.material],
    wall: req.wall && wallLabels[req.wall],
    lid: yes(req.lid),
    print: yes(req.print),
    city: req.city,
    requiredDate: req.requiredDate,
    mandatoryOther: req.other.filter((o) => o.level === "mandatory").map((o) => o.text),
    preferredOther: req.other.filter((o) => o.level === "preferred").map((o) => o.text),
    budgetSar: includeBudget ? req.budgetSar : null,
  };
}

export function deterministicRfq(f: RfqFacts): string {
  const lines = [
    "السلام عليكم،",
    `أرغب في الحصول على عرض سعر للطلب التالي:`,
    `- المنتج: ${f.product}`,
    `- الكمية المطلوبة: ${qty(f.quantity)} كوب`,
    `- المقاس: ${f.sizeOz >= 3 && f.sizeOz <= 10 ? `${f.sizeOz} أونصات` : `${f.sizeOz} أونصة`}`,
  ];
  if (f.use) lines.push(`- الاستخدام: ${f.use}`);
  if (f.material) lines.push(`- المادة: ${f.material}`);
  if (f.wall) lines.push(`- نوع الجدار: ${f.wall}`);
  if (f.lid) lines.push(`- الأغطية: ${f.lid}`);
  if (f.print) lines.push(`- الطباعة المخصصة: ${f.print}`);
  if (f.city) lines.push(`- مدينة التوصيل: ${f.city}`);
  if (f.requiredDate) lines.push(`- موعد الاستلام المطلوب: قبل ${f.requiredDate}`);
  f.mandatoryOther.forEach((o) => lines.push(`- شرط أساسي: ${o}`));
  f.preferredOther.forEach((o) => lines.push(`- مفضّل: ${o}`));
  if (f.budgetSar != null) lines.push(`- الميزانية: ${qty(f.budgetSar)} ريال`);
  lines.push("", "نرجو أن يوضح عرضكم ما يلي:");
  RFQ_REQUESTS.forEach((r) => lines.push(`- ${r.text}`));
  lines.push("", "وشكرًا لكم.");
  return lines.join("\n");
}

export type RfqIssue = "missing_quantity" | "missing_size" | "invented_number" | "leaked_budget" | "missing_request" | "too_long" | "missing_lid" | "missing_print" | "missing_city";

/** A drafted message must preserve every confirmed fact and add no numbers of its own. */
export function validateRfqDraft(text: string, f: RfqFacts, fullBudget: number | null): RfqIssue[] {
  const issues: RfqIssue[] = [];
  if (text.length > 1800) issues.push("too_long");
  const nums = numbersIn(text);
  const allowed = new Set<string>([String(f.quantity), String(f.sizeOz)]);
  if (f.requiredDate) {
    f.requiredDate.split("-").forEach((p) => allowed.add(String(Number(p))));
  }
  if (f.budgetSar != null) allowed.add(String(f.budgetSar));
  [...f.mandatoryOther, ...f.preferredOther, f.product].forEach((t) => numbersIn(t).forEach((n) => allowed.add(n)));
  // List numbering like "1." is harmless.
  const listMarkers = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"]);

  if (!nums.includes(String(f.quantity))) issues.push("missing_quantity");
  if (!nums.includes(String(f.sizeOz))) issues.push("missing_size");
  if (nums.some((n) => !allowed.has(n) && !listMarkers.has(n))) issues.push("invented_number");
  if (f.budgetSar == null && fullBudget != null && nums.includes(String(fullBudget))) issues.push("leaked_budget");
  if (f.budgetSar == null && /ميزاني|budget/i.test(text)) issues.push("leaked_budget");
  for (const r of RFQ_REQUESTS) if (!r.pattern.test(text)) { issues.push("missing_request"); break; }
  if (f.lid === "مطلوبة" && !/غطاء|أغطية|اغطية|غطا/.test(text)) issues.push("missing_lid");
  if (f.lid == null && /أغطية|غطاء/.test(text)) issues.push("missing_lid");
  if (f.print === "مطلوبة" && !/طباع/.test(text)) issues.push("missing_print");
  if (f.print == null && /طباع/.test(text)) issues.push("missing_print");
  if (f.city && !text.includes(f.city)) issues.push("missing_city");
  return issues;
}
