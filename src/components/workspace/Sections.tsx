"use client";

import { useState } from "react";
import { activeQuantity, confirmedOffers, missingFields, questionFor } from "@/chat/state";
import type { ConversationState } from "@/chat/types";
import { CATEGORIES, CATEGORY_IDS, CategoryId, specDef, specLabelValue } from "@/domain/categories";
import { Decision, evaluateOffer, Evaluation, materialLabels, Priority, useLabels, wallLabels } from "@/domain/decision";
import { missingText, priorityLabels, qty, reasonText, sar } from "@/domain/explain";
import { activeVersion, changeHistory, fieldValue, OfferState, resolveOffer } from "@/domain/offer-state";
import { deterministicMessage, offerQuestions } from "@/domain/questions";
import { ConflictChoice, ReplyProposal, unresolvedConflicts } from "@/domain/replies";
import { rfqGaps } from "@/domain/rfq";
import type { Requirements } from "@/domain/schemas";
import { formatDate } from "@/lib/api";
import { displayValue, fieldLabel, fieldsFor } from "@/lib/fields";
import { EvidenceLink, OfferResult, categoryCopy, Unknown, vatText } from "../chat/OfferResult";
import { DiscountSection } from "../DiscountSection";
import { OfferReview } from "../OfferReview";
import { boolOptions, Button, Card, Chip, CopyButton, fromBool, Note, NumberField, SelectField, TextField, toBool } from "../ui";

const req3 = { required: "مطلوب", not_required: "غير مطلوب" };
const SOURCE = { offer: "العرض الأصلي", reply: "رد المورد", user: "تعديلك" };
const categoryOptions = Object.fromEntries(CATEGORY_IDS.map((c) => [c, CATEGORIES[c].label]));

export const SECTIONS = [
  { id: "requirements", label: "المتطلبات" },
  { id: "offers", label: "العروض" },
  { id: "comparison", label: "المقارنة" },
  { id: "scenarios", label: "السيناريوهات والخصم" },
  { id: "clarify", label: "توضيح الموردين" },
  { id: "rfq", label: "طلب عرض السعر" },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];

