import Big from "big.js";
import { budgetFit, BudgetFit, computeCost, CostResult } from "./cost";
import type { Requirements, ResolvedOffer } from "./schemas";

export type CheckStatus = "meets" | "not" | "unknown";
export type Check = {
  id: string;
  label: string;
  status: CheckStatus;
  mandatory: boolean;
  required: string;
  offered: string | null;
  /** Offer field holding the evidence for this check. */
  field: string;
};

export type Priority = "cash" | "unit" | "earliest";
export type Category = "confirmed" | "clarify" | "fail";

export type DeliveryFit = {
  status: "meets" | "not" | "unknown" | "not_required";
  arrival: string | null;
};

export type Evaluation = {
  offerId: string;
  label: string;
  checks: Check[];
  cost: CostResult;
  budget: BudgetFit;
  delivery: DeliveryFit;
  availability: "confirmed" | "insufficient" | "unknown";
  category: Category;
  /** Why it cannot be unconditionally recommended. Plain codes translated by the UI. */
  blockers: string[];
  failReasons: string[];
  rank: number | null;
};

export type Verdict =
  | { kind: "recommend"; winnerId: string }
  | { kind: "recommend_open"; winnerId: string; openIds: string[] }
  | { kind: "tie"; ids: string[] }
  | { kind: "clarify"; openIds: string[] }
  | { kind: "none_eligible" }
  | { kind: "not_comparable"; ids: string[] };

export type Decision = { evaluations: Evaluation[]; verdict: Verdict; priority: Priority };

const sizeLabel = (n: number) => (n >= 3 && n <= 10 ? `${n} أونصات` : `${n} أونصة`);
export const useLabels = { hot: "مشروبات ساخنة", cold: "مشروبات باردة", both: "ساخنة وباردة" } as const;
export const materialLabels = { paper: "ورق", plastic: "بلاستيك", foam: "فوم", biodegradable: "قابل للتحلل", other: "مادة أخرى" } as const;
export const wallLabels = { single: "جدار واحد", double: "جدار مزدوج", ripple: "جدار مموّج" } as const;
const inclusionLabels = { included: "مشمول في السعر", extra: "برسوم إضافية", not_available: "غير متوفر" } as const;

const cityAliases: Record<string, string> = {
  الرياض: "riyadh", riyadh: "riyadh", جدة: "jeddah", جده: "jeddah", jeddah: "jeddah", jedda: "jeddah",
  "مكة": "makkah", "مكة المكرمة": "makkah", مكه: "makkah", makkah: "makkah", mecca: "makkah",
  "المدينة": "madinah", "المدينة المنورة": "madinah", madinah: "madinah", medina: "madinah",
  الدمام: "dammam", dammam: "dammam", الخبر: "khobar", khobar: "khobar", "al khobar": "khobar",
  الطائف: "taif", taif: "taif", تبوك: "tabuk", tabuk: "tabuk", ابها: "abha", أبها: "abha", abha: "abha",
  بريدة: "buraydah", buraydah: "buraydah", "*": "*", "جميع المناطق": "*", "كل المناطق": "*", "جميع مدن المملكة": "*", "كل المملكة": "*", "جميع أنحاء المملكة": "*", nationwide: "*",
};
export const normalizeCity = (c: string) => {
  const key = c.trim().toLowerCase();
  return cityAliases[key] ?? key;
};

export function compatibilityChecks(o: ResolvedOffer, req: Requirements): Check[] {
  const checks: Check[] = [];
  const add = (id: string, label: string, field: string, required: string, offered: string | null, status: CheckStatus, mandatory = true) =>
    checks.push({ id, label, field, required, offered, status, mandatory });
  const eq = <T,>(want: T, got: T | null): CheckStatus => (got == null ? "unknown" : want === got ? "meets" : "not");

  if (req.sizeOz != null) add("size", "المقاس", "cupSizeOz", sizeLabel(req.sizeOz), o.cupSizeOz == null ? null : sizeLabel(o.cupSizeOz), eq(req.sizeOz, o.cupSizeOz));
  if (req.use) {
    const status: CheckStatus = o.use == null ? "unknown" : o.use === "both" || req.use === o.use ? "meets" : "not";
    add("use", "الاستخدام", "use", useLabels[req.use], o.use && useLabels[o.use], status);
  }
  if (req.material) add("material", "المادة", "material", materialLabels[req.material], o.material && materialLabels[o.material], eq(req.material, o.material));
  if (req.wall) add("wall", "نوع الجدار", "wall", wallLabels[req.wall], o.wall && wallLabels[o.wall], eq(req.wall, o.wall));
  if (req.lid === "required") {
    const status: CheckStatus = o.lids == null ? "unknown" : o.lids === "not_available" ? "not" : "meets";
    add("lid", "الأغطية", "lids", "مطلوبة", o.lids && inclusionLabels[o.lids], status);
  }
  if (req.print === "required") {
    const status: CheckStatus = o.printing == null ? "unknown" : o.printing === "not_available" ? "not" : "meets";
    add("print", "الطباعة المخصصة", "printing", "مطلوبة", o.printing && inclusionLabels[o.printing], status);
  }
  if (req.city) {
    const want = normalizeCity(req.city);
    const cities = o.deliveryCities;
    const status: CheckStatus = !cities?.length ? "unknown" : cities.map(normalizeCity).some((c) => c === want || c === "*") ? "meets" : "not";
    add("city", "مدينة التوصيل", "deliveryCities", req.city, cities?.join("، ") ?? null, status);
  }
  for (const r of req.other) {
    const s = o.otherRequirements[r.id];
    add(`other:${r.id}`, r.text, `other:${r.id}`, r.level === "mandatory" ? "إلزامي" : "مفضّل", s === "meets" ? "مذكور في العرض" : s === "not" ? "لا يطابق العرض" : null, s ?? "unknown", r.level === "mandatory");
  }
  return checks;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);

