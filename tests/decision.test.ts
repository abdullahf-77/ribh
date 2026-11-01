import { describe, expect, it } from "vitest";
import { addLeadTime, decide, deliveryFit, evaluateOffer } from "@/domain/decision";
import { deterministicSummary, explainDecisionChange, validateSummary } from "@/domain/explain";
import { offer, req, TODAY } from "./helpers";

const A = offer({ id: "A", label: "أ", priceAmount: 0.38, deliveryKind: "amount", deliveryAmount: 300, deliveryVat: "included" });
const B = offer({ id: "B", label: "ب", priceAmount: 0.42 });

describe("compatibility", () => {
  it("returns not on a different size and unknown on a missing one", () => {
    const e1 = evaluateOffer(offer({ cupSizeOz: 12 }), req(), TODAY);
    expect(e1.checks.find((c) => c.id === "size")!.status).toBe("not");
    expect(e1.category).toBe("fail");
    const e2 = evaluateOffer(offer({ cupSizeOz: null }), req(), TODAY);
    expect(e2.checks.find((c) => c.id === "size")!.status).toBe("unknown");
    expect(e2.category).toBe("clarify");
  });

  it("does not treat unknown lid as failure or success", () => {
    const e = evaluateOffer(offer({ lids: null }), req({ lid: "required" }), TODAY);
    expect(e.checks.find((c) => c.id === "lid")!.status).toBe("unknown");
    expect(e.category).toBe("clarify");
    expect(e.failReasons).toEqual([]);
  });

  it("accepts a both-use cup for hot drinks", () => {
    expect(evaluateOffer(offer({ use: "both" }), req(), TODAY).checks.find((c) => c.id === "use")!.status).toBe("meets");
    expect(evaluateOffer(offer({ use: "cold" }), req(), TODAY).checks.find((c) => c.id === "use")!.status).toBe("not");
  });

  it("matches cities across Arabic and English", () => {
    expect(evaluateOffer(offer({ deliveryCities: ["Riyadh"] }), req(), TODAY).checks.find((c) => c.id === "city")!.status).toBe("meets");
    expect(evaluateOffer(offer({ deliveryCities: ["جدة"] }), req(), TODAY).checks.find((c) => c.id === "city")!.status).toBe("not");
    expect(evaluateOffer(offer({ deliveryCities: ["*"] }), req(), TODAY).checks.find((c) => c.id === "city")!.status).toBe("meets");
  });

  it("gates on mandatory other requirements only", () => {
    const r = req({ other: [{ id: "R1", text: "شهادة صحية", level: "mandatory" }, { id: "R2", text: "لون بني", level: "preferred" }] });
    const unknown = evaluateOffer(offer(), r, TODAY);
    expect(unknown.category).toBe("clarify");
    expect(unknown.blockers).toEqual(["spec:other:R1"]);
    const met = evaluateOffer(offer({ otherRequirements: { R1: "meets" } }), r, TODAY);
    expect(met.category).toBe("confirmed");
  });
});

describe("dates", () => {
  it("compares arrival to deadline inclusively", () => {
    expect(deliveryFit(offer({ leadTimeDays: 5 }), "2026-11-06", TODAY).status).toBe("meets");
    expect(deliveryFit(offer({ leadTimeDays: 6 }), "2026-11-06", TODAY).status).toBe("not");
  });

  it("prefers an explicit date over lead time", () => {
    expect(deliveryFit(offer({ leadTimeDays: 30, deliveryDate: "2026-11-03" }), "2026-11-06", TODAY).status).toBe("meets");
  });

  it("is unknown without commitment and not required without deadline", () => {
    expect(deliveryFit(offer({ leadTimeDays: null }), "2026-11-06", TODAY).status).toBe("unknown");
    expect(deliveryFit(offer({ leadTimeDays: null }), null, TODAY).status).toBe("not_required");
  });

  it("skips Friday and Saturday for business days", () => {
    // 2026-11-01 is a Sunday; 5 work days end on Sunday 8th.
    expect(addLeadTime("2026-11-01", 5, true)).toBe("2026-11-08");
    expect(addLeadTime("2026-11-01", 5, false)).toBe("2026-11-06");
  });
});

