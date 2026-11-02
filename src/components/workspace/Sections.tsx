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
import { boolOptions, Button, Chip, CopyButton, fromBool, Note, NumberField, SelectField, TextField, toBool } from "../ui";

const req3 = { required: "مطلوب", not_required: "غير مطلوب" };
const SOURCE = { offer: "العرض الأصلي", reply: "رد المورد", user: "تعديلك" };
const categoryOptions = Object.fromEntries(CATEGORY_IDS.map((c) => [c, CATEGORIES[c].label]));

export type SectionId = "requirements" | "rfq" | "offers" | "clarify" | "comparison" | "scenarios";
export type WorkTab = "need" | "offers" | "decision";
export const WORK_TABS: { id: WorkTab; label: string }[] = [{ id: "need", label: "احتياجي" }, { id: "offers", label: "العروض" }, { id: "decision", label: "القرار" }];
export const TAB_OF: Record<SectionId, WorkTab> = { requirements: "need", rfq: "need", offers: "offers", clarify: "offers", comparison: "decision", scenarios: "decision" };
export const SECTION_LABEL: Record<SectionId, string> = { requirements: "احتياجي", rfq: "طلب عرض السعر", offers: "العروض", clarify: "أسئلة الموردين", comparison: "القرار", scenarios: "القرار" };

