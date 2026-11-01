import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as compose } from "@/app/api/compose/route";
import { POST as offers } from "@/app/api/offers/route";
import { POST as replies } from "@/app/api/replies/route";
import { POST as requirements } from "@/app/api/requirements/route";
import { POST as rfq } from "@/app/api/rfq/route";
import { decide } from "@/domain/decision";
import { offerQuestions } from "@/domain/questions";
import { rawOffer } from "@/demo/build";
import { scenarios } from "@/demo/scenarios";
import { newOfferState, validateRawOffer, validateRawRequirements } from "@/domain/evidence";
import { resolveOffer } from "@/domain/offer-state";
import { offer, req, TODAY } from "./helpers";

const call = (handler: (r: Request) => Promise<Response>, body: unknown, ip = "1.1.1.1") =>
  handler(new Request("http://x/api", { method: "POST", headers: { "x-forwarded-for": ip }, body: typeof body === "string" ? body : JSON.stringify(body) }));

const llm = (content: unknown) => vi.fn(async () => new Response(JSON.stringify({ model: "meta-llama/llama-4-maverick", choices: [{ message: { content: JSON.stringify(content) } }] })));

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const live = () => { vi.stubEnv("LLAMA_API_KEY", "test"); vi.stubEnv("LLAMA_BASE_URL", "http://llm.test/v1"); };

const r = req({ lid: "required" });
const os = [offer({ id: "A", label: "أ" }), offer({ id: "B", label: "ب", lids: "included", priceAmount: 0.5 })];
const d = decide(os, r, TODAY, "cash");
const questions = d.evaluations.map((e, i) => ({ offerId: e.offerId, label: e.label, items: offerQuestions(os[i], e, r) })).filter((q) => q.items.length);

describe("input validation", () => {
  it("rejects empty and malformed input", async () => {
    expect((await call(requirements, { text: "  ", today: TODAY })).status).toBe(400);
    expect((await call(requirements, "not json")).status).toBe(400);
    expect((await call(offers, { offerId: "Z", text: "x", other: [] })).status).toBe(400);
  });
  it("rejects oversized text", async () => {
    expect((await call(offers, { offerId: "A", text: "x".repeat(7000), other: [] })).status).toBe(400);
    expect((await call(offers, "x".repeat(300000))).status).toBe(413);
  });
  it("limits request bursts", async () => {
    let last = 0;
    for (let i = 0; i < 45; i++) last = (await call(requirements, "bad", "9.9.9.9")).status;
    expect(last).toBe(429);
  });
});

describe("demo mode", () => {
  it("refuses unknown text with a clear code", async () => {
    vi.stubEnv("LLAMA_API_KEY", "");
    const res = await call(offers, { offerId: "A", text: "عرض غير موجود", other: [] });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("demo_unavailable");
  });
  it("compose returns computed text and makes no model call", async () => {
    vi.stubEnv("LLAMA_API_KEY", "");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const res = await call(compose, { decision: d, questions });
    expect(res.status).toBe(200);
    expect((await res.json()).summarySource).toBe("template");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("live path with a stubbed host", () => {
  it("compose discards invented narrative and keeps computed text", async () => {
    live();
    vi.stubGlobal("fetch", llm({ summary: "نوصي بأعلى جودة بسعر 12345 ريال.", messages: [] }));
    const res = await call(compose, { decision: d, questions });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.summarySource).toBe("template");
    expect(out.summary).not.toContain("12345");
  });

  it("compose accepts valid narrative and drafted messages", async () => {
    live();
    const q = questions[0];
    vi.stubGlobal("fetch", llm({ summary: "يتقدم ب بإجمالي 1500 ريال.", messages: [{ offerId: q.offerId, message: "هل يشمل السعر الأغطية؟" }] }));
    const out = await (await call(compose, { decision: d, questions })).json();
    expect(out.summarySource).toBe("llama");
    expect(out.messages.find((m: { offerId: string }) => m.offerId === q.offerId).source).toBe("llama");
  });

  it("compose handles offers that are entirely unknown", async () => {
    live();
    const blank = (id: string) => resolveOffer(newOfferState(id, id, "نص", validateRawOffer(rawOffer({}), `offer:${id}`, "نص", []), 1));
    const full = scenarios.find((s) => s.id === "full-journey")!;
    const { requirements: fr } = validateRawRequirements(full.rawRequirements, full.requirementText, TODAY);
    const first = resolveOffer(newOfferState("A", "A", full.offers[0].text, validateRawOffer(full.offers[0].raw, "offer:A", full.offers[0].text, []), 1));
    const all = [first, blank("B"), blank("C")];
    const dd = decide(all, fr, TODAY, "cash");
    const qs = dd.evaluations.map((e, i) => ({ offerId: e.offerId, label: e.label, items: offerQuestions(all[i], e, fr) })).filter((q) => q.items.length);
    vi.stubGlobal("fetch", llm({ summary: "نوصي بأعلى جودة بسعر 12345 ريال.", messages: [] }));
    const res = await call(compose, { decision: dd, questions: qs });
    if (res.status !== 200) console.log(await res.text());
    expect(res.status).toBe(200);
  });

  it("compose survives a provider failure", async () => {
    live();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const res = await call(compose, { decision: d, questions });
    expect(res.status).toBe(200);
    expect((await res.json()).summarySource).toBe("template");
  });

  it("does not expose provider details on failure", async () => {
    live();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret upstream detail", { status: 500 })));
    const res = await call(requirements, { text: "أحتاج أكواب", today: TODAY });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("secret");
  });

  it("rfq refuses to draft while blocking gaps remain", async () => {
    live();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const out = await (await call(rfq, { requirements: req({ quantity: null }), includeBudget: false })).json();
    expect(out.blocked).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("replies route validates input", async () => {
    live();
    expect((await call(replies, { text: "", current: {}, questions: [], other: [] })).status).toBe(400);
  });
});
