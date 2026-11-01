"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Scenario } from "@/demo/scenarios";
import type { CostResult } from "@/domain/cost";
import { Check, Decision, Evaluation, Priority } from "@/domain/decision";
import { counted, decisionFingerprint, deterministicSummary, missingText, priorityLabels, qty, reasonText, sar } from "@/domain/explain";
import { activeVersion, OfferState, resolveOffer } from "@/domain/offer-state";
import { deterministicMessage, offerQuestions } from "@/domain/questions";
import type { Requirements } from "@/domain/schemas";
import { post, formatDate } from "@/lib/api";
import { DiscountSection } from "./DiscountSection";
import { ReplySection } from "./ReplySection";
import { Button, Card, Chip, Note, NumberField, StatusChip, TextField } from "./ui";

const categoryCopy = {
  confirmed: { label: "مؤكد مناسب", tone: "meets" as const },
  clarify: { label: "يحتاج توضيحًا", tone: "unknown" as const },
  fail: { label: "لا يستوفي شروطك", tone: "not" as const },
};

function CostBar({ cost }: { cost: CostResult }) {
  const segments = [
    { key: "goods", label: "الأكواب", value: cost.goodsHalalas, color: "var(--c-accent)" },
    { key: "delivery", label: "التوصيل", value: cost.deliveryHalalas, color: "#6d90bd" },
    { key: "charges", label: "رسوم أخرى", value: cost.chargesHalalas || null, color: "#a9bfdb" },
    { key: "vat", label: "ضريبة مضافة", value: cost.vatHalalas || null, color: "#54606c" },
  ].filter((s) => s.value);
  const total = segments.reduce((a, s) => a + (s.value ?? 0), 0);
  return (
    <div aria-hidden className="flex h-3 w-full overflow-hidden rounded-s bg-sunken">
      {segments.map((s) => <span key={s.key} title={s.label} style={{ width: `${((s.value ?? 0) / Math.max(total, 1)) * (cost.complete ? 100 : 78)}%`, background: s.color }} />)}
      {!cost.complete && <span className="hatch flex-1" title="مبالغ غير معروفة" />}
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
    <dt className="text-muted">{label}</dt>
    <dd className="text-end font-medium">{children}</dd>
  </div>
);
const Unknown = ({ children = "غير معروف" }: { children?: React.ReactNode }) => <Chip tone="unknown">{children}</Chip>;

function vatText(c: CostResult) {
  if (c.vatTreatment === "included") return "السعر شامل الضريبة";
  if (c.vatTreatment === "excluded") return c.vatHalalas != null ? `تضاف ${sar(c.vatHalalas)}` : null;
  return null;
}

function CheckRow({ check, offer }: { check: Check; offer: OfferState }) {
  const v = activeVersion(offer, check.field);
  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span dir="auto">{check.label}{!check.mandatory && <span className="text-xs text-muted"> (مفضّل)</span>}</span>
        <StatusChip status={check.status} />
      </div>
      <p className="text-xs text-muted">
        المطلوب: <bdi>{check.required}</bdi>{check.offered ? <> · العرض: <bdi>{check.offered}</bdi></> : null}
      </p>
      {v?.evidence && <p className="text-xs text-muted" dir="auto">{v.source === "reply" ? "من رد المورد" : "من العرض"}: «{v.evidence.quote}»</p>}
      {v?.source === "user" && <p className="text-xs text-muted">عدّلته أنت</p>}
    </li>
  );
}

