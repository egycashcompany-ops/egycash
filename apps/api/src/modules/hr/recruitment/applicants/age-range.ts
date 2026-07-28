// Age filters are expressed in whole years; the applicant stores a `birthDate`. Converting at the
// query boundary keeps the stored field the date it always was — nothing derived is persisted (I1),
// and no nightly job has to age anybody.
//
// The conversion is a half-open interval, which is the part worth being careful about:
//
//   age >= from   ⇔   birthDate <= today − from years          (inclusive: your birthday counts)
//   age <= to     ⇔   birthDate >  today − (to + 1) years      (exclusive: the day you turn to+1
//                                                               you are no longer `to`)
//
// Using `>` on the lower bound rather than `>=` on `today − to years` is what makes "25 to 30"
// include everyone through the day before their 31st birthday, instead of cutting them off on
// their 30th.

/** A `birthDate` range, in the shape a Mongo range predicate wants. Empty when no bound applies. */
export interface BirthDateRange {
  $lte?: Date;
  $gt?: Date;
}

const minusYears = (from: Date, years: number): Date => {
  const d = new Date(from.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
};

/**
 * Translate an inclusive age range in whole years into the `birthDate` range that selects it.
 * `now` is injected so the boundary behaviour is testable rather than dependent on the clock.
 */
export const birthDateRangeForAges = (
  ageFrom: number | undefined,
  ageTo: number | undefined,
  now: Date = new Date(),
): BirthDateRange | null => {
  const range: BirthDateRange = {};
  if (ageFrom !== undefined) range.$lte = minusYears(now, ageFrom);
  if (ageTo !== undefined) range.$gt = minusYears(now, ageTo + 1);
  return range.$lte === undefined && range.$gt === undefined ? null : range;
};
