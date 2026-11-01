import { z } from "zod";
import type { Decision } from "@/domain/decision";
import { composeNarrative } from "@/llm/service";
import { handle } from "../_lib";

export const maxDuration = 120;

const Input = z.object({
  decision: z.object({ priority: z.enum(["cash", "unit", "earliest"]), verdict: z.object({ kind: z.string() }).loose(), evaluations: z.array(z.object({ offerId: z.string() }).loose()).max(3) }),
  questions: z.array(z.object({ offerId: z.string(), label: z.string(), items: z.array(z.object({ code: z.string(), text: z.string().max(500), decisive: z.boolean() })) })).max(3),
});

// The decision was computed by the deterministic engine. Llama only writes prose around it, and that prose is checked.
export const POST = handle(Input, ({ decision, questions }) => composeNarrative({ decision: decision as unknown as Decision, questions }));
