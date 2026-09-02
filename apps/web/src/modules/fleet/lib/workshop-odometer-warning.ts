// Does a workshop counter contradict the odometer chain?
//
// `odometerAtService` and `exitOdometer` are typed by hand, and a dropped digit turns «٢٨٠٬٥٠٠»
// into «٢٨٬٠٠٠» without anything objecting: the workshop counters are recorded independently of
// `fleet_odometer_logs`, in a different collection, through a different endpoint, with no
// reference between them. The exit reading in particular becomes the baseline every later
// maintenance calculation measures from, so a typo there does not stay in its own row — it moves
// the next service.
//
// SO THIS WARNS, AND ONLY WARNS. It is advice at the moment of typing, not a rule: the save goes
// through untouched, the value is never rewritten, no request is refused and nothing is written
// to the odometer chain. The workshop's counter stays the authoritative record of what the
// workshop measured. A blocking rule here would be wrong — a mistyped counter must never cost
// somebody the visit, and a counter that disagrees with the chain is sometimes simply right.
//
// WHAT REPLACED THE ONE-SIDED CHECK. The first version of this compared the counter against the
// FR-2 floor — `max(outReading, inReading)` of the highest reading on record — and needed a date
// condition bolted on beside it, because a back-dated visit legitimately carries a counter below
// where the chain has since reached. That rule was sound but half a rule: it could see a counter
// that had fallen below the chain and could not see one that had risen above it, and it compared
// against the chain's global maximum rather than against the chain AS IT STOOD on the visit's own
// day.
//
// The bracket answers both at once, and answers the date question structurally instead of by a
// side condition: the server computes the bounds FOR THE VISIT'S OWN DATE, so a back-dated visit
// is compared with the chain as it was then — which is why no `visitDate >= asOf` clause survives
// here. The rule itself lives in `@ecms/contracts` because the API's alarm projection runs the
// same function; a second copy on this side would be free to disagree about the same visit.
import {
  odometerBracketBreach,
  type FleetOdometerBracketBreach,
  type FleetOdometerBracketDto,
} from '@ecms/contracts';

export interface WorkshopOdometerCheck {
  /** The counter as typed. `null` while the field is empty or not yet a number. */
  counter: number | null;
  /**
   * The bracket for THIS VISIT'S date, from `GET /fleet/{odometer,maintenance}/…bracket`.
   * `null` while it is still loading, or when the reader may not ask for it.
   */
  bracket: Pick<FleetOdometerBracketDto, 'lowerBound' | 'upperBound'> | null;
}

/**
 * Which side of the chain the counter fell outside, or `null` when there is nothing to say.
 *
 * Every unknown answers `null`: no bracket yet, no counter yet, or a bracket with no bounds at
 * all. A warning drawn from a missing fact is a false alarm, and a warning that is usually wrong
 * is one people stop reading.
 */
export const workshopOdometerBreach = (
  check: WorkshopOdometerCheck,
): FleetOdometerBracketBreach | null => {
  if (check.bracket === null) return null;
  return odometerBracketBreach(check.counter, {
    lowerBound: check.bracket.lowerBound,
    upperBound: check.bracket.upperBound,
  });
};

/**
 * The same question as a boolean, for the callers that only need to know whether to show
 * anything. Kept as a thin alias rather than a second rule.
 */
export const workshopOdometerLooksWrong = (check: WorkshopOdometerCheck): boolean =>
  workshopOdometerBreach(check) !== null;

/**
 * The translation key for a breach, or `null`. Two sides, two sentences: which bound was crossed
 * decides what an operator should go and look at, so collapsing them into one message would
 * remove the only actionable part.
 */
export const workshopOdometerWarningKey = (
  breach: FleetOdometerBracketBreach | null,
): 'fleet.maintenance.counterBelowChain' | 'fleet.maintenance.counterAboveChain' | null => {
  if (breach === null) return null;
  return breach === 'belowChain'
    ? 'fleet.maintenance.counterBelowChain'
    : 'fleet.maintenance.counterAboveChain';
};
