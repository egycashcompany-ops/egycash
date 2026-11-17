// The derivation core (v1.1 §4) — pure functions, no I/O, because the heart of the module is the
// part whose tests must be able to state "same inputs, byte-identical output" and mean it.
//
// The resolution order is the specification, first match wins:
//   not employed → no row · leave → onLeave · holiday → holiday · weekend → weekend ·
//   no shift → what the device saw (noSchedule · checkedIn · present) ·
//   no punches → pending while the day is still being lived, else absent ·
//   one punch → checkedIn · else compute.
//
// TWO THINGS THIS FILE USED TO GET WRONG ABOUT THIS COMPANY, both fixed here:
//
//   NO SHIFT USED TO MEAN NO ANSWER. A `dayOff` with no times was returned for anybody without a
//   shift assignment — which is most of the workforce — so their scans were invisible and the
//   module looked broken while the punches sat in the database. With no shift there is still
//   nothing to be late against, but there is plenty to REPORT: when they arrived, when they left,
//   how long they were here.
//
//   ONE PUNCH WAS TREATED AS A FAULT. 70–90% of employees scan on arrival and never scan out, so
//   `incomplete` — a warning on screen, priced at nothing — was the label on the ordinary working
//   day. It is `checkedIn` now: a presence with an arrival time and unknown hours. Lateness is
//   still real and still computed, because being expected at a time is what makes it real.
//
// QUANTITIES ONLY. Late minutes are raw minutes past grace (D4); overtime minutes are derived
// and worth nothing until approved (D5); nothing in this file knows what a minute costs.
import {
  type AttendanceDayFlag,
  type AttendanceDayStatus,
  type AttendancePunchDirection,
  type AttendancePunchSource,
} from '@ecms/contracts';

const CAIRO_TZ = 'Africa/Cairo';

const cairoClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAIRO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Minutes Cairo is ahead of UTC at the given instant (120 in winter, 180 under DST). */
const cairoOffsetMinutes = (instant: Date): number => {
  const parts = Object.fromEntries(
    cairoClock.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']) === 24 ? 0 : Number(parts['hour']),
    Number(parts['minute']),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
};

/**
 * The UTC instant at which a Cairo wall-clock `HH:mm` occurs on a UTC-midnight date-only value.
 * Two correction passes handle a guess that lands on the other side of a DST switch. This is a
 * wall-clock→instant conversion, not a second notion of "today" — date-only work stays on
 * `hr/shared/business-date` (§1.3).
 */
export const cairoInstant = (dateOnly: Date, time: string): Date => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const wallMinutes = h * 60 + m;
  let guess = new Date(dateOnly.getTime() + (wallMinutes - 120) * 60_000);
  for (let i = 0; i < 2; i += 1) {
    guess = new Date(dateOnly.getTime() + (wallMinutes - cairoOffsetMinutes(guess)) * 60_000);
  }
  return guess;
};

export interface EngineShift {
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
  graceInMinutes: number;
  graceOutMinutes: number;
}

export interface EnginePunch {
  at: Date;
  direction: AttendancePunchDirection;
  source: AttendancePunchSource;
  /** String id or null — compared against the employee's branch for the D8 flag. */
  branchIdAtPunch: string | null;
}

export interface DeriveDayInput {
  /** UTC-midnight date-only; the day's identity is the SHIFT START date (D3). */
  workDate: Date;
  employed: boolean;
  /** Approved leave covering the date; `halfDay` keeps the worked half (§4 step 2). */
  leave: { leaveId: string; halfDay: boolean } | null;
  holiday: boolean;
  weekend: boolean;
  shift: EngineShift | null;
  /** Punches attributed to this work date, superseded ones already excluded, any order. */
  punches: EnginePunch[];
  employeeBranchId: string;
  /**
   * The instant the derivation is being made at — INJECTED, never read from the clock, because
   * this file's contract is "same inputs, byte-identical output" and a function that reads the
   * clock has no such contract. It decides one thing only: whether an expected day with no
   * punches is still in progress (`pending`) or over (`absent`).
   */
  now: Date;
}

export interface DerivedDay {
  status: AttendanceDayStatus;
  firstInAt: Date | null;
  lastOutAt: Date | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  leaveId: string | null;
  flags: AttendanceDayFlag[];
}

/** The shift's [start, end] instants on a work date — end lands next day when it crosses midnight. */
export const shiftWindow = (workDate: Date, shift: EngineShift): { start: Date; end: Date } => {
  const start = cairoInstant(workDate, shift.startTime);
  const endDate = shift.crossesMidnight ? new Date(workDate.getTime() + 86_400_000) : workDate;
  return { start, end: cairoInstant(endDate, shift.endTime) };
};

/**
 * The punch-attribution window for a work date (D3): generous margins so an early arrival or a
 * long overtime tail still belongs to the day, tight enough that the next shift's punches do not.
 */
