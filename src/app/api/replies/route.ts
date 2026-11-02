import { z } from "zod";
import { limits } from "@/config/brand";
import { OtherRequirement } from "@/domain/schemas";
import { extractReply } from "@/llm/service";
import { handle } from "../_lib";

export const maxDuration = 300;

const Input = z.object({
  text: z.string().trim().min(1).max(limits.replyChars),
  current: z.record(z.string(), z.unknown()),
  questions: z.array(z.string().max(500)).max(30),
  other: z.array(OtherRequirement).max(20),
});

// Returns the raw extraction; the browser builds the proposal against its own copy of this one offer.
export const POST = handle(Input, ({ text, current, questions, other }) => extractReply(text, current, questions, other));
