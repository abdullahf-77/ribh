import { describe, expect, it } from "vitest";
import { scenarios } from "@/demo/scenarios";
import { decide } from "@/domain/decision";
import { analyzeDiscount } from "@/domain/discount";
import { explainDecisionChange } from "@/domain/explain";
import { newOfferState, validateRawOffer, validateRawRequirements } from "@/domain/evidence";
import { correctField, resolveOffer } from "@/domain/offer-state";
import { applyReplyProposal, buildReplyProposal } from "@/domain/replies";
import { deterministicRfq, rfqFacts, validateRfqDraft } from "@/domain/rfq";
import { TODAY } from "./helpers";

function load(id: string) {
  const s = scenarios.find((x) => x.id === id)!;
  const { requirements, rejected } = validateRawRequirements(s.rawRequirements, s.requirementText, TODAY);
  const ids = ["A", "B", "C"];
  const offers = s.offers.map((o, i) => newOfferState(ids[i], ids[i], o.text, validateRawOffer(o.raw, `offer:${ids[i]}`, o.text, []), 1));
  return { s, requirements, rejected, offers };
}

describe("every scenario passes the same pipeline as live output", () => {
  for (const s of scenarios) {
    it(`${s.id}: all fixture evidence verifies and no values are flagged`, () => {
      const { rejected, offers } = load(s.id);
      expect(rejected).toEqual([]);
      s.offers.forEach((o, i) => {
        const v = validateRawOffer(o.raw, `offer:${i}`, o.text, []);
        expect(v.rejected).toEqual([]);
        for (const [k, f] of Object.entries(v.fields)) expect(f.flag, `${k}`).toBeNull();
      });
      expect(offers.length).toBeGreaterThanOrEqual(2);
      expect(s.offers.every((o) => o.text.includes("خيالي"))).toBe(true);
    });

    it(`${s.id}: decision engine produces the documented outcome`, () => {
      const { requirements, offers } = load(s.id);
      const d = decide(offers.map(resolveOffer), requirements, TODAY, "cash");
      expect(d.verdict.kind).toBe(s.expected.verdict);
      expect(d.evaluations.map((e) => e.category)).toEqual(s.expected.categories);
      if (s.expected.winnerIndex != null) expect((d.verdict as { winnerId: string }).winnerId).toBe(["A", "B", "C"][s.expected.winnerIndex]);
      if (s.expected.totalsSar) expect(d.evaluations.map((e) => (e.cost.totalHalalas == null ? null : e.cost.totalHalalas / 100))).toEqual(s.expected.totalsSar);
    });
  }

  it("moq scenario flips with the unit-cost priority", () => {
    const { requirements, offers } = load("moq-payment");
    expect(decide(offers.map(resolveOffer), requirements, TODAY, "unit").verdict).toMatchObject({ winnerId: "A" });
  });

  it("correction scenario flips recommendation after a user correction", () => {
    const { requirements, offers } = load("user-correction");
    const before = decide(offers.map(resolveOffer), requirements, TODAY, "cash");
    let a = correctField(offers[0], "vatStatus", "excluded", 2);
    a = correctField(a, "vatRatePercent", 15, 2);
    const after = decide([resolveOffer(a), resolveOffer(offers[1])], requirements, TODAY, "cash");
    expect(after.verdict).toMatchObject({ winnerId: "B" });
    expect(explainDecisionChange(before, after).join(" ")).toContain("تغيّرت التوصية");
  });

  it("nested packaging computes 1000 per carton", () => {
    const { requirements, offers } = load("nested-packaging");
    const d = decide(offers.map(resolveOffer), requirements, TODAY, "cash");
    expect(d.evaluations[0].cost.unitsPerPackage).toBe(1000);
    expect(d.evaluations[1].cost.excess).toBe(200);
  });
});

describe("integrated journey", () => {
  it("runs RFQ, discount tradeoff, reply review and updated decision", () => {
    const { s, requirements, offers } = load("full-journey");

    // RFQ before any offers, budget withheld.
    const facts = rfqFacts(requirements, false);
    const rfq = deterministicRfq(facts);
    expect(validateRfqDraft(rfq, facts, requirements.budgetSar)).toEqual([]);
    expect(rfq).not.toContain("1,500");

    const before = decide(offers.map(resolveOffer), requirements, TODAY, "cash");
    expect(before.verdict).toMatchObject({ winnerId: "A" });

    // Discount tradeoff on the first supplier.
    const a = analyzeDiscount(resolveOffer(offers[0]), requirements, { currentStock: null, dailyUse: null, maxCoverageDays: null });
    expect(a.conclusion).toBe("lower_unit_higher_payment");
    expect(a.scenarios[1].cost.totalHalalas).toBe(210000);
    expect(a.scenarios[1].extraPaymentHalalas).toBe(66000);
    expect(a.scenarios[1].coverageDays).toBeNull();

    // Reply for supplier B only.
    const reply = s.reply!;
    const p = buildReplyProposal(offers[1], reply.raw, "reply:B:1", reply.text, []);
    expect(p.changes.find((c) => c.field === "lids")?.kind).toBe("resolves_unknown");
    expect(p.changes.some((c) => c.kind === "conflict")).toBe(false);
    const updated = applyReplyProposal(offers[1], p, {}, new Set(), 2);

    const after = decide([resolveOffer(offers[0]), resolveOffer(updated), resolveOffer(offers[2])], requirements, TODAY, "cash");
    expect(after.verdict).toEqual({ kind: "recommend", winnerId: "B" });
    expect(after.evaluations[1].cost.totalHalalas).toBe(120000);
    expect(after.evaluations[0].cost.totalHalalas).toBe(before.evaluations[0].cost.totalHalalas);
    const lines = explainDecisionChange(before, after).join(" ");
    expect(lines).toContain("مستوفيًا لشرط «الأغطية»");
    expect(lines).toContain("تغيّرت التوصية من الوفرة للتغليف إلى مصنع الربوة");
  });
});
