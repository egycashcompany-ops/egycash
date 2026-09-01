// Is a workshop counter contradicting the odometer chain?
//
// `odometerAtService` and `exitOdometer` are typed by hand, and a dropped digit turns
// «٢٨٠٬٥٠٠» into «٢٨٬٠٠٠» without anything objecting: the workshop counters are recorded
// independently of `fleet_odometer_logs`, and no server rule compares them. The exit reading in
// particular becomes the baseline every later maintenance calculation measures from, so a typo
// there does not stay in its own row — it moves the next service.
//
// SO THIS WARNS, AND ONLY WARNS. It is advice at the moment of typing, not a rule: the save goes
// through untouched, the value is never rewritten, no request is refused and nothing is written
// to the odometer chain. A blocking rule here would be wrong, because a workshop counter that
// disagrees with the chain is often perfectly correct — see the two cases below.
//
// THE NARROWEST RULE THAT CAN BE JUSTIFIED. `expectedReading` already has an exact meaning in
// this system: it is the FR-2 floor, `max(outReading, inReading)` of the highest reading on
// record, and `record()` REFUSES a new reading below it. So a counter below that floor is a
// number the odometer chain itself would not accept today. That is the whole of the suspicion —
// and it is one-sided, plus conditional on the date, because two divergences are legitimate:
//
//   • ABOVE the floor is normal. A car drives between recorded readings, so a counter higher
//     than anything on record is the expected case, not an error. Never warned about.
//   • BELOW the floor is normal TOO on a back-dated visit. Entering last month's visit today
//     should carry last month's counter, which is legitimately below where the chain has since
//     reached. So the visit's own date must be at or after the date of the reading that set the
//     floor — `asOf` — before "below" means anything at all.
//
// Hence: `counter < expectedReading && visitDate >= asOf`. Anything narrower misses the dropped
// digit; anything wider cries wolf over correct data, and a warning that is usually wrong is a
// warning people stop reading.

export interface WorkshopOdometerCheck {
  /** The counter as typed. `null` while the field is empty or not yet a number. */
  counter: number | null;
  /** The FR-2 floor from `GET /fleet/odometer/expected`. `null` = the car has no readings. */
  expectedReading: number | null;
  /** The visit's OWN date — `inDate` on check-in, `outDate` on check-out. Never `new Date()`. */
  visitDate: string | null;
  /** The date of the reading that set the floor, from the same response. */
  asOf: string | null;
}

/** Midnight UTC for a `yyyy-mm-dd` or an ISO timestamp; `null` if it is neither. */
const day = (value: string | null): number | null => {
  if (value === null || value === '') return null;
  const parsed = new Date(value);
  const time = parsed.getTime();
  if (Number.isNaN(time)) return null;
  return Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
};

/**
 * `true` when the counter looks like a mistake worth a second glance — never when it merely
 * differs from the chain. Every unknown answers `false`: with no reading on record, no date on
 * the visit, or no `asOf`, there is nothing to compare against, and a warning drawn from a
 * missing fact would be a guess.
 */
export const workshopOdometerLooksWrong = (check: WorkshopOdometerCheck): boolean => {
  const { counter, expectedReading } = check;
  if (counter === null || !Number.isFinite(counter)) return false;
  if (expectedReading === null) return false;
  // One-sided: only BELOW the floor is suspicious. At or above it is ordinary driving.
  if (counter >= expectedReading) return false;

  const visit = day(check.visitDate);
  const floorSetOn = day(check.asOf);
  if (visit === null || floorSetOn === null) return false;
  // A visit dated before the floor was recorded is back-dated, and belongs below it.
  return visit >= floorSetOn;
};
