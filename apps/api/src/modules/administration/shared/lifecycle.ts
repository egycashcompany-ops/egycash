// The module's lifecycle helpers (design §5.1, §5.16): one shape for every document's table of
// transitions, and the questions every document asks of its table. Recruitment's helpers,
// generalized — `findTransition`, `transitionsFrom` and `statesOf` (workflow-transitions.ts),
// `availableActions` (workflow-actions.ts) — and written once here, so the purchase request (P2)
// and every later document read their tables the same way. Module-local; they move to
// `apps/api/src/shared/` when a second module needs them.
//
// PURE: no database, no clock, no request. A document's service consults its table, and every
// guard that needs more than the status (a reason, an ordered quantity, a rung) is that document's
// own pure function beside its table.
import { type AdministrationAvailableActionDto } from '@ecms/contracts';

/**
 * One row of a document's table (design §5.1.1): one predecessor, one target, the one key it runs
 * under. `from: null` is the creation row, «— → draft»: it has no predecessor, and the table is
 * read from it.
 */
export interface TransitionDef<S extends string, A extends string> {
  /** The dispatch key, the audit mapping and the `availableActions` key. */
  action: A;
  /** One predecessor per row; several rows may share an action (§5.1.1). */
  from: S | null;
  to: S;
  /** Exactly one key; null only for a system row. */
  permission: string | null;
  /**
   * A platform key that stands in for `permission` within its own reach — `approval.override` on
   * a decision (ADR-041 decision 6). Never a second key of the document's own.
   */
  substitute?: string;
  /** The `<act>At` / `<act>ByUserId` pair the row writes (design §5.1.2 item 3). */
  stamps?: string;
  /** Refused without a reason, always (design §5.1.2 item 5). A conditional reason is the document's. */
  requiresReason?: true;
  /** Reached only through a decision on the approval chain. */
  settledByApproval?: true;
  /** The document's requester may take this row under the route's read key (OD-28.4 (i)). */
  ownWithdrawal?: true;
  /** Performed inside another act's transaction, never asked for (§5.1.1). */
  system?: true;
}

export type TransitionTable<S extends string, A extends string> = readonly TransitionDef<S, A>[];

/** The rows that leave `from`, in table order. */
export const transitionsFrom = <S extends string, A extends string>(
  table: TransitionTable<S, A>,
  from: S,
): TransitionDef<S, A>[] => table.filter((row) => row.from === from);

/** The row from `from` to `to`, or null when the table holds no such move. */
export const findTransition = <S extends string, A extends string>(
  table: TransitionTable<S, A>,
  from: S | null,
  to: S,
): TransitionDef<S, A> | null => table.find((row) => row.from === from && row.to === to) ?? null;

/**
 * The statuses a guard set holds (design §5.14), in its own key order — what a Mongo filter or a
 * partial index reads, so the filter and the set can never say two different things.
 */
export const statusesWhere = <S extends string>(set: Readonly<Record<S, boolean>>): S[] =>
  (Object.keys(set) as S[]).filter((status) => set[status]);

/** Every status the table reaches from `start`, `start` included (the creation row's target). */
export const reachableFrom = <S extends string, A extends string>(
  table: TransitionTable<S, A>,
  start: S,
): Set<S> => {
  const seen = new Set<S>();
  const queue: S[] = [start];
  while (queue.length > 0) {
    const current = queue.shift() as S;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const row of transitionsFrom(table, current)) queue.push(row.to);
  }
  return seen;
};

/**
 * One act a record may offer, and the statuses it starts from — a table row's action, an
 * in-state act (a draft's edit, an intermediate rung's decision) or both.
 */
export interface ActDef<S extends string, K extends string> {
  key: K;
  from: readonly S[];
}

/** What a document says of one act for one reader: listed as this, or not listed at all. */
export type ActJudgement = Omit<AdministrationAvailableActionDto, 'key'> | null;

/**
 * The acts a record offers at `status`, in the acts' own order, each once (design §5.1.4). An act
 * that does not start from the status is not asked about; one that does is listed as `judge`
 * answers, or left out when `judge` answers null — a reader who holds none of its keys. A listed
 * act that is not enabled still shows, with its reason: a screen that hides what it cannot explain
 * teaches the reader nothing (recruitment's rule).
 */
export const availableActions = <S extends string, K extends string>(
  acts: readonly ActDef<S, K>[],
  status: S,
  judge: (key: K) => ActJudgement,
): AdministrationAvailableActionDto[] =>
  acts.flatMap((act) => {
    if (!act.from.includes(status)) return [];
    const judgement = judge(act.key);
    return judgement === null ? [] : [{ key: act.key, ...judgement }];
  });
