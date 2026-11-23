// The derivation core, held to the §4 properties the design makes tests of: the resolution order
// IS the specification, recomputation is byte-identical, punch order never matters, leave wins
// over absence, and a night shift's day is its start date (D3) — the choice that decides which
// payroll month owns the day.
import { describe, expect, it } from 'vitest';
import { figuresOf } from '@ecms/contracts';
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
  // ON in the fixture, OFF in production. This file's subject is the engine's own arithmetic, and
  // «an expected day with nothing on it is an absence» is the statement that arithmetic makes;
  // whether the company wants that statement published is the owner's setting, which ships false
  // and has its own block below. `attendance.settings.spec.ts` pins the shipped default.
  countAbsence: true,
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
    // Four hours flat. The break is NOT subtracted: worked time is last out − first in everywhere
    // in this engine, by the owner's rule of 18 November, and a half day gets no second definition.
    expect(row?.workedMinutes).toBe(240);
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

  it('a check-in with no check-out judges NOTHING — not even a ten-o-clock arrival', () => {
    // THIS ASSERTION WAS REVERSED by the owner's flexible-hours rule, and the reversal is the
    // point rather than a loosening. Lateness under that rule is conditional: an arrival after the
    // expected start is late ONLY IF the required hours were not completed. With no check-out,
    // whether they were completed is precisely what nobody knows — so calling the arrival late
    // would be reaching the verdict by skipping the test the rule asks for.
    //
    // The arrival time is still recorded, in full, because that is the fact. What is withheld is
    // the judgement. The screens show «حضر فقط» and a blank where every figure would go.
    const early = deriveDay(base({ punches: [punch(at(9, 10))] }));
    expect(early?.status).toBe('checkedIn');
    expect(early?.lateMinutes).toBe(0);

    const tenOClock = deriveDay(base({ punches: [punch(at(10))] }));
    expect(tenOClock?.status).toBe('checkedIn');
    expect(tenOClock?.firstInAt).toEqual(at(10));
    expect(tenOClock?.lateMinutes).toBe(0);
    expect(tenOClock?.shortfallMinutes).toBe(0);
    expect(tenOClock?.workedMinutes).toBe(0);
    // And what the day was OWED is still reported, because that much is known: 09:00–17:00 less
    // GENERAL's half-hour break.
    expect(tenOClock?.requiredMinutes).toBe(450);
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

  it('applies the SAME rules to a vouched-for arrival as to a scanned one', () => {
    // The manager supplies the evidence, never the verdict — so a `markPresent` carrying only an
    // arrival is read exactly as a single scan is: «حضر فقط», and nothing judged, because the
    // flexible rule cannot be applied to a day with no departure. Vouching for somebody does not
    // buy them a verdict the same evidence from a device would not have earned.
    const out = deriveDay(base({ decision: decided('markPresent', at(10)) }));
    expect(out?.status).toBe('checkedIn');
    expect(out?.firstInAt).toEqual(at(10));
    expect(out?.lateMinutes).toBe(0);
  });

  it('editTimes replaces the span and earns overtime by the ordinary arithmetic', () => {
    const out = deriveDay(base({ punches: [punch(at(9))], decision: decided('editTimes', at(9), at(19)) }));
    // 09:00→19:00 is 600 minutes of presence, flat. GENERAL requires 450 (eight hours less its
    // half-hour break), so 150 of them are overtime — by worked − required, not by «after 17:00»,
    // and nothing about that arithmetic is special-cased for a decision.
    expect(out?.workedMinutes).toBe(600);
    expect(out?.overtimeMinutes).toBe(150);
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

  it('with a same-day shift it is the span plus the D3 margins, the tail trimmed where it would collide', () => {
    const w = punchWindowFor(DAY, GENERAL);
    const { start } = shiftWindow(DAY, GENERAL);
    expect(w.from.getTime()).toBe(start.getTime() - 6 * 60 * 60 * 1000);

    // THIS ASSERTION USED TO READ THE OTHER WAY, and it was wrong in this describe block of all
    // places. It asserted that consecutive windows overlap «on purpose» — true of a roster that
    // crosses midnight, where the shift itself says which night a 17:00 scan belongs to, and NOT
    // true of a nine-to-five, where the twelve-hour tail reached 05:00 and the next day's window
    // opened at 03:00. A scan in those two hours belonged to both days: yesterday's departure
    // after nineteen hours, and this morning's arrival. The block is titled «no punch belongs to
    // two days»; this is the case that did.
    //
    // The tail is trimmed to the instant before the next day's window opens — 03:00, still ten
    // hours past the end and past any real departure — and not one millisecond further.
    const next = punchWindowFor(dayAfter(DAY), GENERAL);
    expect(w.to.getTime()).toBe(next.from.getTime() - 1);
  });

  it('with a MIDNIGHT-CROSSING shift the margins still overlap, which is the roster talking', () => {
    // Kept as a property, for the reason the trimmed case is not: a night shift's own definition
    // says a scan at five in the afternoon follows the night that started the evening before.
    const w = punchWindowFor(DAY, NIGHT);
    const { start, end } = shiftWindow(DAY, NIGHT);
    expect(w.from.getTime()).toBe(start.getTime() - 6 * 60 * 60 * 1000);
    expect(w.to.getTime()).toBe(end.getTime() + 12 * 60 * 60 * 1000);
    expect(punchWindowFor(dayAfter(DAY), NIGHT).from.getTime()).toBeLessThan(w.to.getTime());
  });
});

describe('the computed day', () => {
  it('on time, full day: present, worked is out − in with nothing subtracted', () => {
    const row = deriveDay(base({ punches: [punch(at(9)), punch(at(17))] }));
    expect(row?.status).toBe('present');
    // Eight hours of presence, flat. GENERAL's half-hour break is NOT taken off the worked figure
    // — it sets what the day REQUIRES (450) and nothing else, so this day is thirty minutes over.
    expect(row?.workedMinutes).toBe(480);
    expect(row?.requiredMinutes).toBe(450);
    expect(row?.lateMinutes).toBe(0);
    expect(row?.shortfallMinutes).toBe(0);
    expect(row?.earlyLeaveMinutes).toBe(0);
    expect(row?.overtimeMinutes).toBe(30);
  });

  it('a late arrival is not late when the hours are finished anyway', () => {
    // 09:16 is past both the start and the fifteen-minute grace, and this day is STILL «حاضر»:
    // 09:16→17:00 is 464 minutes against GENERAL's required 450. The flexible rule asks whether
    // the time was owed, not whether the arrival was punctual.
    const madeUp = deriveDay(base({ punches: [punch(at(9, 16)), punch(at(17))] }));
    expect(madeUp?.status).toBe('present');
    expect(madeUp?.lateMinutes).toBe(0);
    expect(madeUp?.shortfallMinutes).toBe(0);

    // Leave at 16:30 instead and the same arrival IS late, because now the day is short: 09:16 →
    // 16:30 is 434 minutes, sixteen short of the 450 required. THE THREE NUMBERS ARE THREE
    // DIFFERENT FACTS and this day shows all of them — sixteen minutes late at the door, thirty
    // minutes early at the end, and sixteen minutes actually missing from the day. The shortfall
    // is the only one of the three that answers «how much time is owed».
    const short = deriveDay(base({ punches: [punch(at(9, 16)), punch(at(16, 30))] }));
    expect(short?.status).toBe('lateAndEarly');
    expect(short?.lateMinutes).toBe(16);
    expect(short?.earlyLeaveMinutes).toBe(30);
    expect(short?.shortfallMinutes).toBe(16);
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
    // 09:00→19:30 is 630 minutes of presence against 450 required: 180 over. Measured as
    // worked − required, so the figure does not depend on which hours of the clock they fell in.
    expect(row?.overtimeMinutes).toBe(180);
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
    expect(row?.workedMinutes).toBe(480);
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

/**
 * THE OWNER'S OWN CASES, in his numbers, against the company default he set on 18 November:
 * 09:00 to 17:00, eight hours, no break, no grace. Required = 480.
 *
 * They are kept together and spelled out one by one because this block is the rule as the person
 * who owns it stated it — every `it` below is a sentence he wrote — and because the whole point of
 * the rule is that several of these days look wrong by the clock and are right by the hours.
 */
const COMPANY: EngineShift = {
  startTime: '09:00',
  endTime: '17:00',
  crossesMidnight: false,
  breakMinutes: 0,
  graceInMinutes: 0,
  graceOutMinutes: 0,
};

describe('the flexible eight-hour rule (the owner, 18 November)', () => {
  const day = (first: Date, last?: Date) =>
    deriveDay(
      base({
        shift: COMPANY,
        punches: last === undefined ? [punch(first)] : [punch(first), punch(last)],
      }),
    );

  it('09:00 → 17:00 is a plain present day: eight hours, nothing owed, nothing over', () => {
    const row = day(at(9), at(17));
    expect(row?.status).toBe('present');
    expect(row?.workedMinutes).toBe(480);
    expect(row?.requiredMinutes).toBe(480);
    expect(row?.lateMinutes).toBe(0);
    expect(row?.shortfallMinutes).toBe(0);
    expect(row?.earlyLeaveMinutes).toBe(0);
    expect(row?.overtimeMinutes).toBe(0);
  });

  it('09:40 → 17:40 is NOT late: the eight hours were completed', () => {
    // «If someone arrives after 09:00 but works 8 hours or more, they are NOT late and NOT early.»
    // This is the clause the whole rule exists for, and the one an ordinary late-arrival check
    // would get wrong.
    const row = day(at(9, 40), at(17, 40));
    expect(row?.status).toBe('present');
    expect(row?.workedMinutes).toBe(480);
    expect(row?.lateMinutes).toBe(0);
    expect(row?.shortfallMinutes).toBe(0);
  });

  it('09:40 → 17:00 is late 0:40 with a shortfall of 0:40', () => {
    const row = day(at(9, 40), at(17));
    expect(row?.status).toBe('late');
    expect(row?.lateMinutes).toBe(40);
    expect(row?.shortfallMinutes).toBe(40);
    expect(row?.workedMinutes).toBe(440);
  });

  it('07:00 → 15:00 is on time: an early start finishes the day early, and that is allowed', () => {
    const row = day(at(7), at(15));
    expect(row?.status).toBe('present');
    expect(row?.workedMinutes).toBe(480);
    expect(row?.earlyLeaveMinutes).toBe(0);
    expect(row?.shortfallMinutes).toBe(0);
    // «Coming early is never counted as anything» — eight hours is eight hours, not nine.
    expect(row?.overtimeMinutes).toBe(0);
  });

  it('09:00 → 16:00 is a shortfall of 1:00 and no lateness at all', () => {
    const row = day(at(9), at(16));
    expect(row?.shortfallMinutes).toBe(60);
    expect(row?.lateMinutes).toBe(0);
    // The hour is missing from the END of the day, so that is where it is reported.
    expect(row?.earlyLeaveMinutes).toBe(60);
    expect(row?.status).toBe('earlyLeave');
  });

  it('09:00 → 19:00 earns 2:00 of overtime, derived and unapproved', () => {
    const row = day(at(9), at(19));
    expect(row?.status).toBe('present');
    expect(row?.workedMinutes).toBe(600);
    expect(row?.overtimeMinutes).toBe(120);
  });

  it('08:59, 09:00 and 09:01 — the boundary, to the minute', () => {
    // «Check-in at 09:00 or earlier = on time. 09:01 or later = late.» Each of these leaves at
    // 16:00, so all three days are short and the lateness clause is live for all three.
    expect(day(at(8, 59), at(16))?.lateMinutes).toBe(0);
    expect(day(at(9), at(16))?.lateMinutes).toBe(0);
    expect(day(at(9, 1), at(16))?.lateMinutes).toBe(1);
    expect(day(at(9, 1), at(16))?.status).toBe('lateAndEarly');
  });

  it('a missing check-out reports NOTHING, never zero', () => {
    const row = day(at(9, 40));
    expect(row?.status).toBe('checkedIn');
    expect(row?.firstInAt).toEqual(at(9, 40));
    expect(row?.lastOutAt).toBeNull();
    // The engine stores zeros because the stored row is a quantity for payroll. What a READER
    // sees is decided by `figuresOf`, which blanks all five — and `figures.spec.ts` holds it to
    // that. The pair is the contract: no quantity invented, no zero displayed.
    expect(row?.workedMinutes).toBe(0);
    expect(row?.lateMinutes).toBe(0);
    expect(row?.shortfallMinutes).toBe(0);
    expect(row?.overtimeMinutes).toBe(0);
    expect(
      figuresOf({
        firstInAt: row?.firstInAt ?? null,
        lastOutAt: row?.lastOutAt ?? null,
        workedMinutes: row?.workedMinutes ?? 0,
        lateMinutes: row?.lateMinutes ?? 0,
        shortfallMinutes: row?.shortfallMinutes ?? 0,
        earlyLeaveMinutes: row?.earlyLeaveMinutes ?? 0,
        overtimeMinutes: row?.overtimeMinutes ?? 0,
        requiredMinutes: row?.requiredMinutes ?? null,
      }),
    ).toEqual({
      workedMinutes: null,
      lateMinutes: null,
      shortfallMinutes: null,
      earlyLeaveMinutes: null,
      overtimeMinutes: null,
      requiredMinutes: 480,
    });
  });

  it('a night shift keeps its check-out after midnight on the same work day', () => {
    // 22:00 to 06:00, keyed to the date it STARTED (D3). The exit falls on the next calendar date
    // and is still this day's `lastOutAt`, and the eight hours are counted across the midnight
    // boundary — which is why worked time is computed from instants and never from a wall clock.
    const row = deriveDay(
      base({
        shift: NIGHT,
        punches: [punch(at(22)), punch(new Date(at(22).getTime() + 8 * 60 * 60_000))],
      }),
    );
    expect(row?.status).toBe('present');
    expect(row?.workedMinutes).toBe(480);
    expect(row?.requiredMinutes).toBe(480);
    expect(row?.shortfallMinutes).toBe(0);
    expect(row?.lastOutAt?.getTime()).toBeGreaterThan(row?.firstInAt?.getTime() ?? 0);
  });
});

describe('«lateness only for now» — the word for a day with no scan', () => {
  it('reads noRecord, not absent, while the owner has absence switched off', () => {
    const row = deriveDay(base({ shift: COMPANY, punches: [], countAbsence: false }));
    expect(row?.status).toBe('noRecord');
    // It still says what the day was owed — that much nobody disputes.
    expect(row?.requiredMinutes).toBe(480);
  });

  it('reads absent once the owner switches absence on', () => {
    expect(deriveDay(base({ shift: COMPANY, punches: [], countAbsence: true }))?.status).toBe(
      'absent',
    );
  });

  it('is still pending while the day is being lived, either way', () => {
    const duringTheDay = cairoInstant(DAY, '11:00');
    for (const countAbsence of [false, true]) {
      expect(
        deriveDay(base({ shift: COMPANY, punches: [], countAbsence, now: duringTheDay }))?.status,
      ).toBe('pending');
    }
  });

  it('never softens a manager who looked and said absent', () => {
    const row = deriveDay(
      base({
        shift: COMPANY,
        punches: [],
        countAbsence: false,
        decision: { type: 'markAbsent', inAt: null, outAt: null },
      }),
    );
    expect(row?.status).toBe('absent');
    expect(row?.flags).toContain('overriddenByManager');
  });
});

describe('two consecutive days may not claim the same scan', () => {
  const nextDay = new Date(DAY.getTime() + 86_400_000);

  it('leaves no gap and no overlap between a same-day pattern‘s windows', () => {
    const today = punchWindowFor(DAY, COMPANY);
    const tomorrow = punchWindowFor(nextDay, COMPANY);
    // Touching, not overlapping: the last millisecond of one is the one before the next begins.
    expect(today.to.getTime()).toBe(tomorrow.from.getTime() - 1);
  });

  it('keeps a four-in-the-morning scan out of the PREVIOUS day', () => {
    // THE DEFECT THIS CLOSES, and it only appeared when the 09:00–17:00 company default was
    // switched on: before that most employees had no expectation at all and their window was the
    // strict Cairo day. With the pattern on, 09:00−6h to 17:00+12h runs to 05:00 the next morning
    // while the next day's window opens at 03:00 — so a night guard's 04:00 scan sat in both, and
    // positional pairing would have made it yesterday's departure after a nineteen-hour day.
    const atFour = cairoInstant(nextDay, '04:00');
    expect(atFour >= punchWindowFor(DAY, COMPANY).to).toBe(true);
    expect(atFour >= punchWindowFor(nextDay, COMPANY).from).toBe(true);
  });

  it('still keeps a long overtime tail — to three in the morning', () => {
    const window = punchWindowFor(DAY, COMPANY);
    expect(cairoInstant(nextDay, '02:00') < window.to).toBe(true);
    expect(cairoInstant(DAY, '23:30') < window.to).toBe(true);
  });

  it('leaves a shift that crosses midnight overlapping, as it always has', () => {
    // Deliberate, and older than this change: the roster says which day a night worker's 17:00
    // scan belongs to, so a late exit belongs to the night that was worked rather than the next.
    const today = punchWindowFor(DAY, NIGHT);
    const tomorrow = punchWindowFor(nextDay, NIGHT);
    expect(today.to.getTime()).toBeGreaterThan(tomorrow.from.getTime());
  });
});
