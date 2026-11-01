import { CATEGORIES, SUPPORTED_LABELS, unitFor } from "@/domain/categories";
import { analyzeDiscount, DiscountAnalysis } from "@/domain/discount";
import { Decision } from "@/domain/decision";
import { locateQuote, newOfferState, numberSupported, validateRawRequirements } from "@/domain/evidence";
import { allowedNumbers, deterministicSummary, missingText, numbersIn, qty, reasonText, sar, validateSummary, whyOffer } from "@/domain/explain";
import { fieldValue, OfferState, pushVersion, resolveOffer } from "@/domain/offer-state";
import { buildReplyProposal } from "@/domain/replies";
import { rfqGaps } from "@/domain/rfq";
import { rawRequirements } from "@/demo/build";
import { demoPlanFor } from "@/demo/chat-script";
import { completeJson, LlmError, ProviderConfig } from "@/llm/provider";
import { DemoUnavailable, draftRfq, extractOffer, extractReply } from "@/llm/service";
import { PLAN_SYSTEM, planUser, RESPOND_SYSTEM } from "./prompts";
import { activeQuantity, confirmedOffers, currentDecision, knownFields, mergeRequirements, missingFields, otherKey, questionFor, stateForPrompt } from "./state";
import { Block, ChatReplySchema, ConversationState, ReplySource, TurnPlan, TurnPlanSchema, TurnRequest, TurnResponse } from "./types";

const HISTORY_TURNS = 12;
const HISTORY_CHARS = 1200;
const IDS = ["A", "B", "C"] as const;

const errorMessage = (e: unknown) => {
  if (e instanceof DemoUnavailable) return "وضع التجربة يقرأ نصوص المثال الخيالي فقط.";
  if (e instanceof LlmError && e.code === "timeout") return "تأخر رد التحليل.";
  return "تعذر تحليل هذا النص.";
};

/* ---------- Deterministic wording, also the fallback whenever a model reply fails its checks ---------- */

export function nextQuestions(state: Pick<ConversationState, "requirements" | "waived">): string {
  const open = missingFields(state).slice(0, 2);
  if (!open.length) return "اكتملت متطلباتك. يمكنني تجهيز طلب عرض سعر، أو ألصق عروض الموردين هنا.";
  return open.map(questionFor).join(" ");
}

export function discountText(analyses: DiscountAnalysis[], label: (id: string) => string): string {
  const applicable = analyses.filter((a) => a.applicable);
  if (!applicable.length) return "لا يذكر أي عرض مؤكد خصم كمية صريحًا.";
  return applicable.map((a) => {
    const tier = a.scenarios.find((s) => !s.isBaseline);
    const name = label(a.offerId);
    switch (a.conclusion) {
      case "ambiguous": return `خصم ${name} غير واضح، فلا يمكن الحكم عليه قبل توضيحه.`;
      case "incomplete": return `لا يمكن حساب خصم ${name} لأن بعض المبالغ غير معروفة.`;
      case "no_larger_option": return `كميتك تصل بالفعل إلى أعلى شريحة خصم في ${name}.`;
      case "no_unit_benefit": return `لا تقل تكلفة الوحدة في الشريحة الأعلى عند ${name}.`;
      case "lower_unit_lower_payment": return `عند ${name}، الكمية الأكبر أقل في الدفعة بمقدار ${sar(-tier!.extraPaymentHalalas!)} وفي تكلفة الوحدة.`;
      case "lower_unit_higher_payment": return `عند ${name}، تنخفض تكلفة الوحدة ${tier!.unitReductionSar} ريال، لكن دفعتك الآن تزيد ${sar(tier!.extraPaymentHalalas!)}. هذا مبلغ إضافي تدفعه اليوم وليس توفيرًا فوريًا.`;
      default: return "";
    }
  }).filter(Boolean).join(" ");
}

