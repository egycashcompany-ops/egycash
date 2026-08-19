// When the board offers to seed itself from the standing crew, and what it then says happened.
//
// "ينزل كل يوم تلقائي في التشغيلة" — automatic, from the operator's side: open tomorrow's board
// and the standing crew is already on it. What makes that safe is WHERE the automation lives.
//
// REJECTED — a nightly cron. It would write with no actor: every crew row in the system would be
// created by nobody, and the audit trail would say so forever.
// REJECTED — seeding inside the board's GET. A read that authors a day's crew means anyone with
// `operationsCrew.view` silently becomes the author of a plan by looking at it.
// REJECTED — a hook in `ensureForDate`. That runs when a SHIPMENT is created, so creating one
// shipment would author the whole day's crew as a side effect.
//
// CHOSEN — the client fires an explicit, permissioned, idempotent POST once per date, and there is
// a permanent button for every other time. The write has a real author, happens at a moment a
// human caused, and can be repeated without consequence.
import { type OperationsCrewSeedReportDto } from '@ecms/contracts';

export interface AutoSeedInput {
  /** Only a planner may write the board — a viewer must never trigger a write by navigating. */
  canPlan: boolean;
  /**
   * The board's operating day, or null.
   *
   * `null` is the precise test for "nobody has planned this date yet": the day row is created by
   * the first plan, so its absence means no crew row can exist either. Anything looser — "the
   * board looks empty", "no crew rows came back" — would re-fire on a day somebody had emptied on
   * purpose.
   */
  boardDay: unknown;
  /** Vehicles in the standing crew. Nothing to descend means nothing to ask the server about. */
  standingRowCount: number;
  /** Dates already attempted in this session. One attempt per date, whatever the outcome. */
  attempted: ReadonlySet<string>;
  /** The resolved board date, as the key the attempt is remembered by. */
  date: string;
  /** A query still loading, or a write in flight. */
  busy: boolean;
}

/**
 * ONE ATTEMPT PER DATE, whatever the outcome — success, failure, or a seed that found nothing.
 *
 * Retrying a failure automatically would turn one bad response into a loop against the server; and
 * a seed that legitimately found nothing to do would otherwise re-fire on every re-render, since
 * nothing about the board would have changed.
 */
export const shouldAutoSeed = (input: AutoSeedInput): boolean =>
  input.canPlan &&
  !input.busy &&
  input.date !== '' &&
  input.boardDay === null &&
  input.standingRowCount > 0 &&
  !input.attempted.has(input.date);

export interface SeedSummary {
  seeded: number;
  /** Vehicles already planned — the veto. Not a problem: it is the seed protecting real work. */
  alreadyPlanned: number;
  /** Vehicles the standing crew names that Fleet did not roster today. */
  notRostered: number;
  /** Vehicles with nobody left to seed, either empty or entirely dropped. */
  noCrew: number;
  /** People left off a row that was still seeded without them. */
  dropped: number;
  /** Did anything at all happen that is worth telling the operator about? */
  quiet: boolean;
}

/**
 * The report reduced to the numbers a message can carry.
 *
 * `quiet` is what stops the auto-fire from being noise: on a day where the seed found every
 * vehicle already planned and dropped nobody, it did its job by doing nothing, and saying so on
 * every visit would train the operator to dismiss the message that matters.
 */
export const seedSummary = (report: OperationsCrewSeedReportDto): SeedSummary => {
  const count = (reason: string): number =>
    report.skipped.filter((entry) => entry.reason === reason).length;
  const seeded = report.seededVehicleIds.length;
  const notRostered = count('notRostered');
  const noCrew = count('noCrewToSeed');
  const dropped = report.dropped.length;
  return {
    seeded,
    alreadyPlanned: count('alreadyPlanned'),
    notRostered,
    noCrew,
    dropped,
    // "Already planned" is deliberately NOT a reason to speak: it is the normal state of a board
    // somebody has already worked on, and it is exactly what the veto is for.
    quiet: seeded === 0 && notRostered === 0 && noCrew === 0 && dropped === 0,
  };
};
