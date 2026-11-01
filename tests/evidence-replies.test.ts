import { describe, expect, it } from "vitest";
import { rawOffer, v } from "@/demo/build";
import { decide } from "@/domain/decision";
import { checkField, locateQuote, newOfferState, numberSupported, validateRawOffer, validateRawRequirements } from "@/domain/evidence";
import { changeHistory, correctField, fieldValue, resolveOffer } from "@/domain/offer-state";
import { applyReplyProposal, buildReplyProposal, unresolvedConflicts } from "@/domain/replies";
import { RawOfferSchema, RawRequirementsSchema, RequirementsSchema } from "@/domain/schemas";
import { explainDecisionChange } from "@/domain/explain";
import { req, TODAY } from "./helpers";

const OFFER_TEXT = "مورد الاختبار: كوب ٨ أونصات، السعر ٠٫٤٠ ريال للحبة شامل   الضريبة. توصيل مجاني للرياض خلال ٥ أيام.";
const baseRaw = rawOffer({
  supplierName: v("مورد الاختبار", "مورد الاختبار"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "كوب"), priceAmount: v(0.4, "٠٫٤٠ ريال للحبة"), priceBasis: v("per_item", "للحبة"),
  vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"), leadTimeDays: v(5, "خلال ٥ أيام"),
});
const state = (id = "A", raw = baseRaw, text = OFFER_TEXT) => newOfferState(id, id, text, validateRawOffer(raw, `offer:${id}`, text, []), 1);

describe("evidence verification", () => {
  it("finds quotes with whitespace differences and maps to the original", () => {
    const loc = locateQuote(OFFER_TEXT, "شامل الضريبة")!;
    expect(OFFER_TEXT.slice(loc.start, loc.end)).toBe("شامل   الضريبة");
  });
  it("ignores tashkeel and direction marks only", () => {
    expect(locateQuote("السعرُ ثابت", "السعر ثابت")).not.toBeNull();
    expect(locateQuote("السعر‏ ثابت", "السعر ثابت")).not.toBeNull();
    expect(locateQuote("السعر ثابت", "السعر متغير")).toBeNull();
  });
  it("rejects a value whose quote is not in the text: it stays unknown", () => {
    const c = checkField("offer:A", OFFER_TEXT, { value: 100, quote: "التوصيل ١٠٠ ريال" });
    expect(c.value).toBeNull();
    expect(c.flag).toBe("unsupported_quote");
  });
  it("rejects a value with no quote", () => {
    expect(checkField("offer:A", OFFER_TEXT, { value: 100, quote: null }).flag).toBe("unsupported_quote");
  });
  it("flags a number that the real quote does not state", () => {
    const c = checkField("offer:A", OFFER_TEXT, { value: 0.5, quote: "٠٫٤٠ ريال للحبة" });
    expect(c.flag).toBe("value_not_in_quote");
  });
  it("understands Arabic numerals and common expressions", () => {
    expect(numberSupported("٣٠٠٠ كوب", 3000)).toBe(true);
    expect(numberSupported("3,000 cups", 3000)).toBe(true);
    expect(numberSupported("ألف كوب", 1000)).toBe(true);
    expect(numberSupported("٣ آلاف كوب", 3000)).toBe(true);
    expect(numberSupported("٤٥ هللة", 0.45)).toBe(true);
    expect(numberSupported("٤٥ هللة", 45)).toBe(true);
    expect(numberSupported("٣٠٠٠ كوب", 2000)).toBe(false);
  });
  it("drops charges and tiers with invented quotes, and reports them", () => {
    const raw = rawOffer({ charges: [{ label: "رسوم", amount: 50, basis: "fixed", appliesWhen: "always", vat: null, quote: "رسوم ٥٠ ريال" }] });
    const out = validateRawOffer(raw, "offer:A", OFFER_TEXT, []);
    expect(out.fields.charges.value).toBeNull();
    expect(out.rejected[0].field).toBe("charges");
  });
  it("ignores requirement ids the app never sent", () => {
    const raw = rawOffer({ otherRequirements: [{ id: "HACK", status: "meets", quote: "كوب" }] });
    expect(validateRawOffer(raw, "offer:A", OFFER_TEXT, []).fields["other:HACK"]).toBeUndefined();
  });
});

