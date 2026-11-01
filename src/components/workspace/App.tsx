"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeQuantity, currentDecision, initialState, otherKey, resetForCategory, setRequirementValue } from "@/chat/state";
import type { Block, ConversationState, TurnEvent, TurnResponse } from "@/chat/types";
import { brand, limits } from "@/config/brand";
import { rawOffer } from "@/demo/build";
import { CATEGORIES, CategoryId } from "@/domain/categories";
import type { Decision, Priority } from "@/domain/decision";
import { newOfferState, validateRawOffer } from "@/domain/evidence";
import { decisionFingerprint, explainDecisionChange, qty } from "@/domain/explain";
import { fieldValue, OfferState } from "@/domain/offer-state";
import { applyReplyProposal, ConflictChoice, ReplyProposal } from "@/domain/replies";
import type { Requirements } from "@/domain/schemas";
import { ApiError, post, todayIso } from "@/lib/api";
import { BrandLogo } from "../Brand";
import { Button, Note } from "../ui";
import { ChatPanel, Composer, Message } from "./ChatPanel";
import { ClarifySection, ComparisonSection, ConflictItem, FailedOffer, OffersSection, RecommendationBanner, reqLabel, reqValue, RequirementsSection, RfqDraft, RfqSection, ScenarioSection, SectionId, SECTIONS } from "./Sections";

const GREETING = "أهلًا، أنا رِبح. أساعدك في شراء مستلزمات مقهاك: الأكواب والأغطية والأكياس والمناديل وعبوات السفري. أخبرني بما تحتاجه، وستظهر التفاصيل في مساحة العمل بجانبي.";

const SECTION_FOR: Partial<Record<Block["type"], SectionId>> = {
  requirements: "requirements", req_conflict: "requirements", offer: "offers", offer_failed: "offers", rfq: "rfq", comparison: "comparison", discount: "scenarios", proposal: "clarify",
};

