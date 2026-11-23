// The owner's rule of 19 November: arrival = the FIRST check-in, departure = the FIRST check-out
// after it. Extra presses are repeats: they never move the times, raise `repeatedPunches`, and are
// tagged in the scan log. Plus working hours per department (24-hour security days).
import { describe, expect, it } from 'vitest';
import {
  countedPunches,
  deriveDay,
  punchTally,
  scanRoles,
  shiftWindow,
  type DeriveDayInput,
  type EnginePunch,
  type EngineShift,
} from './derive-day';
import { patternForDepartment } from './department-hours';

const DAY = new Date(Date.UTC(2026, 10, 18)); // 2026-11-18, Cairo UTC+2
const at = (h: number, m = 0, s = 0): Date => new Date(Date.UTC(2026, 10, 18, h - 2, m, s));
const BRANCH = 'b1';
const p = (when: Date, direction: EnginePunch['direction'] = 'unknown'): EnginePunch => ({
  at: when,
  direction,
  source: 'device',
  branchIdAtPunch: BRANCH,
});
const NINE_TO_FIVE: EngineShift = {
  startTime: '09:00',
  endTime: '17:00',
  crossesMidnight: false,
  breakMinutes: 0,
  graceInMinutes: 0,
  graceOutMinutes: 0,
};
const input = (punches: EnginePunch[], over: Partial<DeriveDayInput> = {}): DeriveDayInput => ({
  workDate: DAY,
  employed: true,
  leave: null,
  holiday: false,
  weekend: false,
  shift: NINE_TO_FIVE,
  punches,
  employeeBranchId: BRANCH,
  decision: null,
  minPunchGapMinutes: 10,
  countAbsence: false,
  now: new Date(Date.UTC(2026, 10, 20)),
  ...over,
});

describe('first check-in, first check-out', () => {
  it('a second check-out later in the day does not move the departure', () => {
    const day = deriveDay(
      input([p(at(9), 'in'), p(at(17, 5), 'out'), p(at(18, 30), 'out')]),
    );
    expect(day?.firstInAt).toEqual(at(9));
    expect(day?.lastOutAt).toEqual(at(17, 5));
    expect(day?.workedMinutes).toBe(485);
    expect(day?.flags).toContain('repeatedPunches');
  });

  it('a second check-in does not move the arrival', () => {
    const day = deriveDay(input([p(at(8, 50), 'in'), p(at(10), 'in'), p(at(17, 10), 'out')]));
    expect(day?.firstInAt).toEqual(at(8, 50));
    expect(day?.lastOutAt).toEqual(at(17, 10));
    expect(day?.flags).toContain('repeatedPunches');
  });

  it('a lunch break-out (unknown direction) is not leaving when a real check-out follows', () => {
    const day = deriveDay(
      input([p(at(9), 'in'), p(at(13), 'unknown'), p(at(14), 'unknown'), p(at(17), 'out')]),
    );
    expect(day?.lastOutAt).toEqual(at(17));
    expect(day?.status).toBe('present');
  });

  it('an out before the arrival is not the departure', () => {
    const pair = countedPunches([p(at(7), 'out'), p(at(9), 'in'), p(at(17), 'out')]);
    expect(pair.arrival?.at).toEqual(at(9));
    expect(pair.departure?.at).toEqual(at(17));
  });

  it('one punch stays checkedIn; no direction at all stays positional', () => {
    expect(deriveDay(input([p(at(9), 'in')]))?.status).toBe('checkedIn');
    const positional = deriveDay(input([p(at(9)), p(at(12)), p(at(17))]));
    expect(positional?.firstInAt).toEqual(at(9));
    expect(positional?.lastOutAt).toEqual(at(17));
  });

  it('with no out punch at all the current rule holds (last scan, else checkedIn)', () => {
    const day = deriveDay(input([p(at(9), 'in'), p(at(17), 'in')]));
    expect(day?.lastOutAt).toEqual(at(17));
  });

  it('a clean day raises no repeat flag', () => {
    expect(deriveDay(input([p(at(9), 'in'), p(at(17), 'out')]))?.flags).not.toContain(
      'repeatedPunches',
    );
  });

  it('the scan log tags arrival, departure and repeats; the tally counts presses', () => {
    const punches = [p(at(9), 'in'), p(at(9, 0, 20), 'in'), p(at(17), 'out'), p(at(17, 30), 'out')];
    const roles = [...scanRoles(punches, 10).values()];
    expect(roles).toEqual(['arrival', 'repeat', 'departure', 'repeat']);
    expect(punchTally(punches, 10)).toEqual({ checkIns: 2, checkOuts: 2, repeats: 2 });
  });
});

describe('working hours per department', () => {
  it('8 hours from 09:00 ends at 17:00', () => {
    const shift = patternForDepartment({ hours: 8, startTime: null }, NINE_TO_FIVE, '09:00');
    expect(shift).toMatchObject({ startTime: '09:00', endTime: '17:00', crossesMidnight: false });
  });

  it('12 hours from 08:00 ends at 20:00', () => {
    const shift = patternForDepartment({ hours: 12, startTime: '08:00' }, NINE_TO_FIVE, '09:00');
    expect(shift.endTime).toBe('20:00');
  });

  it('a 24-hour security day: leaving before 24h is short and early', () => {
    const shift = patternForDepartment({ hours: 24, startTime: '08:00' }, null, '09:00');
    expect(shift).toMatchObject({ startTime: '08:00', endTime: '08:00', crossesMidnight: true });
    const { start, end } = shiftWindow(DAY, shift);
    expect((end.getTime() - start.getTime()) / 60_000).toBe(1440);

    const nextMorning = (h: number): Date => new Date(Date.UTC(2026, 10, 19, h - 2));
    const left = deriveDay(input([p(at(8), 'in'), p(nextMorning(4), 'out')], { shift }));
    expect(left?.requiredMinutes).toBe(1440);
    expect(left?.shortfallMinutes).toBe(240);
    expect(left?.earlyLeaveMinutes).toBe(240);
    expect(left?.status).toBe('earlyLeave');

    const full = deriveDay(input([p(at(8), 'in'), p(nextMorning(8), 'out')], { shift }));
    expect(full?.status).toBe('present');
    expect(full?.shortfallMinutes).toBe(0);
  });

  it('a guard off on the 18th: the previous shift’s check-out and the next check-in are not the 18th', () => {
    const shift = patternForDepartment({ hours: 24, startTime: '08:00' }, null, '09:00');
    const day19 = (h: number, m = 0): Date => new Date(Date.UTC(2026, 10, 19, h - 2, m));
    // 18th 08:05 out closes the 17th's shift; 19th 07:47 in opens the 19th's.
    const off = deriveDay(input([p(at(8, 5), 'out'), p(day19(7, 47), 'in')], { shift }));
    expect(off?.firstInAt).toBeNull();
    expect(off?.flags).not.toContain('repeatedPunches');
  });
});