export function Section({ id, title, hint, actions, children }: { id: SectionId; title: string; hint?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={`section-${id}`} aria-labelledby={`title-${id}`} className="scroll-mt-14 rounded-m border border-line bg-surface p-4 shadow-1 transition sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`title-${id}`} className="text-lg font-semibold">{title}</h2>
          {hint && <p className="text-sm text-muted">{hint}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

const reqFieldLabels: Record<string, string> = {
  category: "فئة المنتج", product: "المنتج", quantity: "الكمية", sizeOz: "مقاس الكوب", material: "المادة", wall: "نوع الجدار", use: "الاستخدام", lid: "الغطاء", print: "الطباعة",
  city: "المدينة", requiredDate: "موعد الاستلام", budgetSar: "الميزانية", budgetIncludesDelivery: "الميزانية تشمل التوصيل", budgetIncludesVat: "الميزانية تشمل الضريبة",
};
export const reqLabel = (f: string) => (f.startsWith("spec:") ? specDef(f.slice(5))?.label ?? f : reqFieldLabels[f] ?? f);

export function reqValue(field: string, value: unknown): string {
  if (value == null) return "غير محدد";
  if (field.startsWith("spec:")) { const d = specDef(field.slice(5)); return d ? specLabelValue(d, value as string | number) : String(value); }
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (field === "category") return CATEGORIES[value as CategoryId]?.label ?? String(value);
  if (field === "use") return useLabels[value as "hot"] ?? String(value);
  if (field === "material") return materialLabels[value as "paper"] ?? String(value);
  if (field === "wall") return wallLabels[value as "single"] ?? String(value);
  if (field === "lid" || field === "print") return req3[value as "required"] ?? String(value);
  if (field === "requiredDate") return formatDate(String(value));
  if (typeof value === "number") return qty(value);
  return String(value);
}

export type ConflictItem = { id: string; field: string; current: unknown; proposed: unknown; quote: string | null };

export function RequirementsSection({ state, conflicts, pendingSwitch, onRequirements, onEditDone, onResolveConflict, onRequestSwitch, onConfirmSwitch, onCancelSwitch, askAssistant }: {
  state: ConversationState; conflicts: ConflictItem[]; pendingSwitch: { to: CategoryId } | null; onRequirements: (r: Requirements) => void; onEditDone: (before: Requirements) => void;
  onResolveConflict: (c: ConflictItem, adopt: boolean) => void; onRequestSwitch: (to: CategoryId) => void; onConfirmSwitch: () => void; onCancelSwitch: () => void; askAssistant: () => void;
}) {
  const r = state.requirements;
  const [before, setBefore] = useState<Requirements | null>(null);
  const editing = before != null;
  const set = <K extends keyof Requirements>(k: K, v: Requirements[K]) => onRequirements({ ...r, [k]: v });
  const setSpec = (key: string, v: string | number | null) => {
    const specs = { ...r.specs };
    if (v == null) delete specs[key]; else specs[key] = v;
    onRequirements({ ...r, specs });
  };
  const cat = r.category ? CATEGORIES[r.category] : null;
  const has = (n: string) => cat?.native.includes(n as "use");
  const shared = ["product", "quantity", "sizeOz", "use", "material", "wall", "lid", "print", "city", "requiredDate", "budgetSar", "budgetIncludesDelivery", "budgetIncludesVat"] as const;
  const known = shared.filter((k) => r[k] != null);
  const specKeys = Object.keys(r.specs);
  const missing = missingFields(state);
  const empty = !r.category && !known.length;

  return (
    <Section id="requirements" title="متطلبات الشراء" hint={cat ? `منتج واحد في كل مقارنة: ${cat.label}` : "تتحدّث من المحادثة ومن هنا."}
      actions={<Button variant="ghost" aria-expanded={editing} onClick={() => { if (editing) { onEditDone(before); setBefore(null); } else setBefore(r); }}>{editing ? "تم" : "عدّل"}</Button>}>
      {pendingSwitch && r.category && (
        <div className="mb-3">
          <Note tone="warn" title={`استبدال ${CATEGORIES[r.category].label} بـ ${CATEGORIES[pendingSwitch.to].label}؟`}
            actions={<><Button variant="primary" onClick={onConfirmSwitch}>نعم، ابدأ مقارنة جديدة</Button><Button onClick={onCancelSwitch}>أبقِ المقارنة الحالية</Button></>}>
            سأمسح المواصفات والكمية والميزانية والعروض الحالية، وأبقي مدينة التوصيل فقط.
          </Note>
        </div>
      )}
      {conflicts.map((c) => (
        <div key={c.id} className="mb-3">
          <Note tone="warn" title={`هذا يختلف عما سجلته: ${reqLabel(c.field)}`}
            actions={<><Button variant="primary" onClick={() => onResolveConflict(c, true)}>اعتمد الجديد</Button><Button onClick={() => onResolveConflict(c, false)}>أبقِ المسجّل</Button></>}>
            المسجّل: <bdi>{reqValue(c.field, c.current)}</bdi>. من رسالتك: <bdi>{reqValue(c.field, c.proposed)}</bdi>.
            {c.quote && <span className="block text-xs" dir="auto">«{c.quote}»</span>}
          </Note>
        </div>
      ))}
      {empty && !editing && (
        <div className="rounded-s bg-sunken p-4 text-sm">
          <p>لم تُحدَّد متطلبات بعد. اكتب ما تحتاجه للمساعد، أو املأها هنا مباشرة.</p>
          <div className="mt-2 flex flex-wrap gap-2"><Button onClick={askAssistant}>تحدث مع المساعد</Button><Button onClick={() => setBefore(r)}>املأها يدويًا</Button></div>
        </div>
      )}
      {!editing && !empty && (
        <dl className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
          {r.category && <ReqRow label="فئة المنتج" value={CATEGORIES[r.category].label} />}
          {known.map((k) => <ReqRow key={k} label={reqFieldLabels[k]} value={reqValue(k, r[k])} quote={state.reqEvidence[k]} />)}
          {specKeys.map((k) => <ReqRow key={k} label={reqLabel(`spec:${k}`)} value={reqValue(`spec:${k}`, r.specs[k])} quote={state.reqEvidence[`spec:${k}`]} />)}
          {r.other.map((o) => <ReqRow key={o.id} label={o.level === "mandatory" ? "شرط إلزامي" : "مفضّل"} value={o.text} />)}
        </dl>
      )}
      {editing && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <SelectField label="فئة المنتج" value={r.category} options={categoryOptions} onChange={(v) => {
            if (!v) return;
            if (r.category && v !== r.category) onRequestSwitch(v as CategoryId);
            else onRequirements({ ...r, category: v as CategoryId, product: r.product ?? CATEGORIES[v as CategoryId].label });
          }} />
          <TextField label="وصف المنتج" value={r.product} onChange={(v) => set("product", v)} />
          <NumberField label="الكمية" integer value={r.quantity} onChange={(v) => set("quantity", v)} />
          {has("sizeOz") && <NumberField label="مقاس الكوب (أونصة)" value={r.sizeOz} onChange={(v) => set("sizeOz", v)} />}
          {has("use") && <SelectField label="الاستخدام" value={r.use} options={useLabels} onChange={(v) => set("use", v as Requirements["use"])} />}
          {has("material") && <SelectField label="المادة" value={r.material} options={materialLabels} onChange={(v) => set("material", v as Requirements["material"])} />}
          {has("wall") && <SelectField label="نوع الجدار" value={r.wall} options={wallLabels} onChange={(v) => set("wall", v as Requirements["wall"])} />}
          {has("lid") && <SelectField label="الغطاء" value={r.lid} options={req3} onChange={(v) => set("lid", v as Requirements["lid"])} />}
          {has("print") && <SelectField label="الطباعة المخصصة" value={r.print} options={req3} onChange={(v) => set("print", v as Requirements["print"])} />}
          {cat?.specs.map((s) => {
            const value = r.specs[s.key] ?? null;
            if (s.kind === "number") return <NumberField key={s.key} label={s.label} value={value as number | null} onChange={(v) => setSpec(s.key, v)} />;
            if (s.kind === "enum") return <SelectField key={s.key} label={s.label} value={value as string | null} options={s.options!} onChange={(v) => setSpec(s.key, v)} />;
            return <TextField key={s.key} label={s.label} value={value as string | null} onChange={(v) => setSpec(s.key, v)} />;
          })}
          <TextField label="مدينة التوصيل" value={r.city} onChange={(v) => set("city", v)} />
          <TextField label="موعد الاستلام" type="date" value={r.requiredDate} onChange={(v) => set("requiredDate", v)} />
          <NumberField label="الميزانية (ريال)" value={r.budgetSar} onChange={(v) => set("budgetSar", v)} />
          <SelectField label="الميزانية تشمل التوصيل؟" value={fromBool(r.budgetIncludesDelivery)} options={boolOptions} onChange={(v) => set("budgetIncludesDelivery", toBool(v))} />
          <SelectField label="الميزانية تشمل الضريبة؟" value={fromBool(r.budgetIncludesVat)} options={boolOptions} onChange={(v) => set("budgetIncludesVat", toBool(v))} />
        </div>
      )}
      {!empty && missing.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1 text-xs">
          <span className="text-muted">لم يُحدَّد بعد:</span>
          {missing.map((f) => <span key={f} title={questionFor(f)}><Chip tone="unknown">{reqLabel(f)}</Chip></span>)}
        </div>
      )}
    </Section>
  );
}

const ReqRow = ({ label, value, quote }: { label: string; value: string; quote?: string }) => (
  <div className="flex justify-between gap-3 border-b border-line py-1.5 text-sm">
    <dt className="text-muted">{label}</dt>
    <dd className="text-end font-medium"><bdi>{value}</bdi>{quote && <span className="block text-xs font-normal text-muted" dir="auto">«{quote}»</span>}</dd>
  </div>
);

const grid = "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,19rem),1fr))]";

export function OfferCard({ offer, state, evaluation, onOffer, onConfirm, onWhy, onReply, onEditOpen, onEditDone, tick }: {
  offer: OfferState; state: ConversationState; evaluation: Evaluation; onOffer: (o: OfferState) => void; onConfirm: () => void; onWhy: () => void; onReply: () => void; onEditOpen: () => void; onEditDone: () => void; tick: () => number;
}) {
  const [editing, setEditing] = useState(false);
  const confirmed = state.confirmedOfferIds.includes(offer.id);
  const name = fieldValue<string>(offer, "supplierName") || offer.label;
  const product = fieldsFor(state.requirements.category).filter((f) => f.group === "المنتج" && !["supplierName", "productDescription", "productCategory"].includes(f.key));
  const rows = [...product.map((f) => [f.label, f.key] as const), ["السعر (ريال)", "priceAmount"], ["أساس السعر", "priceBasis"], ["العبوة", "packageLevels"], ["الحد الأدنى", "moq"], ["التوصيل", "deliveryKind"], ["رسوم التوصيل", "deliveryAmount"], ["الضريبة", "vatStatus"], ["مدة التسليم (أيام)", "leadTimeDays"], ["شرائح الخصم", "tiers"]] as const;
  const optional = new Set(["tiers", "moq", "deliveryAmount", "wall", "material", "spec:diameterMm", "spec:color", "spec:leakproof"]);
  const open = offer.ambiguities.filter((a) => !a.resolved).length;
  const category = fieldValue<CategoryId>(offer, "productCategory");
  const mismatch = category && state.requirements.category && category !== state.requirements.category;
  return (
    <Card className={`!p-4 ${editing ? "col-span-full" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold" dir="auto">{name}</h3>
        {confirmed ? <Chip tone="meets">أكدته</Chip> : <Chip tone="unknown">بانتظار تأكيدك</Chip>}
      </div>
      {mismatch && <div className="mt-2"><Note tone="error">هذا العرض عن {CATEGORIES[category].label}، وطلبك عن {CATEGORIES[state.requirements.category!].label}. لن يدخل في المقارنة.</Note></div>}
      <dl className="mt-2">
        {rows.map(([label, key]) => {
          const value = fieldValue(offer, key);
          if (value == null && optional.has(key)) return null;
          const evidence = activeVersion(offer, key)?.evidence;
          return (
            <div key={key} className="border-b border-line py-1 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">{label}</dt>
                <dd className="text-end font-medium">{value == null ? <Unknown /> : <bdi>{displayValue(key, value)}</bdi>}</dd>
              </div>
              {evidence && <EvidenceLink offer={offer} evidence={evidence} />}
            </div>
          );
        })}
      </dl>
      {evaluation.cost.missing.length > 0 && <p className="mt-2 text-sm text-unknown">ينقص لحساب الإجمالي: {evaluation.cost.missing.map(missingText).join("، ")}</p>}
      {open > 0 && <p className="mt-1 text-sm text-unknown">نقاط ملتبسة: {open}. افتح «عدّل» لمراجعتها.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {!confirmed && <Button variant="primary" onClick={onConfirm}>أكّد العرض</Button>}
        <Button aria-expanded={editing} onClick={() => { if (editing) onEditDone(); else onEditOpen(); setEditing(!editing); }}>{editing ? "تم" : "عدّل"}</Button>
        <Button variant="ghost" onClick={onWhy}>لماذا هذا العرض؟</Button>
        <Button variant="ghost" onClick={onReply}>أضف رد المورد</Button>
      </div>
      {editing && <div className="mt-3"><OfferReview offer={offer} onOffer={onOffer} requirements={state.requirements} rejected={state.rejected[offer.id] ?? []} tick={tick} /></div>}
    </Card>
  );
}

export type FailedOffer = { id: string; text: string; supplierHint: string | null; message: string };

export function OffersSection({ state, failed, busy, onOffer, onConfirm, onWhy, onReply, onEditOpen, onEditDone, onPaste, onRetry, onManual, tick }: {
  state: ConversationState; failed: FailedOffer[]; busy: boolean; onOffer: (o: OfferState) => void; onConfirm: (id: string) => void; onWhy: (id: string) => void; onReply: (id: string) => void;
  onEditOpen: () => void; onEditDone: (id: string) => void; onPaste: () => void; onRetry: (f: FailedOffer) => void; onManual: (f: FailedOffer) => void; tick: () => number;
}) {
  const q = activeQuantity(state);
  return (
    <Section id="offers" title="عروض الموردين" hint="من عرضين إلى ثلاثة لمنتج واحد. لا يدخل المقارنة إلا ما تؤكده."
      actions={state.offers.length < 3 ? <Button onClick={onPaste}>ألصق عرض مورد</Button> : undefined}>
      {!state.offers.length && !failed.length && <p className="rounded-s bg-sunken p-4 text-sm">لا توجد عروض بعد. ألصقها في المحادثة كما وصلتك من واتساب أو البريد.</p>}
      {failed.map((f) => (
        <div key={f.id} className="mb-3">
          <Note tone="error" title="تعذرت قراءة هذا العرض" actions={<><Button disabled={busy} onClick={() => onRetry(f)}>أعد المحاولة</Button><Button onClick={() => onManual(f)}>أدخله يدويًا</Button></>}>
            {f.message}<span className="mt-1 line-clamp-2 block text-xs" dir="auto">{f.text}</span>
          </Note>
        </div>
      ))}
      <div className={grid}>
        {state.offers.map((o) => (
          <OfferCard key={o.id} offer={o} state={state} evaluation={evaluateOffer(resolveOffer(o), { ...state.requirements, quantity: q ?? 0 }, state.orderDate)} onOffer={onOffer}
            onConfirm={() => onConfirm(o.id)} onWhy={() => onWhy(o.id)} onReply={() => onReply(o.id)} onEditOpen={onEditOpen} onEditDone={() => onEditDone(o.id)} tick={tick} />
        ))}
      </div>
    </Section>
  );
}

const verdictTitle: Record<Decision["verdict"]["kind"], string> = {
  recommend: "التوصية", recommend_open: "توصية مشروطة", tie: "تعادل", clarify: "لا توصية بعد: يلزم توضيح", none_eligible: "لا يوجد عرض مستوفٍ", not_comparable: "لا تصح المقارنة المباشرة",
};
const verdictTone = { recommend: "ok", recommend_open: "ok", tie: "info", clarify: "warn", none_eligible: "error", not_comparable: "warn" } as const;

export function RecommendationBanner({ state, decision, onGo }: { state: ConversationState; decision: Decision | null; onGo: (s: SectionId) => void }) {
  const pending = state.offers.length - confirmedOffers(state).length;
  if (!decision) {
    const msg = !state.requirements.quantity ? "حدد المنتج والكمية أولًا." : !state.offers.length ? "ألصق عرضين على الأقل لتظهر التوصية." : pending ? `أكّد ${pending === 1 ? "العرض المتبقي" : "العروض المتبقية"} لتظهر التوصية.` : "أضف عرضًا آخر لتتم المقارنة.";
    return <Note tone="info" title="لا توجد توصية بعد">{msg}</Note>;
  }
  const v = decision.verdict;
  const winnerId = v.kind === "recommend" || v.kind === "recommend_open" ? v.winnerId : null;
  const winner = decision.evaluations.find((e) => e.offerId === winnerId);
  const openOnes = decision.evaluations.filter((e) => e.category === "clarify");
  const scenario = state.scenarioQuantity != null;
  return (
    <Note tone={verdictTone[v.kind]} title={`${verdictTitle[v.kind]}${winner ? `: ${winner.label}` : ""}`}
      actions={<><Button variant="ghost" onClick={() => onGo("comparison")}>التفاصيل</Button>{openOnes.length > 0 && <Button variant="ghost" onClick={() => onGo("clarify")}>وضّح الناقص</Button>}</>}>
      {winner?.cost.totalHalalas != null && <p>تدفع {sar(winner.cost.totalHalalas)} لـ {qty(winner.cost.purchaseQty ?? 0)} وحدة. {scenario && `هذا سيناريو، وطلبك المعتمد ${qty(state.requirements.quantity ?? 0)}.`}</p>}
      {v.kind === "recommend_open" && <p>الأفضل بين المؤكدة فقط. قد تتغير النتيجة بعد توضيح {openOnes.map((e) => e.label).join(" و")}، فلا يمكن الجزم بأنه الأرخص.</p>}
      {v.kind === "none_eligible" && <p>{decision.evaluations.map((e) => `${e.label}: ${e.failReasons.map((r) => reasonText(r, e)).join("؛ ")}`).join(". ")}</p>}
      {v.kind === "clarify" && <p>ما زالت معلومات تنقص: {openOnes.map((e) => e.label).join(" و")}.</p>}
      {v.kind === "not_comparable" && <p>العروض المؤكدة تختلف في المواصفات. حدد المواصفة المطلوبة في المتطلبات.</p>}
    </Note>
  );
}

function ComparisonTable({ d, winnerId }: { d: Decision; winnerId: string | null }) {
  const metric = (label: string, cell: (e: Evaluation) => React.ReactNode) => (
    <tr className="border-t border-line">
      <th scope="row" className="py-1.5 pe-3 text-start text-xs font-medium text-muted">{label}</th>
      {d.evaluations.map((e) => <td key={e.offerId} className="px-2 py-1.5 text-sm">{cell(e)}</td>)}
    </tr>
  );
  const money = (h: number | null | undefined) => (h == null ? <Unknown /> : sar(h));
  return (
    <table className="w-full min-w-[34rem] table-fixed text-start">
      <caption className="sr-only">مقارنة العروض وتفصيل التكلفة</caption>
      <thead><tr>
        <th scope="col" className="w-36"><span className="sr-only">البند</span></th>
        {d.evaluations.map((e) => <th key={e.offerId} scope="col" className="px-2 pb-1 text-start text-sm"><bdi>{e.label}</bdi>{e.offerId === winnerId && <span className="ms-1 align-middle"><Chip tone="meets">الأول</Chip></span>}</th>)}
      </tr></thead>
      <tbody>
        {metric("الحالة", (e) => <Chip tone={categoryCopy[e.category].tone}>{categoryCopy[e.category].label}</Chip>)}
        {metric("قيمة المنتج", (e) => money(e.cost.goodsHalalas))}
        {metric("التوصيل", (e) => (e.cost.deliveryHalalas === 0 ? "مجاني" : money(e.cost.deliveryHalalas)))}
        {metric("رسوم أخرى", (e) => (e.cost.chargesHalalas ? sar(e.cost.chargesHalalas) : "لا توجد مذكورة"))}
        {metric("الضريبة", (e) => vatText(e.cost) ?? <Unknown />)}
        {metric("ما ستدفعه", (e) => (e.cost.totalHalalas != null ? <strong>{sar(e.cost.totalHalalas)}</strong> : e.cost.knownSubtotalHalalas != null ? <>{sar(e.cost.knownSubtotalHalalas)} <span className="text-xs text-unknown">+ غير معروف</span></> : <Unknown />))}
        {metric("كمية الشراء", (e) => (e.cost.purchaseQty != null ? qty(e.cost.purchaseQty) : <Unknown />))}
        {metric("الفائض", (e) => (e.cost.excess != null ? qty(e.cost.excess) : <Unknown />))}
        {metric("تكلفة الوحدة", (e) => (e.cost.comparableUnitSar ? `${e.cost.comparableUnitSar} ريال` : <Unknown />))}
        {metric("الميزانية", (e) => (e.budget.status === "not_set" ? "غير محددة" : e.budget.status === "within" ? <Chip tone="meets">ضمن</Chip> : e.budget.status === "over" ? <Chip tone="not">تتجاوز</Chip> : <Unknown />))}
        {metric("التسليم", (e) => (e.delivery.status === "unknown" ? <Unknown>غير مؤكد</Unknown> : e.delivery.arrival ? <Chip tone={e.delivery.status === "not" ? "not" : e.delivery.status === "meets" ? "meets" : "neutral"}>{formatDate(e.delivery.arrival)}</Chip> : "—"))}
      </tbody>
    </table>
  );
}

export function ComparisonSection({ state, decision, onReply }: { state: ConversationState; decision: Decision | null; onReply: (id: string) => void }) {
  const winnerId = decision && (decision.verdict.kind === "recommend" || decision.verdict.kind === "recommend_open") ? decision.verdict.winnerId : null;
  const reqAt = { ...state.requirements, quantity: activeQuantity(state) };
  return (
    <Section id="comparison" title="نتائج المقارنة وتفصيل التكلفة" hint="تحسبها قواعد التطبيق، وليست من النموذج.">
      {!decision && <p className="rounded-s bg-sunken p-4 text-sm">تظهر المقارنة بعد تأكيد عرضين وتحديد الكمية.</p>}
      {decision && (
        <>
          <div className="hidden overflow-x-auto md:block"><ComparisonTable d={decision} winnerId={winnerId} /></div>
          <div className={`${grid} md:hidden`}>
            {decision.evaluations.map((e) => <OfferResult key={e.offerId} e={e} offer={state.offers.find((o) => o.id === e.offerId)!} isWinner={e.offerId === winnerId} requirements={reqAt} onReply={onReply} />)}
          </div>
          <details className="mt-3 hidden md:block">
            <summary className="min-h-9 cursor-pointer py-1 text-sm font-medium">مطابقة شروطك وأدلتها لكل عرض</summary>
            <div className={`${grid} mt-2`}>
              {decision.evaluations.map((e) => <OfferResult key={e.offerId} e={e} offer={state.offers.find((o) => o.id === e.offerId)!} isWinner={e.offerId === winnerId} requirements={reqAt} onReply={onReply} />)}
            </div>
          </details>
        </>
      )}
    </Section>
  );
}

export function ScenarioSection({ state, onScenario, onAdopt, onRequirements, onPriority, onOrderDate }: {
  state: ConversationState; onScenario: (q: number | null) => void; onAdopt: () => void; onRequirements: (r: Requirements) => void; onPriority: (p: Priority) => void; onOrderDate: (d: string) => void;
}) {
  const r = state.requirements;
  const q = activeQuantity(state);
  const offers = confirmedOffers(state);
  const hasTiers = offers.some((o) => (fieldValue<unknown[]>(o, "tiers") ?? []).length);
  return (
    <Section id="scenarios" title="السيناريوهات وخصم الكمية" hint="يعاد الحساب فورًا دون طلب جديد من النموذج.">
      {state.scenarioQuantity != null && (
        <div className="mb-3">
          <Note tone="info" title={`تعرض الآن سيناريو ${qty(state.scenarioQuantity)} وحدة`} actions={<><Button variant="primary" onClick={onAdopt}>اعتمد هذه الكمية</Button><Button onClick={() => onScenario(null)}>عد إلى {qty(r.quantity ?? 0)}</Button></>}>
            طلبك المعتمد ما زال {qty(r.quantity ?? 0)} وحدة حتى تعتمد التغيير.
          </Note>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <NumberField label="جرّب كمية" integer value={q} onChange={(v) => { if (v) onScenario(v === r.quantity ? null : v); }} />
        <NumberField label="الميزانية (ريال)" value={r.budgetSar} onChange={(v) => onRequirements({ ...r, budgetSar: v })} />
        <TextField label="موعد الاستلام" type="date" value={r.requiredDate} onChange={(v) => onRequirements({ ...r, requiredDate: v })} />
        <TextField label="تاريخ الطلب" type="date" hint="تُحسب منه مدد التسليم" value={state.orderDate} onChange={(v) => v && onOrderDate(v)} />
      </div>
      <fieldset className="mt-3">
        <legend className="mb-1 text-sm font-medium">ما أولويتك؟</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(priorityLabels) as Priority[]).map((k) => (
            <label key={k} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-s border px-3 text-sm ${state.priority === k ? "border-accent bg-accent-soft font-medium text-accent-text" : "border-line"}`}>
              <input type="radio" name="priority" className="size-4" checked={state.priority === k} onChange={() => onPriority(k)} />
              {priorityLabels[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 border-t border-line pt-3">
        {hasTiers && q ? <DiscountSection offers={offers} requirements={{ ...r, quantity: q }} /> : <p className="text-sm text-muted">لا يوجد خصم كمية صريح في العروض المؤكدة، فلا نفترض خصمًا.</p>}
      </div>
    </Section>
  );
}

const KIND = {
  resolves_unknown: { label: "يحسم مجهولًا", tone: "meets" as const },
  conflict: { label: "يتعارض مع المسجّل", tone: "not" as const },
  confirms: { label: "يؤكد المسجّل", tone: "neutral" as const },
};

function ProposalCard({ proposal, otherLabels, onApply, onCancel }: {
  proposal: ReplyProposal; otherLabels: Record<string, string>; onApply: (choices: Record<string, ConflictChoice>, skipped: Set<string>) => void; onCancel: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const pending = unresolvedConflicts(proposal, choices);
  return (
    <div className="mt-3 rounded-s border border-accent/40 bg-accent-soft/40 p-3">
      <h4 className="font-semibold">راجع التغييرات قبل تطبيقها</h4>
      <p className="text-xs text-muted">نص لصقته أنت، ولا أتحقق أنه صادر عن المورد. لم يتغير شيء بعد، والرد الأحدث لا يُعتمد تلقائيًا عند التعارض.</p>
      {!proposal.changes.length && <p className="mt-2 text-sm">لا توجد معلومة واضحة في هذا الرد يمكن إضافتها.</p>}
      <ul className="mt-2 space-y-2">
        {proposal.changes.map((c) => (
          <li key={c.field} className={`rounded-s border bg-surface p-3 text-sm ${c.kind === "conflict" ? "border-not/50" : "border-line"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{fieldLabel(c.field, otherLabels)}</span>
              <Chip tone={KIND[c.kind].tone}>{KIND[c.kind].label}</Chip>
            </div>
            <dl className="mt-1 grid gap-x-4 sm:grid-cols-2">
              <div><dt className="text-xs text-muted">القيمة الحالية</dt><dd><bdi>{displayValue(c.field, c.previous)}</bdi></dd></div>
              <div><dt className="text-xs text-muted">المقترح من الرد</dt><dd><bdi>{displayValue(c.field, c.proposed)}</bdi></dd></div>
            </dl>
            <p className="mt-1 text-xs text-muted" dir="auto">الدليل من الرد: «{c.evidence.quote}»</p>
            {c.flag === "value_not_in_quote" && <p className="mt-1 text-xs text-unknown">الرقم غير ظاهر حرفيًا في الدليل. تأكد منه.</p>}
            {c.kind === "conflict" ? (
              <fieldset className="mt-2">
                <legend className="text-xs font-medium">أي قيمة تعتمد؟</legend>
                <div className="mt-1 flex flex-wrap gap-3">
                  {(["keep", "adopt"] as const).map((ch) => (
                    <label key={ch} className="flex min-h-9 items-center gap-1.5">
                      <input type="radio" name={`${proposal.replyId}-${c.field}`} className="size-4" checked={choices[c.field] === ch} onChange={() => setChoices({ ...choices, [c.field]: ch })} />
                      {ch === "keep" ? "أبقِ الحالية" : "اعتمد قيمة الرد"}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <label className="mt-2 flex min-h-9 items-center gap-1.5 text-xs">
                <input type="checkbox" className="size-4" checked={skipped.has(c.field)} onChange={(ev) => { const next = new Set(skipped); if (ev.target.checked) next.add(c.field); else next.delete(c.field); setSkipped(next); }} />
                لا تطبّق هذا التغيير
              </label>
            )}
          </li>
        ))}
      </ul>
      {proposal.rejected.length > 0 && <div className="mt-2"><Note tone="warn">لم أقبل قيمًا لا دليل عليها في نص الرد: {proposal.rejected.map((x) => fieldLabel(x.field, otherLabels)).join("، ")}. تبقى كما كانت.</Note></div>}
      {pending.length > 0 && <p className="mt-2 text-sm text-not">اختر قيمة لكل تعارض قبل التطبيق.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" disabled={pending.length > 0 || !proposal.changes.length} onClick={() => onApply(choices, skipped)}>طبّق وأعد الحساب</Button>
        <Button onClick={onCancel}>إلغاء</Button>
      </div>
    </div>
  );
}

function ClarifyOffer({ offer, state, proposal, busy, onSendReply, onApply, onCancel }: {
  offer: OfferState; state: ConversationState; proposal: ReplyProposal | null; busy: boolean; onSendReply: (text: string) => void; onApply: (c: Record<string, ConflictChoice>, s: Set<string>) => void; onCancel: () => void;
}) {
  const resolved = resolveOffer(offer);
  const q = activeQuantity(state) ?? 0;
  const evaluation = evaluateOffer(resolved, { ...state.requirements, quantity: q }, state.orderDate);
  const questions = offerQuestions(resolved, evaluation, { ...state.requirements, quantity: q });
  const name = fieldValue<string>(offer, "supplierName") || offer.label;
  const auto = deterministicMessage(name, questions);
  const [edited, setEdited] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [empty, setEmpty] = useState(false);
  const message = edited ?? auto;
  const history = changeHistory(offer).filter((h) => h.source !== "offer");
  const otherLabels = Object.fromEntries(state.requirements.other.map((o) => [o.id, o.text]));
  const decisive = questions.filter((x) => x.decisive).length;
  return (
    <Card className="!p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold" dir="auto">{name}</h3>
        {decisive > 0 ? <Chip tone="unknown">نقاط قد تغيّر القرار: {decisive}</Chip> : <Chip>لا ينقص ما يغيّر القرار</Chip>}
      </div>
      <div className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr))]">
        <div>
          <label htmlFor={`ask-${offer.id}`} className="mb-1 block text-sm font-medium">رسالة للمورد</label>
          {message ? (
            <>
              <textarea id={`ask-${offer.id}`} className="field min-h-44 text-sm" dir="auto" value={message} onChange={(e) => setEdited(e.target.value)} />
              <div className="mt-2 flex flex-wrap gap-2"><CopyButton text={message} label="انسخ الرسالة" />{edited != null && <Button variant="ghost" onClick={() => setEdited(null)}>أعد التوليد</Button>}</div>
            </>
          ) : <p className="rounded-s bg-sunken p-3 text-sm text-muted">لا توجد أسئلة مفتوحة لهذا العرض.</p>}
        </div>
        <div>
          <label htmlFor={`reply-${offer.id}`} className="mb-1 block text-sm font-medium">ألصق رد المورد</label>
          <textarea id={`reply-${offer.id}`} className="field min-h-32 text-sm" dir="auto" value={reply} aria-invalid={empty} onChange={(e) => { setReply(e.target.value); setEmpty(false); }} />
          {empty && <p role="alert" className="text-xs text-not">ألصق نص الرد أولًا.</p>}
          <p className="mt-1 text-xs text-muted">يُطبّق على هذا العرض فقط، وبعد مراجعتك.</p>
          <div className="mt-2"><Button busy={busy} onClick={() => { if (!reply.trim()) { setEmpty(true); return; } onSendReply(reply); setReply(""); }}>استخرج التغييرات</Button></div>
        </div>
      </div>
      {proposal && <ProposalCard proposal={proposal} otherLabels={otherLabels} onApply={onApply} onCancel={onCancel} />}
      {history.length > 0 && (
        <details className="mt-3 border-t border-line pt-1">
          <summary className="min-h-9 cursor-pointer py-1 text-sm font-medium">سجل التغييرات</summary>
          <ol className="space-y-1 text-sm">
            {history.map((h, i) => (
              <li key={i} className="border-s-2 border-line ps-2">
                <span className="font-medium">{fieldLabel(h.field, otherLabels)}</span>: <bdi>{displayValue(h.field, h.value)}</bdi>
                <span className="text-xs text-muted"> · {SOURCE[h.source]}{h.note ? ` (${h.note})` : ""}{h.adopted ? "" : " · لم يُعتمد"}</span>
                {h.quote && <p className="text-xs text-muted" dir="auto">«{h.quote}»</p>}
              </li>
            ))}
          </ol>
          {offer.sources.filter((s) => s.kind === "reply").map((s) => (
            <div key={s.id} className="mt-2"><p className="text-xs font-medium">ردّ لصقته (غير موثّق):</p><p className="whitespace-pre-wrap rounded-s bg-sunken p-2 text-xs" dir="auto">{s.text}</p></div>
          ))}
        </details>
      )}
    </Card>
  );
}

export function ClarifySection({ state, proposals, busy, onSendReply, onApply, onCancel }: {
  state: ConversationState; proposals: ReplyProposal[]; busy: boolean; onSendReply: (offerId: string, text: string) => void; onApply: (p: ReplyProposal, c: Record<string, ConflictChoice>, s: Set<string>) => void; onCancel: (p: ReplyProposal) => void;
}) {
  return (
    <Section id="clarify" title="توضيح الموردين" hint="أسئلة مبنية على الناقص فعليًا. انسخها وأرسلها بنفسك؛ لا أرسل شيئًا.">
      {!state.offers.length && <p className="rounded-s bg-sunken p-4 text-sm">تظهر الأسئلة بعد إضافة العروض.</p>}
      <div className="space-y-3">
        {state.offers.map((o) => {
          const proposal = proposals.find((p) => p.offerId === o.id) ?? null;
          return <ClarifyOffer key={o.id} offer={o} state={state} proposal={proposal} busy={busy} onSendReply={(t) => onSendReply(o.id, t)} onApply={(c, s) => proposal && onApply(proposal, c, s)} onCancel={() => proposal && onCancel(proposal)} />;
        })}
      </div>
    </Section>
  );
}

export type RfqDraft = { message: string; source: "llama" | "template"; reason: string | null; includeBudget: boolean; forKey: string };

export function RfqSection({ state, draft, busy, onGenerate, onEdit }: { state: ConversationState; draft: RfqDraft | null; busy: boolean; onGenerate: (includeBudget: boolean) => void; onEdit: (message: string) => void }) {
  const r = state.requirements;
  const [includeBudget, setIncludeBudget] = useState(false);
  const gaps = rfqGaps(r);
  const blocked = gaps.filter((g) => g.blocking);
  const stale = draft && draft.forKey !== JSON.stringify(r);
  return (
    <Section id="rfq" title="طلب عرض السعر" hint="رسالة موحدة ترسلها بنفسك للموردين، ولو قبل وصول أي عرض.">
      {blocked.length > 0 && <p className="mb-2 rounded-s bg-sunken p-3 text-sm">قبل التجهيز أحتاج: {blocked.map((g) => g.question).join(" ")}</p>}
      {!blocked.length && gaps.length > 0 && <p className="mb-2 text-sm text-muted">لم يُحدَّد بعد، فلن يُذكر في الرسالة: {gaps.map((g) => reqLabel(g.field)).join("، ")}.</p>}
      {stale && <div className="mb-2"><Note tone="warn" title="تغيّرت متطلباتك بعد هذه المسودة">أعد التجهيز حتى تطابق الرسالة طلبك الحالي.</Note></div>}
      {r.budgetSar != null && (
        <label className="mb-2 flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={includeBudget} onChange={(e) => setIncludeBudget(e.target.checked)} />
          أظهر ميزانيتي للمورد ({qty(r.budgetSar)} ريال). مخفية ما لم تفعّل هذا الخيار.
        </label>
      )}
      <Button variant={draft ? "secondary" : "primary"} busy={busy} disabled={blocked.length > 0} onClick={() => onGenerate(includeBudget)}>{draft ? "أعد التجهيز" : "جهّز طلب عرض سعر"}</Button>
      {draft && (
        <div className="mt-3">
          <div className="mb-1">{draft.source === "llama" ? <Chip tone="accent">صياغة Llama بعد التحقق</Chip> : <Chip>{draft.reason === "demo" ? "قالب جاهز (وضع التجربة)" : "قالب جاهز بعد تعذر صياغة موثوقة"}</Chip>}</div>
          <textarea aria-label="نص طلب عرض السعر" className="field min-h-72 text-sm" dir="auto" value={draft.message} onChange={(e) => onEdit(e.target.value)} />
          <div className="mt-2"><CopyButton text={draft.message} label="انسخ الرسالة" /></div>
        </div>
      )}
    </Section>
  );
}
