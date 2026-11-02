import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState } from "@/chat/state";
import { runTurn } from "@/chat/turn";
import type { ConversationState, TurnPlan } from "@/chat/types";
import { rawOffer, rawRequirements, v } from "@/demo/build";
import { demoScript } from "@/demo/chat-script";
import { checkField, locateQuote, newOfferState, validateRawOffer, validateRawRequirements } from "@/domain/evidence";
import { resolveOffer } from "@/domain/offer-state";
import { deterministicRfq, rfqFacts, validateRfqDraft } from "@/domain/rfq";
import { emptyRequirements } from "@/domain/schemas";
import type { ProviderConfig } from "@/llm/provider";
import { TODAY } from "./helpers";

/* Each case here came from running the real model, not from imagining what it might do. */

afterEach(() => vi.unstubAllGlobals());

const cfg: ProviderConfig = { apiKey: "t", baseUrl: "http://llm.test/v1", model: "meta-llama/llama-4-maverick", timeoutMs: 200, maxAttempts: 1 };
const plan = (p: Partial<TurnPlan>): TurnPlan => ({
  reply: "", asks: [], requirementUpdates: rawRequirements({}), waived: [], unsupportedProduct: null, offers: [], supplierReply: null, generateRfq: null,
  showComparison: false, explainDecision: false, whatIfQuantity: null, setPriority: null, showDiscount: false, ...p,
});
function host(responses: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (_: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content: JSON.stringify(responses[body.response_format.json_schema.name]) } }] }));
  }));
}
const turn = (text: string, state: ConversationState) => runTurn({ text, event: null, history: [], state, today: TODAY }, cfg);
const cups = (r: Partial<ConversationState["requirements"]>) => ({ ...initialState(TODAY), requirements: { ...emptyRequirements(), category: "cups" as const, ...r } });

async function journey(): Promise<ConversationState> {
  let s = initialState(TODAY);
  for (const i of [0, 1, 2, 4]) {
    const r = await runTurn({ text: demoScript[i].text, event: null, history: [], state: s, today: TODAY }, null);
    s = { ...s, ...(r.patch.requirements && { requirements: r.patch.requirements }), ...(r.patch.offers && { offers: r.patch.offers }) };
  }
  return { ...s, confirmedOfferIds: s.offers.map((o) => o.id) };
}