export const PUNCH_WINDOW_BEFORE_MS = 6 * 60 * 60 * 1000;
export const PUNCH_WINDOW_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * The window a work date's punches are drawn from. Pure, and exported, so the one property that
 * matters about it can be proven without a database (see the spec).
 *
 * WITH A SHIFT — the shift's own span widened by the margins above. Consecutive shifts' windows
 * DO overlap, deliberately: the pairing that follows is positional over the attributed punches,
 * and a long overtime tail belongs to the day that was worked rather than to the next one.
 *
 * WITH NO SHIFT — the Cairo calendar day, and not one millisecond either side. There is no shift
 * to say which day a 05:00 punch belongs to, so the only defensible answer is the calendar: a
 * margin here would put that punch inside two days' windows at once, making it yesterday's
 * last-out — a twenty-hour working day — and today's first-in simultaneously. The upper bound is
 * the last millisecond BEFORE the next Cairo midnight because the repository query is inclusive at
 * both ends, so midnight itself would belong to two days and reintroduce the overlap at exactly
 * the boundary. Night work gets a real shift or pattern, where `crossesMidnight` answers properly.
 */
export const punchWindowFor = (
  workDate: Date,
  shift: EngineShift | null,
): { from: Date; to: Date } => {
  if (shift === null) {
    const nextMidnight = cairoInstant(new Date(workDate.getTime() + 86_400_000), '00:00');
    return { from: cairoInstant(workDate, '00:00'), to: new Date(nextMidnight.getTime() - 1) };
  }
  const { start, end } = shiftWindow(workDate, shift);
  return {
    from: new Date(start.getTime() - PUNCH_WINDOW_BEFORE_MS),
    to: new Date(end.getTime() + PUNCH_WINDOW_AFTER_MS),
  };
};

const minutesBetween = (from: Date, to: Date): number =>
  Math.floor((to.getTime() - from.getTime()) / 60_000);

const empty = {
  firstInAt: null,
  lastOutAt: null,
  workedMinutes: 0,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  overtimeMinutes: 0,
  leaveId: null,
  flags: [] as AttendanceDayFlag[],
};

const flagsOf = (punches: readonly EnginePunch[], employeeBranchId: string): AttendanceDayFlag[] => {
  const flags: AttendanceDayFlag[] = [];
  if (punches.some((p) => p.branchIdAtPunch !== null && p.branchIdAtPunch !== employeeBranchId)) {
    flags.push('crossBranchPunch');
  }
  // AT-D2 (D12.3/D12.4) — two different facts, two different signals. A hand-entry is somebody
  // typing a time; an approved correction travelled request → manager → HR before it was written.
  // Until this split both raised `manualPunch`, and a reviewer could not tell them apart.
  if (punches.some((p) => p.source === 'manual')) flags.push('manualPunch');
  if (punches.some((p) => p.source === 'regularization')) flags.push('regularizedPunch');
  return flags;
};

/** Sorted copy — the engine is ORDER-INDEPENDENT over its input (§4 property). */
const byTime = (punches: readonly EnginePunch[]): EnginePunch[] =>
  [...punches].sort((a, b) => a.at.getTime() - b.at.getTime());