describe("schemas", () => {
  it("rejects malformed model output", () => {
    expect(RawOfferSchema.safeParse({ supplierName: "x" }).success).toBe(false);
    expect(RawOfferSchema.safeParse({ ...baseRaw, priceAmount: { value: "رخيص", quote: null } }).success).toBe(false);
    expect(RawOfferSchema.safeParse({ ...baseRaw, vatStatus: { value: "maybe", quote: null } }).success).toBe(false);
    expect(RawOfferSchema.safeParse(baseRaw).success).toBe(true);
  });
  it("validates confirmed requirements", () => {
    expect(RequirementsSchema.safeParse(req({ quantity: -5 })).success).toBe(false);
    expect(RequirementsSchema.safeParse(req({ quantity: 1.5 })).success).toBe(false);
    expect(RequirementsSchema.safeParse(req({ requiredDate: "next week" })).success).toBe(false);
    expect(RequirementsSchema.safeParse(req()).success).toBe(true);
  });
  it("computes relative deadlines in code and drops unsupported ones", () => {
    const text = "أحتاج ٣٠٠٠ كوب خلال أسبوع";
    const empty = { value: null, quote: null };
    const raw = RawRequirementsSchema.parse({
      category: empty, specs: [], product: empty, quantity: v(3000, "٣٠٠٠ كوب"), sizeOz: v(12, "١٢ أونصة"), material: empty, wall: empty, use: empty, lid: empty, print: empty, city: empty, requiredDate: empty,
      requiredWithinDays: v(7, "خلال أسبوع"), budgetSar: empty, budgetIncludesDelivery: empty, budgetIncludesVat: empty, other: [],
    });
    const out = validateRawRequirements(raw, text, TODAY);
    expect(out.requirements.requiredDate).toBe("2026-11-08");
    expect(out.requirements.sizeOz).toBeNull();
    expect(out.rejected).toContain("sizeOz");
  });
});

describe("versions", () => {
  it("keeps original and corrected values separately", () => {
    const s = correctField(state(), "priceAmount", 0.5, 2);
    expect(fieldValue(s, "priceAmount")).toBe(0.5);
    expect(s.fields.priceAmount.versions[0].value).toBe(0.4);
    expect(s.fields.priceAmount.versions[0].evidence?.quote).toBe("٠٫٤٠ ريال للحبة");
    expect(s.fields.priceAmount.versions[1].source).toBe("user");
  });
});

