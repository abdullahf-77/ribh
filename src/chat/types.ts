import { z } from "zod";
import type { CategoryId } from "@/domain/categories";
import type { Decision, Priority } from "@/domain/decision";
import type { OfferState } from "@/domain/offer-state";
import type { ReplyProposal } from "@/domain/replies";
import { RawRequirementsSchema, Requirements, RequirementsSchema } from "@/domain/schemas";

/* ---------- Structured state, kept for the whole conversation and sent with each turn ---------- */

export type ConversationState = {
  requirements: Requirements;
  reqEvidence: Record<string, string>;
  /** Fields the buyer said do not matter. They are not asked about again. */
  waived: string[];
  offers: OfferState[];
  confirmedOfferIds: string[];
  rejected: Record<string, { field: string; quote: string | null }[]>;
  priority: Priority;
  orderDate: string;
  /** Other-requirements list the offers were last read against. */
  analyzedOtherKey: string;
  /** A what-if quantity the workspace is showing. The confirmed order stays in requirements. */
  scenarioQuantity: number | null;
};


/* ---------- What Llama returns when it reads a user message ---------- */

export const TurnPlanSchema = z.object({
  reply: z.string(),
  asks: z.array(z.string()),
  requirementUpdates: RawRequirementsSchema,
  waived: z.array(z.string()),
  unsupportedProduct: z.string().nullable(),
  offers: z.array(z.object({ supplierHint: z.string().nullable(), text: z.string() })),
  supplierReply: z.object({ offerId: z.string().nullable(), text: z.string() }).nullable(),
  generateRfq: z.object({ includeBudget: z.boolean() }).nullable(),
  showComparison: z.boolean(),
  explainDecision: z.boolean(),
  whatIfQuantity: z.number().nullable(),
  setPriority: z.enum(["cash", "unit", "earliest"]).nullable(),
  showDiscount: z.boolean(),
});
export type TurnPlan = z.infer<typeof TurnPlanSchema>;

export const ChatReplySchema = z.object({ reply: z.string() });

/* ---------- Rich content rendered inside assistant messages ---------- */

export type Block =
  | { type: "requirements" }
  | { type: "req_conflict"; id: string; field: string; current: unknown; proposed: unknown; quote: string | null; status: "open" | "kept" | "adopted" }
  | { type: "offer"; offerId: string }
  | { type: "offer_failed"; id: string; text: string; supplierHint: string | null; message: string }
  | { type: "rfq"; message: string; source: "llama" | "template"; reason: string | null; includeBudget: boolean }
  | { type: "comparison"; decision: Decision; quantity: number; baselineQuantity: number }
  | { type: "discount"; quantity: number }
  | { type: "proposal"; proposal: ReplyProposal; status: "open" | "applied" | "cancelled" }
  | { type: "choose_offer"; text: string }
  | { type: "reanalyze" }
  | { type: "changes"; offerLabel: string; lines: string[] }
  | { type: "switch_category"; id: string; from: CategoryId; to: CategoryId; text: string; status: "open" | "confirmed" | "cancelled" };

export type ReplySource = "llama" | "demo" | "computed";

export type TurnResponse = {
  mode: "live" | "demo";
  reply: string;
  replySource: ReplySource;
  blocks: Block[];
  patch: {
    requirements?: Requirements;
    reqEvidence?: Record<string, string>;
    waived?: string[];
    offers?: OfferState[];
    rejected?: ConversationState["rejected"];
    priority?: Priority;
    analyzedOtherKey?: string;
    scenarioQuantity?: number | null;
  };
};

/* ---------- Request ---------- */

const OfferStateSchema = z.object({
  id: z.enum(["A", "B", "C"]),
  label: z.string().max(200),
  sources: z.array(z.object({ id: z.string(), kind: z.enum(["offer", "reply"]), text: z.string().max(10000), at: z.number() })).max(20),
  fields: z.record(z.string(), z.object({ versions: z.array(z.unknown()), active: z.number() }).loose()),
  ambiguities: z.array(z.unknown()),
}).loose();

const EventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("compare") }),
  z.object({ type: z.literal("why"), offerId: z.enum(["A", "B", "C"]) }),
  z.object({ type: z.literal("rfq"), includeBudget: z.boolean() }),
  z.object({ type: z.literal("discount") }),
  z.object({ type: z.literal("reanalyze") }),
  z.object({ type: z.literal("offers"), segments: z.array(z.object({ supplierHint: z.string().max(200).nullable(), text: z.string().trim().min(1).max(6000) })).min(1).max(3) }),
  z.object({ type: z.literal("reply"), offerId: z.enum(["A", "B", "C"]), text: z.string().trim().min(1).max(4000) }),
]);
export type TurnEvent = z.infer<typeof EventSchema>;

export const TurnRequestSchema = z.object({
  text: z.string().trim().min(1).max(20000).nullable(),
  event: EventSchema.nullable(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(20000) })).max(40),
  state: z.object({
    requirements: RequirementsSchema,
    reqEvidence: z.record(z.string(), z.string()),
    waived: z.array(z.string()),
    offers: z.array(OfferStateSchema).max(3),
    confirmedOfferIds: z.array(z.string()).max(3),
    rejected: z.record(z.string(), z.array(z.object({ field: z.string(), quote: z.string().nullable() }))),
    priority: z.enum(["cash", "unit", "earliest"]),
    orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    analyzedOtherKey: z.string(),
    scenarioQuantity: z.number().int().positive().nullable(),
  }),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine((r) => (r.text != null) !== (r.event != null), { message: "exactly one of text or event" });
export type TurnRequest = { text: string | null; event: TurnEvent | null; history: { role: "user" | "assistant"; text: string }[]; state: ConversationState; today: string };