export function Section({ id, title, hint, actions, sheet, children }: { id: SectionId; title?: string; hint?: string; actions?: React.ReactNode; sheet?: boolean; children: React.ReactNode }) {
  return (
    <section id={`section-${id}`} aria-label={title} className={`scroll-mt-16 ${sheet ? "sheet p-5 sm:p-7" : ""}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="font-display text-2xl font-bold">{title}</h2>}
            {hint && <p className="text-sm text-muted">{hint}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
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
    <Section id="requirements" sheet title={cat ? `طلب شراء: ${cat.label}` : "طلب شراء"}
      actions={<Button variant="ghost" aria-expanded={editing} onClick={() => { if (editing) { onEditDone(before); setBefore(null); } else setBefore(r); }}>{editing ? "تم" : "عدّل"}</Button>}>
      {pendingSwitch && r.category && (
        <div className="mb-3">
          <Note tone="warn" title={`نستبدل ${CATEGORIES[r.category].label} بـ${CATEGORIES[pendingSwitch.to].label}؟`}
            actions={<><Button variant="primary" onClick={onConfirmSwitch}>نعم، ابدأ مقارنة جديدة</Button><Button onClick={onCancelSwitch}>أبقِ المقارنة الحالية</Button></>}>
            تنمسح المواصفات والكمية والميزانية والعروض، وتبقى مدينة التوصيل.
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
        <div className="text-sm">
          <p>اكتب للمساعد وش تحتاج، أو املأ الطلب بنفسك.</p>
          <div className="mt-2 flex flex-wrap gap-2"><Button onClick={askAssistant}>تحدث مع المساعد</Button><Button onClick={() => setBefore(r)}>املأها يدويًا</Button></div>
        </div>
      )}
      {!editing && !empty && (
        <dl className="grid gap-x-10 md:grid-cols-2">
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
          <span className="text-muted">باقي:</span>
          {missing.map((f) => <span key={f} title={questionFor(f)}><Chip tone="unknown">{reqLabel(f)}</Chip></span>)}
        </div>
      )}
    </Section>
  );
}

const ReqRow = ({ label, value, quote }: { label: string; value: string; quote?: string }) => (
  <div className="leader" title={quote ? `من كلامك: ${quote}` : undefined}>
    <dt>{label}</dt>
    <dd><bdi>{value}</bdi></dd>
  </div>
);

const grid = "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,19rem),1fr))]";

export function OfferCard({ offer, state, evaluation, onOffer, onConfirm, onWhy, onEditOpen, onEditDone, tick }: {
  offer: OfferState; state: ConversationState; evaluation: Evaluation; onOffer: (o: OfferState) => void; onConfirm: () => void; onWhy: () => void; onEditOpen: () => void; onEditDone: () => void; tick: () => number;
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
    <article className={`sheet rise p-4 ${editing ? "col-span-full" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-ink pb-2">
        <h3 className="font-display text-xl font-bold" dir="auto">{name}</h3>
        {confirmed ? <Chip tone="meets">أكدته</Chip> : <Chip tone="unknown">بانتظار تأكيدك</Chip>}
      </div>
      {mismatch && <div className="mt-2"><Note tone="error">هذا العرض عن {CATEGORIES[category].label}، وطلبك عن {CATEGORIES[state.requirements.category!].label}. لن يدخل في المقارنة.</Note></div>}
      <dl className="mt-2">
        {rows.map(([label, key]) => {
          const value = fieldValue(offer, key);
          if (value == null && optional.has(key)) return null;
          const evidence = activeVersion(offer, key)?.evidence;
          return (
            <div key={key}>
              <div className="leader">
                <dt>{label}</dt>
                <dd>{value == null ? <Unknown /> : <bdi>{displayValue(key, value)}</bdi>}</dd>
              </div>
              {evidence && editing && <EvidenceLink offer={offer} evidence={evidence} />}
            </div>
          );
        })}
      </dl>
      {evaluation.cost.missing.length > 0 && <p className="mt-2 text-sm text-unknown">ينقص لحساب الإجمالي: {evaluation.cost.missing.map(missingText).join("، ")}</p>}
      {open > 0 && <p className="mt-1 text-sm text-unknown">نقاط ملتبسة: {open}. افتح «عدّل» لمراجعتها.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {!confirmed && <Button variant="primary" onClick={onConfirm}>أكّد العرض</Button>}
        <Button aria-expanded={editing} onClick={() => { if (editing) onEditDone(); else onEditOpen(); setEditing(!editing); }}>{editing ? "تم" : "عدّل وشوف الأدلة"}</Button>
        <Button variant="ghost" onClick={onWhy}>لماذا هذا العرض؟</Button>
      </div>
      {editing && <div className="mt-3"><OfferReview offer={offer} onOffer={onOffer} requirements={state.requirements} rejected={state.rejected[offer.id] ?? []} tick={tick} /></div>}
    </article>
  );
}

export type FailedOffer = { id: string; text: string; supplierHint: string | null; message: string };

export function OffersSection({ state, failed, busy, onOffer, onConfirm, onWhy, onEditOpen, onEditDone, onPaste, onRetry, onManual, tick }: {
  state: ConversationState; failed: FailedOffer[]; busy: boolean; onOffer: (o: OfferState) => void; onConfirm: (id: string) => void; onWhy: (id: string) => void;
  onEditOpen: () => void; onEditDone: (id: string) => void; onPaste: () => void; onRetry: (f: FailedOffer) => void; onManual: (f: FailedOffer) => void; tick: () => number;
}) {
  const q = activeQuantity(state);
  return (
    <Section id="offers" title="عروض الموردين" hint={state.offers.length ? "لا يدخل القرار إلا ما تؤكده." : undefined}
      actions={state.offers.length < 3 ? <Button onClick={onPaste}>ألصق عرض مورد</Button> : undefined}>
      {!state.offers.length && !failed.length && <p className="py-6 text-lg text-muted">ألصق عرضين أو ثلاثة كما وصلتك من واتساب أو البريد.</p>}
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
            onConfirm={() => onConfirm(o.id)} onWhy={() => onWhy(o.id)} onEditOpen={onEditOpen} onEditDone={() => onEditDone(o.id)} tick={tick} />
        ))}
      </div>
    </Section>
  );
}

const verdictStamp: Record<Decision["verdict"]["kind"], { text: string; color: string }> = {
  recommend: { text: "موصى به", color: "text-meets" }, recommend_open: { text: "توصية مشروطة", color: "text-accent-text" }, tie: { text: "تعادل", color: "text-accent-text" },
  clarify: { text: "يلزم توضيح", color: "text-unknown" }, none_eligible: { text: "لا يوجد مستوفٍ", color: "text-not" }, not_comparable: { text: "لا تصح المقارنة", color: "text-unknown" },
};