export function addLeadTime(from: string, days: number, business: boolean | null): string {
  const d = parse(from);
  if (!business) {
    d.setUTCDate(d.getUTCDate() + days);
    return iso(d);
  }
  // Saudi work week: Friday and Saturday are off.
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 5 && day !== 6) left--;
  }
  return iso(d);
}

export function deliveryFit(o: ResolvedOffer, requiredDate: string | null, orderDate: string): DeliveryFit {
  const arrival = o.deliveryDate ?? (o.leadTimeDays != null ? addLeadTime(orderDate, o.leadTimeDays, o.leadTimeBusinessDays) : null);
  if (!requiredDate) return { status: "not_required", arrival };
  if (!arrival) return { status: "unknown", arrival: null };
  return { status: arrival <= requiredDate ? "meets" : "not", arrival };
}

export function evaluateOffer(o: ResolvedOffer, req: Requirements, orderDate: string): Evaluation {
  const checks = compatibilityChecks(o, req);
  const quantity = req.quantity ?? 0;
  const cost = computeCost(o, quantity, req);
  const budget = budgetFit(cost, req);
  const delivery = deliveryFit(o, req.requiredDate, orderDate);

  const availability: Evaluation["availability"] =
    o.priceBasis === "quoted_lot" ? (cost.lotShort ? "insufficient" : "confirmed")
    : o.availableQuantity == null || cost.purchaseQty == null ? "unknown"
    : o.availableQuantity >= cost.purchaseQty ? "confirmed" : "insufficient";

  const failReasons: string[] = [];
  const blockers: string[] = [];
  for (const c of checks.filter((c) => c.mandatory)) {
    if (c.status === "not") failReasons.push(`spec:${c.id}`);
    if (c.status === "unknown") blockers.push(`spec:${c.id}`);
  }
  if (cost.lotShort) failReasons.push("lot_short");
  if (availability === "insufficient" && !cost.lotShort) failReasons.push("stock_short");
  if (delivery.status === "not") failReasons.push("deadline");
  if (delivery.status === "unknown") blockers.push("deadline");
  if (budget.status === "over") failReasons.push("budget");
  if (budget.status === "unknown" && budget.reason === "basis_unknown") blockers.push("budget_basis");
  if (!cost.complete) blockers.push("cost");
  for (const a of o.openAmbiguities) {
    if (a.kind !== "other") blockers.push(`ambiguity:${a.kind}`);
  }

  return {
    offerId: o.id,
    label: o.label,
    checks,
    cost,
    budget,
    delivery,
    availability,
    category: failReasons.length ? "fail" : blockers.length ? "clarify" : "confirmed",
    blockers,
    failReasons,
    rank: null,
  };
}

function metric(e: Evaluation, priority: Priority): Big | string | null {
  if (priority === "cash") return e.cost.totalHalalas == null ? null : new Big(e.cost.totalHalalas);
  if (priority === "unit") return e.cost.comparableUnitSar == null ? null : new Big(e.cost.comparableUnitSar);
  return e.delivery.arrival;
}

function compare(a: Evaluation, b: Evaluation, priority: Priority): number {
  const ma = metric(a, priority);
  const mb = metric(b, priority);
  if (ma == null && mb == null) return 0;
  if (ma == null) return 1;
  if (mb == null) return -1;
  if (ma instanceof Big && mb instanceof Big) return ma.cmp(mb);
  return String(ma) < String(mb) ? -1 : String(ma) > String(mb) ? 1 : 0;
}

/** Two offers only compete when no known specification sets them apart. */
export function specsComparable(offers: ResolvedOffer[]): boolean {
  const differs = (pick: (o: ResolvedOffer) => unknown) => {
    const known = offers.map(pick).filter((v) => v != null);
    return new Set(known).size > 1;
  };
  return !differs((o) => o.cupSizeOz) && !differs((o) => o.material) && !differs((o) => o.wall);
}

export function decide(offers: ResolvedOffer[], req: Requirements, orderDate: string, priority: Priority): Decision {
  const evaluations = offers.map((o) => evaluateOffer(o, req, orderDate));
  const confirmed = evaluations.filter((e) => e.category === "confirmed");
  const open = evaluations.filter((e) => e.category === "clarify");

  if (!confirmed.length) {
    return {
      evaluations,
      priority,
      verdict: open.length ? { kind: "clarify", openIds: open.map((e) => e.offerId) } : { kind: "none_eligible" },
    };
  }

  const confirmedOffers = offers.filter((o) => confirmed.some((e) => e.offerId === o.id));
  if (confirmed.length > 1 && !specsComparable(confirmedOffers)) {
    return { evaluations, priority, verdict: { kind: "not_comparable", ids: confirmed.map((e) => e.offerId) } };
  }

  const ordered = [...confirmed].sort((a, b) => compare(a, b, priority) || compare(a, b, "cash"));
  ordered.forEach((e, i) => (e.rank = i + 1));

  if (ordered.length > 1 && compare(ordered[0], ordered[1], priority) === 0 && compare(ordered[0], ordered[1], "cash") === 0) {
    return { evaluations, priority, verdict: { kind: "tie", ids: [ordered[0].offerId, ordered[1].offerId] } };
  }

  const winnerId = ordered[0].offerId;
  return {
    evaluations,
    priority,
    verdict: open.length ? { kind: "recommend_open", winnerId, openIds: open.map((e) => e.offerId) } : { kind: "recommend", winnerId },
  };
}
