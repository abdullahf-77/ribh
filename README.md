# رِبح (Ribh)

A Llama-powered, Arabic-first purchasing assistant for small Saudi cafés, covering **cups, lids, bags, napkins and takeaway packaging**. It answers: **which supplier offer actually meets my requirements, what will fulfilling my order cost, and what should I clarify before buying?**

One comparison covers one product and two or three offers. Anything else is refused with an explanation rather than compared unreliably.

## The workspace

One page, with a Llama-powered assistant in a resizable, collapsible side panel and structured sections beside it. On mobile, tabs switch between «المساعد» and «المقارنة» in the same session.

| Section | Holds |
| --- | --- |
| Recommendation banner | Current verdict, conditions, and an active scenario |
| Requirements | Summary with editing, previews of conflicts, and category switching |
| Supplier offers | Specifications, prices, what is missing, evidence links, confirm and edit |
| Comparison | Cost breakdown table (stacked cards on mobile) with per-requirement evidence |
| Scenarios and discount | Quantity, budget, deadline, priority, and quantity-discount analysis |
| Supplier clarification | Questions from actual gaps, reply paste, change preview, history |
| Quotation request | Editable draft with copy; flagged when requirements have since changed |

The assistant gathers requirements, asks targeted questions, accepts pasted offers and replies, explains results, and processes changes. It keeps messages short and links to the section that changed. Chat and workspace share one validated session, sent with every turn, so edits in either place are seen by the other and by Llama. A chat message describing a result is marked outdated once that result changes.

### Product categories

`src/domain/categories.ts` is the single definition of each product's specifications, and validation, prompts, questions, comparison checks and forms all read from it. Shared fields (quantity, packaging, price, VAT, delivery, MOQ, deadline) are the same everywhere, and the money engine has no category logic. Only a category's own fields survive validation, so a napkin buyer is never asked about cup sizes. Changing category asks for confirmation, then clears the old specifications and offers.

The app never sends messages or places orders. The user copies text and acts themselves.

### How a turn works

```
user message + recent history + structured state
        ↓
1. Llama reads it into a typed plan (requirement updates, offers, reply, what-if, ...)
        ↓
2. Code validates the plan: every value must be quoted from the user's own message,
   and offer text must be copied exactly. Differences from held values become conflict cards.
        ↓
3. Existing services extract offers; the deterministic engine computes the decision.
        ↓
4. Llama explains the computed result. Its text is checked for invented numbers, a different
   winner, quality claims, and questions about known fields. Failing text is replaced by computed text.
```

Each assistant message is labelled: **رد Llama**, **رد تجريبي محفوظ** (demo), or **محسوب من بياناتك** (written by code). Card actions such as confirming, editing and changing quantity recalculate locally with no model call.

