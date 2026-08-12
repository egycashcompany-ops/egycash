// The derivation core, held to the §4 properties the design makes tests of: the resolution order
// IS the specification, recomputation is byte-identical, punch order never matters, leave wins
// over absence, and a night shift's day is its start date (D3) — the choice that decides which
// payroll month owns the day.
import { describe, expect, it } from 'vitest';
import {
  cairoInstant,
  deriveDay,
  shiftWindow,
  type DeriveDayInput,
  type EnginePunch,
  type EngineShift,
} from './derive-day';

const DAY = new Date(Date.UTC(2026, 6, 15)); // 2026-07-15, a Wednesday, Cairo DST (UTC+3)
const WINTER_DAY = new Date(Date.UTC(2026, 0, 14)); // 2026-01-14, Cairo standard time (UTC+2)

const GENERAL: EngineShift = {
  startTime: '09:00',
  endTime: '17:00',
  crossesMidnight: false,
  breakMinutes: 30,
  graceInMinutes: 15,
  graceOutMinutes: 0,
};

const NIGHT: EngineShift = {
  startTime: '22:00',
  endTime: '06:00',
  crossesMidnight: true,
  breakMinutes: 0,
  graceInMinutes: 10,
  graceOutMinutes: 0,
};

const BRANCH = 'branch-1';

const punch = (at: Date, over: Partial<EnginePunch> = {}): EnginePunch => ({
  at,
  direction: 'unknown',
  source: 'device',
  branchIdAtPunch: BRANCH,
  ...over,
});

const base = (over: Partial<DeriveDayInput> = {}): DeriveDayInput => ({
  workDate: DAY,
  employed: true,
  leave: null,
  holiday: false,
  weekend: false,
  shift: GENERAL,
  punches: [],
  employeeBranchId: BRANCH,
  ...over,
});

// Cairo is UTC+3 on the July test day: 09:00 Cairo = 06:00 UTC.
const at = (hourCairo: number, minute = 0): Date =>
  new Date(Date.UTC(2026, 6, 15, hourCairo - 3, minute));

describe('cairoInstant', () => {
  it('converts Cairo wall-clock to the right instant under DST (UTC+3)', () => {
    expect(cairoInstant(DAY, '09:00').toISOString()).toBe('2026-07-15T06:00:00.000Z');
  });

  it('converts under standard time (UTC+2)', () => {
    expect(cairoInstant(WINTER_DAY, '09:00').toISOString()).toBe('2026-01-14T07:00:00.000Z');
  });
});

describe('the resolution order — first match wins', () => {
  it('not employed → no row, whatever else is true', () => {
    expect(deriveDay(base({ employed: false, punches: [punch(at(9))] }))).toBeNull();
  });

  it('leave wins over absence — and over the calendar', () => {
    const row = deriveDay(
      base({ leave: { leaveId: 'lv-1', halfDay: false }, holiday: true, weekend: true }),
    );
    expect(row?.status).toBe('onLeave');
    expect(row?.leaveId).toBe('lv-1');
    expect(row?.workedMinutes).toBe(0);
  });

  it('a half-day leave keeps the worked half', () => {
    const row = deriveDay(
      base({
        leave: { leaveId: 'lv-2', halfDay: true },
        punches: [punch(at(13)), punch(at(17))],
      }),
    );
    expect(row?.status).toBe('onLeave');
    // 4 hours minus the 30-minute break.
    expect(row?.workedMinutes).toBe(210);
    expect(row?.lateMinutes).toBe(0);
  });

  it('holiday beats weekend beats dayOff beats absent', () => {
    expect(deriveDay(base({ holiday: true, weekend: true }))?.status).toBe('holiday');
    expect(deriveDay(base({ weekend: true }))?.status).toBe('weekend');
    expect(deriveDay(base({ shift: null }))?.status).toBe('dayOff');
    expect(deriveDay(base())?.status).toBe('absent');
  });

  it('one punch is an incomplete day, never a guessed one (D6)', () => {
    const row = deriveDay(base({ punches: [punch(at(9))] }));
    expect(row?.status).toBe('incomplete');
    expect(row?.workedMinutes).toBe(0);
    expect(row?.firstInAt?.toISOString()).toBe(at(9).toISOString());
  });
});

