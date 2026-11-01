import { z } from "zod";
import { RequirementsSchema } from "@/domain/schemas";
import { rfqGaps } from "@/domain/rfq";
import { draftRfq } from "@/llm/service";
import { handle } from "../_lib";

export const maxDuration = 120;

const Input = z.object({ requirements: RequirementsSchema, includeBudget: z.boolean() });

export const POST = handle(Input, async ({ requirements, includeBudget }) => {
  if (rfqGaps(requirements).some((g) => g.blocking)) return { blocked: true };
  return draftRfq(requirements, includeBudget);
});