describe("supplier replies", () => {
  const REPLY = "نعم الغطاء مشمول، والسعر للحبة ٠٫٥٠ ريال.";
  const replyRaw = rawOffer({ lids: v("included", "الغطاء مشمول"), priceAmount: v(0.5, "٠٫٥٠ ريال") });
  const proposal = (s = state()) => buildReplyProposal(s, replyRaw, `reply:${s.id}:1`, REPLY, []);

  it("labels unknown-resolving and conflicting changes with previous and proposed values", () => {
    const p = proposal();
    const lid = p.changes.find((c) => c.field === "lids")!;
    expect(lid).toMatchObject({ kind: "resolves_unknown", previous: null, proposed: "included" });
    const price = p.changes.find((c) => c.field === "priceAmount")!;
    expect(price).toMatchObject({ kind: "conflict", previous: 0.4, proposed: 0.5 });
    expect(price.evidence.sourceId).toBe("reply:A:1");
  });

  it("refuses to apply until a conflict is decided", () => {
    const p = proposal();
    expect(unresolvedConflicts(p, {})).toEqual(["priceAmount"]);
    expect(() => applyReplyProposal(state(), p, {}, new Set(), 2)).toThrow("unresolved");
  });

  it("does not treat a later reply as authoritative", () => {
    const next = applyReplyProposal(state(), proposal(), { priceAmount: "keep" }, new Set(), 2);
    expect(fieldValue(next, "priceAmount")).toBe(0.4);
    expect(next.fields.priceAmount.versions).toHaveLength(2);
    expect(fieldValue(next, "lids")).toBe("included");
  });

  it("adopts only on explicit choice, keeping prior evidence", () => {
    const next = applyReplyProposal(state(), proposal(), { priceAmount: "adopt" }, new Set(), 2);
    expect(fieldValue(next, "priceAmount")).toBe(0.5);
    expect(next.fields.priceAmount.versions[0].evidence?.sourceId).toBe("offer:A");
    expect(next.fields.priceAmount.versions[1].evidence?.sourceId).toBe("reply:A:1");
  });

  it("keeps unsupported values unknown", () => {
    const bad = rawOffer({ deliveryAmount: v(50, "التوصيل ٥٠ ريال") });
    const noDelivery = state("A", rawOffer({ ...baseRaw, deliveryKind: { value: null, quote: null } }));
    const p = buildReplyProposal(noDelivery, bad, "reply:A:1", REPLY, []);
    expect(p.changes).toHaveLength(0);
    expect(p.rejected[0].field).toBe("deliveryAmount");
  });

  it("isolates suppliers", () => {
    const a = state("A");
    const b = state("B");
    const p = proposal(a);
    expect(() => applyReplyProposal(b, p, { priceAmount: "keep" }, new Set(), 2)).toThrow("another offer");
    applyReplyProposal(a, p, { priceAmount: "adopt" }, new Set(), 2);
    expect(fieldValue(b, "lids")).toBeNull();
    expect(fieldValue(b, "priceAmount")).toBe(0.4);
  });

  it("marks matching information as confirmation, not change", () => {
    const raw = rawOffer({ priceAmount: v(0.4, "٠٫٤٠ ريال") });
    const p = buildReplyProposal(state(), raw, "reply:A:1", "نعم السعر ٠٫٤٠ ريال", []);
    expect(p.changes[0].kind).toBe("confirms");
  });

  it("skipped fields are not recorded as adopted", () => {
    const next = applyReplyProposal(state(), proposal(), { priceAmount: "keep" }, new Set(["lids"]), 2);
    expect(fieldValue(next, "lids")).toBeNull();
  });

  it("history links offer, reply and user sources", () => {
    let s = applyReplyProposal(state(), proposal(), { priceAmount: "keep" }, new Set(), 2);
    s = correctField(s, "cupSizeOz", 12, 3);
    const h = changeHistory(s);
    expect(h.some((e) => e.source === "offer" && e.sourceId === "offer:A" && e.quote)).toBe(true);
    expect(h.some((e) => e.source === "reply" && e.sourceId === "reply:A:1" && e.adopted)).toBe(true);
    expect(h.some((e) => e.source === "reply" && e.field === "priceAmount" && !e.adopted)).toBe(true);
    expect(h.some((e) => e.source === "user" && e.field === "cupSizeOz")).toBe(true);
    expect(s.sources.map((x) => x.id)).toEqual(["offer:A", "reply:A:1"]);
  });

  it("a confirmed reply can change the recommendation, and the explanation states facts", () => {
    const r = req({ lid: "required" });
    const cheap = state("A", rawOffer({ ...baseRaw, priceAmount: v(0.4, "٠٫٤٠ ريال للحبة") }));
    const pricierText = "مورد ب: كوب ٨ أونصات، ٠٫٤٠ ريال للحبة مع الغطاء شامل الضريبة، توصيل مجاني للرياض خلال ٥ أيام.";
    const pricier = state("B", rawOffer({
      supplierName: v("مورد ب", "مورد ب"), cupSizeOz: v(8, "٨ أونصات"), use: v("hot", "كوب"), priceAmount: v(0.4, "٠٫٤٠ ريال للحبة"), priceBasis: v("per_item", "للحبة"),
      lids: v("included", "مع الغطاء"), vatStatus: v("included", "شامل الضريبة"), deliveryKind: v("free", "توصيل مجاني"), deliveryCities: v(["الرياض"], "للرياض"), leadTimeDays: v(5, "خلال ٥ أيام"),
    }), pricierText);
    const before = decide([resolveOffer(cheap), resolveOffer(pricier)], r, TODAY, "cash");
    expect(before.verdict).toMatchObject({ kind: "recommend_open", winnerId: "B" });

    const replyText = "الغطاء مشمول";
    const p = buildReplyProposal(cheap, rawOffer({ lids: v("included", "الغطاء مشمول"), priceAmount: v(0.3, "٠٫٣٠") }), "reply:A:1", `${replyText} والسعر ٠٫٣٠`, []);
    const updated = applyReplyProposal(cheap, p, { priceAmount: "adopt" }, new Set(), 2);
    const after = decide([resolveOffer(updated), resolveOffer(pricier)], r, TODAY, "cash");
    expect(after.verdict).toMatchObject({ kind: "recommend", winnerId: "A" });

    const lines = explainDecisionChange(before, after).join(" ");
    expect(lines).toContain("أصبح مورد الاختبار مستوفيًا لشرط «الأغطية»");
    expect(lines).toContain("تغيّرت التوصية من مورد ب إلى مورد الاختبار");
  });
});
