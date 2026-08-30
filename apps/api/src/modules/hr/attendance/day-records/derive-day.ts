// The derivation core (v1.1 §4) — pure functions, no I/O, because the heart of the module is the
// part whose tests must be able to state "same inputs, byte-identical output" and mean it.
//
// The resolution order is the specification, first match wins:
//   not employed → no row · leave → onLeave · holiday → holiday · weekend → weekend ·
//   no shift → dayOff · no punches → absent · unpaired punch → incomplete · else compute.
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

  // 5 — nobody said they should be here.
  if (input.shift === null) return { ...empty, status: 'dayOff', flags };

  // 6 — expected, and no evidence of presence.
  if (punches.length === 0) return { ...empty, status: 'absent', flags };

  // 7 — evidence of arrival but not of leaving: never guessed into a day (D6).
  if (punches.length === 1) {
    return {
      ...empty,
      status: 'incomplete',
      firstInAt: punches[0]?.at ?? null,
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