function decisionFacts(d: Decision) {
  return {
    priority: d.priority,
    verdict: d.verdict,
    offers: d.evaluations.map((e) => ({
      id: e.offerId, name: e.label, category: e.category, rank: e.rank,
      checks: e.checks.map((c) => ({ label: c.label, status: c.status, required: c.required, offered: c.offered })),
      purchaseQty: e.cost.purchaseQty, excess: e.cost.excess,
      totalSar: e.cost.totalHalalas == null ? null : e.cost.totalHalalas / 100,
      knownSubtotalSar: e.cost.knownSubtotalHalalas == null ? null : e.cost.knownSubtotalHalalas / 100,
      comparableUnitSar: e.cost.comparableUnitSar, missingCost: e.cost.missing.map(missingText), whyNotEligible: e.failReasons.map((r) => reasonText(r, e)), stillOpen: e.blockers.filter((b) => b !== "cost").map((r) => reasonText(r, e)),
      budget: e.budget.status, delivery: e.delivery,
    })),
  };
}

function discountFacts(analyses: DiscountAnalysis[]) {
  return analyses.filter((a) => a.applicable).map((a) => ({
    offerId: a.offerId, conclusion: a.conclusion, ambiguous: a.ambiguousReasons,
    scenarios: a.scenarios.map((s) => ({
      label: s.label, purchaseQty: s.cost.purchaseQty, excess: s.cost.excess,
      totalSar: s.cost.totalHalalas == null ? null : s.cost.totalHalalas / 100,
      comparableUnitSar: s.cost.comparableUnitSar,
      extraPaymentNowSar: s.extraPaymentHalalas == null ? null : s.extraPaymentHalalas / 100,
      unitReductionSar: s.unitReductionSar,
    })),
  }));
}

function discountNumbers(analyses: DiscountAnalysis[]): string[] {
  return analyses.flatMap((a) => a.scenarios.flatMap((s) => [
    s.cost.purchaseQty, s.cost.excess, s.orderQty, s.cost.comparableUnitSar, s.unitReductionSar, s.unitReductionPercent,
    s.cost.totalHalalas == null ? null : s.cost.totalHalalas / 100, s.extraPaymentHalalas == null ? null : Math.abs(s.extraPaymentHalalas) / 100,
  ])).filter((n) => n != null).map((n) => String(Number(n)));
}

/** Checks a first-pass reply: nothing it asks may be known already, and it may only repeat numbers it was given. */
export function validatePlanReply(reply: string, asks: string[], state: ConversationState, userText: string): boolean {
  if (!reply.trim() || reply.length > 700) return false;
  const known = new Set<string>([...knownFields(state), ...state.waived]);
  if (asks.some((f) => known.has(f))) return false;
  // It may ask anything open that belongs to this product, but not another product's fields.
  const category0 = state.requirements.category;
  const own = new Set([...missingFields(state), ...(category0 ? CATEGORIES[category0].native : []), ...(category0 ? CATEGORIES[category0].specs.map((s) => `spec:${s.key}`) : [])]);
  if (asks.some((f) => !own.has(f))) return false;
  // Cup wording has no place in a conversation about another product.
  const category = state.requirements.category;
  if (category && category !== "cups" && category !== "lids" && /أونص|الكوب|أكواب/.test(reply)) return false;
  const allowed = new Set([...numbersIn(userText), ...numbersIn(JSON.stringify(stateForPrompt(state)))]);
  return numbersIn(reply).every((n) => allowed.has(n));
}

/* ---------- One conversational turn ---------- */