/** Nothing resembling a recommendation appears until the engine has one. Until then, only what is left to do. */
export function DecisionHero({ state, decision, onGo }: { state: ConversationState; decision: Decision | null; onGo: (s: SectionId) => void }) {
  const confirmed = confirmedOffers(state).length;
  if (!decision) {
    const steps = [
      { done: !!state.requirements.quantity && !!state.requirements.category, text: "حدد المنتج والكمية", go: "requirements" as const },
      { done: state.offers.length >= 2, text: "أضف عرضين على الأقل", go: "offers" as const },
      { done: confirmed >= 2, text: "أكّد العروض بعد مراجعتها", go: "offers" as const },
    ];
    return (
      <div className="py-4">
        <h2 className="font-display text-2xl font-bold">القرار ينتظر</h2>
        <ol className="mt-3 space-y-1">
          {steps.map((s) => (
            <li key={s.text} className="flex items-center gap-2">
              <span aria-hidden className={`inline-flex size-5 items-center justify-center rounded-full border text-xs ${s.done ? "border-meets bg-meets-soft text-meets" : "border-field-line text-muted"}`}>{s.done ? "✓" : ""}</span>
              {s.done ? <span className="text-muted line-through">{s.text}</span> : <button type="button" onClick={() => onGo(s.go)} className="min-h-9 text-accent-text underline underline-offset-2">{s.text}</button>}
              <span className="sr-only">{s.done ? "تم" : "باقي"}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  const v = decision.verdict;
  const winnerId = v.kind === "recommend" || v.kind === "recommend_open" ? v.winnerId : null;
  const winner = decision.evaluations.find((e) => e.offerId === winnerId);
  const openOnes = decision.evaluations.filter((e) => e.category === "clarify");
  const stamp = verdictStamp[v.kind];
  return (
    <div role="status" className="sheet rise p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span key={v.kind} className={`stamp ${stamp.color}`}>{stamp.text}</span>
          {winner && <h2 className="font-display mt-3 text-3xl font-bold sm:text-4xl" dir="auto">{winner.label}</h2>}
        </div>
        {winner?.cost.totalHalalas != null && (
          <div className="text-end">
            <p className="text-xs text-muted">تدفع</p>
            <p className="price text-3xl font-semibold sm:text-4xl">{sar(winner.cost.totalHalalas)}</p>
            <p className="text-xs text-muted">لـ <span className="price">{qty(winner.cost.purchaseQty ?? 0)}</span> وحدة</p>
          </div>
        )}
      </div>
      <div className="mt-3 space-y-1 text-sm">
        {state.scenarioQuantity != null && <p className="font-medium text-accent-text">هذا سيناريو. طلبك المعتمد {qty(state.requirements.quantity ?? 0)} وحدة.</p>}
        {v.kind === "recommend_open" && <p>الأفضل بين العروض المؤكدة فقط. قد تتغير النتيجة بعد توضيح {openOnes.map((e) => e.label).join(" و")}.</p>}
        {v.kind === "tie" && <p>متساويان في أولويتك والمبلغ. فرّق بينهما بشروط أخرى كالدفع.</p>}
        {v.kind === "none_eligible" && <ul className="space-y-0.5">{decision.evaluations.map((e) => <li key={e.offerId}><bdi>{e.label}</bdi>: {e.failReasons.map((r) => reasonText(r, e)).join("؛ ")}</li>)}</ul>}
        {v.kind === "clarify" && <p>ينقص توضيح من {openOnes.map((e) => e.label).join(" و")}.</p>}
        {v.kind === "not_comparable" && <p>العروض المؤكدة تختلف في المواصفات. حدد المواصفة المطلوبة في «احتياجي».</p>}
      </div>
      {openOnes.length > 0 && <div className="mt-2"><Button variant="ghost" onClick={() => onGo("clarify")}>وضّح الناقص</Button></div>}
    </div>
  );
}

function ComparisonTable({ d, winnerId }: { d: Decision; winnerId: string | null }) {
  const metric = (label: string, cell: (e: Evaluation) => React.ReactNode) => (
    <tr className="border-t border-line">
      <th scope="row" className="py-1.5 pe-3 text-start text-xs font-medium text-muted">{label}</th>
      {d.evaluations.map((e) => <td key={e.offerId} className="px-2 py-1.5 text-sm">{cell(e)}</td>)}
    </tr>
  );
  const money = (h: number | null | undefined) => (h == null ? <Unknown /> : <span className="price">{sar(h)}</span>);
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
        {metric("ما ستدفعه", (e) => (e.cost.totalHalalas != null ? <strong className="price">{sar(e.cost.totalHalalas)}</strong> : e.cost.knownSubtotalHalalas != null ? <>{sar(e.cost.knownSubtotalHalalas)} <span className="text-xs text-unknown">+ غير معروف</span></> : <Unknown />))}
        {metric("كمية الشراء", (e) => (e.cost.purchaseQty != null ? <span className="price">{qty(e.cost.purchaseQty)}</span> : <Unknown />))}
        {metric("الفائض", (e) => (e.cost.excess != null ? <span className="price">{qty(e.cost.excess)}</span> : <Unknown />))}
        {metric("تكلفة الوحدة", (e) => (e.cost.comparableUnitSar ? <span className="price">{e.cost.comparableUnitSar} ريال</span> : <Unknown />))}
        {metric("الميزانية", (e) => (e.budget.status === "not_set" ? "غير محددة" : e.budget.status === "within" ? <Chip tone="meets">ضمن</Chip> : e.budget.status === "over" ? <Chip tone="not">تتجاوز</Chip> : <Unknown />))}
        {metric("التسليم", (e) => (e.delivery.status === "unknown" ? <Unknown>غير مؤكد</Unknown> : e.delivery.arrival ? <Chip tone={e.delivery.status === "not" ? "not" : e.delivery.status === "meets" ? "meets" : "neutral"}>{formatDate(e.delivery.arrival)}</Chip> : "—"))}
      </tbody>
    </table>
  );
}

export function ComparisonSection({ state, decision, onReply }: { state: ConversationState; decision: Decision | null; onReply: (id: string) => void }) {
  if (!decision) return null;
  const winnerId = decision && (decision.verdict.kind === "recommend" || decision.verdict.kind === "recommend_open") ? decision.verdict.winnerId : null;
  const reqAt = { ...state.requirements, quantity: activeQuantity(state) };
  return (
    <Section id="comparison" title="كيف قارنا" hint="الأرقام من قواعد التطبيق، وليست من النموذج.">
      {decision && (
        <>
          <div className="hidden overflow-x-auto md:block"><ComparisonTable d={decision} winnerId={winnerId} /></div>
          <div className={`${grid} md:hidden`}>
            {decision.evaluations.map((e) => <OfferResult key={e.offerId} e={e} offer={state.offers.find((o) => o.id === e.offerId)!} isWinner={e.offerId === winnerId} requirements={reqAt} onReply={onReply} />)}
          </div>
          <details className="fold mt-3 hidden border-t border-line pt-1 md:block">
            <summary>مطابقة شروطك وأدلتها لكل عرض</summary>
            <div className={`${grid} mt-2`}>
              {decision.evaluations.map((e) => <OfferResult key={e.offerId} e={e} offer={state.offers.find((o) => o.id === e.offerId)!} isWinner={e.offerId === winnerId} requirements={reqAt} onReply={onReply} />)}
            </div>
          </details>
        </>
      )}
    </Section>
  );
}

export function ScenarioSection({ state, decision, onScenario, onAdopt, onRequirements, onPriority, onOrderDate }: {
  state: ConversationState; decision: Decision | null; onScenario: (q: number | null) => void; onAdopt: () => void; onRequirements: (r: Requirements) => void; onPriority: (p: Priority) => void; onOrderDate: (d: string) => void;
}) {
  if (!decision) return null;
  const r = state.requirements;
  const q = activeQuantity(state);
  const offers = confirmedOffers(state);
  const hasTiers = offers.some((o) => (fieldValue<unknown[]>(o, "tiers") ?? []).length);
  return (
    <Section id="scenarios" title="جرّب قبل ما تقرر">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40"><NumberField label="الكمية" integer value={q} onChange={(v) => { if (v) onScenario(v === r.quantity ? null : v); }} /></div>
        {state.scenarioQuantity != null && (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={onAdopt}>اعتمد {qty(state.scenarioQuantity)}</Button>
            <Button onClick={() => onScenario(null)}>عد إلى {qty(r.quantity ?? 0)}</Button>
          </div>
        )}
      </div>
      <fieldset className="mt-4">
        <legend className="mb-1 text-sm font-medium">ما أولويتك؟</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(priorityLabels) as Priority[]).map((k) => (
            <label key={k} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-s border px-3 text-sm transition ${state.priority === k ? "border-accent bg-accent-soft font-medium text-accent-text" : "border-line bg-surface"}`}>
              <input type="radio" name="priority" className="size-4" checked={state.priority === k} onChange={() => onPriority(k)} />
              {priorityLabels[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 divide-y divide-line border-y border-line">
        {hasTiers && q && (
          <details className="fold py-1">
            <summary>خصم الكمية</summary>
            <div className="pb-3"><DiscountSection offers={offers} requirements={{ ...r, quantity: q }} /></div>
          </details>
        )}
        <details className="fold py-1">
          <summary>الميزانية والموعد</summary>
          <div className="grid gap-3 pb-3 sm:grid-cols-3">
            <NumberField label="الميزانية (ريال)" value={r.budgetSar} onChange={(v) => onRequirements({ ...r, budgetSar: v })} />
            <TextField label="موعد الاستلام" type="date" value={r.requiredDate} onChange={(v) => onRequirements({ ...r, requiredDate: v })} />
            <TextField label="تاريخ الطلب" type="date" hint="تُحسب منه مدد التسليم" value={state.orderDate} onChange={(v) => v && onOrderDate(v)} />
          </div>
        </details>
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
    <details className="fold" open={!!proposal || undefined}>
      <summary>
        <span className="flex min-w-0 flex-wrap items-center gap-2"><bdi>{name}</bdi>{decisive > 0 ? <Chip tone="unknown">ينقص {decisive}</Chip> : <span className="text-xs font-normal text-muted">لا ينقص ما يغيّر القرار</span>}</span>
      </summary>
      <div className="mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr))]">
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
        <details className="mb-3 border-t border-line pt-1">
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
    </details>
  );
}

export function ClarifySection({ state, proposals, busy, onSendReply, onApply, onCancel }: {
  state: ConversationState; proposals: ReplyProposal[]; busy: boolean; onSendReply: (offerId: string, text: string) => void; onApply: (p: ReplyProposal, c: Record<string, ConflictChoice>, s: Set<string>) => void; onCancel: (p: ReplyProposal) => void;
}) {
  if (!state.offers.length) return null;
  return (
    <Section id="clarify" title="أسئلة الموردين" hint="مبنية على الناقص فعليًا. انسخها وأرسلها بنفسك.">
      <div className="divide-y divide-line border-y border-line">
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
  if (!r.category) return null;
  const gaps = rfqGaps(r);
  const blocked = gaps.filter((g) => g.blocking);
  const stale = draft && draft.forKey !== JSON.stringify(r);
  return (
    <section id="section-rfq" className="scroll-mt-16 border-y border-line">
      <details className="fold py-1" open={!!draft || undefined}>
        <summary>طلب عرض سعر للموردين</summary>
        <div className="pb-4">
          {blocked.length > 0 && <p className="mb-2 text-sm">قبل التجهيز أحتاج: {blocked.map((g) => g.question).join(" ")}</p>}
          {!blocked.length && gaps.length > 0 && <p className="mb-2 text-sm text-muted">لن يُذكر ما لم تحدده: {gaps.map((g) => reqLabel(g.field)).join("، ")}.</p>}
          {stale && <div className="mb-2"><Note tone="warn" title="تغيّر طلبك بعد هذه المسودة">أعد التجهيز حتى تطابق الرسالة طلبك الحالي.</Note></div>}
          {r.budgetSar != null && (
            <label className="mb-2 flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={includeBudget} onChange={(e) => setIncludeBudget(e.target.checked)} />
              أظهر ميزانيتي للمورد. مخفية ما لم تفعّل هذا الخيار.
            </label>
          )}
          <Button variant={draft ? "secondary" : "primary"} busy={busy} disabled={blocked.length > 0} onClick={() => onGenerate(includeBudget)}>{draft ? "أعد التجهيز" : "جهّز الرسالة"}</Button>
          {draft && (
            <div className="sheet rise mt-3 p-4">
              <p className="mb-1 text-xs text-muted">{draft.source === "llama" ? "صياغة الذكاء الاصطناعي بعد التحقق" : draft.reason === "demo" ? "قالب جاهز (وضع التجربة)" : "قالب جاهز بعد تعذر صياغة موثوقة"}</p>
              <textarea aria-label="نص طلب عرض السعر" className="min-h-64 w-full resize-y border-0 bg-transparent text-sm leading-7 outline-none" dir="auto" value={draft.message} onChange={(e) => onEdit(e.target.value)} />
              <div className="mt-2 border-t border-line pt-2"><CopyButton text={draft.message} label="انسخ الرسالة" /></div>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
