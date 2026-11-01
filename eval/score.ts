import type { ValidatedOffer } from "../src/domain/evidence";
import type { Charge, Tier } from "../src/domain/schemas";
import { unitsPerPackage } from "../src/domain/cost";

const close = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-6 : a === b;

/** Reads a scored property out of what survived evidence validation. */
export function observed(v: ValidatedOffer, key: string): unknown {
  const get = (k: string) => v.fields[k]?.value ?? null;
  const tiers = (get("tiers") as Tier[] | null) ?? [];
  const charges = (get("charges") as Charge[] | null) ?? [];
  switch (key) {
    case "levelsProduct": return unitsPerPackage({ packageLevels: get("packageLevels") as { label: string; count: number }[] | null });
    case "tierCount": return tiers.length;
    case "firstTierMin": return tiers[0]?.minQty ?? null;
    case "firstTierPrice": return tiers[0]?.price ?? null;
    case "firstTierHasCondition": return !!tiers[0]?.condition;
    case "firstChargeAmount": return charges[0]?.amount ?? null;
    case "firstChargeWhen": return charges[0]?.appliesWhen ?? null;
    case "firstChargeVat": return charges[0]?.vat ?? null;
    case "hasContradiction": return v.ambiguities.some((a) => a.kind === "contradiction" || a.kind === "vat");
    default: return get(key);
  }
}

export type Score = { correct: number; total: number; invented: number; missed: number; wrong: number; mistakes: { key: string; expected: unknown; got: unknown }[] };

/** "invented" counts values returned where the text gives none. That is the failure this product cares about most. */
export function scoreExample(v: ValidatedOffer, expect: Record<string, unknown>): Score {
  const s: Score = { correct: 0, total: 0, invented: 0, missed: 0, wrong: 0, mistakes: [] };
  for (const [key, expected] of Object.entries(expect)) {
    const got = observed(v, key);
    s.total++;
    if (close(got, expected)) { s.correct++; continue; }
    if (expected === null) s.invented++;
    else if (got === null) s.missed++;
    else s.wrong++;
    s.mistakes.push({ key, expected, got });
  }
  return s;
}
