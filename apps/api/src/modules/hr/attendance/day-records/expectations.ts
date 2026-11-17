// WHAT WAS EXPECTED OF SOMEBODY ON A DATE — for one employee, and for a page of them at once.
//
// Two callers want the same answer and cannot share a query shape. `computeDay` wants one
// employee's expectation and is already doing a handful of reads for that employee. The daily
// sheet wants fifty employees' expectations in one go, because a sheet that resolved them one by
// one would run fifty assignment queries and fifty settings reads to draw one screen, and the
// target here is 1,300 employees per branch.
//
// So the rule lives in one place and is reached two ways. Neither way re-implements the
// precedence: `pickAssignmentForDate` is already exported pure from the assignments feature —
// bounded interval beats open, later anchor beats earlier (D2) — and both paths call it rather
// than copying "the latest bounded one wins" into a second file where it could drift.
//
// THE EXPECTATION IS RESOLVED WHEN IT IS NEEDED, NEVER STORED. A copy written onto a day row
// would be read back for exactly the date it is wrong about: HR edits the pattern at eleven and
// every row written before eleven now carries the old hours, so the sheet would decide «غائب» and
// «لم يحضر بعد» from an expectation nobody holds any more.
import { Types } from 'mongoose';
import { HrAttendanceSettingKeys } from '@ecms/contracts';
import { settingsService } from '../../../../platform/settings';
import { ShiftModel, type ShiftDoc } from '../shifts';
import { pickAssignmentForDate, ShiftAssignmentModel, type ShiftAssignmentDoc } from '../assignments';
import { shiftWindow, type EngineShift } from './derive-day';
import { patternFrom } from './default-pattern';

export interface DayExpectation {
  /**
   * The assigned shift's id, or null when the expectation came from the branch's default pattern.
   * A pattern is NOT a shift document and must never be reported as one — the payroll feed carries
   * `shiftId` onward, and a day claiming a shift nobody assigned would be a lie.
   */
  shiftId: string | null;
  shift: EngineShift;
  /** The instants that expectation lands on for the date in question. */
  start: Date;
  end: Date;
}

/** Just the fields this module needs of an employee, so callers need not pass whole documents. */
export interface ExpectationSubject {
  id: string;
  branchId: string;
}

/**
 * The branch's default working pattern (1b), or null when it is switched off or malformed.
 *
 * The subject is `{ userId: null, branchId }`, so the organization value is the company default
 * and a branch row overrides it — the same mechanism the notification settings use, which is why
 * this needed no new model and no new screen.
 *
 * THE SWITCH IS READ FIRST AND ALONE. While the pattern is off — which is how it ships, and how it
 * stays until somebody fills in the hours — this costs exactly one settings read, and that read is
 * cached per subject. Only when it is on are the other five fetched, together.
 */
export const defaultPatternForBranch = async (branchId: string): Promise<EngineShift | null> => {
  const subject = { userId: null, branchId };
  const enabled = await settingsService.resolve<boolean>(
    HrAttendanceSettingKeys.DefaultPatternEnabled,
    subject,
  );
  if (!enabled) return null;
  const [startTime, endTime, breakMinutes, graceInMinutes, graceOutMinutes] = await Promise.all([
    settingsService.resolve<string>(HrAttendanceSettingKeys.DefaultPatternStartTime, subject),
    settingsService.resolve<string>(HrAttendanceSettingKeys.DefaultPatternEndTime, subject),
    settingsService.resolve<number>(HrAttendanceSettingKeys.DefaultPatternBreakMinutes, subject),
    settingsService.resolve<number>(HrAttendanceSettingKeys.DefaultPatternGraceInMinutes, subject),
    settingsService.resolve<number>(HrAttendanceSettingKeys.DefaultPatternGraceOutMinutes, subject),
  ]);
  return patternFrom({ enabled, startTime, endTime, breakMinutes, graceInMinutes, graceOutMinutes });
};

