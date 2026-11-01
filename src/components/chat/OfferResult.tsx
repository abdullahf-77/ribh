"use client";

import { useState } from "react";
import type { CostResult } from "@/domain/cost";
import { Check, Evaluation } from "@/domain/decision";
import { counted, missingText, qty, reasonText, sar } from "@/domain/explain";
import { activeVersion, Evidence, OfferState, resolveOffer } from "@/domain/offer-state";
import { deterministicMessage, offerQuestions } from "@/domain/questions";
import type { Requirements } from "@/domain/schemas";
import { formatDate } from "@/lib/api";
import { SourceBlock } from "../OfferReview";
import { Button, Card, Chip, CopyButton, StatusChip } from "../ui";

export const categoryCopy = {
  confirmed: { label: "مؤكد مناسب", tone: "meets" as const },
  clarify: { label: "يحتاج توضيحًا", tone: "unknown" as const },
  fail: { label: "لا يستوفي شروطك", tone: "not" as const },
};

export const Unknown = ({ children = "غير معروف" }: { children?: React.ReactNode }) => <Chip tone="unknown">{children}</Chip>;

export function vatText(c: CostResult) {
  if (c.vatTreatment === "included") return "شامل الضريبة";
  if (c.vatTreatment === "excluded") return c.vatHalalas != null ? `تضاف ${sar(c.vatHalalas)}` : null;
  return null;
}

/** Opens the source text inside the message with the supporting words highlighted. */
export function EvidenceLink({ offer, evidence }: { offer: OfferState; evidence: Evidence }) {
  const [open, setOpen] = useState(false);
  const source = offer.sources.find((s) => s.id === evidence.sourceId);
  return (
    <span className="block">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="min-h-7 text-start text-xs text-accent-text underline underline-offset-2">
        {source?.kind === "reply" ? "من رد المورد" : "من العرض"}: <bdi>«{evidence.quote}»</bdi>
      </button>
      {open && source && <span className="mt-1 block"><SourceBlock source={source} highlight={evidence} /></span>}
    </span>
  );
}

function CostBar({ cost }: { cost: CostResult }) {
  const segments = [
    { key: "goods", label: "المنتج", value: cost.goodsHalalas, color: "var(--c-accent)" },
    { key: "delivery", label: "التوصيل", value: cost.deliveryHalalas, color: "var(--c-green)" },
    { key: "charges", label: "رسوم أخرى", value: cost.chargesHalalas || null, color: "#7fa8dc" },
    { key: "vat", label: "ضريبة مضافة", value: cost.vatHalalas || null, color: "#54606c" },
  ].filter((s) => s.value);
  const total = segments.reduce((a, s) => a + (s.value ?? 0), 0);
  return (
    <div aria-hidden className="flex h-2.5 w-full overflow-hidden rounded-s bg-sunken">
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

function CheckRow({ check, offer }: { check: Check; offer: OfferState }) {
  const v = activeVersion(offer, check.field);
  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span dir="auto">{check.label}{!check.mandatory && <span className="text-xs text-muted"> (مفضّل)</span>}</span>
        <StatusChip status={check.status} />
      </div>
      <p className="text-xs text-muted">المطلوب: <bdi>{check.required}</bdi>{check.offered ? <> · العرض: <bdi>{check.offered}</bdi></> : null}</p>
      {v?.evidence && <EvidenceLink offer={offer} evidence={v.evidence} />}
      {v?.source === "user" && <p className="text-xs text-muted">عدّلته أنت</p>}
    </li>
  );
}

export function OfferResult({ e, offer, isWinner, requirements, onReply }: {
  e: Evaluation; offer: OfferState; isWinner: boolean; requirements: Requirements; onReply: (offerId: string) => void;
}) {
  const c = e.cost;
  const cat = categoryCopy[e.category];
  const questions = offerQuestions(resolveOffer(offer), e, requirements);
  const decisive = questions.filter((q) => q.decisive).length;
  const [asking, setAsking] = useState(false);
  const [edited, setEdited] = useState<string | null>(null);
  const message = edited ?? deterministicMessage(e.label, questions);

  return (
    <Card className={`!p-4 ${isWinner ? "ring-2 ring-green" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold" dir="auto">{e.label}</h4>
        <div className="flex flex-wrap gap-1">
          {e.rank != null && <Chip tone="accent">الترتيب {e.rank}</Chip>}
          <Chip tone={cat.tone}>{cat.label}</Chip>
        </div>
      </div>

      <div className="mt-2">
        <p className="text-xs text-muted">{c.complete ? "ما ستدفعه" : "مبلغ معروف جزئيًا"}</p>
        {c.totalHalalas != null
          ? <p className="text-xl font-bold">{sar(c.totalHalalas)}</p>
          : c.knownSubtotalHalalas != null
            ? <p className="text-xl font-bold">{sar(c.knownSubtotalHalalas)} <span className="text-sm font-medium text-unknown">+ غير معروف</span></p>
            : <p className="text-lg font-bold text-unknown">لا يمكن الحساب بعد</p>}
        <div className="mt-2"><CostBar cost={c} /></div>
      </div>

      {(e.failReasons.length > 0 || e.blockers.length > 0) && (
        <ul className="mt-2 space-y-1 text-sm">
          {e.failReasons.map((r) => <li key={r} className="text-not">{reasonText(r, e)}</li>)}
          {e.blockers.filter((b) => b !== "cost").map((r, i) => <li key={`${r}${i}`} className="text-unknown">{reasonText(r, e)}</li>)}
        </ul>
      )}
      {c.missing.length > 0 && <p className="mt-1 text-sm text-unknown">ينقص: {c.missing.map(missingText).join("، ")}</p>}

      <dl className="mt-2 divide-y divide-line border-t border-line">
        <Row label="كمية الشراء">{c.purchaseQty != null ? `${qty(c.purchaseQty)} وحدة${c.packages != null ? ` (${counted(c.packages, "عبوة", "عبوات")})` : ""}` : <Unknown />}</Row>
        <Row label="الفائض عن حاجتك">{c.excess != null ? `${qty(c.excess)} وحدة` : <Unknown />}</Row>
        <Row label="تكلفة الوحدة شاملة كل الرسوم">{c.comparableUnitSar ? `${c.comparableUnitSar} ريال` : <Unknown />}</Row>
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
        <details className="mt-2 border-t border-line pt-1">
          <summary className="min-h-9 cursor-pointer py-1 text-sm font-medium">مطابقة شروطك ودليلها</summary>
          <ul className="divide-y divide-line">{e.checks.map((k) => <CheckRow key={k.id} check={k} offer={offer} />)}</ul>
        </details>
      )}

      <div className="mt-2 flex flex-wrap gap-2 border-t border-line pt-2">
        {questions.length > 0 && <Button aria-expanded={asking} onClick={() => setAsking(!asking)}>{decisive ? `اسأل المورد (${decisive})` : "اسأل المورد"}</Button>}
        <Button onClick={() => onReply(offer.id)}>أضف رد المورد</Button>
      </div>
      {asking && (
        <div className="mt-2">
          <textarea aria-label={`رسالة إلى ${e.label}`} className="field min-h-44 text-sm" dir="auto" value={message} onChange={(ev) => setEdited(ev.target.value)} />
          <div className="mt-2"><CopyButton text={message} label="انسخ الرسالة" /></div>
        </div>
      )}
    </Card>
  );
}
