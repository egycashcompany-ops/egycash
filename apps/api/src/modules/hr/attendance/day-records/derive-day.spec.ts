// The derivation core, held to the §4 properties the design makes tests of: the resolution order
// IS the specification, recomputation is byte-identical, punch order never matters, leave wins
// over absence, and a night shift's day is its start date (D3) — the choice that decides which
// payroll month owns the day.
import { describe, expect, it } from 'vitest';
import {
  cairoInstant,
  deriveDay,
  punchWindowFor,
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

/**
 * Two days after the test day, so every expectation under test has already ENDED by `now` and an
 * expected day with no punches derives `absent` — the state this file has always asserted. The
 * `pending` boundary is interesting enough to get its own describe block rather than to be smeared
 * across the default, and it moves `now` explicitly.
 */
const AFTER_THE_FACT = new Date(Date.UTC(2026, 6, 17));

const base = (over: Partial<DeriveDayInput> = {}): DeriveDayInput => ({
  workDate: DAY,
  employed: true,
  leave: null,
  holiday: false,
  weekend: false,
  shift: GENERAL,
  punches: [],
  employeeBranchId: BRANCH,
  now: AFTER_THE_FACT,
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

  it('one punch is a CHECK-IN, not a fault — the ordinary day here (owner ruling)', () => {
    const row = deriveDay(base({ punches: [punch(at(9))] }));
    expect(row?.status).toBe('checkedIn');
    expect(row?.firstInAt?.toISOString()).toBe(at(9).toISOString());
    // The hours are unknown, and a departure is still never guessed into the day (D6).
    expect(row?.workedMinutes).toBe(0);
    expect(row?.lastOutAt).toBeNull();
    expect(row?.earlyLeaveMinutes).toBe(0);
    expect(row?.overtimeMinutes).toBe(0);
  });

  it('a check-in is still LATE when it is late — being expected at a time is what makes it so', () => {
    const onTime = deriveDay(base({ punches: [punch(at(9, 10))] }));
    expect(onTime?.status).toBe('checkedIn');
    expect(onTime?.lateMinutes).toBe(0); // inside the 15-minute grace

    const late = deriveDay(base({ punches: [punch(at(10))] }));
    expect(late?.status).toBe('checkedIn');
    expect(late?.lateMinutes).toBe(60); // raw minutes past the 09:00 start (D4)
    expect(late?.workedMinutes).toBe(0);
  });
});

// Most of this workforce has no shift assignment. The engine used to answer `dayOff` with no
// times for all of them, which hid scans that were sitting in the database.
describe('no shift and no default pattern — report what the devices saw', () => {
  const noShift = (punches: EnginePunch[]) => deriveDay(base({ shift: null, punches }));

  it('no punches at all is still a day nobody owes anything for', () => {
    expect(noShift([])?.status).toBe('dayOff');
  });

  it('one punch is a check-in, and nothing is late with no expected start', () => {
    const row = noShift([punch(at(9))]);
    expect(row?.status).toBe('checkedIn');
    expect(row?.firstInAt?.toISOString()).toBe(at(9).toISOString());
    expect(row?.lateMinutes).toBe(0);
    expect(row?.workedMinutes).toBe(0);
  });

  it('two punches give a present day with both times and the span between them', () => {
    const row = noShift([punch(at(9)), punch(at(17))]);
    expect(row?.status).toBe('present');
    expect(row?.firstInAt?.toISOString()).toBe(at(9).toISOString());
    expect(row?.lastOutAt?.toISOString()).toBe(at(17).toISOString());
    // The full 8 hours: with no shift there is no break to subtract, where the same two punches
    // against GENERAL would be 450 minutes.
    expect(row?.workedMinutes).toBe(480);
  });

  it('nothing is ever late, early or overtime without an expected start and end', () => {
    const row = noShift([punch(at(5)), punch(at(23))]);
    expect(row?.lateMinutes).toBe(0);
    expect(row?.earlyLeaveMinutes).toBe(0);
    expect(row?.overtimeMinutes).toBe(0);
  });

  it('first-in and last-out are taken over the whole day, whatever order they arrive in', () => {
    const row = noShift([punch(at(17)), punch(at(9)), punch(at(13))]);
    expect(row?.firstInAt?.toISOString()).toBe(at(9).toISOString());
    expect(row?.lastOutAt?.toISOString()).toBe(at(17).toISOString());
  });
});

// The window is where a pre-dawn punch is either attributed once or attributed twice, and the
// difference is a twenty-hour working day on somebody's record. These are the properties that
// make the shift-less case safe, proven without a database.
describe('pending — an expected day nobody has concluded yet', () => {
  // GENERAL ends at 17:00 Cairo, which is 14:00 UTC on this July day.
  const end = shiftWindow(DAY, GENERAL).end;

  it('is pending while the expected end is still ahead, and absent once it has passed', () => {
    // The branch servers recompute all day long, so this is a row that really does get written at
    // ten in the morning for somebody who has not scanned. Calling that an absence would put a
    // false statement in the database about a person who is very likely to walk in at ten past.
    expect(deriveDay(base({ now: at(10) }))?.status).toBe('pending');
    expect(deriveDay(base({ now: at(18) }))?.status).toBe('absent');
  });

  it('turns over exactly AT the expected end, not a minute either side', () => {
    expect(deriveDay(base({ now: new Date(end.getTime() - 1) }))?.status).toBe('pending');
    expect(deriveDay(base({ now: end }))?.status).toBe('absent');
    expect(deriveDay(base({ now: new Date(end.getTime() + 1) }))?.status).toBe('absent');
  });

  it('carries no quantities either way — it is the absence of information, not a measurement', () => {
    const pending = deriveDay(base({ now: at(10) }));
    expect(pending).toMatchObject({
      status: 'pending',
      firstInAt: null,
      lastOutAt: null,
      workedMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
    });
  });

  it('never applies without an expectation: no shift and no pattern stays dayOff all day', () => {
    // Nobody said when this person was due, so there is no hour for them to be "not yet in" by.
    expect(deriveDay(base({ shift: null, now: at(10) }))?.status).toBe('dayOff');
    expect(deriveDay(base({ shift: null, now: at(23) }))?.status).toBe('dayOff');
  });

  it('never outranks the calendar or a punch', () => {
    // Every earlier branch of the resolution still wins: `pending` is only ever the answer to
    // "expected, and nothing seen".
    expect(deriveDay(base({ now: at(10), weekend: true }))?.status).toBe('weekend');
    expect(deriveDay(base({ now: at(10), holiday: true }))?.status).toBe('holiday');
    expect(
      deriveDay(base({ now: at(10), leave: { leaveId: 'lv-1', halfDay: false } }))?.status,
    ).toBe('onLeave');
    expect(deriveDay(base({ now: at(10), punches: [punch(at(9))] }))?.status).toBe('checkedIn');
  });

  it('follows a night shift past midnight — the day is winnable until the shift ends', () => {
    // NIGHT runs 22:00 → 06:00, so at 02:00 Cairo on the following morning the day that started
    // on DAY is still in progress. A cut at midnight would mint an absence for somebody halfway
    // through their shift.
    const nightEnd = shiftWindow(DAY, NIGHT).end;
    expect(deriveDay(base({ shift: NIGHT, now: new Date(nightEnd.getTime() - 60_000) }))?.status).toBe(
      'pending',
    );
    expect(deriveDay(base({ shift: NIGHT, now: new Date(nightEnd.getTime() + 60_000) }))?.status).toBe(
      'absent',
    );
  });
});

describe('punchWindowFor — no punch belongs to two days', () => {
  const dayAfter = (d: Date): Date => new Date(d.getTime() + 86_400_000);

  it('with no shift the window is exactly one Cairo calendar day', () => {
    const w = punchWindowFor(DAY, null);
    expect(w.from.toISOString()).toBe(cairoInstant(DAY, '00:00').toISOString());
    // The last millisecond before the next Cairo midnight, because the repository query is
    // inclusive at both ends.
    expect(w.to.getTime()).toBe(cairoInstant(dayAfter(DAY), '00:00').getTime() - 1);
  });

  it('consecutive shift-less days do not overlap, not even by one millisecond', () => {
    const first = punchWindowFor(DAY, null);
    const second = punchWindowFor(dayAfter(DAY), null);
    expect(first.to.getTime()).toBeLessThan(second.from.getTime());
    expect(second.from.getTime() - first.to.getTime()).toBe(1);
  });

  it('a 05:00 punch falls in exactly ONE shift-less day — the morning it happened', () => {
    const preDawn = new Date(Date.UTC(2026, 6, 16, 2)); // 05:00 Cairo on the 16th (UTC+3)
    const inWindow = (w: { from: Date; to: Date }): boolean =>
      preDawn >= w.from && preDawn <= w.to;
    expect(inWindow(punchWindowFor(DAY, null))).toBe(false); // not the 15th's last-out
    expect(inWindow(punchWindowFor(dayAfter(DAY), null))).toBe(true); // the 16th's first-in
  });

  it('holds across the DST boundary, where a day is not 24 hours of UTC', () => {
    const w = punchWindowFor(WINTER_DAY, null);
    expect(w.from.toISOString()).toBe(cairoInstant(WINTER_DAY, '00:00').toISOString());
    expect(w.to.getTime()).toBe(cairoInstant(dayAfter(WINTER_DAY), '00:00').getTime() - 1);
    const next = punchWindowFor(dayAfter(WINTER_DAY), null);
    expect(next.from.getTime() - w.to.getTime()).toBe(1);
  });

  it('with a shift it is the shift span plus the D3 margins, which DO overlap on purpose', () => {
    const w = punchWindowFor(DAY, GENERAL);
    const { start, end } = shiftWindow(DAY, GENERAL);
    expect(w.from.getTime()).toBe(start.getTime() - 6 * 60 * 60 * 1000);
    expect(w.to.getTime()).toBe(end.getTime() + 12 * 60 * 60 * 1000);
    // Stated as a property so nobody "fixes" it later: an overtime tail belongs to the day worked.
    expect(punchWindowFor(dayAfter(DAY), GENERAL).from.getTime()).toBeLessThan(w.to.getTime());
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
