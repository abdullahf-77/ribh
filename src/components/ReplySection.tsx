"use client";

import { useState } from "react";
import { limits } from "@/config/brand";
import type { Scenario } from "@/demo/scenarios";
import { decide, Decision, Evaluation, Priority } from "@/domain/decision";
import { explainDecisionChange } from "@/domain/explain";
import { changeHistory, fieldValue, OfferState, resolveOffer } from "@/domain/offer-state";
import type { ClarifyQuestion } from "@/domain/questions";
import { applyReplyProposal, buildReplyProposal, ConflictChoice, ReplyProposal, unresolvedConflicts } from "@/domain/replies";
import type { RawOffer, Requirements } from "@/domain/schemas";
import { ApiError, post } from "@/lib/api";
import { displayValue, fieldLabel } from "@/lib/fields";
import { Button, Card, Chip, CopyButton, Note } from "./ui";

const KIND = {
  resolves_unknown: { label: "يحسم مجهولًا", tone: "meets" as const },
  conflict: { label: "يتعارض مع المسجّل", tone: "not" as const },
  confirms: { label: "يؤكد المسجّل", tone: "neutral" as const },
};
const SOURCE = { offer: "العرض الأصلي", reply: "رد المورد", user: "تعديلك" };

export function ReplySection({ offer, evaluation: e, questions, message, messageSource, requirements, decide: currentDecision, scenario, offers, onOffers, onChange, orderDate, priority, tick }: {
  offer: OfferState; evaluation: Evaluation; questions: ClarifyQuestion[]; message: string; messageSource: "llama" | "template"; requirements: Requirements; decide: Decision; scenario: Scenario | null;
  offers: OfferState[]; onOffers: (o: OfferState[]) => void; onChange: (n: { offerLabel: string; lines: string[] }) => void; orderDate: string; priority: Priority; tick: () => number;
}) {
  const [open, setOpen] = useState(false);
  const [edited, setEdited] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [proposal, setProposal] = useState<ReplyProposal | null>(null);
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [emptyError, setEmptyError] = useState(false);

  const otherLabels = Object.fromEntries(requirements.other.map((o) => [o.id, o.text]));
  const replyNumber = offer.sources.filter((s) => s.kind === "reply").length + 1;
  const demoReply = scenario?.reply && ["A", "B", "C"][scenario.reply.offerIndex] === offer.id ? scenario.reply : null;
  const shownMessage = edited ?? message;
  const history = changeHistory(offer).filter((h) => h.source !== "offer" || h.field !== "supplierName");

  const extract = async () => {
    if (!replyText.trim()) { setEmptyError(true); return; }
    setEmptyError(false); setBusy(true); setError(null);
    try {
      const current = Object.fromEntries(Object.keys(offer.fields).map((k) => [k, fieldValue(offer, k)]).filter(([, v]) => v != null));
      const out = await post<{ raw: RawOffer }>("/api/replies", { text: replyText, current, questions: questions.map((q) => q.text), other: requirements.other });
      setProposal(buildReplyProposal(offer, out.raw, `reply:${offer.id}:${replyNumber}`, replyText, requirements.other.map((o) => o.id)));
      setChoices({}); setSkipped(new Set());
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  };

  const confirm = () => {
    if (!proposal) return;
    const updated = applyReplyProposal(offer, proposal, choices, skipped, tick());
    const nextOffers = offers.map((o) => (o.id === updated.id ? updated : o));
    const after = decide(nextOffers.map(resolveOffer), requirements, orderDate, priority);
    onOffers(nextOffers);
    onChange({ offerLabel: e.label, lines: explainDecisionChange(currentDecision, after, offer.id) });
    setProposal(null); setReplyText("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const pending = proposal ? unresolvedConflicts(proposal, choices) : [];
  const decisive = questions.filter((q) => q.decisive).length;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold" dir="auto">{e.label}</h4>
        <div className="flex flex-wrap items-center gap-2">
          {decisive > 0 ? <Chip tone="unknown">نقاط قد تغيّر القرار: {decisive}</Chip> : <Chip>لا ينقص ما يغيّر القرار</Chip>}
          <Button aria-expanded={open} onClick={() => setOpen(!open)}>أضف رد المورد</Button>
        </div>
      </div>

      {questions.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-sm">{questions.map((q) => <li key={q.code} dir="auto">{q.text}{!q.decisive && <span className="text-xs text-muted"> (للتأكد)</span>}</li>)}</ul>
      )}

      {open && (
        <div className="mt-4 grid gap-4 border-t border-line pt-4 lg:grid-cols-2">
          <div>
            <p className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
              رسالة للمورد
              {messageSource === "llama" && edited == null && <Chip tone="accent">صياغة Llama</Chip>}
            </p>
            {shownMessage ? (
              <>
                <textarea aria-label={`رسالة إلى ${e.label}`} className="field min-h-52" dir="auto" value={shownMessage} onChange={(ev) => setEdited(ev.target.value)} />
                <div className="mt-2"><CopyButton text={shownMessage} label="انسخ الرسالة" /></div>
              </>
            ) : <p className="rounded-s bg-sunken p-3 text-sm text-muted">لا توجد أسئلة مفتوحة لهذا العرض.</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={`reply-${offer.id}`}>ألصق رد المورد هنا</label>
            <textarea id={`reply-${offer.id}`} className="field min-h-40" dir="auto" maxLength={limits.replyChars} value={replyText} aria-invalid={emptyError}
              onChange={(ev) => { setReplyText(ev.target.value); setEmptyError(false); }} />
            {emptyError && <p role="alert" className="text-xs text-not">ألصق نص الرد أولًا.</p>}
            <p className="mt-1 text-xs text-muted">هذا نص تلصقه أنت. لا يتحقق التطبيق من أنه صادر فعلًا عن المورد.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="primary" busy={busy} onClick={extract}>{busy ? "جارٍ قراءة الرد" : "استخرج التغييرات"}</Button>
              {demoReply && <Button onClick={() => setReplyText(demoReply.text)}>الصق الرد الخيالي</Button>}
            </div>
            {error && <div className="mt-2"><Note tone="error" title="تعذر قراءة الرد">{error.message}</Note></div>}
          </div>
        </div>
      )}

      {proposal && (
        <div className="mt-4 border-t border-line pt-4">
          <h5 className="font-semibold">راجع التغييرات قبل تطبيقها</h5>
          <p className="mb-2 text-xs text-muted">لم يتغير شيء بعد. الرد الأحدث لا يُعتمد تلقائيًا عند التعارض.</p>
          {proposal.changes.length === 0 && <Note tone="info">لم نجد في هذا الرد معلومة واضحة يمكن إضافتها. تبقى البيانات كما هي.</Note>}
          <ul className="space-y-2">
            {proposal.changes.map((c) => (
              <li key={c.field} className={`rounded-s border p-3 text-sm ${c.kind === "conflict" ? "border-not/50" : "border-line"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{fieldLabel(c.field, otherLabels)}</span>
                  <Chip tone={KIND[c.kind].tone}>{KIND[c.kind].label}</Chip>
                </div>
                <dl className="mt-1 grid gap-x-4 sm:grid-cols-2">
                  <div><dt className="text-xs text-muted">القيمة الحالية</dt><dd><bdi>{displayValue(c.field, c.previous)}</bdi></dd></div>
                  <div><dt className="text-xs text-muted">المقترح من الرد</dt><dd><bdi>{displayValue(c.field, c.proposed)}</bdi></dd></div>
                </dl>
                <p className="mt-1 text-xs text-muted" dir="auto">الدليل من الرد: «{c.evidence.quote}»</p>
                {c.flag === "value_not_in_quote" && <p className="mt-1 text-xs text-unknown">الرقم غير ظاهر حرفيًا في الدليل. تأكد منه قبل اعتماده.</p>}
                {c.kind === "conflict" ? (
                  <fieldset className="mt-2">
                    <legend className="text-xs font-medium">أي قيمة تعتمد؟</legend>
                    <div className="mt-1 flex flex-wrap gap-3">
                      {(["keep", "adopt"] as const).map((ch) => (
                        <label key={ch} className="flex min-h-9 items-center gap-1.5">
                          <input type="radio" name={`${offer.id}-${c.field}`} className="size-4" checked={choices[c.field] === ch} onChange={() => setChoices({ ...choices, [c.field]: ch })} />
                          {ch === "keep" ? "أبقِ الحالية" : "اعتمد قيمة الرد"}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : (
                  <label className="mt-2 flex min-h-9 items-center gap-1.5 text-xs">
                    <input type="checkbox" className="size-4" checked={skipped.has(c.field)} onChange={(ev) => {
                      const next = new Set(skipped);
                      if (ev.target.checked) next.add(c.field); else next.delete(c.field);
                      setSkipped(next);
                    }} />
                    لا تطبّق هذا التغيير
                  </label>
                )}
              </li>
            ))}
          </ul>
          {proposal.rejected.length > 0 && (
            <div className="mt-2"><Note tone="warn">لم نقبل قيمًا لم نجد لها دليلًا في نص الرد: {proposal.rejected.map((x) => fieldLabel(x.field, otherLabels)).join("، ")}. تبقى كما كانت.</Note></div>
          )}
          {pending.length > 0 && <p className="mt-2 text-sm text-not">اختر قيمة لكل تعارض قبل التطبيق.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" disabled={pending.length > 0 || proposal.changes.length === 0} onClick={confirm}>طبّق وأعد الحساب</Button>
            <Button onClick={() => setProposal(null)}>إلغاء</Button>
          </div>
        </div>
      )}

      {history.some((h) => h.source !== "offer") && (
        <details className="mt-3 border-t border-line pt-2">
          <summary className="min-h-9 cursor-pointer py-1 text-sm font-medium">سجل التغييرات في هذه الجلسة</summary>
          <ol className="mt-1 space-y-2 text-sm">
            {history.filter((h) => h.source !== "offer").map((h, i) => (
              <li key={i} className="border-s-2 border-line ps-2">
                <span className="font-medium">{fieldLabel(h.field, otherLabels)}</span>: <bdi>{displayValue(h.field, h.value)}</bdi>
                <span className="text-xs text-muted"> · {SOURCE[h.source]}{h.note ? ` (${h.note})` : ""}{h.adopted ? "" : " · لم يُعتمد"}</span>
                {h.quote && <p className="text-xs text-muted" dir="auto">«{h.quote}»</p>}
              </li>
            ))}
          </ol>
          {offer.sources.filter((s) => s.kind === "reply").map((s) => (
            <div key={s.id} className="mt-2">
              <p className="text-xs font-medium">ردّ لصقته (غير موثّق):</p>
              <p className="whitespace-pre-wrap rounded-s bg-sunken p-2 text-xs" dir="auto">{s.text}</p>
            </div>
          ))}
          <p className="mt-2 text-xs text-muted">القيم الأصلية من العرض تبقى محفوظة ويمكن مراجعتها في خطوة المراجعة.</p>
        </details>
      )}
    </Card>
  );
}
