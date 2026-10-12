// Which closed workshop visits the dealership backfill opens rows for — pure, so the rule is
// tested without a database. `dealership-backfill.ts` reads the visits, hands them here, and opens
// rows for exactly what comes back, through the check-out's own `openRowsOfVisit`.
//
// «دول مظهروش فى شاشه التوكيل» — car 159's visits of 27 September and 29–30 September are on
// «صيانة السيارات» and not on the dealership screen. A row there opens only when a visit is
// checked out IN THE SYSTEM (`fleetDealershipService.openForVisit`), and the screen went live on
// 1 October: the visits the old book brought in, by its import or by its second export, and any
// checked out before that day, never opened one. The owner's choice of which get one now:
//
//   - CLOSED. A visit still in the workshop opens its rows when it is checked out, as every visit
//     does; opening them now would put a bill on the screen for work that has not left.
//   - OUT ON OR AFTER 1 SEPTEMBER 2026, by the UTC day of its exit date (`outDate`). The dates
//     are days, stored at midnight UTC, so the UTC day is the day the screen shows.
//   - NOT DELETED. A deleted visit shows nowhere, and a bill for it would be a row about nothing.
//   - WITH NO ROW AT ALL, deleted or not. A visit with rows needs none; a visit whose rows were
//     deleted — by the clerk, or withdrawn by a reopen — had them taken away by somebody, and
//     opening them again would undo that.
//
// What the rows say — how many, which half of the work, «ملاكي», the insurer — is not decided
// here: it is the check-out's, and stays the check-out's.

/** The first exit day that gets rows — the owner's «من أول سبتمبر». */
export const DEALERSHIP_BACKFILL_FROM = '2026-09-01';

/** As much of a visit as the rule reads. */
export interface BackfillVisit {
  id: string;
  outDate: Date | null;
  isDeleted: boolean;
}

/** Why a visit gets no rows. */
export type BackfillSkip = 'stillIn' | 'before' | 'deleted' | 'hadRows';

export type BackfillDecision = 'backfill' | BackfillSkip;

/** The UTC day a date falls on, as `YYYY-MM-DD`. */
export const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * One visit, by the rule above. In this order, so a visit is counted under the first reason that
 * holds: a deleted visit that also had rows is «deleted» — the reason it shows nowhere.
 */
export const decideBackfill = (
  visit: BackfillVisit,
  hasRows: boolean,
  from: string = DEALERSHIP_BACKFILL_FROM,
): BackfillDecision => {
  if (visit.outDate === null) return 'stillIn';
  if (dayOf(visit.outDate) < from) return 'before';
  if (visit.isDeleted) return 'deleted';
  if (hasRows) return 'hadRows';
  return 'backfill';
};

export interface DealershipBackfillPlan<V extends BackfillVisit> {
  /** The visits to open rows for, in the order given. */
  backfill: V[];
  /** How many got none, by reason. */
  skipped: Record<BackfillSkip, number>;
}

/** Every visit, decided. `withRows` holds the ids of visits that ever had a row, deleted or not. */
export const planDealershipBackfill = <V extends BackfillVisit>(
  visits: readonly V[],
  withRows: ReadonlySet<string>,
  from: string = DEALERSHIP_BACKFILL_FROM,
): DealershipBackfillPlan<V> => {
  const plan: DealershipBackfillPlan<V> = {
    backfill: [],
    skipped: { stillIn: 0, before: 0, deleted: 0, hadRows: 0 },
  };
  for (const visit of visits) {
    const decision = decideBackfill(visit, withRows.has(visit.id), from);
    if (decision === 'backfill') plan.backfill.push(visit);
    else plan.skipped[decision] += 1;
  }
  return plan;
};

/** The run row's line for one visit given rows: «159 2026-09-30: صيانة · إصلاح». */
export const openedLine = (
  code: string | null,
  outDate: Date | null,
  labels: readonly string[],
): string => `${code ?? '—'} ${outDate === null ? '—' : dayOf(outDate)}: ${labels.join(' · ')}`;

/**
 * What earlier, failed attempts opened, read off the run row before this attempt writes over it.
 * Those visits have rows now, so this attempt counts them as «had rows»; carried, the row still
 * says this step opened them. A refusal's row carries no counts and reads as nothing. (A process
 * killed mid-run wrote nothing on the row: what it opened reads as «had rows», and nothing more.)
 */
export const earlierOpened = (
  outcome: Record<string, unknown> | null | undefined,
): { opened: number; rowsCreated: number } => {
  const count = (key: string): number => {
    const value = outcome?.[key];
    return typeof value === 'number' ? value : 0;
  };
  return {
    opened: count('opened') + count('openedEarlier'),
    rowsCreated: count('rowsCreated') + count('rowsCreatedEarlier'),
  };
};
