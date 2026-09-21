// The arithmetic of a chain, with nothing around it: which workflow applies, which rungs survive,
// and which rung is live.
//
// Pure on purpose. Every rule here is one the owner stated in a sentence, and each of them is the
// kind that goes wrong silently — a chain that resolves to the wrong row, a rung that blocks when
// it should have been skipped, a request that reads «finished» with a rung still waiting. None of
// those raise an error; they just route a request to the wrong desk, or to none.
import { type ApprovalLevel } from '@ecms/contracts';

export interface ChainStep {
  permissionKey: string;
  level: ApprovalLevel;
  label: { ar: string; en: string } | null;
}

/** A stored chain, reduced to what selection needs. */
export interface Candidate<T> {
  departmentCatalogId: string | null;
  branchId: string | null;
  value: T;
}

/** The unit a request belongs to — its requester's placement. */
export interface RequestUnit {
  branchId: string | null;
  /** The company-wide department, not one branch's copy of it (ADR-031). */
  departmentCatalogId: string | null;
}

/**
 * The chain that applies to one request: the most specific row that matches it.
 *
 * Specificity is counted, not ranked by hand — department AND branch beats either alone, and
 * either alone beats the company-wide default. A row that names a place the request is not in
 * does not match at all, so «الحركة في المهندسين» never answers a request from «الأمن».
 *
 * Ties cannot happen: the unique index makes (type, department, branch) one row. If a future
 * migration ever lets one through, the first wins deterministically rather than at random, because
 * the caller sorts before asking.
 */
export const selectChain = <T>(
  candidates: readonly Candidate<T>[],
  unit: RequestUnit,
): Candidate<T> | null => {
  const matches = candidates.filter(
    (c) =>
      (c.departmentCatalogId === null || c.departmentCatalogId === unit.departmentCatalogId) &&
      (c.branchId === null || c.branchId === unit.branchId),
  );
  const specificity = (c: Candidate<T>): number =>
    (c.departmentCatalogId === null ? 0 : 2) + (c.branchId === null ? 0 : 1);
  return matches.reduce<Candidate<T> | null>(
    (best, c) => (best === null || specificity(c) > specificity(best) ? c : best),
    null,
  );
};

export interface ResolvedStep extends ChainStep {
  /** Somebody in the company holds this key at this level over this unit. */
  staffed: boolean;
}

/**
 * The chain with each rung told whether anybody can actually stand on it.
 *
 * `hasApprovers` is asked once per rung rather than per request-and-rung, because two rungs of the
 * same chain often name the same key at different levels and the lookup is a database round trip.
 */
export const resolveChain = (
  steps: readonly ChainStep[],
  hasApprovers: (step: ChainStep) => boolean,
): ResolvedStep[] => steps.map((step) => ({ ...step, staffed: hasApprovers(step) }));

/**
 * The rung a request is waiting on, or `null` when nothing is left to decide.
 *
 * Unstaffed rungs are stepped over — «لو مفيش Branch Manager، يتخطى المستوى ده ويروح للـGeneral
 * Department Manager» — and so are rungs already decided. A chain whose every rung is unstaffed
 * leaves nothing waiting, which is the one case a caller must handle rather than assume: it means
 * the request is approved by default, and whether that is acceptable is the caller's policy, not
 * this function's.
 */
export const liveStep = (
  steps: readonly ResolvedStep[],
  decidedCount: number,
): { index: number; step: ResolvedStep } | null => {
  for (let i = decidedCount; i < steps.length; i += 1) {
    const step = steps[i];
    if (step !== undefined && step.staffed) return { index: i, step };
  }
  return null;
};

/**
 * Every rung between where the chain stands and the next live one — the ones that were skipped.
 *
 * They are returned rather than swallowed because the trail has to show them. A reader asking why
 * a request went straight to «الموارد البشرية» is asking about the rung that was not there, and a
 * trail that simply omits it answers nothing.
 */
export const skippedBefore = (
  steps: readonly ResolvedStep[],
  decidedCount: number,
): number[] => {
  const skipped: number[] = [];
  for (let i = decidedCount; i < steps.length; i += 1) {
    if (steps[i]?.staffed === true) break;
    skipped.push(i);
  }
  return skipped;
};

/**
 * Does an authority that reaches `held` satisfy a rung asking for `required`?
 *
 * Exactly, and never by rank. It is tempting to order the four levels and let anything wider
 * satisfy anything narrower, and that is wrong in both directions: a company-wide HR account is
 * not «مدير حركة المهندسين» and must not silently absorb his rung, while a chain that asks for
 * «مدير عام الحركة» is not satisfied by the branch manager underneath him.
 *
 * Seniority does have its say — but through the CHAIN'S OWN ORDER, in `decisionFor` below, not by
 * ranking the four words. The two are different claims: this one is «is this rung his», that one
 * is «may he act on a rung below his».
 */
export const levelSatisfied = (required: ApprovalLevel, held: ApprovalLevel): boolean =>
  required === held;

/** What a decision by one person does to the chain. */
export interface Decision {
  /** The rung he is deciding — his own, which may be above the one that was waiting. */
  step: number;
  /**
   * The rungs his decision cancels: the ones still waiting, below his.
   *
   * «لو المدير العام وافق مش محتاج مدير الفرع». They are CANCELLED, not decided — nobody stood on
   * them and the trail must not pretend somebody did.
   */
  covers: number[];
}

/**
 * Which rung a person decides, and what that cancels — or `null` when it is not his to decide.
 *
 * The rule the owner stated, in the only form that stays generic: a chain is a ladder, and
 * somebody standing further UP it may answer while it is still waiting further down, because his
 * yes is the one the lower rungs existed to escalate to. What that cancels is everything BELOW
 * him. What comes after him is untouched — «الموارد البشرية لسه لازم توافق» — because the rungs
 * above are not people he outranks, they are a different authority being asked a different
 * question.
 *
 * `ownSteps` are the indices whose key and level this person actually satisfies. Passing them in
 * rather than resolving them here keeps the database out of the rule.
 */
export const decisionFor = (
  ownSteps: readonly number[],
  liveIndex: number,
): Decision | null => {
  const eligible = ownSteps.filter((i) => i >= liveIndex).sort((a, b) => a - b);
  const step = eligible[0];
  if (step === undefined) return null;
  const covers: number[] = [];
  for (let i = liveIndex; i < step; i += 1) covers.push(i);
  return { step, covers };
};
