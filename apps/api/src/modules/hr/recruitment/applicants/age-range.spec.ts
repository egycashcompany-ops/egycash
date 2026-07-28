// The boundaries are the whole point of this helper, so the tests are about birthdays: the day you
// turn `from` you must appear, and the day you turn `to + 1` you must disappear.
import { describe, expect, it } from 'vitest';
import { birthDateRangeForAges } from './age-range';

const NOW = new Date('2026-07-28T00:00:00.000Z');
/** Does someone born on `iso` fall inside the range? Mirrors what Mongo would decide. */
const matches = (range: { $lte?: Date; $gt?: Date } | null, iso: string): boolean => {
  if (range === null) return true;
  const b = new Date(iso);
  if (range.$lte !== undefined && b > range.$lte) return false;
  if (range.$gt !== undefined && b <= range.$gt) return false;
  return true;
};

describe('birthDateRangeForAges', () => {
  it('returns null when neither bound is given, so the caller adds no predicate at all', () => {
    expect(birthDateRangeForAges(undefined, undefined, NOW)).toBeNull();
  });

  it('a lower bound alone is an upper bound on birth date', () => {
    const r = birthDateRangeForAges(30, undefined, NOW);
    expect(r?.$lte?.toISOString()).toBe('1996-07-28T00:00:00.000Z');
    expect(r?.$gt).toBeUndefined();
  });

  it('an upper bound alone reaches back to the day before the next birthday', () => {
    const r = birthDateRangeForAges(undefined, 30, NOW);
    expect(r?.$gt?.toISOString()).toBe('1995-07-28T00:00:00.000Z');
    expect(r?.$lte).toBeUndefined();
  });

  it('includes someone on the day they turn the minimum age', () => {
    const r = birthDateRangeForAges(25, 30, NOW);
    expect(matches(r, '2001-07-28T00:00:00.000Z'), 'exactly 25 today').toBe(true);
    expect(matches(r, '2001-07-29T00:00:00.000Z'), 'turns 25 tomorrow').toBe(false);
  });

  it('still includes someone the day before they turn one year past the maximum', () => {
    const r = birthDateRangeForAges(25, 30, NOW);
    expect(matches(r, '1995-07-29T00:00:00.000Z'), 'is 30, turns 31 tomorrow').toBe(true);
    expect(matches(r, '1995-07-28T00:00:00.000Z'), 'turns 31 today').toBe(false);
  });

  it('a single-year range (from === to) still spans a full year of birth dates', () => {
    const r = birthDateRangeForAges(40, 40, NOW);
    expect(matches(r, '1986-07-28T00:00:00.000Z'), 'exactly 40 today').toBe(true);
    expect(matches(r, '1985-07-29T00:00:00.000Z'), 'turns 41 tomorrow').toBe(true);
    expect(matches(r, '1985-07-28T00:00:00.000Z'), 'turns 41 today').toBe(false);
    expect(matches(r, '1986-07-29T00:00:00.000Z'), 'still 39').toBe(false);
  });

  it('age 0 is a real bound, not a missing one', () => {
    const r = birthDateRangeForAges(0, 0, NOW);
    expect(r).not.toBeNull();
    expect(matches(r, '2026-01-01T00:00:00.000Z'), 'born this year').toBe(true);
    expect(matches(r, '2024-01-01T00:00:00.000Z'), 'already 2').toBe(false);
  });
});