export async function runTurn(req: TurnRequest, cfg: ProviderConfig | null): Promise<TurnResponse> {
  const mode = cfg ? "live" as const : "demo" as const;
  const llmSource: ReplySource = cfg ? "llama" : "demo";
  const blocks: Block[] = [];
  const patch: TurnResponse["patch"] = {};
  let state: ConversationState = req.state;
  const notes: string[] = [];

  let plan: TurnPlan | null = null;
  let segments: { supplierHint: string | null; text: string }[] = [];
  let supplierReply: { offerId: string | null; text: string } | null = null;
  let rfq: { includeBudget: boolean } | null = null;
  let compare = false, explain = false, discount = false, reanalyze = false;
  let focusOfferId: string | null = null;
  let whatIf: number | null = null;

  /* 1. Understand: Llama reads the message, or a button already said what is wanted. */
  if (req.text != null) {
    const context = { state: stateForPrompt(state), history: req.history.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, text: m.text.slice(0, HISTORY_CHARS) })), text: req.text };
    plan = cfg
      ? await completeJson(cfg, { name: "chat_plan", system: PLAN_SYSTEM, user: planUser(context), schema: TurnPlanSchema, maxTokens: 1800 })
      : demoPlanFor(req.text);
    if (!plan) throw new DemoUnavailable();

    if (plan.unsupportedProduct) {
      return { mode, replySource: "computed", blocks: [], patch: {}, reply: `لا أقارن «${plan.unsupportedProduct.slice(0, 60)}» حاليًا، لأن النتيجة لن تكون موثوقة. أدعم: ${SUPPORTED_LABELS}.` };
    }

    // Supplier text is untrusted. A message carrying an offer or reply cannot change what the buyer requires,
    // and a what-if question never proposes changing the confirmed quantity.
    if (plan.offers.length || plan.supplierReply) plan = { ...plan, requirementUpdates: rawRequirements({}), generateRfq: null, showComparison: false, explainDecision: false, whatIfQuantity: null, showDiscount: false };
    if (plan.whatIfQuantity != null) plan = { ...plan, requirementUpdates: { ...plan.requirementUpdates, quantity: { value: null, quote: null } } };

    /* 2. Validate the plan against what the user actually wrote. */
    const current = state.requirements.category;
    const asked = validateRawRequirements(plan.requirementUpdates, req.text, req.today).requirements.category;
    if (current && asked && asked !== current) {
      // Nothing changes until the user confirms replacing the current comparison.
      return {
        mode, replySource: "computed", patch: {},
        reply: `طلبك الحالي عن ${CATEGORIES[current].label}. هل تريد استبدال هذه المقارنة بمقارنة ${CATEGORIES[asked].label}؟ سأمسح المواصفات والعروض الحالية.`,
        blocks: [{ type: "switch_category", id: `switch-${Date.now()}`, from: current, to: asked, text: req.text, status: "open" }],
      };
    }
    const validated = validateRawRequirements(plan.requirementUpdates, req.text, req.today, current);
    const merged = mergeRequirements(state.requirements, state.reqEvidence, validated.requirements, validated.evidence, validated.specEvidence);
    state = { ...state, requirements: merged.next, reqEvidence: merged.nextEvidence };
    if (merged.filled.length || merged.next.other.length !== req.state.requirements.other.length) {
      patch.requirements = merged.next;
      patch.reqEvidence = merged.nextEvidence;
      blocks.push({ type: "requirements" });
    }
    merged.conflicts.forEach((c, i) => {
      blocks.push({ type: "req_conflict", id: `${c.field}-${Date.now()}-${i}`, field: c.field, current: c.current, proposed: c.proposed, quote: c.quote, status: "open" });
    });

    if (plan.waived.length) {
      state = { ...state, waived: [...new Set([...state.waived, ...plan.waived])] };
      patch.waived = state.waived;
    }
    if (plan.setPriority && plan.setPriority !== state.priority) {
      state = { ...state, priority: plan.setPriority };
      patch.priority = plan.setPriority;
      compare = true;
    }

    for (const seg of plan.offers) {
      // Offer text must be the user's own words, copied exactly, or it is not treated as an offer.
      const loc = locateQuote(req.text, seg.text);
      if (loc) segments.push({ supplierHint: seg.supplierHint, text: req.text.slice(loc.start, loc.end) });
      else notes.push("لم أتمكن من تحديد نص أحد العروض بدقة. استخدم زر «ألصق عرض مورد» والصقه وحده.");
    }
    if (plan.supplierReply) {
      const loc = locateQuote(req.text, plan.supplierReply.text);
      if (loc) supplierReply = { offerId: plan.supplierReply.offerId, text: req.text.slice(loc.start, loc.end) };
      else notes.push("لم أتمكن من تحديد نص رد المورد بدقة. استخدم زر «أضف رد المورد» في بطاقة العرض.");
    }
    // Drafting is only accepted when the message itself mentions a quotation request.
    rfq = plan.generateRfq && /عرض سعر|عرض السعر|طلب عرض|تسعير|quot|rfq/i.test(req.text) ? plan.generateRfq : null;
    compare ||= plan.showComparison;
    explain = plan.explainDecision;
    discount = plan.showDiscount;
    if (plan.whatIfQuantity != null) {
      if (Number.isInteger(plan.whatIfQuantity) && plan.whatIfQuantity > 0 && numberSupported(req.text, plan.whatIfQuantity)) whatIf = plan.whatIfQuantity;
      else notes.push("لم أتأكد من الكمية التي تقصدها. اكتبها بالأرقام.");
    }
    if (merged.filled.some((f) => f === "quantity" || f === "budgetSar" || f === "requiredDate") && confirmedOffers(state).length >= 2) compare = true;
  } else if (req.event) {
    const e = req.event;
    if (e.type === "compare") compare = true;
    if (e.type === "why") { explain = true; focusOfferId = e.offerId; }
    if (e.type === "rfq") rfq = { includeBudget: e.includeBudget };
    if (e.type === "discount") discount = true;
    if (e.type === "reanalyze") reanalyze = true;
    if (e.type === "offers") segments = e.segments;
    if (e.type === "reply") supplierReply = { offerId: e.offerId, text: e.text };
  }

  /* 3. Execute with existing services and the deterministic engine. */
  let codeReply: string | null = null;

  if (segments.length) {
    const free = IDS.filter((id) => !state.offers.some((o) => o.id === id));
    const accepted = segments.slice(0, free.length);
    if (accepted.length < segments.length) notes.push("أقارن ثلاثة عروض كحد أقصى، فلم أضف الباقي.");
    const results = await Promise.allSettled(accepted.map((seg, i) => extractOffer(free[i], seg.text, state.requirements.other, cfg, state.requirements.category)));
    const added: OfferState[] = [];
    const rejected = { ...state.rejected };
    results.forEach((r, i) => {
      const id = free[i];
      const seg = accepted[i];
      if (r.status === "fulfilled") {
        let offer = newOfferState(id, seg.supplierHint || `المورد ${"أبج"[IDS.indexOf(id)]}`, seg.text, r.value.validated, Date.now());
        if (seg.supplierHint && !fieldValue(offer, "supplierName")) offer = pushVersion(offer, "supplierName", { value: seg.supplierHint, source: "user", evidence: null, flag: null, at: Date.now() });
        added.push(offer);
        rejected[id] = r.value.validated.rejected;
        blocks.push({ type: "offer", offerId: id });
      } else {
        blocks.push({ type: "offer_failed", id: `${id}-${Date.now()}`, text: seg.text, supplierHint: seg.supplierHint, message: errorMessage(r.reason) });
      }
    });
    if (added.length) {
      state = { ...state, offers: [...state.offers, ...added], rejected, analyzedOtherKey: otherKey(state.requirements) };
      patch.offers = state.offers;
      patch.rejected = rejected;
      patch.analyzedOtherKey = state.analyzedOtherKey;
      codeReply = "قرأت العروض وأضفتها إلى قسم «عروض الموردين». راجعها وأكّدها، فلا أقارن إلا ما تؤكده.";
    } else codeReply = "تعذرت قراءة العروض. يمكنك إعادة المحاولة أو إدخالها يدويًا من البطاقة.";
  }

  if (reanalyze) {
    const updated = await Promise.all(state.offers.map(async (o) => {
      const r = await extractOffer(o.id, o.sources[0].text, state.requirements.other, cfg, state.requirements.category);
      let next = o;
      // Only requirement matches refresh; the user's corrections and earlier evidence stay.
      for (const [k, v] of Object.entries(r.validated.fields)) if (k.startsWith("other:")) next = pushVersion(next, k, { ...v, source: "offer", at: Date.now() });
      return next;
    }));
    state = { ...state, offers: updated, analyzedOtherKey: otherKey(state.requirements) };
    patch.offers = updated;
    patch.analyzedOtherKey = state.analyzedOtherKey;
    compare = true;
  }

  if (supplierReply) {
    const target = state.offers.find((o) => o.id === supplierReply!.offerId);
    if (!target) {
      blocks.push({ type: "choose_offer", text: supplierReply.text });
      codeReply = state.offers.length ? "هذا الرد من أي مورد؟ اختره ليُطبّق على عرضه فقط." : "لا يوجد عرض بعد لربط هذا الرد به. ألصق العرض أولًا.";
    } else {
      const context = Object.fromEntries(Object.keys(target.fields).map((k) => [k, fieldValue(target, k)]).filter(([, v]) => v != null));
      const r = await extractReply(supplierReply.text, context, [], state.requirements.other, cfg, state.requirements.category);
      const n = target.sources.filter((s) => s.kind === "reply").length + 1;
      const proposal = buildReplyProposal(target, r.raw, `reply:${target.id}:${n}`, supplierReply.text, state.requirements.other.map((o) => o.id), state.requirements.category);
      blocks.push({ type: "proposal", proposal, status: "open" });
      codeReply = proposal.changes.length
        ? "جهزت التغييرات المقترحة في قسم «توضيح الموردين». لم أطبق شيئًا بعد، راجعها وأكّدها."
        : "لم أجد في هذا الرد معلومة واضحة يمكن إضافتها، فتبقى البيانات كما هي.";
    }
  }

  if (rfq) {
    const gaps = rfqGaps(state.requirements);
    if (gaps.some((g) => g.blocking)) {
      codeReply = `قبل تجهيز طلب عرض السعر أحتاج: ${gaps.filter((g) => g.blocking).map((g) => g.question).join(" ")}`;
      if (!blocks.some((b) => b.type === "requirements")) blocks.push({ type: "requirements" });
    } else {
      const draft = await draftRfq(state.requirements, rfq.includeBudget, cfg);
      blocks.push({ type: "rfq", message: draft.message, source: draft.source, reason: draft.reason, includeBudget: rfq.includeBudget });
      const open = gaps.map((g) => g.question).slice(0, 2).join(" ");
      codeReply = `جهزت طلب عرض السعر في قسمه. راجعه وانسخه وأرسله بنفسك؛ لا أرسل شيئًا.${open ? ` لم تحدد بعد ما يلي فلن يُذكر: ${open}` : ""}`;
    }
  }

  /* 4. Computed answers: the engine decides, Llama only explains, and its text is verified. */
  const wantsDecision = !supplierReply && (compare || explain || whatIf != null || discount);
  let computedFallback: string | null = null;
  let factsForModel: unknown = null;
  let decisionForCheck: Decision | null = null;
  const extraAllowed = new Set<string>();

  if (wantsDecision) {
    const confirmed = confirmedOffers(state);
    const label = (id: string) => { const o = state.offers.find((x) => x.id === id); return (o && fieldValue<string>(o, "supplierName")) || o?.label || id; };
    if (!state.requirements.quantity) {
      computedFallback = `أحتاج الكمية أولًا. ${questionFor("quantity")}`;
    } else if (confirmed.length < 2) {
      const pending = state.offers.length - confirmed.length;
      computedFallback = pending ? "أكّد بطاقات العروض أولًا؛ أقارن عرضين مؤكدين على الأقل." : "ألصق عرضين على الأقل لأقارن بينهما.";
    } else {
      const baseQty = state.requirements.quantity;
      const quantity = whatIf ?? activeQuantity(state) ?? baseQty;
      const baseline = currentDecision(state, baseQty)!;
      if (whatIf != null) {
        state = { ...state, scenarioQuantity: whatIf === baseQty ? null : whatIf };
        patch.scenarioQuantity = state.scenarioQuantity;
      }
      const decision = currentDecision(state, quantity)!;
      const reqForCalc = { ...state.requirements, quantity };
      const analyses = confirmed.map((o) => analyzeDiscount(resolveOffer(o), reqForCalc, { currentStock: null, dailyUse: null, maxCoverageDays: null }));
      if (compare || whatIf != null) blocks.push({ type: "comparison", decision, quantity, baselineQuantity: baseQty });
      if (discount || (whatIf != null && analyses.some((a) => a.applicable))) blocks.push({ type: "discount", quantity });

      const parts: string[] = [];
      if (whatIf != null) parts.push(`عرضت النتائج على كمية ${qty(whatIf)} ${unitFor(state.requirements.category)} كسيناريو، وطلبك المعتمد ما زال ${qty(baseQty)}.`);
      parts.push(deterministicSummary(decision));
      if (focusOfferId) {
        const e = decision.evaluations.find((x) => x.offerId === focusOfferId);
        if (e) parts.unshift(whyOffer(e));
      }
      if (whatIf != null) {
        const totals = decision.evaluations.filter((e) => e.cost.totalHalalas != null).map((e) => `${e.label} ${sar(e.cost.totalHalalas!)}`);
        if (totals.length) parts.push(`الدفعة بهذه الكمية: ${totals.join("، ")}.`);
      }
      if (discount) parts.push(discountText(analyses, label));
      computedFallback = parts.join(" ");
      factsForModel = { focusOffer: focusOfferId, whatIfQuantity: whatIf, currentQuantity: baseQty, result: decisionFacts(decision), ...(whatIf != null ? { resultAtCurrentQuantity: decisionFacts(baseline) } : {}), discount: discountFacts(analyses), userAsked: req.text };
      decisionForCheck = decision;
      allowedNumbers(baseline).forEach((n) => extraAllowed.add(n));
      discountNumbers(analyses).forEach((n) => extraAllowed.add(n));
      if (req.text) numbersIn(req.text).forEach((n) => extraAllowed.add(n));
    }
  }

  /* 5. Choose the words. A model reply is only used when it passes its checks. */
  let reply: string;
  let replySource: ReplySource = "computed";

  if (computedFallback != null) {
    reply = computedFallback;
    if (cfg && factsForModel && decisionForCheck) {
      try {
        const out = await completeJson(cfg, { name: "chat_reply", system: RESPOND_SYSTEM, user: JSON.stringify(factsForModel), schema: ChatReplySchema, maxTokens: 500 });
        if (validateSummary(out.reply, decisionForCheck, extraAllowed)) { reply = out.reply; replySource = "llama"; }
      } catch (e) {
        if (e instanceof LlmError && e.code === "invalid_model") throw e;
      }
    }
    if (codeReply) reply = `${codeReply} ${reply}`;
  } else if (codeReply) {
    reply = codeReply;
  } else if (plan && validatePlanReply(plan.reply, plan.asks, state, req.text ?? "")) {
    reply = plan.reply;
    replySource = llmSource;
  } else {
    reply = nextQuestions(state);
  }
  if (notes.length) reply = `${reply}\n${notes.join("\n")}`;
  if (patch.requirements && otherKey(state.requirements) !== state.analyzedOtherKey && state.offers.length) blocks.push({ type: "reanalyze" });

  return { mode, reply, replySource, blocks, patch };
}
