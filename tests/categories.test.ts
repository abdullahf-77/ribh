import { describe, expect, it, vi, afterEach } from "vitest";
import { applicableFields, currentDecision, initialState, missingFields, resetForCategory } from "@/chat/state";
import { runTurn, validatePlanReply } from "@/chat/turn";
import type { ConversationState, TurnPlan, TurnResponse } from "@/chat/types";
import { rawOffer, rawRequirements, v } from "@/demo/build";
import { demoPaths, demoPlanFor, unsupportedExample } from "@/demo/chat-script";
import { CATEGORIES, CATEGORY_IDS, coerceSpec, compareSpec, specDef, specSchema } from "@/domain/categories";
import { decide, evaluateOffer } from "@/domain/decision";
import { newOfferState, validateRawOffer, validateRawRequirements } from "@/domain/evidence";
import { resolveOffer } from "@/domain/offer-state";
import { applyReplyProposal, buildReplyProposal } from "@/domain/replies";
import { deterministicRfq, rfqFacts, rfqGaps, validateRfqDraft } from "@/domain/rfq";
import { emptyRequirements } from "@/domain/schemas";
import { fieldsFor } from "@/lib/fields";
import type { ProviderConfig } from "@/llm/provider";
import { offer, req, TODAY } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const plan = (p: Partial<TurnPlan>): TurnPlan => ({
  reply: "", asks: [], requirementUpdates: rawRequirements({}), waived: [], unsupportedProduct: null, offers: [], supplierReply: null, generateRfq: null,
  showComparison: false, explainDecision: false, whatIfQuantity: null, setPriority: null, showDiscount: false, ...p,
});
const cfg: ProviderConfig = { apiKey: "t", baseUrl: "http://llm.test/v1", model: "meta-llama/llama-4-maverick", timeoutMs: 200, maxAttempts: 1 };
function host(responses: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (_: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content: JSON.stringify(responses[body.response_format.json_schema.name]) } }] }));
  }));
}
function apply(s: ConversationState, r: TurnResponse): ConversationState {
  const p = r.patch;
  return { ...s, ...(p.requirements && { requirements: p.requirements }), ...(p.reqEvidence && { reqEvidence: p.reqEvidence }), ...(p.offers && { offers: p.offers }), ...(p.rejected && { rejected: p.rejected }), ...(p.scenarioQuantity !== undefined && { scenarioQuantity: p.scenarioQuantity }) };
}
const say = (text: string, state: ConversationState, c: ProviderConfig | null = null) => runTurn({ text, event: null, history: [], state, today: TODAY }, c);

describe("category schemas", () => {
  it("accepts only each category's own keys and valid values", () => {
    expect(specSchema("napkins").safeParse({ ply: 2, napkinSize: "33×33" }).success).toBe(true);
    expect(specSchema("napkins").safeParse({ lidType: "sip" }).success).toBe(false);
    expect(specSchema("napkins").safeParse({ ply: "طبقتين" }).success).toBe(false);
    expect(specSchema("lids").safeParse({ lidType: "sip" }).success).toBe(true);
    expect(specSchema("lids").safeParse({ lidType: "hat" }).success).toBe(false);
    expect(specSchema("cups").safeParse({ ply: 2 }).success).toBe(false);
  });
  it("coerces Arabic numerals and refuses invalid values", () => {
    expect(coerceSpec(specDef("capacityMl")!, "٧٥٠")).toBe(750);
    expect(coerceSpec(specDef("capacityMl")!, "كبيرة")).toBeNull();
    expect(coerceSpec(specDef("lidType")!, "hat")).toBeNull();
  });
  it("compares sizes by number and leaves free words undecided", () => {
    const d = specDef("napkinSize")!;
    expect(compareSpec(d, "33×33", "٣٣ x ٣٣ سم")).toBe("meets");
    expect(compareSpec(d, "33×33", "40×40")).toBe("not");
    expect(compareSpec(d, "33×33", null)).toBe("unknown");
    expect(compareSpec(specDef("color")!, "أبيض", "سكري")).toBe("unknown");
  });
});