Structured state (requirements, evidence, waived fields, offers with version history, confirmations, priority) lives in the browser tab and is sent with each turn. Nothing is stored on the server. Pasted offer text is not included in the state sent back to the planning prompt.

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
    categories.ts        Supported products and their specifications
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
  app/api/chat           The conversation endpoint; other api/* routes expose single tasks
  app/api/_lib.ts        Size limit, Zod validation, rate limit, safe errors
  chat/                  Session state, plan schema, prompts, and the turn orchestrator (turn.ts)
  components/workspace/  App state, assistant panel, and workspace sections
  components/            Brand assets, offer review form, discount section, shared controls
eval/                    Held-out extraction set, scorer, multi-turn live smoke test
tests/                   Vitest suites
```

The workflow is stateless: no database or accounts, and offer text is never logged. State lives in the browser tab and disappears when it closes.

### Reliability rules worth explaining

- **Evidence:** every extracted value needs support in the submitted text. Matching tolerates whitespace, tashkeel, direction marks, the Arabic "لل" prefix, and a shortened phrase whose words appear in order at most two words apart; a number written literally in the source counts as its own evidence. The evidence stored is always the real source span, never the model's words. Without support the value is rejected and stays unknown. The product category is a classification checked against the catalogue, so it needs no quote.
- **Unknown is never zero:** missing data is `null` everywhere. A total appears only when every component is known; otherwise a known subtotal is shown, clearly marked incomplete.
- **Eligibility gates before ranking:** offers are separated into confirmed, needs clarification, and failing. Only confirmed offers rank. With unresolved alternatives the recommendation stays conditional and never claims "cheapest".
- **VAT:** never double-added, and no rate is assumed. For an exclusive price with no stated rate, the user may explicitly apply 15% ([ZATCA guideline](https://zatca.gov.sa/ar/HelpCenter/guidelines/Documents/VAT15.pdf), effective 2020-07-01); this is recorded as their assumption. The tax treatment of delivery and other charges is not assumed either.
- **Replies are not authoritative:** a conflict with existing data blocks applying until the user chooses. Pasted replies are labelled as user-supplied, not authenticated.
- **Untrusted text:** instructions inside an offer are treated as data, and the evidence check stops values a manipulated model might invent. A message carrying an offer or reply can never change the buyer's requirements.
- **Scenario edits** (quantity, budget, deadline, priority, consumption) recalculate locally with no model call. Changing "other requirements" shows that re-reading is needed.

## Llama provider

Checked 2026-11-01 against live data, because many tutorials are out of date:

- [Groq's deprecation page](https://console.groq.com/docs/deprecations) lists all its Llama chat models as retired (Maverick on 2026-03-09, Scout on 2026-07-17, Llama 3.3 70B and 3.1 8B on 2026-08-16).
- [OpenRouter's public models API](https://openrouter.ai/api/v1/models) lists `meta-llama/llama-4-maverick` with `structured_outputs` support, served by several hosts.

The default is therefore OpenRouter with Llama 4 Maverick and strict JSON schema. Requests try Parasail first (`LLAMA_HOST_ORDER`): measured on 2026-11-01, one offer took about 10 seconds there and about 66 on the default route, at about twice the cost per call. Other hosts of the same model remain as fallback, and a slow fallback can still cause timeouts. The adapter works with any OpenAI-compatible host through environment variables. It refuses a model name without "llama", refuses a response reporting a different model, and on OpenRouter asks only for hosts that honor the schema.

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

Without `LLAMA_API_KEY` the app runs in **demo mode**, with a permanent label. It is a set of fixed fictional walkthroughs, one per product: suggested messages stand in for Llama's reading of those exact texts, and everything after that runs through the real validation and engine. Free text is refused rather than faked, so demo mode is not a substitute for the live assistant.

### Enable and verify live Llama

1. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys) and put it in `.env.local` as `LLAMA_API_KEY`.
2. Run a real multi-turn conversation (requirements, follow-ups, RFQ, offers, comparison, why, what-if, supplier reply, every category, unsupported product, category switch):

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

Routes declare `maxDuration = 120`, and `.vercelignore` keeps env files out of the upload. The rate limiter is per server instance and best-effort, so set a spending limit on the provider key as well.

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
| `lids-basic` | Other category, conflicting reply | Flat lid fails despite a 600 total; sip lid 900, and the reply's 200-per-carton price needs a choice |
| `bags-basic` | Unknown printing | Cheaper bag stays "clarify"; recommendation is conditional |
| `napkins-basic` | Ply and carton rounding | 1-ply fails; 5 cartons = 720 with 2,000 excess |
| `takeaway-basic` | Capacity and VAT | 500 ml fails; 750 ml with 15% stated VAT = 1,035 |
| `full-journey` | RFQ, discount, reply, update | 5 cartons: 0.42/cup, +660 now. After the reply, recommendation moves from الوفرة (1,440) to الربوة (1,200) |

## Evaluation results

- **Tests:** run `npm test` for the current count. Suites cover money, packaging, MOQ, lots, VAT, fees, compatibility, dates, ranking after edits, tiers (all-unit vs incremental, boundaries), coverage, evidence, schemas, RFQ, replies and conflicts, supplier isolation, the provider adapter, API routes, and every demo scenario.
- **Live conversation:** `npm run smoke:llama` passed against real `meta-llama/llama-4-maverick` through OpenRouter on 2026-11-01, covering requirements, follow-ups, quotation, offers, comparison, why, what-if, a supplier reply that changed the recommendation, four other categories, an unsupported product and a category switch. Replies vary between runs, because the model is not deterministic.
- **Live extraction quality:** **not measured yet.** No API key was available during development. `eval/heldout.ts` holds 19 synthetic examples kept apart from the demos, and `npm run eval:extraction` reports correct, missed, wrong and invented fields. No accuracy claim is made until it has been run.

## Known limitations

- Live Llama behaviour is unverified until the smoke test runs. Prompts have not been tuned on real responses and may need adjusting, especially the planning prompt, which uses a large strict schema.
- A turn with several offers makes several model calls and can take 20 to 40 seconds, or time out on a slow host. The user then gets a clear error and a retry button.
- Model quality varies: it can miss a stated detail or ask something it could have read. Unsupported values are rejected, and everything is editable, but a missed value has to be supplied or corrected by the user.
- When the key's credits run out, requests return a clear message, and manual entry and calculations keep working.
- Demo data is synthetic and does not represent real Saudi prices or suppliers.
- Scope is deliberately narrow: five product types, one product per comparison, text input only.
- Free-text specs such as colour cannot be judged by code unless they match exactly, so they stay unknown for the buyer to resolve.
- A "what if" question is applied as a labelled scenario across the workspace; the confirmed order changes only when the buyer adopts it.
- City matching uses a small alias table; unlisted spellings can read as "does not meet" and should be corrected on the review screen.
- Budget overruns count as failing a requirement. Raise the budget in the scenario panel to explore further.
- Business-day lead times skip Fridays and Saturdays but not public holidays.
- Passing tests and a build does not make this production-proven: it has had no real users or real supplier text.

## Identity

Applied from `Ribh_Brand_Kit` (approved option 01). The logo files are in `public/brand`, shown as supplied through `src/components/Brand.tsx`, and the symbol is the avatar and favicon. Colors, radii and shadows are tokens in `src/app/globals.css`.

Measured contrast: brand green on pale green is 3.43:1, below AA for small text, so confirmed-state text uses a darker `#0B6B4A` (5.89:1) and brand green stays on the logo and graphics. White on brand blue is 5.34:1. Ink on white is 12.95:1.
