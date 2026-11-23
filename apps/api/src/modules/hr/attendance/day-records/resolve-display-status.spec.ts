// The read-time resolution, pinned at every boundary it has.
//
// This function exists because of two operational facts. The branch servers recompute only the
// employees who scanned, so a no-show's row is written at most once and then left alone — and very
// often there is no row at all. And production carries two years of imported punches that nothing
// has re-derived, so "no row" is the ordinary case for most of the history rather than an edge.
//
// Every case below is a shape that really occurs on this deployment, not a hypothetical. The two
// marked REGRESSION are the ones the owner was looking at: a hundred employees shown as five, and
// a day with punches reading «يوم راحة».
import { describe, expect, it } from 'vitest';
import { resolveDayStatus } from './resolve-display-status';

const resolve = (stored: Parameters<typeof resolveDayStatus>[0]['stored'],
                 derived: Parameters<typeof resolveDayStatus>[0]['derived']) =>
  resolveDayStatus({ stored, derived });

describe('the one line that is left out', () => {
  it('omits a date the employee was not employed on, and nothing else', () => {
    // `deriveDay` returns null for a date outside somebody's employment, and so does this.
    expect(resolve(null, null)).toBeNull();
    expect(resolve('present', null)).toBeNull();
  });

  it('REGRESSION: an employed person with no row is a LINE, not a silence', () => {
    // This is the defect that made a sheet for any past date show four or five names out of a
    // hundred: the resolution answered null for a missing row and both callers dropped the line.
    // Whatever the derivation says, there is now an answer.
    for (const derived of ['present', 'checkedIn', 'absent', 'noSchedule', 'weekend'] as const) {
      expect(resolve(null, derived)).not.toBeNull();
    }
  });
});

describe('a settled row is the answer', () => {
  it('returns a conclusion drawn from evidence untouched', () => {
    // Evidence does not change as the clock moves, so these are never re-decided — and note the
    // derivation is deliberately given a DIFFERENT value, to prove the stored one wins.
    for (const stored of ['present', 'checkedIn', 'late', 'earlyLeave', 'lateAndEarly',
                          'onLeave', 'weekend', 'holiday', 'incomplete'] as const) {
      expect(resolve(stored, 'absent')).toBe(stored);
    }
  });

  it('keeps a legacy `incomplete` row, because payroll still prices it as one', () => {
    // It is legacy and nothing derives it any more, but it carries real times and a frozen month
    // was priced from it. Re-labelling it on screen would make the screen disagree with the
    // payslip, so it stays settled while `dayOff` does not.
    expect(resolve('incomplete', 'checkedIn')).toBe('incomplete');
  });
});

describe('the three statuses that are re-decided', () => {
  it('re-resolves a row left at `pending` by a branch recompute', () => {
    // Written while the day was being lived; the derivation now reads the clock against the
    // expected end and says what the day became.
    expect(resolve('pending', 'present')).toBe('present');
    expect(resolve('pending', 'absent')).toBe('absent');
    expect(resolve('pending', 'pending')).toBe('pending');
  });

  it('re-resolves an `absent` written earlier in the same day', () => {
    // A branch recompute at ten in the morning can write `absent` for somebody due at five. When
    // they scan, the derivation sees the punch.
    expect(resolve('absent', 'checkedIn')).toBe('checkedIn');
    // And a real absence stays one: `absent` stored and `absent` derived is a conclusion.
    expect(resolve('absent', 'absent')).toBe('absent');
  });

  it('REGRESSION: a legacy `dayOff` row never holds a rest day over real punches', () => {
    // Nothing derives `dayOff` any more, so every stored one predates `noSchedule`. These are the
    // rows behind «12 and 15 November read يوم راحة although I scanned on both»: taking them at
    // face value would keep a wrong answer on screen for as long as the row sits in the database.
    expect(resolve('dayOff', 'present')).toBe('present');
    expect(resolve('dayOff', 'checkedIn')).toBe('checkedIn');
    // And when the date really is a rest day, the calendar says so through the derivation.
    expect(resolve('dayOff', 'weekend')).toBe('weekend');
    expect(resolve('dayOff', 'holiday')).toBe('holiday');
  });
});

describe('an absence must be concluded, never inferred by a screen', () => {
  it('reports a derived absence with no row at all as `noRecord`', () => {
    // Nothing has decided this date and no scan was seen for it. On a deployment whose history was
    // imported but never re-derived, that covers most of two years — and «غائب» across two years
    // would be a claim nobody made, carried onward by every figure above the table.
    expect(resolve(null, 'absent')).toBe('noRecord');
  });

  it('reports a derived absence behind a legacy `dayOff` row as `noRecord` too', () => {
    // There is a row, but it is not an absence conclusion — it is a row from before the engine
    // could tell a missing schedule from a rest day.
    expect(resolve('dayOff', 'absent')).toBe('noRecord');
  });

  it('keeps a CONCLUDED absence as `absent`', () => {
    // A stored `pending` or `absent` was written by the engine about this date. Once the date has
    // passed the derivation says `absent`, and that is a conclusion, so it reads as one.
    expect(resolve('pending', 'absent')).toBe('absent');
    expect(resolve('absent', 'absent')).toBe('absent');
  });

  it('never turns a non-absence into `noRecord`', () => {
    // The substitution is narrow on purpose: it applies to a derived `absent` and nothing else.
    expect(resolve(null, 'noSchedule')).toBe('noSchedule');
    expect(resolve(null, 'pending')).toBe('pending');
    expect(resolve(null, 'weekend')).toBe('weekend');
    expect(resolve(null, 'holiday')).toBe('holiday');
    expect(resolve(null, 'onLeave')).toBe('onLeave');
  });
});

describe('what a reader sees is what a recompute would store', () => {
  it('passes the derivation through for every status but an inferred absence', () => {
    // The property every screen depends on: the sheet, the employee page and their CSVs all
    // resolve through here, so none of them can invent a status the engine would not write. The
    // ONE deliberate divergence is the inferred absence above, which is reported as the gap it is.
    for (const derived of ['present', 'checkedIn', 'late', 'earlyLeave', 'lateAndEarly',
                           'pending', 'onLeave', 'weekend', 'holiday', 'noSchedule'] as const) {
      expect(resolve(null, derived)).toBe(derived);
    }
  });
});