describe("category-specific questions", () => {
  it("never asks about cup size or lids for other products", () => {
    for (const c of ["bags", "napkins"] as const) {
      const fields = applicableFields(c);
      expect(fields).not.toContain("sizeOz");
      expect(fields).not.toContain("lid");
    }
    expect(applicableFields("takeaway")).not.toContain("sizeOz");
    expect(applicableFields("cups")).toContain("sizeOz");
  });
  it("asks each category for its own decisive specs", () => {
    const expected = { lids: ["spec:fitsCupOz", "spec:lidType"], bags: ["spec:bagDimensions", "spec:handles", "print"], napkins: ["spec:ply", "spec:napkinSize"], takeaway: ["spec:containerType", "spec:capacityMl", "lid"], cups: ["sizeOz", "use"] } as const;
    for (const c of CATEGORY_IDS) {
      const missing = missingFields({ requirements: { ...emptyRequirements(), category: c }, waived: [] });
      for (const f of expected[c]) expect(missing, `${c} ${f}`).toContain(f);
    }
  });
  it("asks for the category first when unknown", () => {
    expect(missingFields({ requirements: emptyRequirements(), waived: [] })[0]).toBe("category");
  });
  it("rejects a model reply with cup wording for napkins or another category's field", () => {
    const s = { ...initialState(TODAY), requirements: { ...emptyRequirements(), category: "napkins" as const } };
    expect(validatePlanReply("كم مقاس الكوب بالأونصة؟", [], s, "")).toBe(false);
    expect(validatePlanReply("كم مقاس الكوب؟", ["sizeOz"], s, "")).toBe(false);
    expect(validatePlanReply("كم طبقة تريد؟", ["spec:ply"], s, "")).toBe(true);
  });
  it("gives the review form only relevant fields", () => {
    const keys = fieldsFor("napkins").map((f) => f.key);
    expect(keys).toContain("spec:ply");
    expect(keys).not.toContain("cupSizeOz");
    expect(keys).not.toContain("lids");
    expect(keys).toContain("priceAmount");
    expect(fieldsFor("takeaway").map((f) => f.key)).toContain("lids");
  });
});

describe("extraction per category", () => {
  it("drops specs and fields belonging to another product", () => {
    const text = "منديل طبقتين، غطاء مسطح، ٨ أونصات";
    const raw = rawOffer({ cupSizeOz: v(8, "٨ أونصات"), lids: v("included", "غطاء مسطح"), specs: [{ key: "ply", value: "2", quote: "طبقتين" }, { key: "lidType", value: "flat", quote: "غطاء مسطح" }] });
    const out = validateRawOffer(raw, "offer:A", text, [], "napkins");
    expect(out.fields["spec:ply"].value).toBe(2);
    expect(out.fields["spec:lidType"]).toBeUndefined();
    expect(out.fields.cupSizeOz.value).toBeNull();
    expect(out.fields.lids.value).toBeNull();
    expect(out.rejected.map((r) => r.field)).toContain("spec:lidType");
  });
  it("rejects a spec whose quote is not in the text", () => {
    const out = validateRawOffer(rawOffer({ specs: [{ key: "ply", value: "3", quote: "ثلاث طبقات" }] }), "offer:A", "منديل طبقتين", [], "napkins");
    expect(out.fields["spec:ply"].value).toBeNull();
    expect(out.rejected[0].field).toBe("spec:ply");
  });
  it("clears cup fields from requirements of another category", () => {
    const text = "أبي مناديل مقاس ٨ أونصات";
    const out = validateRawRequirements(rawRequirements({ category: v("napkins", "مناديل"), sizeOz: v(8, "٨ أونصات") }), text, TODAY);
    expect(out.requirements.sizeOz).toBeNull();
  });
});

