import { allowedNumbers, deterministicSummary, numbersIn, validateSummary } from "@/domain/explain";
import type { Decision } from "@/domain/decision";
import { validateRawOffer, validateRawRequirements } from "@/domain/evidence";
import type { ClarifyQuestion } from "@/domain/questions";
import { deterministicMessage } from "@/domain/questions";
import { deterministicRfq, rfqFacts, validateRfqDraft } from "@/domain/rfq";
import {
  ComposeSchema, OtherRequirement, RawOffer, RawOfferSchema, RawRequirements, RawRequirementsSchema, Requirements, RfqDraftSchema,
} from "@/domain/schemas";
import { demoOfferFor, demoReplyFor, demoRequirementsFor } from "@/demo/fixtures";
import { completeJson, LlmError, ProviderConfig, readConfig } from "./provider";
import { COMPOSE_SYSTEM, OFFER_SYSTEM, offerUser, REPLY_SYSTEM, replyUser, REQUIREMENTS_SYSTEM, requirementsUser, RFQ_SYSTEM } from "./prompts";

/* One function per AI task. Each returns validated data and says where it came from, so the UI can
   never present a demo fixture as a live model response. */

export type Mode = "live" | "demo";
export const currentMode = (): Mode => (readConfig() ? "live" : "demo");

export class DemoUnavailable extends Error {}

function fromDemo<T>(fixture: T | null): T {
  if (fixture == null) throw new DemoUnavailable();
  return fixture;
}

export async function extractRequirements(text: string, today: string, cfg = readConfig()) {
  const raw: RawRequirements = cfg
    ? await completeJson(cfg, { name: "requirements", system: REQUIREMENTS_SYSTEM, user: requirementsUser(text), schema: RawRequirementsSchema, maxTokens: 1500 })
    : fromDemo(demoRequirementsFor(text));
  return { ...validateRawRequirements(raw, text, today), mode: (cfg ? "live" : "demo") as Mode };
}

export async function extractOffer(offerId: string, text: string, other: OtherRequirement[], cfg = readConfig()) {
  const raw: RawOffer = cfg
    ? await completeJson(cfg, { name: "offer", system: OFFER_SYSTEM, user: offerUser(text, other), schema: RawOfferSchema, maxTokens: 3500 })
    : fromDemo(demoOfferFor(text));
  const validated = validateRawOffer(raw, `offer:${offerId}`, text, other.map((o) => o.id));
  return { validated, mode: (cfg ? "live" : "demo") as Mode };
}

export async function extractReply(text: string, current: Record<string, unknown>, questions: string[], other: OtherRequirement[], cfg = readConfig()) {
  const raw: RawOffer = cfg
    ? await completeJson(cfg, { name: "reply", system: REPLY_SYSTEM, user: replyUser(text, current, questions, other), schema: RawOfferSchema, maxTokens: 3000 })
    : fromDemo(demoReplyFor(text));
  return { raw, mode: (cfg ? "live" : "demo") as Mode };
}

export type DraftSource = "llama" | "template";

export async function draftRfq(req: Requirements, includeBudget: boolean, cfg: ProviderConfig | null = readConfig()) {
  const facts = rfqFacts(req, includeBudget);
  const template = deterministicRfq(facts);
  if (!cfg) return { message: template, source: "template" as DraftSource, reason: "demo" };
  try {
    const { message } = await completeJson(cfg, { name: "rfq", system: RFQ_SYSTEM, user: JSON.stringify(facts), schema: RfqDraftSchema, maxTokens: 900 });
    const issues = validateRfqDraft(message, facts, req.budgetSar);
    if (!issues.length) return { message, source: "llama" as DraftSource, reason: null };
    return { message: template, source: "template" as DraftSource, reason: "validation" };
  } catch (e) {
    if (e instanceof LlmError && e.code === "invalid_model") throw e;
    return { message: template, source: "template" as DraftSource, reason: "provider" };
  }
}

type ComposeInput = { decision: Decision; questions: { offerId: string; label: string; items: ClarifyQuestion[] }[] };

export async function composeNarrative({ decision, questions }: ComposeInput, cfg: ProviderConfig | null = readConfig()) {
  const fallbackMessages = questions.map((q) => ({ offerId: q.offerId, message: deterministicMessage(q.label, q.items), source: "template" as DraftSource }));
  const fallback = { summary: deterministicSummary(decision), summarySource: "template" as DraftSource, messages: fallbackMessages };
  if (!cfg) return fallback;
  try {
    const facts = {
      priority: decision.priority,
      verdict: decision.verdict,
      offers: decision.evaluations.map((e) => ({
        id: e.offerId, name: e.label, category: e.category, rank: e.rank,
        checks: e.checks.map((c) => ({ label: c.label, status: c.status, required: c.required, offered: c.offered })),
        purchaseQty: e.cost.purchaseQty, excess: e.cost.excess,
        totalSar: e.cost.totalHalalas == null ? null : e.cost.totalHalalas / 100,
        unitSar: e.cost.comparableUnitSar, missingCost: e.cost.missing, budget: e.budget.status, delivery: e.delivery,
      })),
      questions: questions.map((q) => ({ offerId: q.offerId, supplier: q.label, ask: q.items.map((i) => i.text) })),
    };
    const out = await completeJson(cfg, { name: "compose", system: COMPOSE_SYSTEM, user: JSON.stringify(facts), schema: ComposeSchema, maxTokens: 1500 });
    const allowed = allowedNumbers(decision);
    const summaryOk = validateSummary(out.summary, decision);
    const messages = fallbackMessages.map((f) => {
      const drafted = out.messages.find((m) => m.offerId === f.offerId)?.message;
      if (!drafted || drafted.length > 1200) return f;
      const q = questions.find((x) => x.offerId === f.offerId)!;
      const ok = new Set([...allowed, ...q.items.flatMap((i) => numbersIn(i.text))]);
      for (let i = 1; i <= 15; i++) ok.add(String(i));
      return numbersIn(drafted).every((n) => ok.has(n)) ? { ...f, message: drafted, source: "llama" as DraftSource } : f;
    });
    return { summary: summaryOk ? out.summary : fallback.summary, summarySource: (summaryOk ? "llama" : "template") as DraftSource, messages };
  } catch (e) {
    if (e instanceof LlmError && e.code === "invalid_model") throw e;
    return fallback;
  }
}
