// EVERYTHING `deriveDay` NEEDS, LOADED IN BATCHES — in the two directions the screens ask for it.
//
// `computeDay` resolves one employee-day and runs about eight queries to do it, which is right for
// one day and ruinous for a screen. The daily sheet wants one date for 1,300 people; the employee
// page wants one person across up to a year. Both now derive rather than read a stored status (see
// `resolve-display-status.ts` for why), so both need these inputs in bulk.
//
// So this file loads them ONCE per screen read, and hands back a function that assembles the exact
// `DeriveDayInput` for any (employee, date) in what it loaded. The derivation itself is the same
// pure function the stored rows come from — that is the point, and it is what stops the sheet and
// the employee page from disagreeing about the same day.
//
// NOTHING HERE WRITES. These are read paths; a screen that minted rows would mean 1,300 writes for
// a date that is not over yet, every time somebody opened it, and each of those rows would need
// correcting when the person walked in.
import { Types } from 'mongoose';
import { toDateOnly, addDays, dateOnlyIso, isoWeekday } from '../../shared/business-date';
import { type EmployeeDoc } from '../../employee-management/employees';
import { LeaveRequestModel, type LeaveRequestDoc } from '../../leave-management/leave-requests';
import { workCalendarService } from '../../work-calendar';
import { ShiftModel, type ShiftDoc } from '../shifts';
import { pickAssignmentForDate, ShiftAssignmentModel, type ShiftAssignmentDoc } from '../assignments';
import { AttendanceDecisionModel } from '../decisions/decision.model';
import { AttendancePunchModel, type AttendancePunchDoc } from '../punches/punch.model';
import {
  cairoInstant,
  punchWindowFor,
  shiftWindow,
  type DeriveDayInput,
  type EngineShift,
  type EnginePunch,
} from './derive-day';
import { defaultPatternForBranch } from './expectations';

/**
 * The leave statuses that COVER a date, so the derivation reports «إجازة» for it. Exported because
 * `computeDay` resolves the same question for one day and the two must not drift apart.
 */
export const COVERING_LEAVE_STATUSES = ['approved', 'active', 'completed'] as const;

/**
 * Employed on the date per the derived hire→exit periods; the hire date alone covers legacy records
 * that never had periods written. Shared with `computeDay` so one definition decides whether a day
 * exists at all — the one case that yields no line on any screen.
 */
export const employedOn = (employee: EmployeeDoc, workDate: Date): boolean => {
  if (employee.employmentPeriods.length > 0) {
    return employee.employmentPeriods.some(
      (p) =>
        toDateOnly(p.hiredAt).getTime() <= workDate.getTime() &&
        (p.exitedAt === null || toDateOnly(p.exitedAt).getTime() >= workDate.getTime()),
    );
  }
  return toDateOnly(employee.employment.startDate).getTime() <= workDate.getTime();
};

/** What was expected of somebody on a date: the engine's shift, and the shift document behind it. */
export interface ResolvedExpectation {
  /** Null when the expectation came from the branch's default pattern rather than an assignment. */
  shiftId: string | null;
  shift: EngineShift;
  start: Date;
  end: Date;
}

/** One resolved (employee, date): the inputs, plus the two things the callers report alongside. */
export interface AssembledDay {
  input: DeriveDayInput;
  expectation: ResolvedExpectation | null;
  punches: EnginePunch[];
}

/** The loaded batch — ask it for any (employee, date) it covers. */
export interface DayInputs {
  /** Null when the employee was not employed on that date. */
  assemble: (employee: EmployeeDoc, workDate: Date, now: Date) => AssembledDay | null;
}

const leaveKey = (employeeId: string, workDate: Date): string =>
  `${employeeId}:${dateOnlyIso(workDate)}`;

/**
 * THE WIDEST WINDOW any of these dates could attribute a punch to. A shift that crosses midnight
 * puts a scan after midnight on the previous work date, and `punchWindowFor` owns that rule — so
 * the query is widened by a day at each end and the exact per-employee window is applied in memory.
 * One query either way; the alternative is one per employee per date.
 */
const punchQueryWindow = (from: Date, to: Date): { from: Date; to: Date } => ({
  from: cairoInstant(addDays(from, -1), '00:00'),
  to: cairoInstant(addDays(to, 2), '00:00'),
});