describe("compatibility and ranking per category", () => {
  it("fails an offer for a different product even when cheaper", () => {
    const r = req({ category: "napkins", sizeOz: null, use: null, quantity: 1000 });
    const e = evaluateOffer(offer({ productCategory: "cups", cupSizeOz: 8 }), r, TODAY);
    expect(e.category).toBe("fail");
    expect(e.failReasons).toContain("spec:category");
  });
  it("checks specs with meets, not and unknown", () => {
    const r = req({ category: "takeaway", sizeOz: null, use: null, specs: { capacityMl: 750 } });
    const at = (capacityMl?: number) => evaluateOffer(offer({ specs: capacityMl ? { capacityMl } : {} }), r, TODAY).category;
    expect(at(750)).toBe("confirmed");
    expect(at(500)).toBe("fail");
    expect(at()).toBe("clarify");
  });
  it("refuses to rank offers with different stated specs when the buyer set none", () => {
    const r = req({ category: "napkins", sizeOz: null, use: null, quantity: 1000 });
    const d = decide([offer({ id: "A", specs: { ply: 2 } }), offer({ id: "B", specs: { ply: 1 } })], r, TODAY, "cash");
    expect(d.verdict.kind).toBe("not_comparable");
  });
  it("uses the same money engine for every category", () => {
    const r = req({ category: "bags", sizeOz: null, use: null, quantity: 2500 });
    const e = evaluateOffer(offer({ priceBasis: "per_package", priceAmount: 100, packageLevels: [{ label: "كرتون", count: 1000 }] }), r, TODAY);
    expect(e.cost.purchaseQty).toBe(3000);
    expect(e.cost.excess).toBe(500);
    expect(e.cost.totalHalalas).toBe(30000);
  });
});

describe("RFQ per category", () => {
  it("uses the product's unit and specs, with no cup fields", () => {
    const r = { ...emptyRequirements(), category: "napkins" as const, product: "مناديل", quantity: 10000, specs: { ply: 2, napkinSize: "33×33" } };
    expect(rfqGaps(r).some((g) => g.blocking)).toBe(false);
    const f = rfqFacts(r, false);
    const t = deterministicRfq(f);
    expect(t).toContain("10,000 منديل");
    expect(t).toContain("عدد الطبقات: 2");
    expect(t).not.toContain("أونص");
    expect(t).not.toContain("كوب");
    expect(validateRfqDraft(t, f, null)).toEqual([]);
    expect(validateRfqDraft(t.replace("عدد الطبقات: 2", ""), f, null)).toContain("missing_size");
  });
  it("does not require a cup size for other products", () => {
    expect(rfqGaps({ ...emptyRequirements(), category: "bags", product: "أكياس", quantity: 100 }).find((g) => g.field === "sizeOz")).toBeUndefined();
    expect(rfqGaps({ ...emptyRequirements(), category: "cups", product: "أكواب", quantity: 100 }).find((g) => g.field === "sizeOz")?.blocking).toBe(true);
  });
});

describe("unsupported products", () => {
  it("explains clearly and changes nothing", async () => {
    const s = initialState(TODAY);
    const r = await say(unsupportedExample, s);
    expect(r.reply).toContain("لا أقارن");
    expect(r.reply).toContain(CATEGORIES.napkins.label);
    expect(r.patch).toEqual({});
    expect(r.replySource).toBe("computed");
  });
  it("ignores everything else the model returned", async () => {
    host({ chat_plan: plan({ unsupportedProduct: "شاي", offers: [{ supplierHint: null, text: "عرض شاي" }] }) });
    const r = await say("عرض شاي", initialState(TODAY), cfg);
    expect(r.patch.offers).toBeUndefined();
  });
});