export const deriveDay = (input: DeriveDayInput): DerivedDay | null => {
  // 1 — not employed on that date: no row at all.
  if (!input.employed) return null;

  const punches = byTime(input.punches);
  const flags = flagsOf(punches, input.employeeBranchId);

  // 2 — leave wins over absence. A half-day keeps the worked half: presence minutes are computed
  // when they exist, but nothing is "late" against a day the employee was excused from.
  if (input.leave !== null) {
    const first = punches[0] ?? null;
    const last = punches.length >= 2 ? (punches[punches.length - 1] ?? null) : null;
    const worked =
      input.leave.halfDay && first !== null && last !== null
        ? Math.max(0, minutesBetween(first.at, last.at) - (input.shift?.breakMinutes ?? 0))
        : 0;
    return {
      ...empty,
      status: 'onLeave',
      leaveId: input.leave.leaveId,
      firstInAt: input.leave.halfDay ? (first?.at ?? null) : null,
      lastOutAt: input.leave.halfDay ? (last?.at ?? null) : null,
      workedMinutes: worked,
      flags,
    };
  }

  // 3 / 4 — the calendar speaks before absence does.
  if (input.holiday) return { ...empty, status: 'holiday', flags };
  if (input.weekend) return { ...empty, status: 'weekend', flags };

  // 5 — no shift and no default pattern: nobody said WHEN they were expected, so nothing here can
  // be late, early or overtime. What the devices saw is reported all the same, which is the whole
  // difference between this and the `dayOff` this branch used to return for everyone.
  //
  // The window these punches were drawn from is the Cairo calendar day and nothing more (see
  // `computeDay`): no tail into the next morning, because a 05:00 punch inside two days' windows
  // would be the first day's last-out AND the second day's first-in, which reads as a twenty-hour
  // shift and an arrival at dawn. Night work gets a real shift or a pattern, where
  // `crossesMidnight` answers it properly.
  if (input.shift === null) {
    // NOT `dayOff`, which is what this returned until production showed an entire branch marked
    // «يوم راحة» on a Tuesday. A rest day is a positive claim that the company owed this person no
    // work, and nobody had made it: the weekend and the holidays are already decided above, so
    // reaching here on a working day means only that NOBODY HAS SAID WHEN THIS PERSON WORKS.
    // `noSchedule` says that, which is a gap HR can close; «يوم راحة» said the opposite and hid it.
    if (punches.length === 0) return { ...empty, status: 'noSchedule', flags };
    if (punches.length === 1) {
      return { ...empty, status: 'checkedIn', firstInAt: (punches[0] as EnginePunch).at, flags };
    }
    const firstIn = (punches[0] as EnginePunch).at;
    const lastOut = (punches[punches.length - 1] as EnginePunch).at;
    return {
      ...empty,
      status: 'present',
      firstInAt: firstIn,
      lastOutAt: lastOut,
      // No break is subtracted: there is no shift to say how long a break was meant to be, and
      // inventing one would be a labour rule nobody has granted this system.
      workedMinutes: Math.max(0, minutesBetween(firstIn, lastOut)),
      flags,
    };
  }

  // 6 — expected, and no evidence of presence. WHICH OF THE TWO ANSWERS depends on the clock,
  // and only here does this file consult it.
  //
  // Somebody due at 09:00 who has not scanned is NOT ABSENT AT TEN IN THE MORNING. They are a day
  // nobody has concluded: `pending`. The distinction is not cosmetic — a row is written by whoever
  // recomputes, the branch servers recompute all day long, and the payroll feed carries `status`
  // onward, so an `absent` minted at ten o'clock is a false statement sitting in the database
  // about a person who is very likely to walk in at ten past. `pending` is payroll-neutral by
  // construction (it is in no quantity group) and the nightly pass turns it into the real answer
  // once the day is over.
  //
  // The cut is the expected END, not the start: the day stops being winnable when the shift it
  // belonged to has finished, not when it began.
  if (punches.length === 0) {
    const { end } = shiftWindow(input.workDate, input.shift);
    return { ...empty, status: input.now < end ? 'pending' : 'absent', flags };
  }

  // 7 — checked in, never checked out: the ordinary working day here, not an anomaly. The hours
  // are genuinely unknown, so `workedMinutes` stays 0 and nothing is early leave or overtime —
  // guessing a departure into a day is still refused (D6). LATENESS IS DIFFERENT: they were
  // expected at a time and the arrival is on record, so it is computed, with the same grace the
  // full day below uses.
  if (punches.length === 1) {
    const firstIn = (punches[0] as EnginePunch).at;
    const { start } = shiftWindow(input.workDate, input.shift);
    const graceInEnd = new Date(start.getTime() + input.shift.graceInMinutes * 60_000);
    return {
      ...empty,
      status: 'checkedIn',
      firstInAt: firstIn,
      lateMinutes: firstIn > graceInEnd ? minutesBetween(start, firstIn) : 0,
      flags,
    };
  }

  // 8 — compute. First-in / last-out over the attributed window; directions recorded by devices
  // are advisory (many log presence only), so the pairing is positional.
  const firstIn = (punches[0] as EnginePunch).at;
  const lastOut = (punches[punches.length - 1] as EnginePunch).at;
  const { start, end } = shiftWindow(input.workDate, input.shift);

  const workedMinutes = Math.max(
    0,
    minutesBetween(firstIn, lastOut) - input.shift.breakMinutes,
  );
  const graceInEnd = new Date(start.getTime() + input.shift.graceInMinutes * 60_000);
  const lateMinutes = firstIn > graceInEnd ? minutesBetween(start, firstIn) : 0;
  const graceOutStart = new Date(end.getTime() - input.shift.graceOutMinutes * 60_000);
  const earlyLeaveMinutes = lastOut < graceOutStart ? minutesBetween(lastOut, end) : 0;
  const overtimeMinutes = lastOut > end ? minutesBetween(end, lastOut) : 0;

  const status: AttendanceDayStatus =
    lateMinutes > 0 && earlyLeaveMinutes > 0
      ? 'lateAndEarly'
      : lateMinutes > 0
        ? 'late'
        : earlyLeaveMinutes > 0
          ? 'earlyLeave'
          : 'present';

  return {
    status,
    firstInAt: firstIn,
    lastOutAt: lastOut,
    workedMinutes,
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes,
    leaveId: null,
    flags,
  };
};
