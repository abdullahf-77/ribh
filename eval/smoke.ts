/* Real multi-turn conversation against the configured Llama host: requirements, follow-up answers, RFQ,
   offers, confirmation, comparison, why, what-if and a supplier reply. Exits non-zero on any failure.
   Prints where each reply came from, so a fallback to computed text is visible rather than hidden. */
import { initialState, currentDecision, missingFields } from "../src/chat/state";
import { runTurn } from "../src/chat/turn";
import type { ConversationState, TurnEvent, TurnResponse } from "../src/chat/types";
import { scenarios } from "../src/demo/scenarios";
import { CATEGORIES, CATEGORY_IDS } from "../src/domain/categories";
import { applyReplyProposal } from "../src/domain/replies";
import { readConfig } from "../src/llm/provider";

const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
};
let failures = 0;

async function main() {
  const cfg = readConfig();
  if (!cfg) {
    console.error("NOT RUN: LLAMA_API_KEY is not set. Live Llama is not verified.");
    process.exit(2);
  }
  console.log(`host ${cfg.baseUrl}, model ${cfg.model}\n`);
  const today = new Date().toISOString().slice(0, 10);
  const journey = scenarios.find((s) => s.id === "full-journey")!;
  let state: ConversationState = initialState(today);
  const history: { role: "user" | "assistant"; text: string }[] = [];

  const step = async (label: string, input: { text?: string; event?: TurnEvent }): Promise<TurnResponse> => {
    let r: TurnResponse;
    const started = Date.now();
    try {
      r = await runTurn({ text: input.text ?? null, event: input.event ?? null, history, state, today }, cfg);
    } catch (e) {
      check(false, `${label}: ${(e as { code?: string }).code ?? (e as Error).message}`);
      return { mode: "live", reply: "", replySource: "computed", blocks: [], patch: {} };
    }
    console.log(`(${Date.now() - started}ms)`);
    const p = r.patch;
    state = { ...state, ...(p.requirements && { requirements: p.requirements }), ...(p.reqEvidence && { reqEvidence: p.reqEvidence }), ...(p.waived && { waived: p.waived }), ...(p.offers && { offers: p.offers }), ...(p.rejected && { rejected: p.rejected }), ...(p.priority && { priority: p.priority }), ...(p.analyzedOtherKey && { analyzedOtherKey: p.analyzedOtherKey }), ...(p.scenarioQuantity !== undefined && { scenarioQuantity: p.scenarioQuantity }) };
    if (input.text) history.push({ role: "user", text: input.text });
    history.push({ role: "assistant", text: r.reply });
    console.log(`\n[${label}] (${r.replySource}, ${r.servedModel}) ${r.reply}\nblocks: ${r.blocks.map((b) => b.type).join(", ") || "none"}`);
    return r;
  };

  const first = await step("first message", { text: "السلام عليكم، أبي أكواب ورقية للمشروبات الساخنة لمقهاي في الرياض" });
  check(first.replySource === "llama", "reply written by the model");
  check(state.requirements.city != null, "city understood");

  const second = await step("follow-up", { text: "٣٠٠٠ كوب مقاس ٨ أونصات مع أغطية" });
  check(state.requirements.quantity === 3000 && state.requirements.sizeOz === 8, "quantity and size kept");
  check(second.replySource === "llama", "follow-up accepted, so it did not re-ask known fields");

  await step("delivery and budget", { text: "خلال ١٠ أيام، وميزانيتي ١٥٠٠ ريال شاملة التوصيل والضريبة، وما أحتاج طباعة" });
  check(state.requirements.budgetSar === 1500 && state.requirements.requiredDate != null, "budget and date kept");
  console.log("still missing:", missingFields(state));

  const rfq = await step("quotation request", { text: "جهّز لي طلب عرض سعر" });
  const draft = rfq.blocks.find((b) => b.type === "rfq");
  check(!!draft, "quotation drafted");
  if (draft?.type === "rfq") { console.log(`source: ${draft.source}\n${draft.message}`); check(!draft.message.includes("1500") && !draft.message.includes("1,500"), "budget withheld"); }

  const texts = journey.offers.map((o) => o.text);
  await step("offers pasted", { text: `وصلتني هذي العروض:\n\n${texts.join("\n\n")}` });
  check(state.offers.length === 3, "three offers identified and extracted");
  for (const o of state.offers) console.log(o.id, Object.fromEntries(Object.entries(o.fields).filter(([, f]) => f.versions[f.active]?.value != null).map(([k, f]) => [k, f.versions[f.active].value])));
  console.log("rejected:", state.rejected);

  state = { ...state, confirmedOfferIds: state.offers.map((o) => o.id) };
  const compared = await step("comparison", { event: { type: "compare" } });
  check(compared.blocks.some((b) => b.type === "comparison"), "comparison produced");
  console.log("requirements:", JSON.stringify(state.requirements));
  console.log("verdict:", currentDecision(state)?.verdict, JSON.stringify(currentDecision(state)?.evaluations.map((e) => [e.label, e.category, e.cost.totalHalalas, e.failReasons, e.blockers, e.cost.missing])));

  const why = await step("why", { text: "ليش هذا المورد؟" });
  check(why.replySource === "llama", "explanation passed verification");

  const whatIf = await step("what if", { text: "وش لو اشتريت ٥٠٠٠؟" });
  check(whatIf.blocks.some((b) => b.type === "comparison") && state.requirements.quantity === 3000, "what-if shown as a scenario without changing the order");

  state = { ...state, scenarioQuantity: null };
  const before = currentDecision(state);
  const replyTurn = await step("supplier reply", { text: `هذا رد مصنع الربوة: ${journey.reply!.text}` });
  const proposal = replyTurn.blocks.find((b) => b.type === "proposal");
  check(!!proposal, "reply matched to its supplier and previewed");
  if (proposal?.type === "proposal") {
    console.log(proposal.proposal.changes.map((c) => [c.field, c.kind, c.previous, c.proposed]));
    const offer = state.offers.find((o) => o.id === proposal.proposal.offerId)!;
    const choices = Object.fromEntries(proposal.proposal.changes.filter((c) => c.kind === "conflict").map((c) => [c.field, "adopt" as const]));
    const updated = applyReplyProposal(offer, proposal.proposal, choices, new Set(), Date.now());
    state = { ...state, offers: state.offers.map((o) => (o.id === updated.id ? updated : o)) };
    console.log("before:", before?.verdict, "\nafter:", currentDecision(state)?.verdict);
  }

  // Category coverage: each product is read, its specs validated, and nothing from another product leaks.
  for (const c of CATEGORY_IDS) {
    if (c === "cups") continue;
    state = initialState(today);
    history.length = 0;
    await step(`${c} request`, { text: CATEGORIES[c].example });
    check(state.requirements.category === c, `${c}: category identified`);
    check(state.requirements.sizeOz == null || c === "lids", `${c}: no cup size leaked`);
  }

  state = initialState(today);
  history.length = 0;
  const unsupported = await step("unsupported product", { text: "أبي أقارن عروض حبوب قهوة" });
  check(unsupported.reply.includes("لا أقارن"), "unsupported product refused");

  history.length = 0;
  state = { ...initialState(today), requirements: { ...initialState(today).requirements, category: "cups", product: "أكواب", quantity: 3000 } };
  const switching = await step("switch request", { text: "طيب أبي الحين أقارن مناديل" });
  check(switching.blocks.some((b) => b.type === "switch_category"), "switch asks before replacing");

  console.log(failures ? `\nSMOKE FINISHED WITH ${failures} FAILED CHECK(S)` : "\nSMOKE OK");
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e.code ?? e.message);
  process.exit(1);
});
