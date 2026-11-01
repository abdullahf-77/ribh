/* One real request per AI task against the configured host. Exits non-zero on any failure. */
import { scenarios } from "../src/demo/scenarios";
import { decide } from "../src/domain/decision";
import { newOfferState } from "../src/domain/evidence";
import { resolveOffer } from "../src/domain/offer-state";
import { readConfig } from "../src/llm/provider";
import { composeNarrative, draftRfq, extractOffer, extractReply, extractRequirements } from "../src/llm/service";

async function main() {
  const cfg = readConfig();
  if (!cfg) {
    console.error("NOT RUN: LLAMA_API_KEY is not set. Live Llama is not verified.");
    process.exit(2);
  }
  console.log(`host ${cfg.baseUrl}, model ${cfg.model}`);
  const s = scenarios.find((x) => x.id === "full-journey")!;
  const today = new Date().toISOString().slice(0, 10);

  const r = await extractRequirements(s.requirementText, today, cfg);
  console.log("requirements:", r.requirements.quantity, r.requirements.sizeOz, r.requirements.requiredDate, "rejected:", r.rejected);
  if (r.requirements.quantity !== 3000) throw new Error("quantity not extracted");

  const offers = [];
  for (const [i, o] of s.offers.entries()) {
    const id = "ABC"[i];
    const e = await extractOffer(id, o.text, [], cfg);
    console.log(`offer ${id}: rejected`, e.validated.rejected.map((x) => x.field));
    offers.push(newOfferState(id, id, o.text, e.validated, 1));
  }

  const d = decide(offers.map(resolveOffer), r.requirements, today, "cash");
  console.log("verdict:", d.verdict, d.evaluations.map((e) => [e.category, e.cost.totalHalalas]));

  const rfq = await draftRfq(r.requirements, false, cfg);
  console.log("rfq source:", rfq.source, rfq.reason ?? "");

  const compose = await composeNarrative({ decision: d, questions: [] }, cfg);
  console.log("summary source:", compose.summarySource);

  const reply = await extractReply(s.reply!.text, {}, [], [], cfg);
  console.log("reply lids:", reply.raw.lids);
  console.log("SMOKE OK");
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e.code ?? e.message);
  process.exit(1);
});
