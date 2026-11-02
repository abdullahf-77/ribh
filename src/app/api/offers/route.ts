import { z } from "zod";
import { limits } from "@/config/brand";
import { OtherRequirement } from "@/domain/schemas";
import { extractOffer } from "@/llm/service";
import { handle } from "../_lib";

export const maxDuration = 300;

const Input = z.object({
  offerId: z.enum(["A", "B", "C"]),
  text: z.string().trim().min(1).max(limits.offerChars),
  other: z.array(OtherRequirement).max(20),
});

export const POST = handle(Input, ({ offerId, text, other }) => extractOffer(offerId, text, other));