function OfferCard({ e, offer, isWinner }: { e: Evaluation; offer: OfferState; isWinner: boolean }) {
  const c = e.cost;
  const cat = categoryCopy[e.category];
  return (
    <Card className={isWinner ? "ring-2 ring-accent" : ""}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold" dir="auto">{e.label}</h4>
        <div className="flex flex-wrap gap-1">
          {e.rank != null && <Chip tone="accent">الترتيب {e.rank}</Chip>}
          <Chip tone={cat.tone}>{cat.label}</Chip>
        </div>
      </div>

      <div className="mt-3">
        <p className="text-xs text-muted">{c.complete ? "ما ستدفعه" : "مبلغ معروف جزئيًا"}</p>
        {c.totalHalalas != null
          ? <p className="text-2xl font-bold">{sar(c.totalHalalas)}</p>
          : c.knownSubtotalHalalas != null
            ? <p className="text-2xl font-bold">{sar(c.knownSubtotalHalalas)} <span className="text-sm font-medium text-unknown">+ غير معروف</span></p>
            : <p className="text-xl font-bold text-unknown">لا يمكن الحساب بعد</p>}
        <div className="mt-2"><CostBar cost={c} /></div>
      </div>

      {(e.failReasons.length > 0 || e.blockers.length > 0) && (
        <ul className="mt-3 space-y-1 text-sm">
          {e.failReasons.map((r) => <li key={r} className="text-not">{reasonText(r, e)}</li>)}
          {e.blockers.filter((b) => b !== "cost").map((r, i) => <li key={`${r}${i}`} className="text-unknown">{reasonText(r, e)}</li>)}
        </ul>
      )}
      {c.missing.length > 0 && (
        <div className="mt-2 text-sm">
          <p className="font-medium text-unknown">ينقص لحساب الإجمالي:</p>
          <p className="text-unknown">{c.missing.map(missingText).join("، ")}</p>
        </div>
      )}

      <dl className="mt-3 divide-y divide-line border-t border-line">
        <Row label="كمية الشراء">{c.purchaseQty != null ? `${qty(c.purchaseQty)} كوب${c.packages != null ? ` (${counted(c.packages, "عبوة", "عبوات")})` : ""}` : <Unknown />}</Row>
        <Row label="الفائض عن حاجتك">{c.excess != null ? `${qty(c.excess)} كوب` : <Unknown />}</Row>
        <Row label="سعر الكوب في العرض">{c.goodsUnitSar ? `${c.goodsUnitSar} ريال` : <Unknown />}</Row>
        <Row label="تكلفة الكوب شاملة كل الرسوم">{c.comparableUnitSar ? `${c.comparableUnitSar} ريال` : <Unknown />}</Row>
        <Row label="التوصيل">{c.deliveryHalalas != null ? (c.deliveryHalalas === 0 ? "مجاني" : sar(c.deliveryHalalas)) : <Unknown />}</Row>
        <Row label="الضريبة">{vatText(c) ?? <Unknown />}</Row>
        <Row label="الميزانية">
          {e.budget.status === "not_set" ? "غير محددة"
            : e.budget.status === "within" ? <Chip tone="meets">ضمن الميزانية</Chip>
            : e.budget.status === "over" ? <Chip tone="not">تتجاوز بـ {sar(e.budget.overByHalalas!)}</Chip>
            : <Unknown />}
        </Row>
        <Row label="التسليم">
          {e.delivery.status === "not_required" ? (e.delivery.arrival ? formatDate(e.delivery.arrival) : "لا يوجد موعد مطلوب")
            : e.delivery.status === "meets" ? <Chip tone="meets">{formatDate(e.delivery.arrival)}</Chip>
            : e.delivery.status === "not" ? <Chip tone="not">{formatDate(e.delivery.arrival)} (متأخر)</Chip>
            : <Unknown>غير مؤكد</Unknown>}
        </Row>
        <Row label="توفر الكمية">{e.availability === "confirmed" ? <Chip tone="meets">مذكور</Chip> : e.availability === "insufficient" ? <Chip tone="not">غير كافٍ</Chip> : <Unknown>غير مؤكد</Unknown>}</Row>
      </dl>

      {e.checks.length > 0 && (
        <details className="mt-3 border-t border-line pt-2" open={e.category !== "confirmed"}>
          <summary className="min-h-9 cursor-pointer py-1 text-sm font-medium">مطابقة شروطك ودليلها</summary>
          <ul className="divide-y divide-line">{e.checks.map((k) => <CheckRow key={k.id} check={k} offer={offer} />)}</ul>
        </details>
      )}
    </Card>
  );
}