/**
 * Load the inputs for a set of employees across a date range, inclusive.
 *
 * The query count is BOUNDED AND SMALL whatever the size of either dimension: six, plus one
 * settings read per distinct branch among the employees with no assignment (cached per subject
 * thereafter). It serves both shapes the screens need — many employees on one date, and one
 * employee across a year — because they want the same inputs and differ only in which axis is long.
 */
export const loadDayInputs = async (
  employees: readonly EmployeeDoc[],
  from: Date,
  to: Date,
): Promise<DayInputs> => {
  const ids = employees.map((e) => e._id as Types.ObjectId);
  const fromDate = toDateOnly(from);
  const toDate = toDateOnly(to);
  const pw = punchQueryWindow(fromDate, toDate);

  const [leaveRows, holidayRows, weekendDays, assignmentRows, decisionRows, punchRows] =
    await Promise.all([
      LeaveRequestModel.find({
        employeeId: { $in: ids },
        status: { $in: [...COVERING_LEAVE_STATUSES] },
        startDate: { $lte: toDate },
        endDate: { $gte: fromDate },
        isDeleted: false,
      })
        .lean<LeaveRequestDoc[]>()
        .exec(),
      workCalendarService.listHolidays(fromDate, toDate),
      workCalendarService.weekendDays(),
      ShiftAssignmentModel.find({
        employeeId: { $in: ids },
        isDeleted: false,
        fromDate: { $lte: toDate },
        $or: [{ toDate: null }, { toDate: { $gte: fromDate } }],
      })
        .lean<ShiftAssignmentDoc[]>()
        .exec(),
      AttendanceDecisionModel.find({
        employeeId: { $in: ids },
        workDate: { $gte: fromDate, $lte: toDate },
        status: 'applied',
        type: { $ne: 'revoke' },
        isDeleted: false,
      })
        .sort({ createdAt: 1 })
        .select({ employeeId: 1, workDate: 1, type: 1, inAt: 1, outAt: 1 })
        .lean<
          { employeeId: Types.ObjectId; workDate: Date; type: string; inAt: Date | null; outAt: Date | null }[]
        >()
        .exec(),
      AttendancePunchModel.find({
        employeeId: { $in: ids },
        at: { $gte: pw.from, $lt: pw.to },
        supersededBy: null,
        isDeleted: false,
      })
        .sort({ at: 1 })
        .lean<AttendancePunchDoc[]>()
        .exec(),
    ]);

  // ── the shifts those assignments name, in one more query ────────────────────
  const assignmentsByEmployee = new Map<string, ShiftAssignmentDoc[]>();
  for (const row of assignmentRows) {
    const key = String(row.employeeId);
    const list = assignmentsByEmployee.get(key);
    if (list === undefined) assignmentsByEmployee.set(key, [row]);
    else list.push(row);
  }
  const namedShiftIds = [...new Set(assignmentRows.map((r): string => String(r.shiftId)))];
  const shiftDocs =
    namedShiftIds.length === 0
      ? []
      : await ShiftModel.find({ _id: { $in: namedShiftIds.map((id) => new Types.ObjectId(id)) } })
          .lean<ShiftDoc[]>()
          .exec();
  const shiftById = new Map(shiftDocs.map((doc) => [String(doc._id), doc]));

  // One settings resolution per distinct branch, and only where it can actually be needed.
  const patterns = new Map<string, EngineShift | null>();
  for (const employee of employees) {
    const branchId = String(employee.employment.branchId);
    if (patterns.has(branchId)) continue;
    patterns.set(branchId, await defaultPatternForBranch(branchId));
  }

  // ── indexes over what was loaded ────────────────────────────────────────────
  const holidayDates = new Set(holidayRows.map((h): string => dateOnlyIso(toDateOnly(h.date))));
  const leaveByDay = new Map<string, { leaveId: string; halfDay: boolean }>();
  for (const doc of leaveRows) {
    const start = toDateOnly(doc.startDate);
    const end = toDateOnly(doc.endDate);
    for (let d = start; d.getTime() <= end.getTime(); d = addDays(d, 1)) {
      if (d.getTime() < fromDate.getTime() || d.getTime() > toDate.getTime()) continue;
      leaveByDay.set(leaveKey(String(doc.employeeId), d), {
        leaveId: String(doc._id),
        halfDay:
          (doc.halfDayStart && start.getTime() === d.getTime()) ||
          (doc.halfDayEnd && end.getTime() === d.getTime()),
      });
    }
  }
  // Latest applied decision wins, matching `liveDecisionFor`'s `createdAt: -1` — the rows arrive
  // oldest first here, so the last write into the map is the newest.
  const decisionByDay = new Map<string, { type: 'markPresent' | 'markAbsent' | 'editTimes'; inAt: Date | null; outAt: Date | null }>();
  for (const row of decisionRows) {
    if (row.type !== 'markPresent' && row.type !== 'markAbsent' && row.type !== 'editTimes') continue;
    decisionByDay.set(leaveKey(String(row.employeeId), toDateOnly(row.workDate)), {
      type: row.type,
      inAt: row.inAt ?? null,
      outAt: row.outAt ?? null,
    });
  }
  // Appended in place, NOT rebuilt per row: one employee's year holds hundreds of punches, and
  // `[...prev, row]` per row copies the whole array each time. The sheet would never have noticed
  // (two punches a person); a two-year employee period would.
  const punchesByEmployee = new Map<string, AttendancePunchDoc[]>();
  for (const punch of punchRows) {
    const key = String(punch.employeeId);
    const list = punchesByEmployee.get(key);
    if (list === undefined) punchesByEmployee.set(key, [punch]);
    else list.push(punch);
  }

  const expectationFor = (employee: EmployeeDoc, workDate: Date): ResolvedExpectation | null => {
    const picked = pickAssignmentForDate(assignmentsByEmployee.get(String(employee._id)) ?? [], workDate);
    // A winning assignment whose shift document has gone missing falls through to the pattern
    // rather than to an exception, exactly as `computeDay` and `expectationsForDate` resolve it:
    // one broken catalogue row must not blank out a branch's whole sheet.
    const assigned = picked === null ? undefined : shiftById.get(String(picked.shiftId));
    const shift: EngineShift | null =
      assigned === undefined
        ? (patterns.get(String(employee.employment.branchId)) ?? null)
        : {
            startTime: assigned.startTime,
            endTime: assigned.endTime,
            crossesMidnight: assigned.crossesMidnight,
            breakMinutes: assigned.breakMinutes,
            graceInMinutes: assigned.graceInMinutes,
            graceOutMinutes: assigned.graceOutMinutes,
          };
    if (shift === null) return null;
    const { start, end } = shiftWindow(workDate, shift);
    return { shiftId: assigned === undefined ? null : String(assigned._id), shift, start, end };
  };

  const punchesFor = (employee: EmployeeDoc, workDate: Date, expectation: ResolvedExpectation | null): EnginePunch[] => {
    const window = punchWindowFor(workDate, expectation === null ? null : expectation.shift);
    return (punchesByEmployee.get(String(employee._id)) ?? [])
      .filter((p) => p.at.getTime() >= window.from.getTime() && p.at.getTime() <= window.to.getTime())
      .map((p) => ({
        at: p.at,
        direction: p.direction,
        source: p.source,
        branchIdAtPunch: p.branchIdAtPunch === null ? null : String(p.branchIdAtPunch),
      }));
  };

  return {
    assemble: (employee, workDateInput, now) => {
      const workDate = toDateOnly(workDateInput);
      if (!employedOn(employee, workDate)) return null;
      const expectation = expectationFor(employee, workDate);
      const punches = punchesFor(employee, workDate, expectation);
      return {
        expectation,
        punches,
        input: {
          workDate,
          employed: true,
          leave: leaveByDay.get(leaveKey(String(employee._id), workDate)) ?? null,
          holiday: holidayDates.has(dateOnlyIso(workDate)),
          weekend: weekendDays.includes(isoWeekday(workDate)),
          shift: expectation === null ? null : expectation.shift,
          punches,
          employeeBranchId: String(employee.employment.branchId),
          decision: decisionByDay.get(leaveKey(String(employee._id), workDate)) ?? null,
          now,
        },
      };
    },
  };
};
