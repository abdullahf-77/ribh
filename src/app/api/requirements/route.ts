import { z } from "zod";
import { limits } from "@/config/brand";
import { extractRequirements } from "@/llm/service";
import { handle, Today } from "../_lib";

export const maxDuration = 120;

const Input = z.object({ text: z.string().trim().min(1).max(limits.requirementChars), today: Today });

export const POST = handle(Input, ({ text, today }) => extractRequirements(text, today));