const verdictTone = { recommend: "ok", recommend_open: "ok", tie: "info", clarify: "warn", none_eligible: "error", not_comparable: "warn" } as const;
const verdictTitle: Record<Decision["verdict"]["kind"], string> = {
  recommend: "التوصية",
  recommend_open: "توصية مشروطة",
  tie: "تعادل",
  clarify: "لا توصية بعد: يلزم توضيح",
  none_eligible: "لا يوجد عرض مستوفٍ",
  not_comparable: "لا تصح المقارنة المباشرة",
};

type Narrative = { fingerprint: string; summary: string; summarySource: "llama" | "template"; messages: { offerId: string; message: string; source: "llama" | "template" }[] };

export function CompareStep(p: {
  mode: "live" | "demo" | null; decision: Decision; requirements: Requirements; onRequirements: (r: Requirements) => void; offers: OfferState[]; onOffers: (o: OfferState[]) => void;
  priority: Priority; onPriority: (x: Priority) => void; orderDate: string; onOrderDate: (d: string) => void; scenario: Scenario | null; tick: () => number;
  changeNote: { offerLabel: string; lines: string[] } | null; onChangeNote: (n: { offerLabel: string; lines: string[] } | null) => void;
  onEditRequirements: () => void; onEditOffers: () => void; onStartOver: () => void; needsReanalysis: boolean; reanalyzing: boolean; onReanalyze: () => void; problems: { message: string }[];
}) {
  const { decision: d, requirements: r, offers, mode } = p;
  const [narrative, setNarrative] = useState<Narrative | null>(null);
  const [drafting, setDrafting] = useState(false);
  const fingerprint = decisionFingerprint(d);

  const resolved = useMemo(() => offers.map(resolveOffer), [offers]);
  const questions = useMemo(() => d.evaluations.map((e) => {
    const o = resolved.find((x) => x.id === e.offerId)!;
    return { offerId: e.offerId, label: e.label, items: offerQuestions(o, e, r) };
  }), [d, resolved, r]);

  const compose = useCallback(async () => {
    setDrafting(true);
    try {
      const out = await post<Omit<Narrative, "fingerprint">>("/api/compose", { decision: d, questions: questions.filter((q) => q.items.length) });
      setNarrative({ ...out, fingerprint });
    } catch { /* The deterministic text is already on screen. */ } finally { setDrafting(false); }
  }, [d, questions, fingerprint]);

  // One automatic drafting call per comparison. Later numeric edits use the computed text until asked.
  useEffect(() => {
    if (mode === "live" && !narrative && !drafting) compose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const fresh = narrative?.fingerprint === fingerprint;
  const summary = fresh && narrative ? narrative.summary : deterministicSummary(d);
  const v = d.verdict;
  const winnerId = v.kind === "recommend" || v.kind === "recommend_open" ? v.winnerId : null;

  const groups = (["confirmed", "clarify", "fail"] as const).map((cat) => ({
    cat, items: d.evaluations.filter((e) => e.category === cat).sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9)),
  })).filter((g) => g.items.length);

  const set = <K extends keyof Requirements>(k: K, val: Requirements[K]) => p.onRequirements({ ...r, [k]: val });

  return (
    <div className="space-y-5">
      <Note tone={verdictTone[v.kind]} title={verdictTitle[v.kind]}>
        <p className="mt-1 text-base" dir="auto">{summary}</p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {fresh && narrative?.summarySource === "llama" ? <Chip tone="accent">صاغها Llama وتحققنا من أرقامها</Chip> : <Chip>نص محسوب من بياناتك</Chip>}
          {mode === "live" && !fresh && (
            <Button variant="ghost" busy={drafting} onClick={compose}>أعد الصياغة عبر Llama</Button>
          )}
        </p>
      </Note>

      {p.changeNote && (
        <Note tone="info" title={`ما الذي تغيّر بعد رد ${p.changeNote.offerLabel}`} actions={<Button variant="ghost" onClick={() => p.onChangeNote(null)}>إخفاء</Button>}>
          <ul className="mt-1 list-inside list-disc">{p.changeNote.lines.map((l) => <li key={l} dir="auto">{l}</li>)}</ul>
        </Note>
      )}

      <Card>
        <h3 className="font-semibold">جرّب تغيير القرار</h3>
        <p className="mb-3 text-sm text-muted">يعاد الحساب فورًا من بياناتك المؤكدة.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField label="الكمية المطلوبة" integer value={r.quantity} onChange={(val) => val && set("quantity", val)} />
          <NumberField label="الميزانية (ريال)" value={r.budgetSar} onChange={(val) => set("budgetSar", val)} />
          <TextField label="موعد الاستلام" type="date" value={r.requiredDate} onChange={(val) => set("requiredDate", val)} />
          <TextField label="تاريخ الطلب" type="date" hint="تُحسب منه مدد التسليم" value={p.orderDate} onChange={(val) => val && p.onOrderDate(val)} />
        </div>
        <fieldset className="mt-4">
          <legend className="mb-1 text-sm font-medium">ما أولويتك؟</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(priorityLabels) as Priority[]).map((k) => (
              <label key={k} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-s border px-3 text-sm ${p.priority === k ? "border-accent bg-accent-soft font-medium text-accent" : "border-line"}`}>
                <input type="radio" name="priority" className="size-4" checked={p.priority === k} onChange={() => p.onPriority(k)} />
                {priorityLabels[k]}
              </label>
            ))}
          </div>
        </fieldset>
        {p.needsReanalysis && (
          <div className="mt-4">
            <Note tone="warn" title="شروطك الأخرى تغيرت، وهذا يحتاج إعادة قراءة العروض" actions={<Button busy={p.reanalyzing} onClick={p.onReanalyze}>أعد قراءة العروض</Button>}>
              الأرقام لا تتأثر، لكن مطابقة الشروط الجديدة تبقى «غير معروف» إلى أن تتم القراءة. تعديلاتك السابقة تبقى كما هي.
            </Note>
          </div>
        )}
        {p.problems.length > 0 && <div className="mt-3"><Note tone="error">{p.problems[0].message}</Note></div>}
      </Card>

      {groups.map((g) => (
        <section key={g.cat}>
          <h3 className="mb-2 font-semibold">{g.cat === "confirmed" ? "عروض مؤكدة مناسبة" : g.cat === "clarify" ? "عروض قد تناسبك بعد التوضيح" : "عروض لا تستوفي شروطك"}</h3>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {g.items.map((e) => <OfferCard key={e.offerId} e={e} offer={offers.find((o) => o.id === e.offerId)!} isWinner={e.offerId === winnerId} />)}
          </div>
        </section>
      ))}

      <DiscountSection offers={offers} requirements={r} />

      <section>
        <h3 className="mb-2 text-lg font-semibold">وضّح ما ينقص وأضف رد المورد</h3>
        <div className="space-y-4">
          {d.evaluations.map((e) => {
            const q = questions.find((x) => x.offerId === e.offerId)!;
            const drafted = fresh ? narrative?.messages.find((m) => m.offerId === e.offerId) : undefined;
            const message = drafted?.message ?? deterministicMessage(e.label, q.items);
            return (
              <ReplySection key={e.offerId} offer={offers.find((o) => o.id === e.offerId)!} evaluation={e} questions={q.items} message={message} messageSource={drafted?.source ?? "template"}
                requirements={r} decide={p.decision} scenario={p.scenario} offers={offers} onOffers={p.onOffers} onChange={p.onChangeNote} orderDate={p.orderDate} priority={p.priority} tick={p.tick} />
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button onClick={p.onEditOffers}>راجع بيانات العروض</Button>
        <Button onClick={p.onEditRequirements}>عدّل المتطلبات</Button>
        <Button variant="ghost" onClick={p.onStartOver}>ابدأ مقارنة جديدة</Button>
      </div>
      <p className="text-xs text-muted">لا يرسل التطبيق رسائل ولا ينفذ طلبات شراء. لا يحفظ بياناتك بعد إغلاق الصفحة.</p>
    </div>
  );
}
