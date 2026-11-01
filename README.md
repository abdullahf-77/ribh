# رِبح (Ribh)

An AI procurement assistant for small Saudi cafés buying disposable cups. It answers: **which supplier offer actually meets my requirements, what will fulfilling my order cost, and what should I clarify before buying?**

The name and look are temporary. Both are configurable (see [Identity](#identity)).

## The journey

Define requirements → prepare a quotation request → enter 2–3 supplier offers → review extracted data → compare → clarify missing information → update the decision.

The app never sends messages or places orders. The user copies text and acts themselves.

## Who does what

The core design rule: **Llama reads and writes language; code does every number and every decision.**

| Llama (`src/llm`) | Application code (`src/domain`) |
| --- | --- |
| Extracts requirements from natural Arabic or English | Validates all input and model output (Zod) |
| Extracts offers: specs, packaging, price basis, VAT status, tiers, charges | Multiplies package levels, rounds to full packages, applies MOQs |
| Extracts stated changes from supplier replies | Calculates costs in integer halalas (`big.js`), VAT, delivery, tiers |
| Flags ambiguity and contradictions | Checks each mandatory requirement: meets / does not meet / unknown |
| Drafts the RFQ, clarification messages and summary | Applies budget and date checks, eligibility gates, ranking |

Llama never receives the job of calculating a total or picking a winner. It receives computed results to explain, and the text is checked before display: invented numbers, a different winner, or quality and confidence claims cause it to be discarded in favour of the deterministic text. RFQ drafts are checked the same way: quantity and size preserved, no new numbers, no leaked budget.

## Architecture

```
src/
  config/brand.ts        Name, VAT assumption with source, input limits
  domain/                Pure, tested, no I/O
    schemas.ts           Zod schemas for model output and confirmed data
    evidence.ts          Quote verification, numeral handling, requirement validation
    offer-state.ts       Versioned fields: offer / reply / user, nothing overwritten
    cost.ts              Packaging, MOQ, tiers, delivery, VAT, totals, budget
    decision.ts          Compatibility, dates, eligibility gates, ranking
    discount.ts          Quantity-discount scenarios and inventory coverage
    replies.ts           Proposed changes, conflicts, applying a reply to one offer
    rfq.ts               RFQ facts, gaps, template, draft validation
    questions.ts         Clarification questions from what is actually unresolved
    explain.ts           Deterministic text, narrative validation, decision diffs
  llm/
    provider.ts          The only host-specific code: timeouts, bounded retries, Llama-only guard
    prompts.ts           System prompts; pasted text is delimited as untrusted data
    service.ts           One function per AI task; falls back to fixtures only in demo mode
  demo/                  Fictional scenarios with documented expected outcomes
  app/api/*              Thin routes: size limit, Zod validation, rate limit, safe errors
  components/            Arabic-first RTL guided workflow
eval/                    Held-out extraction set, scorer, live smoke test, test-only mock
tests/                   Vitest suites
```

The workflow is stateless: no database or accounts, and offer text is never logged. State lives in the browser tab and disappears when it closes.

### Reliability rules worth explaining

- **Evidence:** every extracted value needs a quote that really occurs in the submitted text (only whitespace, tashkeel and direction marks are normalized). Without one, the value is rejected and stays unknown. A number absent from its quote is flagged for review.
- **Unknown is never zero:** missing data is `null` everywhere. A total appears only when every component is known; otherwise a known subtotal is shown, clearly marked incomplete.
- **Eligibility gates before ranking:** offers are separated into confirmed, needs clarification, and failing. Only confirmed offers rank. With unresolved alternatives the recommendation stays conditional and never claims "cheapest".
- **VAT:** never double-added, and no rate is assumed. For an exclusive price with no stated rate, the user may explicitly apply 15% ([ZATCA guideline](https://zatca.gov.sa/ar/HelpCenter/guidelines/Documents/VAT15.pdf), effective 2020-07-01); this is recorded as their assumption. The tax treatment of delivery and other charges is not assumed either.
- **Replies are not authoritative:** a conflict with existing data blocks applying until the user chooses. Pasted replies are labelled as user-supplied, not authenticated.
- **Untrusted text:** instructions inside an offer are treated as data, and the evidence check stops values a manipulated model might invent.
- **Scenario edits** (quantity, budget, deadline, priority, consumption) recalculate locally with no model call. Changing "other requirements" shows that re-reading is needed.

## Llama provider

Checked 2026-11-01 against live data, because many tutorials are out of date:

- [Groq's deprecation page](https://console.groq.com/docs/deprecations) lists all its Llama chat models as retired (Maverick on 2026-03-09, Scout on 2026-07-17, Llama 3.3 70B and 3.1 8B on 2026-08-16).
- [OpenRouter's public models API](https://openrouter.ai/api/v1/models) lists `meta-llama/llama-4-maverick` with `structured_outputs` support, served by several hosts.

The default is therefore OpenRouter with Llama 4 Maverick and strict JSON schema. The adapter works with any OpenAI-compatible host through environment variables. It refuses a model name without "llama", refuses a response reporting a different model, and on OpenRouter asks only for hosts that honor the schema.

**Licence:** Llama is used under Meta's [Llama 4 Community License](https://www.llama.com/llama4/license/). The app displays "Built with Llama" as that licence requires.

## Setup

Requires Node 20 or later.

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

Without `LLAMA_API_KEY` the app runs in **demo mode**, with a permanent label. Fictional examples are answered from stored fixtures that pass through the same validation as live output. Any other text is refused rather than faked, but requirements and offers can still be entered by hand, and all calculations work.

### Enable and verify live Llama

1. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys) and put it in `.env.local` as `LLAMA_API_KEY`.
2. Run one real request per AI task:

```bash
npm run smoke:llama
```

3. Measure extraction on the held-out set. This writes `eval/results.json`:

```bash
npm run eval:extraction
```

### Checks

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run build
```

## Deploy

The app uses server routes, so it needs a Node host, not static hosting such as GitHub Pages. For [Vercel](https://vercel.com/docs/deployments):

1. Push this repository to GitHub and import it in Vercel. No build settings are needed.
2. Add `LLAMA_API_KEY` (and optionally `LLAMA_BASE_URL`, `LLAMA_MODEL`) under Environment Variables.
3. Deploy, then confirm the header shows "التحليل يعمل عبر Llama" and run the full-journey example.

Routes declare `maxDuration = 60`. The rate limiter is per server instance and best-effort, so set a spending limit on the provider key as well.

## Demo scenarios

All suppliers, prices and replies are fictional. No scenario contains a pre-selected winner: tests run each one through the real engine and compare with these documented outcomes (priority: lowest payment).

| Scenario | Tests | Expected outcome |
| --- | --- | --- |
| `delivery-flip` | Cheaper price, costly delivery | 0.38 + 300 delivery = 1,440; loses to 0.42 free delivery = 1,260 |
| `moq-payment` | Lower unit price, higher payment | 5,000 MOQ at 0.35 = 1,750 vs 1,440; wins only on unit-cost priority |
| `unresolved-attractive` | Printing, VAT, delivery unknown | The 0.29 offer stays "clarify"; recommendation is conditional |
| `different-sizes` | Different cup size | 12 oz fails despite a lower total |
| `missing-lids` | Lid inclusion unknown | Unknown, not failed; recommendation conditional |
| `nested-packaging` | 20 packs × 50 cups, Arabic numerals | 1,000 per carton computed in code; competitor has 200 excess |
| `fixed-lot` | Lot smaller than request | 2,000-cup lot fails; never repeated or prorated |
| `user-correction` | Correction flips result | After correcting to excluded + 15%: 1,380 loses to 1,260 |
| `no-deadline-match` | Nobody meets the date | "No eligible offer", stated plainly |
| `full-journey` | RFQ, discount, reply, update | 5 cartons: 0.42/cup, +660 now. After the reply, recommendation moves from الوفرة (1,440) to الربوة (1,200) |

## Evaluation results

- **Tests:** run `npm test` for the current count. Suites cover money, packaging, MOQ, lots, VAT, fees, compatibility, dates, ranking after edits, tiers (all-unit vs incremental, boundaries), coverage, evidence, schemas, RFQ, replies and conflicts, supplier isolation, the provider adapter, API routes, and every demo scenario.
- **Live extraction quality:** **not measured yet.** No API key was available during development. `eval/heldout.ts` holds 15 synthetic examples kept apart from the demos, and `npm run eval:extraction` reports correct, missed, wrong and invented fields. No accuracy claim is made until it has been run.

## Known limitations

- Live Llama behaviour is unverified until the smoke test runs. Prompts have not been tuned on real responses and may need adjusting.
- Demo data is synthetic and does not represent real Saudi prices or suppliers.
- Scope is deliberately narrow: one cup specification per comparison, text input only.
- City matching uses a small alias table; unlisted spellings can read as "does not meet" and should be corrected on the review screen.
- Budget overruns count as failing a requirement. Raise the budget in the scenario panel to explore further.
- Business-day lead times skip Fridays and Saturdays but not public holidays.
- Passing tests and a build does not make this production-proven: it has had no real users or real supplier text.

## Identity

The brand is deliberately unfinished. Change the name in `src/config/brand.ts` or through `NEXT_PUBLIC_BRAND_NAME_AR`, and colors, radii, shadows and type through the tokens in `src/app/globals.css`. Components only reference tokens.
