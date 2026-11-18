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
  // The production default. Every existing expectation in this file uses punches hours apart, so
  // nothing below is collapsed by it; the cases that exercise it say so.
  minPunchGapMinutes: 10,
  employeeBranchId: BRANCH,
  decision: null,
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

  it('holiday beats weekend beats noSchedule beats absent', () => {
    expect(deriveDay(base({ holiday: true, weekend: true }))?.status).toBe('holiday');
    expect(deriveDay(base({ weekend: true }))?.status).toBe('weekend');
    expect(deriveDay(base({ shift: null }))?.status).toBe('noSchedule');
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
    // NOT `dayOff`: nobody has said when this person works, which is a gap in the roster and not
    // a rest day the company granted. Production showed a whole branch marked «يوم راحة» on a
    // Tuesday before this was split.
    expect(noShift([])?.status).toBe('noSchedule');
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

  it('never applies without an expectation: no shift and no pattern is noSchedule all day', () => {
    // Nobody said when this person was due, so there is no hour for them to be "not yet in" by —
    // and equally no grounds to call the day a rest day.
    expect(deriveDay(base({ shift: null, now: at(10) }))?.status).toBe('noSchedule');
    expect(deriveDay(base({ shift: null, now: at(23) }))?.status).toBe('noSchedule');
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

describe("a manager's decision is an input, not an edit (stage 3)", () => {
  const decided = (
    type: 'markPresent' | 'markAbsent' | 'editTimes',
    inAt: Date | null = null,
    outAt: Date | null = null,
  ) => ({ type, inAt, outAt });

  it('markAbsent decides the day against the evidence, and SAYS it did', () => {
    // The punches are not deleted and not superseded — the device saw what it saw. The flag is
    // what tells a reviewer the status was judged rather than read.
    const out = deriveDay(
      base({ punches: [punch(at(9)), punch(at(17))], decision: decided('markAbsent') }),
    );
    expect(out?.status).toBe('absent');
    expect(out?.flags).toContain('overriddenByManager');
    expect(out?.workedMinutes).toBe(0);
  });

  it('markPresent on a day with no punches at all gives a checked-in day', () => {
    // A manager vouching for an arrival should not have to invent a departure: on this payroll
    // most people never scan out, so an arrival alone is the ordinary shape of a working day.
    const out = deriveDay(base({ punches: [], decision: decided('markPresent', at(9)) }));
    expect(out?.status).toBe('checkedIn');
    expect(out?.firstInAt).toEqual(at(9));
    expect(out?.lastOutAt).toBeNull();
    expect(out?.flags).toContain('overriddenByManager');
  });

  it('applies the SAME lateness rule to a vouched-for arrival as to a scanned one', () => {
    // GENERAL starts 09:00 with 15 minutes of grace. The manager supplies the evidence, never the
    // verdict — so somebody vouched in at 10:00 is an hour late, exactly as the device would say.
    const out = deriveDay(base({ decision: decided('markPresent', at(10)) }));
    expect(out?.status).toBe('checkedIn');
    expect(out?.lateMinutes).toBe(60);
  });

  it('editTimes replaces the span and earns overtime by the ordinary arithmetic', () => {
    const out = deriveDay(base({ punches: [punch(at(9))], decision: decided('editTimes', at(9), at(19)) }));
    // 09:00→19:00 is 600 minutes less GENERAL's 30-minute break; the shift ends at 17:00, so the
    // last two hours are overtime and nothing about that is special-cased for a decision.
    expect(out?.workedMinutes).toBe(600 - GENERAL.breakMinutes);
    expect(out?.overtimeMinutes).toBe(120);
    expect(out?.status).toBe('present');
    expect(out?.flags).toContain('overriddenByManager');
  });

  it('leaves the day it replaces entirely alone otherwise — the evidence still shapes the flags', () => {
    // A cross-branch punch stays reported even when the manager overrode the day: the flags
    // describe what was OBSERVED, and that does not stop being true because somebody judged it.
    const out = deriveDay(
      base({
        punches: [punch(at(9), { branchIdAtPunch: 'branch-2' })],
        decision: decided('markAbsent'),
      }),
    );
    expect(out?.flags).toContain('crossBranchPunch');
    expect(out?.flags).toContain('overriddenByManager');
  });

  it('NEVER talks over the calendar or an approved leave', () => {
    // Marking somebody absent from a day they were never due is not a judgement anyone should be
    // able to record, so the decision sits below leave, holidays and the weekend in the order.
    expect(deriveDay(base({ weekend: true, decision: decided('markAbsent') }))?.status).toBe('weekend');
    expect(deriveDay(base({ holiday: true, decision: decided('markAbsent') }))?.status).toBe('holiday');
    expect(
      deriveDay(
        base({ leave: { leaveId: 'lv-1', halfDay: false }, decision: decided('markAbsent') }),
      )?.status,
    ).toBe('onLeave');
  });

  it('is re-applied on every derivation, which is what makes a re-send harmless', () => {
    // THE GUARANTEE OF THE WHOLE FEATURE. A branch server re-sending its punches and calling
    // `days/recompute` runs exactly this: same decision, more punches, same verdict.
    const input = base({ punches: [punch(at(9))], decision: decided('markAbsent') });
    const first = deriveDay(input);
    const resend = deriveDay({ ...input, punches: [punch(at(9)), punch(at(17))] });
    expect(resend?.status).toBe('absent');
    expect(resend?.status).toBe(first?.status);
  });

  it('with no decision the day derives exactly as it always did', () => {
    expect(deriveDay(base({ punches: [punch(at(9)), punch(at(17))] }))?.flags).not.toContain(
      'overriddenByManager',
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

/**
 * RE-TAPS — the defect behind «حاضر» with zero worked minutes.
 *
 * The owner's 18 November sheet: five people read «حاضر» and 0 minutes, one «حاضر» and 5. The
 * pairing is positional because the K40 Pro logs presence without a direction, so a finger
 * presented twice became an arrival and a departure. On a rostered day the same two taps would
 * have handed payroll a full shift's worth of «انصراف مبكر».
 */
describe('two scans a moment apart are one visit to the reader', () => {
  it('reads a re-tap as a check-in, not a zero-minute day', () => {
    // 09:57:03 then 09:57:41 — one finger, read twice.
    const day = deriveDay(
      base({
        shift: null,
        punches: [punch(at(9, 57)), punch(new Date(at(9, 57).getTime() + 38_000))],
      }),
    );
    expect(day?.status).toBe('checkedIn');
    expect(day?.firstInAt).toEqual(at(9, 57));
    // Not a departure, so no hours are claimed and none are denied.
    expect(day?.lastOutAt).toBeNull();
    expect(day?.workedMinutes).toBe(0);
  });

  it('keeps the FIRST tap of a cluster, which is when the person actually arrived', () => {
    const day = deriveDay(
      base({
        shift: null,
        punches: [punch(at(8)), punch(at(8, 2)), punch(at(8, 5)), punch(at(17))],
      }),
    );
    // 08:00 → 17:00, not 08:05 → 17:00: the third attempt is not the arrival.
    expect(day?.firstInAt).toEqual(at(8));
    expect(day?.lastOutAt).toEqual(at(17));
    expect(day?.workedMinutes).toBe(9 * 60);
  });

  it('never collapses a real working day, however many re-taps surround its ends', () => {
    // Each comparison is against the previous KEPT punch, so a long day keeps both ends.
    const day = deriveDay(
      base({
        shift: null,
        punches: [
          punch(at(8)), punch(new Date(at(8).getTime() + 20_000)),
          punch(at(16, 30)), punch(at(16, 31)),
        ],
      }),
    );
    expect(day?.status).toBe('present');
    expect(day?.workedMinutes).toBe(8 * 60 + 30);
  });

  it('REGRESSION: a re-tap on a rostered day invents no early leave', () => {
    // This is the half that had not happened yet and would have cost somebody money: paired
    // positionally, a second tap at 08:00 is a departure eight hours before the shift ends.
    const day = deriveDay(
      base({
        punches: [punch(at(8)), punch(new Date(at(8).getTime() + 45_000))],
      }),
    );
    expect(day?.status).toBe('checkedIn');
    expect(day?.earlyLeaveMinutes).toBe(0);
    expect(day?.workedMinutes).toBe(0);
  });

  it('pairs every scan when the threshold is switched off', () => {
    // 0 is the escape hatch, and it restores exactly the old behaviour — including the defect,
    // which is what makes it an honest switch rather than a pretend one.
    const day = deriveDay(
      base({
        shift: null,
        minPunchGapMinutes: 0,
        punches: [punch(at(9, 57)), punch(new Date(at(9, 57).getTime() + 38_000))],
      }),
    );
    expect(day?.status).toBe('present');
    expect(day?.workedMinutes).toBe(0);
  });

  it('still flags a manual punch that the collapse removed from the pairing', () => {
    // The flags describe EVERYTHING the devices saw, so they are taken before the collapse.
    const day = deriveDay(
      base({
        shift: null,
        punches: [
          punch(at(9)),
          punch(new Date(at(9).getTime() + 30_000), { source: 'manual' }),
        ],
      }),
    );
    expect(day?.status).toBe('checkedIn');
    expect(day?.flags).toContain('manualPunch');
  });
});
