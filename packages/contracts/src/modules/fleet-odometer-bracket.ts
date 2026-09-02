// The odometer bracket — the one rule that says whether a workshop counter and the odometer chain
// are measurements of the same instrument.
//
// A maintenance visit's counters and `fleet_odometer_logs` are written by different endpoints into
// different collections, inside no shared transaction, with no reference between them. So the
// question every later calculation depends on — "is `exitOdometer` a point on this car's odometer
// sequence?" — has never been answerable from the data. It is answerable in exactly one way that
// needs no new field: an odometer is monotonic in time, so a counter measured on day D must sit
//
//     at or above everything recorded on or before D,  and  at or below everything recorded after.
//
// That is the whole invariant. It is deliberately weak: it proves nothing about whether the number
// is TRUE, only whether it can be compared with the chain at all. A counter that satisfies it may
// still be a typo; a counter that violates it is certainly not on the same sequence.
//
// An absent bound constrains nothing. A car whose first ever reading comes after its service has
// no lower bound; one that has not been read since has no upper bound. Neither absence is
// suspicious, and inventing a bound from the other side would be inventing data.
//
// This lives in contracts because BOTH sides run it: the API's alarm projection refuses an
// incomparable baseline with it, and the maintenance dialogs warn with it while somebody types. A
// second copy would be free to drift, and the two would then disagree about the same visit.

/** Which side of the bracket a counter fell outside, or `null` when it sits inside. */
export type FleetOdometerBracketBreach = 'belowChain' | 'aboveChain';

export interface FleetOdometerBracketBounds {
  /** Highest reading dated on or before the counter's own date. `null` = none that early. */
  lowerBound: number | null;
  /** Lowest reading dated after it. `null` = none that late. */
  upperBound: number | null;
}

/**
 * Where `counter` sits relative to the chain on its own date.
 *
 * `null` means "nothing to report": the counter sits inside whichever bounds exist, or there is
 * no bound at all, or the counter itself is not a finite number yet. Every unknown answers `null`
 * rather than guessing — a warning drawn from a missing fact is a false alarm, and a check that
 * cries wolf is one people stop reading.
 *
 * The two sides are NOT symmetric in what they mean, which is why they are named rather than
 * collapsed into a boolean:
 *
 *   • `belowChain` — the car had already driven further than this before it left the workshop.
 *   • `aboveChain` — the car has since been recorded lower than it left on.
 *
 * Both are impossible for one instrument; only their explanations differ.
 */
export const odometerBracketBreach = (
  counter: number | null,
  bounds: FleetOdometerBracketBounds,
): FleetOdometerBracketBreach | null => {
  if (counter === null || !Number.isFinite(counter)) return null;
  // Lower first: it is the side that says the baseline was already wrong when it was written,
  // which is the more fundamental of the two and the one an operator can still act on.
  if (bounds.lowerBound !== null && counter < bounds.lowerBound) return 'belowChain';
  if (bounds.upperBound !== null && counter > bounds.upperBound) return 'aboveChain';
  return null;
};

/**
 * Equality is INSIDE the bracket, on both sides.
 *
 * A counter equal to a bound is the same instrument reading the same number twice, which is what
 * a car that has not moved between the two records looks like — the ordinary case on the day of a
 * service, not an error. Refusing it would turn "the car sat still" into a data-integrity alarm.
 */
export const odometerBracketSatisfied = (
  counter: number | null,
  bounds: FleetOdometerBracketBounds,
): boolean => odometerBracketBreach(counter, bounds) === null;
