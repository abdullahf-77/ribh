import { validateRawOffer } from "./evidence";
import { Evidence, fieldValue, OfferState, pushVersion, resolveAmbiguitiesFor, VersionFlag } from "./offer-state";
import type { Charge, RawOffer } from "./schemas";

export type ChangeKind = "resolves_unknown" | "conflict" | "confirms";

export type ProposedChange = {
  field: string;
  previous: unknown;
  proposed: unknown;
  evidence: Evidence;
  kind: ChangeKind;
  flag: VersionFlag;
};

export type ReplyProposal = {
  offerId: string;
  replyId: string;
  text: string;
  changes: ProposedChange[];
  rejected: { field: string; quote: string | null }[];
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function mergeCharges(existing: Charge[], incoming: Charge[]): { merged: Charge[]; conflict: boolean } {
  const merged = [...existing];
  let conflict = false;
  for (const c of incoming) {
    const i = merged.findIndex((m) => m.label === c.label);
    if (i < 0) merged.push(c);
    else {
      if (merged[i].amount != null && c.amount != null && merged[i].amount !== c.amount) conflict = true;
      merged[i] = c;
    }
  }
  return { merged, conflict };
}

/** Turns a validated reply extraction into a proposal. Nothing is applied here. */
export function buildReplyProposal(offer: OfferState, raw: RawOffer, replyId: string, text: string, requirementIds: string[]): ReplyProposal {
  const validated = validateRawOffer(raw, replyId, text, requirementIds);
  const changes: ProposedChange[] = [];
  const rejected = [...validated.rejected];

  for (const [field, v] of Object.entries(validated.fields)) {
    if (v.value == null || !v.evidence) continue;
    if (field === "supplierName") continue;
    const previous = fieldValue(offer, field);

    if (field === "charges") {
      const { merged, conflict } = mergeCharges((previous as Charge[]) ?? [], v.value as Charge[]);
      if (same(previous, merged)) continue;
      changes.push({ field, previous, proposed: merged, evidence: v.evidence, kind: conflict ? "conflict" : "resolves_unknown", flag: v.flag });
      continue;
    }

    const kind: ChangeKind = previous == null ? "resolves_unknown" : same(previous, v.value) ? "confirms" : "conflict";
    changes.push({ field, previous, proposed: v.value, evidence: v.evidence, kind, flag: v.flag });
  }
  return { offerId: offer.id, replyId, text, changes, rejected };
}

export type ConflictChoice = "keep" | "adopt";

export function unresolvedConflicts(p: ReplyProposal, choices: Record<string, ConflictChoice>): string[] {
  return p.changes.filter((c) => c.kind === "conflict" && !choices[c.field]).map((c) => c.field);
}

/**
 * Applies a reviewed proposal to the one offer it belongs to. A conflict without an explicit choice
 * refuses the whole apply. Rejected choices are still recorded in history but not activated.
 */
export function applyReplyProposal(
  offer: OfferState,
  p: ReplyProposal,
  choices: Record<string, ConflictChoice>,
  skipped: Set<string>,
  at: number,
): OfferState {
  if (p.offerId !== offer.id) throw new Error("reply belongs to another offer");
  if (unresolvedConflicts(p, choices).length) throw new Error("unresolved conflicts");

  let next: OfferState = {
    ...offer,
    sources: [...offer.sources, { id: p.replyId, kind: "reply", text: p.text, at }],
  };
  for (const c of p.changes) {
    if (skipped.has(c.field)) continue;
    const adopt = c.kind !== "conflict" || choices[c.field] === "adopt";
    next = pushVersion(next, c.field, { value: c.proposed, source: "reply", evidence: c.evidence, flag: c.flag, at }, adopt);
    if (adopt) next = resolveAmbiguitiesFor(next, c.field);
  }
  return next;
}