describe("ranking and gates", () => {
  it("ranks on real total, not advertised price", () => {
    const d = decide([A, B], req(), TODAY, "cash");
    expect(d.verdict).toEqual({ kind: "recommend", winnerId: "B" });
    expect(d.evaluations.find((e) => e.offerId === "A")!.rank).toBe(2);
  });

  it("changes winner when priority changes", () => {
    const moq = offer({ id: "M", label: "م", priceAmount: 0.35, moq: 5000, moqUnit: "item" });
    const flat = offer({ id: "F", label: "ف", priceAmount: 0.48 });
    expect(decide([moq, flat], req(), TODAY, "cash").verdict).toMatchObject({ winnerId: "F" });
    expect(decide([moq, flat], req(), TODAY, "unit").verdict).toMatchObject({ winnerId: "M" });
  });

  it("ranks by earliest confirmed arrival", () => {
    const quick = offer({ id: "Q", label: "ق", priceAmount: 0.5, leadTimeDays: 2 });
    const slow = offer({ id: "S", label: "س", priceAmount: 0.3, leadTimeDays: 9 });
    expect(decide([quick, slow], req(), TODAY, "earliest").verdict).toMatchObject({ winnerId: "Q" });
  });

  it("changes ranking after a quantity edit", () => {
    const moq = offer({ id: "M", label: "م", priceAmount: 0.35, moq: 5000, moqUnit: "item" });
    const flat = offer({ id: "F", label: "ف", priceAmount: 0.48 });
    expect(decide([moq, flat], req({ quantity: 3000 }), TODAY, "cash").verdict).toMatchObject({ winnerId: "F" });
    expect(decide([moq, flat], req({ quantity: 5000 }), TODAY, "cash").verdict).toMatchObject({ winnerId: "M" });
  });

  it("changes outcome after a budget edit", () => {
    expect(decide([B], req({ budgetSar: 1000, budgetIncludesDelivery: true, budgetIncludesVat: true }), TODAY, "cash").verdict.kind).toBe("none_eligible");
    expect(decide([B], req({ budgetSar: 2000, budgetIncludesDelivery: true, budgetIncludesVat: true }), TODAY, "cash").verdict.kind).toBe("recommend");
  });

  it("changes outcome after a deadline edit", () => {
    expect(decide([B], req({ requiredDate: "2026-11-02" }), TODAY, "cash").verdict.kind).toBe("none_eligible");
    expect(decide([B], req({ requiredDate: "2026-12-01" }), TODAY, "cash").verdict.kind).toBe("recommend");
  });

  it("does not crown an incomplete cheaper offer", () => {
    const incomplete = offer({ id: "I", label: "ن", priceAmount: 0.2, vatStatus: null });
    const d = decide([incomplete, B], req(), TODAY, "cash");
    expect(d.verdict).toEqual({ kind: "recommend_open", winnerId: "B", openIds: ["I"] });
    expect(deterministicSummary(d)).toContain("لا يمكن الجزم");
  });

  it("asks for clarification when nothing is confirmed", () => {
    const d = decide([offer({ id: "X", vatStatus: null }), offer({ id: "Y", deliveryKind: null })], req(), TODAY, "cash");
    expect(d.verdict).toEqual({ kind: "clarify", openIds: ["X", "Y"] });
  });

  it("refuses to rank materially different confirmed specs", () => {
    const r = req({ sizeOz: null });
    const d = decide([offer({ id: "X", cupSizeOz: 8 }), offer({ id: "Y", cupSizeOz: 12 })], r, TODAY, "unit");
    expect(d.verdict.kind).toBe("not_comparable");
  });

  it("an open contradiction blocks confirmation", () => {
    const o = offer({ openAmbiguities: [{ kind: "contradiction", text: "سعران مختلفان", field: "priceAmount" }] });
    expect(evaluateOffer(o, req(), TODAY).category).toBe("clarify");
  });

  it("insufficient stated stock fails", () => {
    expect(evaluateOffer(offer({ availableQuantity: 1000 }), req(), TODAY).failReasons).toContain("stock_short");
    expect(evaluateOffer(offer({ availableQuantity: null }), req(), TODAY).availability).toBe("unknown");
  });
});

describe("explanations", () => {
  const d = decide([A, B], req(), TODAY, "cash");

  it("deterministic summary passes its own validator", () => {
    expect(validateSummary(deterministicSummary(d), d)).toBe(true);
  });

  it("rejects model text with invented numbers", () => {
    expect(validateSummary("يتقدم ب بإجمالي 999 ريال.", d)).toBe(false);
  });

  it("rejects text that omits the computed winner or adds a quality claim", () => {
    expect(validateSummary("العرض أ جيد.", d)).toBe(false);
    expect(validateSummary("ب أعلى جودة.", d)).toBe(false);
  });

  it("rejects crowning another offer", () => {
    expect(validateSummary("ب خيار جيد لكن نوصي بالعرض أ.", d)).toBe(false);
  });

  it("reports a price change only if the total moved", () => {
    const lidsReq = req({ lid: "required" });
    const before = decide([offer({ id: "A", label: "أ" })], lidsReq, TODAY, "cash");
    const after = decide([offer({ id: "A", label: "أ", lids: "included" })], lidsReq, TODAY, "cash");
    const lines = explainDecisionChange(before, after);
    expect(lines.join(" ")).toContain("مستوفيًا لشرط «الأغطية»");
    expect(lines.join(" ")).not.toContain("تغيّر إجمالي");
  });
});
