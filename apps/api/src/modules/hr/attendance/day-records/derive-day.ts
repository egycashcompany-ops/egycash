// The derivation core (v1.1 §4) — pure functions, no I/O, because the heart of the module is the
// part whose tests must be able to state "same inputs, byte-identical output" and mean it.
//
// The resolution order is the specification, first match wins:
//   not employed → no row · leave → onLeave · holiday → holiday · weekend → weekend ·
//   manager decision → absent ·
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
  /** The machine serial, carried only so the scan log can name the device. Not used in arithmetic. */
  deviceId?: string | null;
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
   * A manager's live decision about this day (stage 3), or null.
   *
   * IT IS AN INPUT, NOT AN EDIT, and that is what makes it survive: a branch server calls
   * `days/recompute` every few seconds all morning, so a judgement written onto the derived row
   * would be erased by the next one. Passed in here, it is re-applied on every derivation.
   *
   * THE DEVICE'S PUNCHES ARE NEVER TOUCHED BY IT. A decision does not supersede, edit or delete
   * evidence — it stands beside it, and the day it produces carries `overriddenByManager` so a
   * reviewer can see that the status was judged rather than read. That also makes revoking exact:
   * the decision stops being live, the day is recomputed, and what the devices saw is still
   * exactly what they saw.
   */
  decision: {
    type: 'markPresent' | 'markAbsent' | 'editTimes';
    /** What the manager vouches for; `markAbsent` carries neither. */
    inAt: Date | null;
    outAt: Date | null;
  } | null;
  /**
   * HOW CLOSE TWO SCANS HAVE TO BE TO COUNT AS ONE, in minutes.
   *
   * THE DEFECT THIS ANSWERS, in the owner's own figures: five people read «حاضر» with ZERO worked
   * minutes on 18 November, and a sixth with five. Nobody works a zero-minute day. What the device
   * recorded was a RE-TAP — a finger that read poorly, presented again seconds later — and the
   * pairing below is positional (`punches[0]` in, last out) because the K40 Pro logs presence
   * without a direction. So the second tap became a departure.
   *
   * On a shift-less day that produced «حاضر, 0 minutes». On a ROSTERED day it is worse: a re-tap at
   * 08:00 would pair as a departure eight hours before the shift ends, and the engine would hand
   * payroll eight hours of «انصراف مبكر» for somebody who worked the whole day.
   *
   * Zero switches it off and the engine pairs every punch as it did before.
   */
  minPunchGapMinutes: number;
  /**
   * WHETHER A WORKING DAY WITH NO SCAN IS AN ACCUSATION — the owner's ruling of 18 November,
   * «lateness only for now», made an input rather than assumed.
   *
   * False, and an expected day whose hour has passed with nothing on it reads `noRecord`: «لا يوجد
   * تسجيل», a statement about the evidence. True, and the same day reads `absent`, which is a
   * statement about the person and a quantity payroll prices.
   *
   * The difference matters most on the two years of history being re-derived: the machines were
   * holding the punches, so a day with none may mean somebody did not come — or may mean the
   * reader was down, or that the scans are still in quarantine. Until the hours per department are
   * in and the backfill has run clean, the honest word is the one about the evidence.
   *
   * A MANAGER'S `markAbsent` IS NOT AFFECTED. Somebody looked and said so; that is evidence of a
   * different kind and it still writes `absent`.
   */
  countAbsence: boolean;
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
  /** Required − worked, when positive — the owner's «النقص». */
  shortfallMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  /** The minutes the date was supposed to hold; null when nobody has said when they work. */
  requiredMinutes: number | null;
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
  const from = new Date(start.getTime() - PUNCH_WINDOW_BEFORE_MS);
  const to = new Date(end.getTime() + PUNCH_WINDOW_AFTER_MS);
  if (shift.crossesMidnight) return { from, to };
  // A SAME-DAY PATTERN MAY NOT REACH INTO THE NEXT DAY'S OWN MARGIN.
  //
  // This became load-bearing the moment the 09:00–17:00 company default was switched on, because
  // until then most employees had NO expectation and their window was the strict Cairo day. With
  // the pattern on, day D's window runs to 05:00 on D+1 and day D+1's begins at 03:00 — so a scan
  // at four in the morning fell inside BOTH. Positional pairing would then make it D's last-out,
  // reporting a nineteen-hour day, and D+1's first-in at the same time. Night security scanning at
  // 04:00 is exactly who that would have happened to.
  //
  // The tail is kept as long as it can honestly be: for 09:00–17:00 it still runs to 03:00 the
  // next morning, which is ten hours past the end and far beyond any real departure. What it can
  // no longer do is claim a punch the next day has a better claim to.
  //
  // A shift that genuinely CROSSES MIDNIGHT is left alone. Consecutive night shifts' windows do
  // overlap, deliberately and from the start: the roster says which day a 17:00 scan belongs to,
  // and a night worker's late exit belongs to the night that was worked.
  const nextWindowStart = new Date(
    shiftWindow(new Date(workDate.getTime() + 86_400_000), shift).start.getTime() -
      PUNCH_WINDOW_BEFORE_MS,
  );
  return { from, to: to < nextWindowStart ? to : new Date(nextWindowStart.getTime() - 1) };
};

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/**
 * WHICH DAY A DIRECTIONAL SCAN BELONGS TO, when the days' windows overlap — which they do for a
 * night shift and above all for a 24-hour one (security), where day D's window reaches far into
 * D+1. A check-IN belongs to the day whose expected START it is within half a day of; a check-OUT
 * to the day whose expected END it is within half a day of. So a guard's 08:05 check-out on the
 * 18th closes the 17th's shift, and their 07:47 check-in on the 19th opens the 19th — neither is
 * read as the 18th. Scans with no direction are left to the window, exactly as before.
 */