describe('the computed day', () => {
  it('on time, full day: present, worked minus break', () => {
    const row = deriveDay(base({ punches: [punch(at(9)), punch(at(17))] }));
    expect(row?.status).toBe('present');
    expect(row?.workedMinutes).toBe(450); // 8h − 30min break
    expect(row?.lateMinutes).toBe(0);
    expect(row?.earlyLeaveMinutes).toBe(0);
    expect(row?.overtimeMinutes).toBe(0);
  });

  it('inside grace is not late; one minute past grace is late by the RAW minutes (D4)', () => {
    expect(deriveDay(base({ punches: [punch(at(9, 14)), punch(at(17))] }))?.lateMinutes).toBe(0);
    const row = deriveDay(base({ punches: [punch(at(9, 16)), punch(at(17))] }));
    expect(row?.status).toBe('late');
    // Raw minutes from shift START, not from the grace boundary: 09:16 − 09:00 = 16.
    expect(row?.lateMinutes).toBe(16);
  });

  it('leaving early is measured against the end, minus graceOut', () => {
    const row = deriveDay(base({ punches: [punch(at(9)), punch(at(16))] }));
    expect(row?.status).toBe('earlyLeave');
    expect(row?.earlyLeaveMinutes).toBe(60);
  });

  it('late and early together classify as lateAndEarly', () => {
    const row = deriveDay(base({ punches: [punch(at(10)), punch(at(16))] }));
    expect(row?.status).toBe('lateAndEarly');
    expect(row?.lateMinutes).toBe(60);
    expect(row?.earlyLeaveMinutes).toBe(60);
  });

  it('overtime is derived after the end and is NOT auto-approved (D5)', () => {
    const row = deriveDay(base({ punches: [punch(at(9)), punch(at(19, 30))] }));
    expect(row?.status).toBe('present');
    expect(row?.overtimeMinutes).toBe(150);
    // approvedOvertimeMinutes is not this function's to grant: the row starts at 0 and only the
    // AT-5 approval raises it — asserted here by the shape not carrying it at all.
    expect('approvedOvertimeMinutes' in (row ?? {})).toBe(false);
  });
});

describe('§4 properties', () => {
  it('idempotent and order-independent: shuffled punches, byte-identical output', () => {
    const punches = [punch(at(17)), punch(at(9, 20)), punch(at(12)), punch(at(13))];
    const a = deriveDay(base({ punches }));
    const b = deriveDay(base({ punches: [...punches].reverse() }));
    const c = deriveDay(base({ punches }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
  });

  it('the input array is not mutated by sorting', () => {
    const punches = [punch(at(17)), punch(at(9))];
    deriveDay(base({ punches }));
    expect(punches[0]?.at.toISOString()).toBe(at(17).toISOString());
  });
});

describe('D3 — the night shift belongs to its start date', () => {
  it('the window ends on the NEXT calendar day', () => {
    const { start, end } = shiftWindow(DAY, NIGHT);
    expect(start.toISOString()).toBe('2026-07-15T19:00:00.000Z'); // 22:00 Cairo
    expect(end.toISOString()).toBe('2026-07-16T03:00:00.000Z'); // 06:00 Cairo next day
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  it('a full night shift computes as one present day on the start date', () => {
    const row = deriveDay(
      base({
        shift: NIGHT,
        punches: [
          punch(new Date('2026-07-15T19:00:00.000Z')),
          punch(new Date('2026-07-16T03:00:00.000Z')),
        ],
      }),
    );
    expect(row?.status).toBe('present');
    expect(row?.workedMinutes).toBe(480);
  });
});

describe('D8 flags — signals, never arithmetic', () => {
  it('flags a punch from another branch and a manual punch', () => {
    const row = deriveDay(
      base({
        punches: [
          punch(at(9), { branchIdAtPunch: 'branch-2' }),
          punch(at(17), { source: 'manual' }),
        ],
      }),
    );
    expect(row?.flags).toEqual(['crossBranchPunch', 'manualPunch']);
    // Same minutes as the unflagged day — the flags changed nothing numeric.
    expect(row?.workedMinutes).toBe(450);
  });
});
