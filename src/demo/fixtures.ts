import type { RawOffer, RawRequirements } from "@/domain/schemas";
import { scenarios } from "./scenarios";

/* Demo mode answers only for the fictional scenario texts. Anything else is refused instead of faked. */

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export function demoRequirementsFor(text: string): RawRequirements | null {
  return scenarios.find((s) => norm(s.requirementText) === norm(text))?.rawRequirements ?? null;
}

export function demoOfferFor(text: string): RawOffer | null {
  for (const s of scenarios) {
    const o = s.offers.find((x) => norm(x.text) === norm(text));
    if (o) return o.raw;
  }
  return null;
}

export function demoReplyFor(text: string): RawOffer | null {
  return scenarios.find((s) => s.reply && norm(s.reply.text) === norm(text))?.reply!.raw ?? null;
}