export function WorkspaceApp() {
  const [mode, setMode] = useState<"live" | "demo" | null>(null);
  const [state, setStateRaw] = useState<ConversationState>(() => initialState(todayIso()));
  const stateRef = useRef(state);
  const setState = useCallback((next: ConversationState) => { stateRef.current = next; setStateRaw(next); }, []);
  const greeting = (): Message[] => [{ id: 0, role: "assistant", text: GREETING, targets: [] }];
  const [messages, setMessages] = useState<Message[]>(greeting);
  const messagesRef = useRef(messages);
  const [busy, setBusy] = useState(false);
  const [composer, setComposer] = useState<Composer>({ kind: "chat" });
  const [tab, setTab] = useState<"assistant" | "comparison">("assistant");
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [proposals, setProposals] = useState<ReplyProposal[]>([]);
  const [failed, setFailed] = useState<FailedOffer[]>([]);
  const [rfq, setRfq] = useState<RfqDraft | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<{ to: CategoryId; text: string | null } | null>(null);
  const [chooseReply, setChooseReply] = useState<string | null>(null);
  const [flash, setFlash] = useState<SectionId | null>(null);
  const nextId = useRef(1);
  const clock = useRef(Date.now());
  const tick = useCallback(() => ++clock.current, []);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const offerEditBefore = useRef<Decision | null>(null);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((d) => setMode(d.mode)).catch(() => setMode("demo"));
  }, []);

  const decision = useMemo(() => currentDecision(state), [state]);
  const fingerprint = decision ? decisionFingerprint(decision) : null;

  const updateMessages = useCallback((fn: (m: Message[]) => Message[]) => { messagesRef.current = fn(messagesRef.current); setMessages(messagesRef.current); }, []);
  const append = useCallback((m: Omit<Message, "id">) => updateMessages((all) => [...all, { ...m, id: nextId.current++ }]), [updateMessages]);

  const goTo = useCallback((s: SectionId) => {
    setTab("comparison");
    setFlash(s);
    setTimeout(() => setFlash(null), 1600);
    requestAnimationFrame(() => document.getElementById(`section-${s}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  const focusAssistant = useCallback((c: Composer = { kind: "chat" }) => {
    setTab("assistant");
    setComposer(c);
    requestAnimationFrame(() => composerInput.current?.focus());
  }, []);

  /** One turn: the message or action, recent history, and the whole shared session. */
  const runTurn = useCallback(async (payload: { text: string | null; event: TurnEvent | null }) => {
    setBusy(true);
    const history = messagesRef.current.filter((m) => m.text && !m.failed).map((m) => ({ role: m.role, text: m.text })).slice(-20);
    try {
      const out = await post<TurnResponse>("/api/chat", { ...payload, history, state: stateRef.current, today: todayIso() });
      const s = stateRef.current;
      const p = out.patch;
      const next: ConversationState = {
        ...s,
        ...(p.requirements && { requirements: p.requirements }), ...(p.reqEvidence && { reqEvidence: p.reqEvidence }), ...(p.waived && { waived: p.waived }),
        ...(p.offers && { offers: p.offers }), ...(p.rejected && { rejected: p.rejected }), ...(p.priority && { priority: p.priority }),
        ...(p.analyzedOtherKey && { analyzedOtherKey: p.analyzedOtherKey }), ...(p.scenarioQuantity !== undefined && { scenarioQuantity: p.scenarioQuantity }),
      };
      setState(next);

      // Results land in their workspace sections. The chat keeps a short reply and a link to them.
      for (const b of out.blocks) {
        if (b.type === "req_conflict") setConflicts((c) => [...c, { id: b.id, field: b.field, current: b.current, proposed: b.proposed, quote: b.quote }]);
        if (b.type === "proposal") setProposals((all) => [...all.filter((x) => x.offerId !== b.proposal.offerId), b.proposal]);
        if (b.type === "offer_failed") setFailed((all) => [...all, { id: b.id, text: b.text, supplierHint: b.supplierHint, message: b.message }]);
        if (b.type === "rfq") setRfq({ message: b.message, source: b.source, reason: b.reason, includeBudget: b.includeBudget, forKey: JSON.stringify(next.requirements) });
        if (b.type === "switch_category") setPendingSwitch({ to: b.to, text: b.text });
        if (b.type === "choose_offer") setChooseReply(b.text);
      }
      const targets = [...new Set(out.blocks.map((b) => SECTION_FOR[b.type]).filter((x): x is SectionId => !!x))];
      const madeResult = out.blocks.some((b) => b.type === "comparison");
      const d = madeResult ? currentDecision(next) : null;
      append({ role: "assistant", text: out.reply, source: out.replySource, targets, resultKey: d ? decisionFingerprint(d) : undefined });
      if (out.blocks.some((b) => b.type === "reanalyze") && otherKey(next.requirements) !== next.analyzedOtherKey) {
        append({ role: "assistant", text: "شروطك الأخرى تغيرت، فتبقى مطابقتها «غير معروف» حتى أعيد قراءة العروض.", source: "computed", targets: [], action: "reanalyze" });
      }
    } catch (e) {
      const err = e as ApiError;
      append({ role: "assistant", text: "", targets: [], failed: { ...payload, message: err.message, code: err.code } });
    } finally {
      setBusy(false);
    }
  }, [append, setState]);

  const retry = useCallback((id: number) => {
    const m = messagesRef.current.find((x) => x.id === id);
    if (!m?.failed) return;
    const { text, event } = m.failed;
    updateMessages((all) => all.filter((x) => x.id !== id));
    runTurn({ text, event });
  }, [runTurn, updateMessages]);

  const send = useCallback((value: string, c: Composer) => {
    const text = value.trim();
    if (!text || busy) return false;
    if (c.kind === "offer" && text.length > limits.offerChars) return false;
    if (c.kind === "reply" && text.length > limits.replyChars) return false;
    append({ role: "user", text, targets: [] });
    setComposer({ kind: "chat" });
    if (c.kind === "offer") runTurn({ text: null, event: { type: "offers", segments: [{ supplierHint: null, text }] } });
    else if (c.kind === "reply") runTurn({ text: null, event: { type: "reply", offerId: c.offerId as "A", text } });
    else runTurn({ text, event: null });
    return true;
  }, [append, busy, runTurn]);

  const resetSessionData = useCallback(() => { setConflicts([]); setProposals([]); setFailed([]); setRfq(null); setChooseReply(null); setPendingSwitch(null); }, []);

  const startOver = useCallback(() => {
    setState(initialState(todayIso()));
    resetSessionData();
    messagesRef.current = greeting();
    setMessages(messagesRef.current);
    setComposer({ kind: "chat" });
  }, [resetSessionData, setState]);

  const confirmSwitch = useCallback(() => {
    if (!pendingSwitch) return;
    const { to, text } = pendingSwitch;
    setState(resetForCategory(stateRef.current, to, !text));
    resetSessionData();
    append({ role: "assistant", text: `بدأت مقارنة جديدة: ${CATEGORIES[to].label}. مسحت مواصفات المنتج السابق وعروضه.`, source: "computed", targets: ["requirements"] });
    if (text) runTurn({ text, event: null });
  }, [append, pendingSwitch, resetSessionData, runTurn, setState]);

  const cancelSwitch = useCallback(() => {
    setPendingSwitch(null);
    append({ role: "assistant", text: "أبقيت المقارنة الحالية كما هي.", source: "computed", targets: [] });
  }, [append]);

  /* ---------- Workspace actions: they change the shared session directly, with no Llama call ---------- */

  const updateOffer = useCallback((o: OfferState) => {
    const s = stateRef.current;
    setState({ ...s, offers: s.offers.map((x) => (x.id === o.id ? o : x)) });
  }, [setState]);

  const offerName = (o: OfferState) => fieldValue<string>(o, "supplierName") || o.label;

  const confirmOffer = useCallback((id: string) => {
    const s = stateRef.current;
    const ids = [...new Set([...s.confirmedOfferIds, id])];
    setState({ ...s, confirmedOfferIds: ids });
    if (s.offers.length >= 2 && s.offers.every((o) => ids.includes(o.id))) {
      if (s.requirements.quantity) runTurn({ text: null, event: { type: "compare" } });
      else append({ role: "assistant", text: "أكدت العروض. حدد الكمية في المتطلبات حتى أقارن بينها.", source: "computed", targets: ["requirements"] });
    }
  }, [append, runTurn, setState]);

  const askWhy = useCallback((id: string) => {
    const o = stateRef.current.offers.find((x) => x.id === id);
    if (!o) return;
    focusAssistant();
    append({ role: "user", text: `لماذا هذا العرض: ${offerName(o)}؟`, targets: [] });
    runTurn({ text: null, event: { type: "why", offerId: id as "A" } });
  }, [append, focusAssistant, runTurn]);

  const manualOffer = useCallback((f: FailedOffer) => {
    const s = stateRef.current;
    const id = (["A", "B", "C"] as const).find((x) => !s.offers.some((o) => o.id === x));
    if (!id) return;
    const offer = newOfferState(id, f.supplierHint || `المورد ${"أبج"["ABC".indexOf(id)]}`, f.text, validateRawOffer(rawOffer({}), `offer:${id}`, f.text, []), tick());
    setState({ ...s, offers: [...s.offers, offer] });
    setFailed((all) => all.filter((x) => x.id !== f.id));
  }, [setState, tick]);

  const retryOffer = useCallback((f: FailedOffer) => {
    setFailed((all) => all.filter((x) => x.id !== f.id));
    runTurn({ text: null, event: { type: "offers", segments: [{ supplierHint: f.supplierHint, text: f.text }] } });
  }, [runTurn]);

  const applyProposal = useCallback((p: ReplyProposal, choices: Record<string, ConflictChoice>, skipped: Set<string>) => {
    const s = stateRef.current;
    const offer = s.offers.find((o) => o.id === p.offerId);
    if (!offer) return;
    const before = currentDecision(s);
    const updated = applyReplyProposal(offer, p, choices, skipped, tick());
    const next = { ...s, offers: s.offers.map((o) => (o.id === updated.id ? updated : o)) };
    setState(next);
    setProposals((all) => all.filter((x) => x.replyId !== p.replyId));
    const after = currentDecision(next);
    const lines = before && after ? explainDecisionChange(before, after, updated.id) : [`طبّقت التغييرات على ${offerName(updated)}. أكّد العروض لأقارن بينها.`];
    append({ role: "assistant", text: lines.join("\n"), source: "computed", targets: ["comparison"], resultKey: after ? decisionFingerprint(after) : undefined });
    goTo("comparison");
    setTab("assistant");
  }, [append, goTo, setState, tick]);

  const setRequirements = useCallback((r: Requirements) => setState({ ...stateRef.current, requirements: r }), [setState]);

  const requirementsEdited = useCallback((before: Requirements) => {
    const now = stateRef.current.requirements;
    const fields = (["quantity", "sizeOz", "use", "material", "wall", "lid", "print", "city", "requiredDate", "budgetSar", "budgetIncludesDelivery", "budgetIncludesVat", "product"] as const).filter((k) => before[k] !== now[k]);
    const specs = [...new Set([...Object.keys(before.specs), ...Object.keys(now.specs)])].filter((k) => before.specs[k] !== now.specs[k]).map((k) => `spec:${k}`);
    const changed = [...fields, ...specs];
    if (!changed.length) return;
    const list = changed.slice(0, 4).map((f) => `${reqLabel(f)}: ${reqValue(f, f.startsWith("spec:") ? now.specs[f.slice(5)] : now[f as keyof Requirements])}`).join("، ");
    append({ role: "assistant", text: `سجلت تعديلك (${list}). حدّثت الحسابات والمتطلبات.`, source: "computed", targets: ["requirements"] });
  }, [append]);

  const offerEdited = useCallback((id: string) => {
    const before = offerEditBefore.current;
    offerEditBefore.current = null;
    const s = stateRef.current;
    const after = currentDecision(s);
    if (!before || !after || decisionFingerprint(before) === decisionFingerprint(after)) return;
    append({ role: "assistant", text: explainDecisionChange(before, after, id).join("\n"), source: "computed", targets: ["comparison"], resultKey: decisionFingerprint(after) });
  }, [append]);

  const resolveConflict = useCallback((c: ConflictItem, adopt: boolean) => {
    setConflicts((all) => all.filter((x) => x.id !== c.id));
    if (!adopt) return;
    const s = stateRef.current;
    const next = { ...s, requirements: setRequirementValue(s.requirements, c.field, c.proposed), scenarioQuantity: c.field === "quantity" ? null : s.scenarioQuantity };
    setState(next);
    if (currentDecision(next)) runTurn({ text: null, event: { type: "compare" } });
    else append({ role: "assistant", text: `اعتمدت ${reqLabel(c.field)}: ${reqValue(c.field, c.proposed)}.`, source: "computed", targets: ["requirements"] });
  }, [append, runTurn, setState]);

  const setScenario = useCallback((q: number | null) => setState({ ...stateRef.current, scenarioQuantity: q }), [setState]);
  const adoptScenario = useCallback(() => {
    const s = stateRef.current;
    if (s.scenarioQuantity == null) return;
    const old = s.requirements.quantity;
    setState({ ...s, requirements: { ...s.requirements, quantity: s.scenarioQuantity }, scenarioQuantity: null });
    append({ role: "assistant", text: `اعتمدت الكمية ${qty(s.scenarioQuantity)} بدل ${qty(old ?? 0)}. حدّثت البطاقات والتوصية.`, source: "computed", targets: ["comparison"] });
  }, [append, setState]);
  const setPriority = useCallback((p: Priority) => setState({ ...stateRef.current, priority: p }), [setState]);
  const setOrderDate = useCallback((d: string) => setState({ ...stateRef.current, orderDate: d }), [setState]);

  const sectionClass = (s: SectionId) => (flash === s ? "rounded-m ring-2 ring-accent transition" : "");
  const q = activeQuantity(state);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <BrandLogo className="h-10 w-auto shrink-0" />
          <div className="hidden min-w-0 md:block">
            <p className="truncate text-sm font-semibold">{brand.tagline}</p>
            <p className="truncate text-xs text-muted">{brand.descriptor}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {mode === "demo" && <span className="hatch rounded-s px-2 py-1 text-xs font-medium text-unknown">وضع تجربة: أمثلة خيالية، ليس Llama مباشر</span>}
          {mode === "live" && <span className="rounded-s bg-accent-soft px-2 py-1 text-xs font-medium text-accent-text">وضع Llama المباشر</span>}
          <Button variant="ghost" className="!min-h-9 !px-2 text-sm" onClick={startOver}>جلسة جديدة</Button>
        </div>
      </header>

      <div role="tablist" aria-label="التبديل بين المساعد والمقارنة" className="grid grid-cols-2 border-b border-line bg-surface lg:hidden">
        {([["assistant", "المساعد"], ["comparison", "المقارنة"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`min-h-11 border-b-2 text-sm ${tab === id ? "border-accent font-semibold text-accent-text" : "border-transparent text-muted"}`}>{label}</button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <ChatPanel
          className={tab === "assistant" ? "flex" : "hidden lg:flex"} mode={mode} messages={messages} busy={busy} composer={composer} onComposer={setComposer} inputRef={composerInput} state={state}
          currentKey={fingerprint} onSend={send} onRetry={retry} onGoTo={goTo} pendingSwitch={pendingSwitch} onConfirmSwitch={confirmSwitch} onCancelSwitch={cancelSwitch}
          chooseReply={chooseReply} onChooseReply={(id) => { const t = chooseReply; setChooseReply(null); if (t) runTurn({ text: null, event: { type: "reply", offerId: id as "A", text: t } }); }}
          onReanalyze={() => runTurn({ text: null, event: { type: "reanalyze" } })}
        />

        <main aria-label="مساحة العمل" className={`${tab === "comparison" ? "block" : "hidden lg:block"} min-w-0 flex-1 overflow-y-auto`}>
          <nav aria-label="أقسام مساحة العمل" className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-line bg-canvas/95 px-3 py-1.5 backdrop-blur [scrollbar-width:none] sm:px-5">
            {SECTIONS.map((s) => <button key={s.id} type="button" onClick={() => goTo(s.id)} className="min-h-9 shrink-0 rounded-s px-2.5 text-sm text-muted transition hover:bg-sunken hover:text-ink">{s.label}</button>)}
          </nav>
          <div className="space-y-4 p-3 sm:p-5">
            <RecommendationBanner state={state} decision={decision} onGo={goTo} />
            <div className={sectionClass("requirements")}>
              <RequirementsSection state={state} conflicts={conflicts} pendingSwitch={pendingSwitch} onRequirements={setRequirements} onEditDone={requirementsEdited} onResolveConflict={resolveConflict}
                onRequestSwitch={(to) => setPendingSwitch({ to, text: null })} onConfirmSwitch={confirmSwitch} onCancelSwitch={cancelSwitch} askAssistant={() => focusAssistant()} />
            </div>
            <div className={sectionClass("offers")}>
              <OffersSection state={state} failed={failed} busy={busy} onOffer={updateOffer} onConfirm={confirmOffer} onWhy={askWhy} onReply={(id) => focusAssistant({ kind: "reply", offerId: id })}
                onEditOpen={() => { offerEditBefore.current = currentDecision(stateRef.current); }} onEditDone={offerEdited} onPaste={() => focusAssistant({ kind: "offer" })} onRetry={retryOffer} onManual={manualOffer} tick={tick} />
            </div>
            <div className={sectionClass("comparison")}><ComparisonSection key={q ?? 0} state={state} decision={decision} onReply={(id) => focusAssistant({ kind: "reply", offerId: id })} /></div>
            <div className={sectionClass("scenarios")}><ScenarioSection state={state} onScenario={setScenario} onAdopt={adoptScenario} onRequirements={setRequirements} onPriority={setPriority} onOrderDate={setOrderDate} /></div>
            <div className={sectionClass("clarify")}>
              <ClarifySection state={state} proposals={proposals} busy={busy} onSendReply={(id, t) => { const o = stateRef.current.offers.find((x) => x.id === id); append({ role: "user", text: `رد ${o ? offerName(o) : ""}: ${t}`, targets: [] }); runTurn({ text: null, event: { type: "reply", offerId: id as "A", text: t } }); }}
                onApply={applyProposal} onCancel={(p) => setProposals((all) => all.filter((x) => x.replyId !== p.replyId))} />
            </div>
            <div className={sectionClass("rfq")}><RfqSection state={state} draft={rfq} busy={busy} onGenerate={(b) => { append({ role: "user", text: "جهّز طلب عرض سعر", targets: [] }); runTurn({ text: null, event: { type: "rfq", includeBudget: b } }); }} onEdit={(m) => setRfq((d) => d && { ...d, message: m })} /></div>
            {mode === "demo" && <Note tone="warn">كل الموردين والأسعار والردود في وضع التجربة مختلقة للتوضيح.</Note>}
            <p className="pb-4 text-xs text-muted"><span dir="ltr">Built with Llama</span> · الأرقام والترتيب تحسبها قواعد التطبيق، ولا أرسل شيئًا للموردين ولا أنفذ طلبات شراء.</p>
          </div>
        </main>
      </div>
    </div>
  );
}