/** The shift fields the engine derives against — a document narrowed to the expectation it states. */
const asEngineShift = (shift: ShiftDoc): EngineShift => ({
  startTime: shift.startTime,
  endTime: shift.endTime,
  crossesMidnight: shift.crossesMidnight,
  breakMinutes: shift.breakMinutes,
  graceInMinutes: shift.graceInMinutes,
  graceOutMinutes: shift.graceOutMinutes,
});

/**
 * One date's expectation for a page of employees, in a bounded number of queries however many
 * employees arrive: one for the covering assignments, one for the shifts those name, and one
 * settings read per DISTINCT BRANCH among the employees who have no assignment (cached per subject
 * thereafter).
 *
 * A REAL ASSIGNMENT ALWAYS WINS over the pattern, exactly as in `computeDay`: somebody took the
 * trouble to say what that person works, and a company-wide default must not argue with them.
 *
 * The returned map holds an entry for every employee asked about, `null` meaning "nobody has said
 * when this person is due" — a real answer, which the read-time resolution turns into `dayOff`
 * rather than into an absence.
 */
export const expectationsForDate = async (
  employees: readonly ExpectationSubject[],
  workDate: Date,
): Promise<Map<string, DayExpectation | null>> => {
  const out = new Map<string, DayExpectation | null>();
  if (employees.length === 0) return out;

  // One query for every assignment that could cover the date. The interval test is repeated in
  // Mongo only to narrow what comes back; `pickAssignmentForDate` is what decides.
  const rows = await ShiftAssignmentModel.find({
    employeeId: { $in: employees.map((e) => new Types.ObjectId(e.id)) },
    isDeleted: false,
    fromDate: { $lte: workDate },
    $or: [{ toDate: null }, { toDate: { $gte: workDate } }],
  })
    .lean<ShiftAssignmentDoc[]>()
    .exec();

  const byEmployee = new Map<string, ShiftAssignmentDoc[]>();
  for (const row of rows) {
    const key = String(row.employeeId);
    const list = byEmployee.get(key);
    if (list === undefined) byEmployee.set(key, [row]);
    else list.push(row);
  }

  const winners = new Map<string, string>();
  for (const employee of employees) {
    const picked = pickAssignmentForDate(byEmployee.get(employee.id) ?? [], workDate);
    if (picked !== null) winners.set(employee.id, String(picked.shiftId));
  }

  // One query for the shifts those assignments name.
  const shiftIds = [...new Set(winners.values())];
  const shiftDocs =
    shiftIds.length === 0
      ? []
      : await ShiftModel.find({ _id: { $in: shiftIds.map((id) => new Types.ObjectId(id)) } })
          .lean<ShiftDoc[]>()
          .exec();
  const shiftById = new Map(shiftDocs.map((doc) => [String(doc._id), doc]));

  // One settings resolution per distinct branch, and only for the employees who need it.
  const patterns = new Map<string, EngineShift | null>();
  for (const employee of employees) {
    if (winners.has(employee.id)) continue;
    if (patterns.has(employee.branchId)) continue;
    patterns.set(employee.branchId, await defaultPatternForBranch(employee.branchId));
  }

  for (const employee of employees) {
    const shiftId = winners.get(employee.id) ?? null;
    // A winning assignment whose shift document has gone missing falls through to the pattern
    // rather than to an exception: one broken catalog row must not blank out a whole branch's
    // sheet, and `computeDay` resolves the same case the same way.
    const assigned = shiftId === null ? undefined : shiftById.get(shiftId);
    const shift =
      assigned === undefined
        ? (patterns.get(employee.branchId) ?? null)
        : asEngineShift(assigned);
    if (shift === null) {
      out.set(employee.id, null);
      continue;
    }
    const { start, end } = shiftWindow(workDate, shift);
    out.set(employee.id, {
      shiftId: assigned === undefined ? null : shiftId,
      shift,
      start,
      end,
    });
  }
  return out;
};