describe("switching categories", () => {
  const cups: ConversationState = {
    ...initialState(TODAY),
    requirements: { ...emptyRequirements(), category: "cups", product: "أكواب", quantity: 3000, sizeOz: 8, use: "hot", lid: "required", city: "الرياض", budgetSar: 1500 },
    offers: [newOfferState("A", "A", "عرض", validateRawOffer(rawOffer({ cupSizeOz: v(8, "عرض") }), "offer:A", "عرض", []), 1)],
    confirmedOfferIds: ["A"], scenarioQuantity: 5000,
  };

  it("asks first and changes nothing", async () => {
    host({ chat_plan: plan({ requirementUpdates: rawRequirements({ category: v("napkins", "مناديل"), quantity: v(100, "١٠٠ منديل") }) }) });
    const r = await say("أبي ١٠٠ منديل مناديل", cups, cfg);
    expect(r.patch).toEqual({});
    expect(r.blocks[0]).toMatchObject({ type: "switch_category", from: "cups", to: "napkins", status: "open" });
  });

  it("leaks no previous specs or offers after confirming", () => {
    const s = resetForCategory(cups, "napkins");
    expect(s.requirements.category).toBe("napkins");
    expect(s.requirements.sizeOz).toBeNull();
    expect(s.requirements.use).toBeNull();
    expect(s.requirements.lid).toBeNull();
    expect(s.requirements.quantity).toBeNull();
    expect(s.requirements.budgetSar).toBeNull();
    expect(s.requirements.specs).toEqual({});
    expect(s.offers).toEqual([]);
    expect(s.confirmedOfferIds).toEqual([]);
    expect(s.scenarioQuantity).toBeNull();
    expect(s.requirements.city).toBe("الرياض");
    expect(missingFields(s)).not.toContain("sizeOz");
  });

  it("re-reading the new request after a switch raises no false conflicts", async () => {
    const steps = demoPaths.find((p) => p.id === "lids")!.steps;
    const s = resetForCategory(cups, "lids", false);
    const r = await say(steps[0].text, s);
    expect(r.blocks.filter((b) => b.type === "req_conflict")).toEqual([]);
    expect(r.patch.requirements?.city).toBe("جدة");
    expect(r.patch.requirements?.product).toBe("أغطية بفتحة شرب");
  });

  it("a real change to a confirmed value is still a conflict", async () => {
    const s = { ...resetForCategory(cups, "lids"), requirements: { ...resetForCategory(cups, "lids").requirements, product: "أغطية مميزة" } };
    const r = await say(demoPaths.find((p) => p.id === "lids")!.steps[0].text, s);
    const fields = r.blocks.flatMap((b) => (b.type === "req_conflict" ? [b.field] : []));
    expect(fields).toContain("product");
    expect(fields).toContain("city");
  });

  it("does not ask when the category is the same", async () => {
    host({ chat_plan: plan({ reply: "ما المقاس؟", asks: ["sizeOz"], requirementUpdates: rawRequirements({ category: v("cups", "أكواب") }) }) });
    const s = { ...cups, requirements: { ...cups.requirements, sizeOz: null } };
    const r = await say("أبي أكواب", s, cfg);
    expect(r.blocks.some((b) => b.type === "switch_category")).toBe(false);
  });
});

describe("what-if updates the workspace, not the confirmed order", () => {
  it("sets a labelled scenario that adopts nothing", async () => {
    let s = initialState(TODAY);
    const path = demoPaths.find((p) => p.id === "cups")!.steps;
    for (const i of [0, 1, 2, 4]) s = apply(s, await say(path[i].text, s));
    s = { ...s, confirmedOfferIds: s.offers.map((o) => o.id) };
    const before = currentDecision(s)!.evaluations[0].cost.totalHalalas;
    const r = await say("وش لو اشتريت ٥٠٠٠؟", s);
    s = apply(s, r);
    expect(s.scenarioQuantity).toBe(5000);
    expect(s.requirements.quantity).toBe(3000);
    expect(currentDecision(s)!.evaluations[0].cost.totalHalalas).toBe(210000);
    expect(before).toBe(144000);
    expect(r.reply).toContain("سيناريو");
  });
});

