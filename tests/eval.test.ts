import { describe, expect, it } from "vitest";
import { rawOffer, v } from "@/demo/build";
import { scenarios } from "@/demo/scenarios";
import { validateRawOffer } from "@/domain/evidence";
import { heldOut } from "../eval/heldout";
import { scoreExample } from "../eval/score";

describe("held-out set", () => {
  it("shares no text with the demo scenarios", () => {
    const demo = new Set(scenarios.flatMap((s) => s.offers.map((o) => o.text)));
    expect(heldOut.every((h) => !demo.has(h.text))).toBe(true);
    expect(new Set(heldOut.map((h) => h.id)).size).toBe(heldOut.length);
  });
});

describe("scorer", () => {
  const text = "كوب ٨ أونصات بسعر ٤٠ هللة";
  const validated = validateRawOffer(rawOffer({ cupSizeOz: v(8, "٨ أونصات"), priceAmount: v(0.4, "٤٠ هللة"), moq: v(100, "٨ أونصات") }), "offer:A", text, []);

  it("separates correct, invented, missed and wrong", () => {
    const s = scoreExample(validated, { cupSizeOz: 8, priceAmount: 0.5, moq: null, lids: "included" });
    expect(s).toMatchObject({ correct: 1, total: 4, wrong: 1, invented: 1, missed: 1 });
  });
});