describe("regressions found with real Llama", () => {
  it("takes no requirements from a message carrying an offer", async () => {
    const text = "عرض: البيع بالكرتون الكامل فقط";
    host({ chat_plan: plan({ offers: [{ supplierHint: null, text }], requirementUpdates: rawRequirements({ other: [{ text: "البيع بالكرتون", level: "mandatory", quote: "البيع بالكرتون" }] }) }), offer: rawOffer({}) });
    const r = await turn(text, cups({ quantity: 3000 }));
    expect(r.patch.requirements).toBeUndefined();
  });

  it("a what-if never proposes changing the confirmed quantity", async () => {
    const s = await journey();
    host({ chat_plan: plan({ whatIfQuantity: 5000, requirementUpdates: rawRequirements({ quantity: v(5000, "٥٠٠٠") }) }), chat_reply: { reply: "x" } });
    const r = await turn("وش لو اشتريت ٥٠٠٠؟", s);
    expect(r.blocks.some((b) => b.type === "req_conflict")).toBe(false);
    expect(r.patch.scenarioQuantity).toBe(5000);
  });

  it("a reply turn announces no result before the change is confirmed", async () => {
    const s = await journey();
    const text = "الغطاء مشمول";
    const calls = vi.fn();
    host({ chat_plan: plan({ supplierReply: { offerId: "B", text }, showComparison: true, explainDecision: true }), reply: rawOffer({ lids: v("included", "الغطاء مشمول") }), chat_reply: { reply: "صار فائزًا" } });
    const r = await turn(text, s);
    expect(r.blocks.some((b) => b.type === "comparison")).toBe(false);
    expect(r.blocks.some((b) => b.type === "proposal")).toBe(true);
    expect(r.reply).not.toContain("فائز");
    expect(calls).not.toHaveBeenCalled();
  });

  it("accepts the category as a classification, without a quote", async () => {
    host({ chat_plan: plan({ reply: "كم طبقة؟", asks: ["spec:ply"], requirementUpdates: rawRequirements({ category: { value: "napkins", quote: null } }) }) });
    const r = await turn("أبي مناديل", initialState(TODAY));
    expect(r.patch.requirements?.category).toBe("napkins");
    expect(r.replySource).toBe("llama");
  });

  it("asks before switching when the model classifies a new product", async () => {
    host({ chat_plan: plan({ requirementUpdates: rawRequirements({ category: { value: "napkins", quote: null } }) }) });
    const r = await turn("طيب أبي الحين أقارن مناديل", cups({ quantity: 3000 }));
    expect(r.blocks[0]).toMatchObject({ type: "switch_category", to: "napkins" });
    expect(r.patch).toEqual({});
  });

  it("drops extra conditions that repeat a field, keeping genuine ones", () => {
    const text = "شاملة التوصيل، وأبغى شهادة ملامسة الغذاء";
    const out = validateRawRequirements(rawRequirements({ other: [{ text: "توصيل", level: "mandatory", quote: "شاملة التوصيل" }, { text: "شهادة ملامسة الغذاء", level: "mandatory", quote: "شهادة ملامسة الغذاء" }] }), text, TODAY);
    expect(out.requirements.other.map((o) => o.text)).toEqual(["شهادة ملامسة الغذاء"]);
  });

  it("a category code is not used as the product description", () => {
    const out = validateRawRequirements(rawRequirements({ category: { value: "cups", quote: null }, product: v("cups", "أكواب") }), "أبي أكواب", TODAY);
    expect(out.requirements.product).toBeNull();
    expect(out.requirements.category).toBe("cups");
  });

  it("matches Arabic prefixes and shortened quotes, keeping the real source span", () => {
    expect(locateQuote("توصيل مجاني للرياض", "الرياض")).not.toBeNull();
    const text = "السعر شامل الغطاء والضريبة اليوم";
    const c = checkField("offer:A", text, { value: "included", quote: "شامل الضريبة" });
    expect(c.value).toBe("included");
    expect(c.evidence?.quote).toBe("شامل الغطاء والضريبة");
    expect(checkField("offer:A", text, { value: "included", quote: "شامل التوصيل" }).value).toBeNull();
    expect(checkField("offer:A", "شامل كل شيء ما عدا بعض الأشياء الضريبة", { value: "included", quote: "شامل الضريبة" }).value).toBeNull();
    expect(checkField("offer:A", text, { value: "included", quote: "الضريبة" }).evidence?.quote).toBe("الضريبة");
  });

  it("accepts a number written literally in the source when the model rewrote its quote", () => {
    const c = checkField("requirement", "أحتاج ٣٠٠٠ كوب", { value: 3000, quote: "ثلاثة آلاف" });
    expect(c.value).toBe(3000);
    expect(c.evidence?.quote).toBe("٣٠٠٠");
    expect(checkField("requirement", "أحتاج ٣٠٠٠ كوب", { value: 300, quote: "ثلاثمئة" }).value).toBeNull();
    expect(checkField("requirement", "أحتاج ٣٠٠٠ كوب", { value: 5000, quote: "خمسة آلاف" }).value).toBeNull();
  });

  it("treats the word null as no value, and ignores shared fields inside specs", () => {
    const out = validateRawOffer(rawOffer({ specs: [{ key: "sizeOz", value: "8", quote: "٨" }, { key: "wall", value: "null", quote: "null" }, { key: "ply", value: "null", quote: "null" }] }), "offer:A", "نص", [], "napkins");
    expect(out.rejected).toEqual([]);
  });

  it("rejects a draft that negates a required lid or print", () => {
    const r = { ...emptyRequirements(), category: "cups" as const, product: "أكواب", quantity: 3000, sizeOz: 8, lid: "required" as const, print: "required" as const };
    const f = rfqFacts(r, false);
    const t = deterministicRfq(f);
    expect(validateRfqDraft(t, f, null)).toEqual([]);
    expect(validateRfqDraft(`${t}\nبدون غطاء`, f, null)).toContain("missing_lid");
    expect(validateRfqDraft(`${t}\nوبدون طباعة`, f, null)).toContain("missing_print");
  });
});