export const attributePunches = <P extends EnginePunch>(
  workDate: Date,
  shift: EngineShift | null,
  punches: readonly P[],
): P[] => {
  if (shift === null) return [...punches];
  const { start, end } = shiftWindow(workDate, shift);
  return punches.filter((p) => {
    if (p.direction === 'in') return Math.abs(p.at.getTime() - start.getTime()) <= HALF_DAY_MS;
    if (p.direction === 'out') return Math.abs(p.at.getTime() - end.getTime()) <= HALF_DAY_MS;
    return true;
  });
};

const minutesBetween = (from: Date, to: Date): number =>
  Math.floor((to.getTime() - from.getTime()) / 60_000);

/**
 * THE MINUTES A DAY IS SUPPOSED TO HOLD: the shift's span less its unpaid break.
 *
 * Taken from the window rather than from `startTime`/`endTime` as strings, so a pattern that
 * crosses midnight and one that does not are the same arithmetic, and a DST switch inside the day
 * is counted as the clock actually ran rather than as the wall times suggest.
 */
const requiredMinutesOf = (start: Date, end: Date, breakMinutes: number): number =>
  Math.max(0, minutesBetween(start, end) - breakMinutes);

const empty = {
  firstInAt: null,
  lastOutAt: null,
  workedMinutes: 0,
  lateMinutes: 0,
  shortfallMinutes: 0,
  earlyLeaveMinutes: 0,
  overtimeMinutes: 0,
  requiredMinutes: null as number | null,
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

/**
 * ONE EVENT PER VISIT TO THE READER: a punch within `minutes` of the one before it is the same
 * presentation of the same finger, not a second event.
 *
 * It runs on the SORTED list and keeps the FIRST of each cluster, so the recorded instant is the
 * one the person actually arrived at rather than the moment their third attempt succeeded.
 *
 * It is applied before anything branches on how many punches there are, which is what makes it fix
 * both shapes at once: the shift-less day that read «حاضر, 0 minutes» and the rostered day that
 * would have reported hours of early leave. A day left with ONE event after this is a check-in and
 * says so — which is the honest reading of a single visit to the glass.
 *
 * What it must NOT do is collapse a real day. Two scans nine hours apart are not a cluster: the
 * comparison is against the previous KEPT punch, so a long day keeps both ends however many
 * re-taps surround them, and `minutes` is far below any worked day and far above any re-tap.
 */
const collapseRetaps = (punches: readonly EnginePunch[], minutes: number): EnginePunch[] => {
  if (minutes <= 0 || punches.length < 2) return [...punches];
  const gap = minutes * 60_000;
  const kept: EnginePunch[] = [punches[0] as EnginePunch];
  for (const punch of punches.slice(1)) {
    const previous = kept[kept.length - 1] as EnginePunch;
    if (punch.at.getTime() - previous.at.getTime() >= gap) kept.push(punch);
  }
  return kept;
};

/**
 * WHICH TWO SCANS ARE THE DAY — the owner's rule of 19 November: ARRIVAL = the FIRST check-in,
 * DEPARTURE = the FIRST check-out after it. People press Check-out (or Check-in) more than once;
 * the extra presses are repeats and never move the times.
 *
 *   · No punch carries a direction (presence-only readers) → positional: first scan, last scan.
 *   · Arrival = the first `in`; with no `in` at all, the first scan.
 *   · Departure = the first `out` AFTER the arrival. A lunch break-out reaches ECMS as `unknown`
 *     (the branch maps ZK codes 2/3 to it), so it is never mistaken for leaving.
 *   · No `out` after the arrival → the rule as it was: the last scan if it is later than the
 *     arrival, else none (one visit → `checkedIn`).
 *
 * Input must be sorted. Returns the SAME object references it was given, so a caller can tell
 * which of its punches were counted.
 */
export const countedPunches = (
  sorted: readonly EnginePunch[],
): { arrival: EnginePunch | null; departure: EnginePunch | null } => {
  if (sorted.length === 0) return { arrival: null, departure: null };
  const directional = sorted.some((p) => p.direction !== 'unknown');
  const arrival =
    (directional ? sorted.find((p) => p.direction === 'in') : undefined) ??
    (sorted[0] as EnginePunch);
  let departure: EnginePunch | null = directional
    ? (sorted.find((p) => p.direction === 'out' && p.at.getTime() > arrival.at.getTime()) ?? null)
    : null;
  if (departure === null) {
    const last = sorted[sorted.length - 1] as EnginePunch;
    departure = last !== arrival && last.at.getTime() > arrival.at.getTime() ? last : null;
  }
  return { arrival, departure };
};

/** Per scan: counted as the arrival, the departure, or a repeat — the scan log's tags. */
export const scanRoles = (
  punches: readonly EnginePunch[],
  minPunchGapMinutes: number,
): Map<EnginePunch, 'arrival' | 'departure' | 'repeat'> => {
  const observed = byTime(punches);
  const { arrival, departure } = countedPunches(collapseRetaps(observed, minPunchGapMinutes));
  return new Map(
    observed.map((p) => [p, p === arrival ? 'arrival' : p === departure ? 'departure' : 'repeat']),
  );
};

/** How many times Check-in / Check-out was pressed: directional scans plus the counted pair. */
export const punchTally = (
  punches: readonly EnginePunch[],
  minPunchGapMinutes: number,
): { checkIns: number; checkOuts: number; repeats: number } => {
  const roles = scanRoles(punches, minPunchGapMinutes);
  let checkIns = 0;
  let checkOuts = 0;
  let repeats = 0;
  for (const [p, role] of roles) {
    if (role === 'repeat') repeats += 1;
    if (p.direction === 'in' || (p.direction === 'unknown' && role === 'arrival')) checkIns += 1;
    if (p.direction === 'out' || (p.direction === 'unknown' && role === 'departure')) checkOuts += 1;
  }
  return { checkIns, checkOuts, repeats };
};

export const deriveDay = (input: DeriveDayInput): DerivedDay | null => {
  // 1 — not employed on that date: no row at all.
  if (!input.employed) return null;

  // What the DEVICES saw. Kept under its own name because a decision may replace what the day is
  // derived FROM without changing what was observed — the flags below still describe the evidence.
  const observed = byTime(attributePunches(input.workDate, input.shift, input.punches));
  // THE FLAGS DESCRIBE EVERYTHING THE DEVICES SAW, so they are taken before the re-tap collapse:
  // a manual punch or a punch recorded at another branch must still be flagged even when it is the
  // second tap of a cluster and so plays no part in the pairing below.
  const flags = flagsOf(observed, input.employeeBranchId);
  // ONE EVENT PER VISIT TO THE READER. Everything downstream pairs positionally, so this is the
  // only place the difference between «two taps» and «an arrival and a departure» can be drawn.
  const evidence = collapseRetaps(observed, input.minPunchGapMinutes);
  // EXTRA PRESSES. Everything the devices saw beyond the counted arrival and departure is a repeat;
  // the flag lets HR filter for it, and the screens show it only in the employee's scan log.
  const evidencePair = countedPunches(evidence);
  const countedCount = (evidencePair.arrival ? 1 : 0) + (evidencePair.departure ? 1 : 0);
  if (observed.length > countedCount) flags.push('repeatedPunches');

  // 2 — leave wins over absence. A half-day keeps the worked half: presence minutes are computed
  // when they exist, but nothing is "late" against a day the employee was excused from.
  if (input.leave !== null) {
    const first = evidencePair.arrival;
    const last = evidencePair.departure;
    // Flat, like every other worked figure here: last out − first in. Rule 1 of 18 November is a
    // company-wide definition of worked time, so a half day does not get a second one.
    const worked =
      input.leave.halfDay && first !== null && last !== null
        ? Math.max(0, minutesBetween(first.at, last.at))
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

  // 4b — A MANAGER DECIDED THIS DAY. It comes after the calendar and before the schedule, so a
  // decision cannot talk over a weekend or a public holiday — nobody was expected on those, and
  // marking somebody absent from a day they were never due is not a judgement anyone should be
  // able to record.
  //
  // The punches are NOT deleted and NOT superseded: the device saw what it saw, and that evidence
  // is the whole reason a reviewer can later tell whether the manager was right. The flag is what
  // marks the status as a judgement rather than a reading.
  //
  // `markAbsent` answers here and stops. `markPresent` and `editTimes` instead REPLACE the day's
  // punches with the times the manager vouched for, and then every rule below runs over those
  // exactly as it would over the device's own — so a vouched-for arrival is late against the same
  // grace, and a vouched-for span earns overtime by the same arithmetic. Nothing about lateness or
  // overtime is special-cased for a decision, which is the point: the manager supplies the
  // evidence, not the verdict.
  const decided = input.decision;
  if (decided !== null) {
    flags.push('overriddenByManager');
    if (decided.type === 'markAbsent') return { ...empty, status: 'absent', flags };
  }
  const punches: EnginePunch[] =
    decided === null || decided.type === 'markAbsent'
      ? evidence
      : [decided.inAt, decided.outAt]
          .filter((at): at is Date => at !== null)
          .map((at) => ({
            at,
            direction: 'unknown' as const,
            source: 'manual' as const,
            branchIdAtPunch: input.employeeBranchId,
          }));

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
    const pair = countedPunches(punches);
    if (pair.departure === null) {
      return { ...empty, status: 'checkedIn', firstInAt: (pair.arrival as EnginePunch).at, flags };
    }
    const firstIn = (pair.arrival as EnginePunch).at;
    const lastOut = pair.departure.at;
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
    const { start, end } = shiftWindow(input.workDate, input.shift);
    const required = requiredMinutesOf(start, end, input.shift.breakMinutes);
    // AND WHICH WORD FOR A DAY THAT IS OVER is the owner's ruling, carried in `countAbsence`:
    // `absent` accuses, `noRecord` reports that ECMS has nothing. See that field.
    const concluded: AttendanceDayStatus = input.countAbsence ? 'absent' : 'noRecord';
    return {
      ...empty,
      status: input.now < end ? 'pending' : concluded,
      requiredMinutes: required,
      flags,
    };
  }

  // 7 — checked in, never checked out: the ordinary working day here, not an anomaly. «حضر فقط»,
  // and EVERY FIGURE ON IT IS ZERO — which the reader turns into a blank cell, never «0:00».
  //
  // LATENESS USED TO BE COMPUTED HERE and no longer is, and that is a consequence of the owner's
  // flexible-hours rule rather than a simplification. Under that rule an arrival after nine is
  // only late IF THE EIGHT HOURS WERE NOT COMPLETED — somebody in at 09:40 and out at 17:40 owes
  // nothing. With no check-out, whether the hours were completed is exactly what is unknown, so
  // declaring the arrival late would be a verdict reached by ignoring the test the rule asks for.
  // The day keeps its arrival time, which is the fact, and makes no claim about it.
  const pair = countedPunches(punches);
  if (pair.departure === null) {
    const { start, end } = shiftWindow(input.workDate, input.shift);
    return {
      ...empty,
      status: 'checkedIn',
      firstInAt: (pair.arrival as EnginePunch).at,
      requiredMinutes: requiredMinutesOf(start, end, input.shift.breakMinutes),
      flags,
    };
  }

  // 8 — COMPUTE, under the owner's flexible-hours rule of 18 November. The whole rule, in order:
  //
  //   worked    = last out − first in, flat. No break is subtracted and nothing is clamped to the
  //               shift's own hours: the question is how long the person was here.
  //   required  = the shift's span less its break — 480 minutes for the 09:00–17:00 default.
  //   COMPLETED THE HOURS?  Then the day is «حاضر» and it is not late, not short and not early,
  //               WHATEVER TIME THEY ARRIVED. In at 09:40, out at 17:40, eight hours: nothing owed,
  //               nothing to answer for. This is the clause that makes the rule flexible, and it is
  //               deliberately indifferent to the clock at both ends of the day.
  //   SHORT?      Then two different numbers are reported, because they answer two different
  //               questions and the owner asked for both:
  //                 late      = first in − the expected start (past grace) — how late they were;
  //                 shortfall = required − worked — how much time is actually missing.
  //               They are usually different. In at 09:40, out at 17:00: late 0:40 and short 0:40,
  //               the same by coincidence. In at 09:00, out at 16:00: late 0:00 and short 1:00.
  //   early leave = the end less the last out, and ONLY on a short day. Leaving at 15:00 after
  //               starting at 07:00 is a completed day, so it is not early by this rule — which is
  //               the same clause as above, read from the other end.
  //   overtime  = worked − required, when positive. NOT «after 17:00»: the person who worked
  //               07:00–17:00 did ten hours and two of them are over, whatever hour they fell in.
  //               Derived only — payroll pays it after a manager approves it (D5), as before.
  //
  // The pairing is `countedPunches`: first check-in, first check-out after it (positional only
  // when no scan carries a direction). workedMinutes runs between exactly those two.
  const firstIn = (pair.arrival as EnginePunch).at;
  const lastOut = pair.departure.at;
  const { start, end } = shiftWindow(input.workDate, input.shift);
  const requiredMinutes = requiredMinutesOf(start, end, input.shift.breakMinutes);

  // Flat presence. A check-out after midnight is simply a later instant than the check-in, so a
  // night shift's span is correct here with no special case — the day's identity was already
  // settled upstream by the attribution window (D3), not by which calendar date the exit fell in.
  const workedMinutes = Math.max(0, minutesBetween(firstIn, lastOut));
  const completed = workedMinutes >= requiredMinutes;
  const shortfallMinutes = completed ? 0 : requiredMinutes - workedMinutes;

  const graceInEnd = new Date(start.getTime() + input.shift.graceInMinutes * 60_000);
  const graceOutStart = new Date(end.getTime() - input.shift.graceOutMinutes * 60_000);
  // `minutesBetween` floors, which is what makes «09:00 or earlier is on time» exact to the
  // owner's wording: an arrival at 09:00:40 is past the start instant but rounds to zero late
  // minutes, and the status below turns only on the MINUTES, not on the instant.
  const lateMinutes = !completed && firstIn > graceInEnd ? minutesBetween(start, firstIn) : 0;
  const earlyLeaveMinutes =
    !completed && lastOut < graceOutStart ? minutesBetween(lastOut, end) : 0;
  const overtimeMinutes = Math.max(0, workedMinutes - requiredMinutes);

  const status: AttendanceDayStatus =
    lateMinutes > 0 && earlyLeaveMinutes > 0
      ? 'lateAndEarly'
      : lateMinutes > 0
        ? 'late'
        : earlyLeaveMinutes > 0
          ? 'earlyLeave'
          // «حاضر» — either the hours were completed, or what is missing is inside a grace somebody
          // granted on purpose. The shortfall is still reported; the day is simply not an offence.
          : 'present';

  return {
    status,
    firstInAt: firstIn,
    lastOutAt: lastOut,
    workedMinutes,
    lateMinutes,
    shortfallMinutes,
    earlyLeaveMinutes,
    overtimeMinutes,
    requiredMinutes,
    leaveId: null,
    flags,
  };
};