describe("every category end to end, through the real pipeline", () => {
  const expected = { lids: "مصنع الإتقان", bags: "أكياس المدينة", napkins: "نقاء للمناديل", takeaway: "سفري بلس", cups: "الوفرة للتغليف" } as const;
  for (const p of demoPaths) {
    it(`${p.id}: requirements, offers, RFQ, comparison`, async () => {
      let s = initialState(TODAY);
      const first = await say(p.steps[0].text, s);
      s = apply(s, first);
      expect(s.requirements.category).toBe(p.id);
      if (p.id === "cups") for (const i of [1, 2]) s = apply(s, await say(p.steps[i].text, s));
      const offers = p.steps.find((x) => x.plan.offers.length)!;
      s = apply(s, await say(offers.text, s));
      expect(s.offers.length).toBeGreaterThanOrEqual(2);
      expect(Object.values(s.rejected).flat()).toEqual([]);
      s = { ...s, confirmedOfferIds: s.offers.map((o) => o.id) };
      const rfq = await runTurn({ text: null, event: { type: "rfq", includeBudget: false }, history: [], state: s, today: TODAY }, null);
      const draft = rfq.blocks.find((b) => b.type === "rfq");
      expect(draft?.type === "rfq" && draft.message).toContain(CATEGORIES[p.id as "lids"].unit);
      const d = currentDecision(s)!;
      const vd = d.verdict;
      const winner = vd.kind === "recommend" || vd.kind === "recommend_open" ? d.evaluations.find((e) => e.offerId === vd.winnerId)!.label : null;
      expect(winner).toBe(expected[p.id as "lids"]);
    });
  }

  it("a conflicting lids reply previews, requires a choice, and stays on its offer", async () => {
    const steps = demoPaths.find((p) => p.id === "lids")!.steps;
    let s = initialState(TODAY);
    for (const i of [0, 1]) s = apply(s, await say(steps[i].text, s));
    s = { ...s, confirmedOfferIds: s.offers.map((o) => o.id) };
    const r = await say(steps[3].text, s);
    const b = r.blocks.find((x) => x.type === "proposal");
    if (b?.type !== "proposal") throw new Error("no proposal");
    expect(b.proposal.offerId).toBe("B");
    const c = b.proposal.changes.find((x) => x.field === "priceAmount")!;
    expect(c).toMatchObject({ kind: "conflict", previous: 180, proposed: 200 });
    expect(currentDecision(s)!.evaluations[1].cost.totalHalalas).toBe(90000);
    expect(() => applyReplyProposal(s.offers[1], b.proposal, {}, new Set(), 2)).toThrow("unresolved");
    const updated = applyReplyProposal(s.offers[1], b.proposal, { priceAmount: "adopt" }, new Set(), 2);
    const next = { ...s, offers: [s.offers[0], updated] };
    expect(currentDecision(next)!.evaluations[1].cost.totalHalalas).toBe(100000);
    expect(next.offers[0]).toBe(s.offers[0]);
  });

  it("an unsupported spec in a reply is rejected for that category", () => {
    const o = newOfferState("A", "A", "عرض", validateRawOffer(rawOffer({}), "offer:A", "عرض", [], "bags"), 1);
    const p = buildReplyProposal(o, rawOffer({ specs: [{ key: "ply", value: "2", quote: "طبقتين" }] }), "reply:A:1", "طبقتين", [], "bags");
    expect(p.changes).toEqual([]);
    expect(p.rejected[0].field).toBe("spec:ply");
  });

  it("incomplete category offer stays unknown, with resolveOffer keeping specs", () => {
    const o = newOfferState("A", "A", "منديل", validateRawOffer(rawOffer({ specs: [{ key: "ply", value: "2", quote: "منديل" }] }), "offer:A", "منديل طبقتين منديل", [], "napkins"), 1);
    expect(resolveOffer(o).priceAmount).toBeNull();
  });
  it("demo refuses other text", () => expect(demoPlanFor("نص آخر")).toBeNull());
});
