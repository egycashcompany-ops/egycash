// The dealership backfill's decisions, without a database — «دول مظهروش فى شاشه التوكيل»: car
// 159's visits of 27 and 29–30 September get their rows, and nothing the owner did not choose does.
import { describe, expect, it } from 'vitest';
import {
  DEALERSHIP_BACKFILL_FROM,
  decideBackfill,
  earlierOpened,
  openedLine,
  planDealershipBackfill,
  type BackfillVisit,
} from './dealership-backfill-plan';

const at = (iso: string): Date => new Date(iso);
const visit = (id: string, outDate: Date | null, isDeleted = false): BackfillVisit => ({
  id,
  outDate,
  isDeleted,
});

describe('which visits get rows', () => {
  it('starts on the owner’s day', () => {
    expect(DEALERSHIP_BACKFILL_FROM).toBe('2026-09-01');
  });

  it('car 159’s visits of 27 September and 29–30 September — closed, no rows — get them', () => {
    expect(decideBackfill(visit('a', at('2026-09-27T00:00:00.000Z')), false)).toBe('backfill');
    expect(decideBackfill(visit('b', at('2026-09-30T00:00:00.000Z')), false)).toBe('backfill');
  });

  it('a visit after the screen went live that never got rows gets them too', () => {
    expect(decideBackfill(visit('a', at('2026-10-03T00:00:00.000Z')), false)).toBe('backfill');
  });

  it('counts the exit day by UTC: 1 September at midnight is in, the last instant of 31 August is not', () => {
    expect(decideBackfill(visit('a', at('2026-09-01T00:00:00.000Z')), false)).toBe('backfill');
    expect(decideBackfill(visit('b', at('2026-08-31T23:59:59.999Z')), false)).toBe('before');
    // Midnight in Cairo on 1 September is still 31 August by UTC — the rule's day, as asked.
    expect(decideBackfill(visit('c', at('2026-09-01T00:00:00.000+03:00')), false)).toBe('before');
  });

  it('a visit still in the workshop gets none — its check-out will open them', () => {
    expect(decideBackfill(visit('a', null), false)).toBe('stillIn');
  });

  it('a deleted visit gets none', () => {
    expect(decideBackfill(visit('a', at('2026-09-27T00:00:00.000Z'), true), false)).toBe('deleted');
  });

  it('a visit that has rows — even only deleted or withdrawn ones — gets none', () => {
    // The caller asks «ever had a row», deleted or not; the plan only reads the answer.
    expect(decideBackfill(visit('a', at('2026-09-27T00:00:00.000Z')), true)).toBe('hadRows');
  });

  it('says the first reason that holds: deleted before «had rows», still-in before everything', () => {
    expect(decideBackfill(visit('a', at('2026-09-27T00:00:00.000Z'), true), true)).toBe('deleted');
    expect(decideBackfill(visit('b', null, true), true)).toBe('stillIn');
    expect(decideBackfill(visit('c', at('2026-08-01T00:00:00.000Z'), true), true)).toBe('before');
  });
});

describe('the plan over every visit', () => {
  it('keeps the visits to open in order and counts the rest by reason', () => {
    const visits = [
      visit('aug', at('2026-08-20T00:00:00.000Z')),
      visit('s27', at('2026-09-27T00:00:00.000Z')),
      visit('open', null),
      visit('gone', at('2026-09-15T00:00:00.000Z'), true),
      visit('billed', at('2026-10-03T00:00:00.000Z')),
      visit('withdrawn', at('2026-09-20T00:00:00.000Z')),
      visit('s30', at('2026-09-30T00:00:00.000Z')),
    ];
    const plan = planDealershipBackfill(visits, new Set(['billed', 'withdrawn', 'gone']));
    expect(plan.backfill.map((v) => v.id)).toEqual(['s27', 's30']);
    expect(plan.skipped).toEqual({ stillIn: 1, before: 1, deleted: 1, hadRows: 2 });
  });

  it('hands back the caller’s own objects, whatever else they carry', () => {
    const doc = { ...visit('s27', at('2026-09-27T00:00:00.000Z')), code: '159' };
    expect(planDealershipBackfill([doc], new Set()).backfill[0]).toBe(doc);
  });

  it('opens nothing on a second pass — every visit it opened now has rows', () => {
    const visits = [
      visit('s27', at('2026-09-27T00:00:00.000Z')),
      visit('s30', at('2026-09-30T00:00:00.000Z')),
    ];
    const first = planDealershipBackfill(visits, new Set());
    const again = planDealershipBackfill(visits, new Set(first.backfill.map((v) => v.id)));
    expect(again.backfill).toEqual([]);
    expect(again.skipped.hadRows).toBe(2);
  });

  it('an empty list is an empty plan, not an error', () => {
    expect(planDealershipBackfill([], new Set())).toEqual({
      backfill: [],
      skipped: { stillIn: 0, before: 0, deleted: 0, hadRows: 0 },
    });
  });
});

describe('what the run row says', () => {
  it('one line per visit opened: the car, the exit day, the rows', () => {
    expect(openedLine('159', at('2026-09-30T00:00:00.000Z'), ['صيانة', 'إصلاح'])).toBe(
      '159 2026-09-30: صيانة · إصلاح',
    );
    // A car the registry never had keeps the old book's code; none at all is a dash, not a guess.
    expect(openedLine(null, at('2026-09-10T00:00:00.000Z'), ['صيانة'])).toBe('— 2026-09-10: صيانة');
  });

  it('carries what earlier failed attempts opened, and reads nothing off a refusal or a fresh row', () => {
    expect(earlierOpened({ opened: 3, rowsCreated: 4, failed: 1 })).toEqual({
      opened: 3,
      rowsCreated: 4,
    });
    // Two failed attempts in a row: the second already carried the first's.
    expect(
      earlierOpened({ opened: 1, rowsCreated: 2, openedEarlier: 3, rowsCreatedEarlier: 4 }),
    ).toEqual({ opened: 4, rowsCreated: 6 });
    expect(earlierOpened({ refused: true, reason: 'maintenance-not-done' })).toEqual({
      opened: 0,
      rowsCreated: 0,
    });
    expect(earlierOpened(null)).toEqual({ opened: 0, rowsCreated: 0 });
    expect(earlierOpened(undefined)).toEqual({ opened: 0, rowsCreated: 0 });
  });
});