describe("notes from the model do not hold back clear offers", () => {
  const offerWith = (kind: "pricing" | "contradiction", field: string | null, raw = rawOffer({})) => {
    const v0 = validateRawOffer(raw, "offer:A", "السعر ١ ريال", [], "cups");
    return { ...newOfferState("A", "A", "السعر ١ ريال", v0, 1), ambiguities: [{ id: "x", kind, text: "ملاحظة", field, quote: null, resolved: false }] };
  };
  it("a remark on a known field, or with no field, does not block", () => {
    const known = rawOffer({ priceAmount: v(1, "١ ريال") });
    expect(resolveOffer(offerWith("pricing", "priceAmount", known)).openAmbiguities).toEqual([]);
    expect(resolveOffer(offerWith("pricing", null)).openAmbiguities).toEqual([]);
  });
  it("a remark on an unknown field and any contradiction do block", () => {
    expect(resolveOffer(offerWith("pricing", "tierMechanism")).openAmbiguities).toHaveLength(1);
    expect(resolveOffer(offerWith("contradiction", null)).openAmbiguities).toHaveLength(1);
  });
});

describe("found by running Qwen on the live site", () => {
  it("treats a carton price without a lot quantity as per package", () => {
    const text = "الكرتون ٢٤٠٠ منديل بـ ١٥٠ ريال";
    const out = validateRawOffer(rawOffer({ priceAmount: v(150, "١٥٠ ريال"), priceBasis: v("quoted_lot", "١٥٠ ريال"), packageLevels: v([{ label: "كرتون", count: 2400 }], "الكرتون ٢٤٠٠ منديل") }), "offer:A", text, [], "napkins");
    expect(out.fields.priceBasis.value).toBe("per_package");
  });
  it("keeps a real lot that states its quantity", () => {
    const text = "٢٥٠٠ كوب بمبلغ ١٤٠٠ ريال، الكرتون ٥٠٠ كوب";
    const out = validateRawOffer(rawOffer({ priceBasis: v("quoted_lot", "بمبلغ ١٤٠٠ ريال"), quotedQuantity: v(2500, "٢٥٠٠ كوب"), packageLevels: v([{ label: "كرتون", count: 500 }], "الكرتون ٥٠٠ كوب") }), "offer:A", text, [], "cups");
    expect(out.fields.priceBasis.value).toBe("quoted_lot");
  });
  it("accepts a ply count given as a word", () => {
    const out = validateRawOffer(rawOffer({ specs: [{ key: "ply", value: "طبقتين", quote: "طبقتين" }] }), "offer:A", "منديل طبقتين", [], "napkins");
    expect(out.fields["spec:ply"].value).toBe(2);
  });
  it("replaces a question that names no field", async () => {
    host({ chat_plan: plan({ reply: "كم عدد المناديل؟", asks: [], requirementUpdates: rawRequirements({ category: { value: "napkins", quote: null }, quantity: v(10000, "١٠٠٠٠ منديل") }) }) });
    const r = await turn("أبي ١٠٠٠٠ منديل", initialState(TODAY));
    expect(r.reply).not.toContain("كم عدد المناديل");
    expect(r.replySource).toBe("computed");
  });
});

describe("a model reply that re-asks something known", () => {
  it("is replaced, even when its field list does not admit it", async () => {
    host({ chat_plan: plan({ reply: "كم عدد المناديل اللي تحتاجها؟ ومتى تحتاجها؟", asks: ["requiredDate"], requirementUpdates: rawRequirements({ quantity: v(10000, "١٠٠٠٠ منديل") }) }) });
    const r = await turn("أبي ١٠٠٠٠ منديل", { ...initialState(TODAY), requirements: { ...emptyRequirements(), category: "napkins" } });
    expect(r.reply).not.toContain("كم عدد");
    expect(r.replySource).toBe("computed");
  });
  it("is kept when the question is still open", async () => {
    host({ chat_plan: plan({ reply: "متى تحتاجها؟", asks: ["requiredDate"], requirementUpdates: rawRequirements({ quantity: v(10000, "١٠٠٠٠ منديل") }) }) });
    const r = await turn("أبي ١٠٠٠٠ منديل", { ...initialState(TODAY), requirements: { ...emptyRequirements(), category: "napkins" } });
    expect(r.reply).toBe("متى تحتاجها؟");
  });
});
