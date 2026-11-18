// The engine's orchestrator (v1.1 §4): gathers one employee-day's inputs, calls the pure core,
// and upserts exactly one row — idempotently, through the unique {employeeId, workDate} key.
//
// The freeze guard lives HERE and nowhere lower: a row with `frozenAt` set is never rewritten,
// no matter what arrives — a late punch import, a leave event, a manual recompute. Nothing in
// AT-1..3 sets `frozenAt`; the trigger is the Payroll Run's (AT-4, D-PR-07 Option A). The guard
// ships with the engine because an engine without it is safe only by coincidence.
import { Types } from 'mongoose';
import {
  HrAttendanceEvents,
  HrAttendanceSettingKeys,
  type AttendanceDayDto,
  type AttendanceFeedRow,
  type AttendanceSheetRowDto,
  type ListAttendanceDaysQuery,
  type ListAttendanceSheetQuery,
  type AttendanceArrivalSlotDto,
  type AttendanceEmployeeSummaryDto,
  type AttendanceEmployeeSummaryQuery,
  type AttendanceSheetSummaryDto,
  type AttendanceSheetSummaryQuery,
  type AttendanceEmployeeDayDto,
  type AttendanceDayStatus,
  ATTENDANCE_DAY_STATUSES,
  type Paginated,
  type RecomputeAttendanceDays,
} from '@ecms/contracts';
import { BusinessRuleError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { settingsService } from '../../../../platform/settings';
import { logger } from '../../../../infrastructure/logging/logger';
import {
  addDays,
  cairoToday,
  dateOnlyIso,
  isoWeekday,
  toDateOnly,
} from '../../shared/business-date';
import {
  employeeRepository,
  resolvePlacements,
  type EmployeeDoc,
} from '../../employee-management/employees';
import { LeaveRequestModel, type LeaveRequestDoc } from '../../leave-management/leave-requests';
import { workCalendarService } from '../../work-calendar';
import { shiftRepository, type ShiftDoc } from '../shifts';
import { shiftAssignmentService } from '../assignments';
// The direct file, NOT the `../punches` barrel: the barrel re-exports `punch.service`, which now
// calls back into this service to derive the days an import touched. Importing the repository
// straight keeps that dependency one-way.
import { punchRepository } from '../punches/punch.repository';
import {
  cairoInstant,
  deriveDay,
  punchWindowFor,
  type EnginePunch,
  type EngineShift,
} from './derive-day';
import {
  defaultPatternForBranch,
  expectationsForDate,
  type DayExpectation,
} from './expectations';
import { periodFigures } from './period-figures';
import { resolveDayStatus } from './resolve-display-status';
import { loadDayInputs, employedOn, COVERING_LEAVE_STATUSES } from './day-inputs';
import { unlinkedScansOn } from '../quarantine/attendance-quarantine.store';
import { liveDecisionFor } from '../decisions/live-decision';
import { AttendanceDayModel, type AttendanceDayDoc } from './day-record.model';
import { dayRecordRepository } from './day-record.repository';
import { monthRange, toFeedRow } from './attendance-feed';

const ORG_SUBJECT = { userId: null, branchId: null };

/**
 * The most employees one sheet read will resolve. A guard against a filter nobody meant — every
 * branch at once — rather than an expected limit: the target is about 1,300 per branch, and a
 * sheet is always one date.
 */
const SHEET_CAP = 10_000;

/** One page of days: the period is capped at 92, and `MAX_PAGE_SIZE` is 100. */
const PERIOD_PAGE_SIZE = 100;

/** What one resolved branch-day carries beyond its rows: who it covered, and the roster it holds them to. */
interface ResolvedSheetDay {
  rows: AttendanceSheetRowDto[];
  employeeIds: Types.ObjectId[];
  /** Cairo minutes after midnight, or null when nobody on the sheet has a roster at all. */
  dayStart: number | null;
  graceMinutes: number;
}

/** `HH:mm` → minutes after midnight. The shift stores Cairo wall-clock, which is what a reader reads. */
const minutesOfClock = (hhmm: string): number => {
  const [hours, minutes] = hhmm.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
};

/**
 * THE ROSTER THE SHEET IS HELD TO — the most common one, not an assumed nine o'clock.
 *
 * A sheet can span branches and shifts, and the arrival chart draws exactly one «بداية الدوام»
 * line. Averaging two shifts would mark an hour neither of them starts at, so the line goes on the
 * hour the most people on this sheet are actually due, and ties go to the earlier one for
 * steadiness. With nobody rostered at all it is `null` and the screen draws no line: a mark at
 * nine on a sheet where nobody has been given hours is a claim about lateness nobody has made.
 */
const rosterOf = (
  expectations: Map<string, DayExpectation | null>,
): { dayStart: number | null; graceMinutes: number } => {
  const tally = new Map<string, { start: number; grace: number; n: number }>();
  for (const expectation of expectations.values()) {
    // Nobody rostered contributes nothing — it must not pull the line towards a default.
    if (expectation === null) continue;
    const key = `${expectation.shift.startTime}|${String(expectation.shift.graceInMinutes)}`;
    const seen = tally.get(key);
    if (seen === undefined) {
      tally.set(key, {
        start: minutesOfClock(expectation.shift.startTime),
        grace: expectation.shift.graceInMinutes,
        n: 1,
      });
    } else seen.n += 1;
  }
  let best: { start: number; grace: number; n: number } | null = null;
  for (const entry of tally.values()) {
    if (best === null || entry.n > best.n || (entry.n === best.n && entry.start < best.start)) {
      best = entry;
    }
  }
  return best === null
    ? { dayStart: null, graceMinutes: 0 }
    : { dayStart: best.start, graceMinutes: best.grace };
};

/** The Cairo minute-of-day an instant falls on — the business clock, never the server's zone. */
const cairoMinutesOf = (at: Date): number => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: 'hour' | 'minute'): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return part('hour') * 60 + part('minute');
};

/** Every row's FIRST check-in, counted into its quarter hour. Empty quarters are left out. */
const arrivalSlots = (rows: AttendanceSheetRowDto[]): AttendanceArrivalSlotDto[] => {
  const counts = new Map<number, number>();
  for (const row of rows) {
    const firstIn = row.day?.firstInAt ?? null;
    if (firstIn === null) continue;
    const slot = Math.floor(cairoMinutesOf(new Date(firstIn)) / 15) * 15;
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([slot, count]) => ({ slot, count }))
    .sort((a, b) => a.slot - b.slot);
};

/** Leave that covers a day for the engine: decided-and-running, or already lived. */
// `COVERING_LEAVE_STATUSES` and `employedOn` now live in `day-inputs.ts`, so the batch read paths
// and this single-day one resolve both questions by one definition each.

export const toAttendanceDayDto = (doc: AttendanceDayDoc): AttendanceDayDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  workDate: dateOnlyIso(doc.workDate),
  status: doc.status,
  shiftId: doc.shiftId === null ? null : String(doc.shiftId),
  firstInAt: doc.firstInAt === null ? null : doc.firstInAt.toISOString(),
  lastOutAt: doc.lastOutAt === null ? null : doc.lastOutAt.toISOString(),
  workedMinutes: doc.workedMinutes,
  lateMinutes: doc.lateMinutes,
  earlyLeaveMinutes: doc.earlyLeaveMinutes,
  overtimeMinutes: doc.overtimeMinutes,
  approvedOvertimeMinutes: doc.approvedOvertimeMinutes,
  leaveId: doc.leaveId === null ? null : String(doc.leaveId),
  flags: doc.flags,
  branchId: String(doc.branchId),
  computedAt: doc.computedAt.toISOString(),
  frozenAt: doc.frozenAt === null ? null : doc.frozenAt.toISOString(),
  version: doc.__v,
});

/** The shape `BaseRepository.list` returns, for the reads that resolve to nothing without a query. */
const emptyPage = (query: { page: number; pageSize: number }): Paginated<AttendanceDayDoc> => ({
  items: [],
  meta: { page: query.page, pageSize: query.pageSize, totalItems: 0, totalPages: 0 },
});

class DayRecordService {
  /**
   * Scoped list (AT-6): `own` resolves the caller's linked employee (rows are system-written, so
   * BaseRepository's creator-based own-match can never see them — C1-R); the org scopes ride the
   * repository's `branchId` filter. A section filter resolves the sections' employees first,
   * because day rows deliberately carry only the branch axis (D8).
   */
  async list(
    query: ListAttendanceDaysQuery,
    scope?: ScopeSelector,
  ): Promise<Paginated<AttendanceDayDoc>> {
    let employeeIds: string[] | undefined;
    if (query.sectionId !== undefined && query.sectionId.length > 0) {
      employeeIds = await employeeRepository.listIdsBySectionSystem(query.sectionId);
    }
    if (scope !== undefined && scope.scope === 'own') {
      const own = await employeeRepository.findByUserIdSystem(scope.userId);
      if (own === null) throw new NotFoundError('no employee is linked to this login');
      const ownId = String(own._id);
      // A narrower question than the grant allows is answered with NOTHING, never by silently
      // substituting the caller's own rows: "show me employee X" must not come back as "here is
      // you", which reads as an answer about X and would be believed as one.
      const asksForSomebodyElse = query.employeeId !== undefined && query.employeeId !== ownId;
      const sectionExcludesMe = employeeIds !== undefined && !employeeIds.includes(ownId);
      if (asksForSomebodyElse || sectionExcludesMe) return emptyPage(query);
      return dayRecordRepository.listDays({ ...query, employeeId: ownId });
    }
    return dayRecordRepository.listDays(query, { employeeIds, scope });
  }

  /** ESS: the caller's own month — own by construction (resolved from the login link). */
  async listMine(
    userId: string,
    query: Omit<ListAttendanceDaysQuery, 'employeeId' | 'branchId'>,
  ): Promise<Paginated<AttendanceDayDoc>> {
    const employee = await employeeRepository.findByUserIdSystem(userId);
    if (employee === null) throw new NotFoundError('no employee is linked to this login');
    return dayRecordRepository.listDays({ ...query, employeeId: String(employee._id) });
  }

  /**
   * ONE EMPLOYEE'S PERIOD, ADDED UP — the figures above their attendance page (and above their own
   * copy of it).
   *
   * It reads through `list()`/`listMine()` rather than querying the rows itself, so the scope rules
   * are the ones already proven: a branch-scoped reader asking about somebody outside their branch
   * gets nothing, and the own-scope path cannot be pointed at anybody but the caller.
   *
   * THE ROSTER IS READ FOR THE PERIOD'S LAST DAY. A shift can change mid-period; the punctuality
   * band on the chart is the hour they are held to NOW, which is the one a reader is deciding
   * about today.
   */
  async employeeSummary(
    query: AttendanceEmployeeSummaryQuery,
    scope?: ScopeSelector,
  ): Promise<AttendanceEmployeeSummaryDto> {
    if (query.employeeId === undefined) {
      throw new BusinessRuleError('an employee is required for this summary');
    }
    const page = await this.list(
      {
        employeeId: query.employeeId,
        from: query.from,
        to: query.to,
        page: 1,
        pageSize: PERIOD_PAGE_SIZE,
        sortDir: 'asc',
        branchId: [],
        sectionId: [],
      },
      scope,
    );
    return this.figuresFor(query, query.employeeId, page.items);
  }

  /** The caller's own, own-scope by construction: the employee comes from the login, not the query. */
  async employeeSummaryMine(
    userId: string,
    query: Omit<AttendanceEmployeeSummaryQuery, 'employeeId'>,
  ): Promise<AttendanceEmployeeSummaryDto> {
    const employee = await employeeRepository.findByUserIdSystem(userId);
    if (employee === null) throw new NotFoundError('no employee is linked to this login');
    const page = await this.listMine(userId, {
      from: query.from,
      to: query.to,
      page: 1,
      pageSize: PERIOD_PAGE_SIZE,
      sortDir: 'asc',
      sectionId: [],
    });
    return this.figuresFor(query, String(employee._id), page.items);
  }

  /**
   * EVERY CALENDAR DATE OF ONE EMPLOYEE'S PERIOD, RESOLVED — the employee page's single source, and
   * the sheet's twin.
   *
   * WHY THIS EXISTS. The employee page was served from `GET /hr/attendance/days`, which filters day
   * DOCUMENTS. A date with no row was simply not in the answer, so the month SKIPPED it: punches
   * had been imported for the 12th and the 15th of November and the page showed neither of them,
   * while dates whose legacy row still said `dayOff` read «يوم راحة» on top of real scans. The
   * daily sheet meanwhile resolved its own answer for the same dates. Two screens, two sources, one
   * employee — and they disagreed, which is the complaint this whole change answers.
   *
   * So there is exactly ONE ROW PER DATE here, resolved by the same pure functions the sheet uses
   * and the stored rows come from: the stored row when it is settled, else the day derived from
   * that date's punches, else the calendar, else «لا يوجد جدول» or «لا يوجد تسجيل».
   *
   * THE QUERY COUNT DOES NOT GROW WITH THE SPAN. `loadDayInputs` batches every input once for the
   * whole period, so a year costs the same handful of queries a month does — which is what lets the
   * period picker reach back to the first scan of 2024 without a screen that crawls.
   */
  async employeePeriod(
    employeeId: string,
    from: Date,
    to: Date,
  ): Promise<AttendanceEmployeeDayDto[]> {
    const employee = await employeeRepository.findById(employeeId);
    if (employee === null) throw new NotFoundError('no such employee');
    const start = toDateOnly(from);
    const end = toDateOnly(to);

    const [storedRows, inputs] = await Promise.all([
      AttendanceDayModel.find({
        employeeId: employee._id,
        workDate: { $gte: start, $lte: end },
        isDeleted: false,
      })
        .lean<AttendanceDayDoc[]>()
        .exec(),
      loadDayInputs([employee], start, end),
    ]);
    const storedByDate = new Map(storedRows.map((row) => [dateOnlyIso(toDateOnly(row.workDate)), row]));

    // ONE reading of the clock for the whole period, so two dates cannot be resolved against
    // different "now"s — the same discipline the sheet keeps.
    const now = new Date();
    const out: AttendanceEmployeeDayDto[] = [];
    for (let d = start; d.getTime() <= end.getTime(); d = addDays(d, 1)) {
      const assembled = inputs.assemble(employee, d, now);
      // Not employed on this date: no line, exactly as the sheet omits one.
      if (assembled === null) continue;
      const stored = storedByDate.get(dateOnlyIso(d)) ?? null;
      const derived = deriveDay(assembled.input);
      const status = resolveDayStatus({
        stored: stored === null ? null : stored.status,
        derived: derived === null ? null : derived.status,
      });
      if (status === null) continue;
      // The times come from the stored row when there is one and from the derivation otherwise, so
      // a date whose punches arrived but whose recompute has not run still shows its real hours.
      const times = stored ?? derived;
      out.push({
        date: dateOnlyIso(d),
        status,
        firstInAt:
          times === null || times.firstInAt === null ? null : times.firstInAt.toISOString(),
        lastOutAt: times === null || times.lastOutAt === null ? null : times.lastOutAt.toISOString(),
        workedMinutes: times === null ? 0 : times.workedMinutes,
        lateMinutes: times === null ? 0 : times.lateMinutes,
        earlyLeaveMinutes: times === null ? 0 : times.earlyLeaveMinutes,
        expectedStartAt:
          assembled.expectation === null ? null : assembled.expectation.start.toISOString(),
        expectedEndAt:
          assembled.expectation === null ? null : assembled.expectation.end.toISOString(),
        provisional: stored === null,
        frozen: stored !== null && stored.frozenAt !== null,
        punches: assembled.punches.map((punch) => ({
          at: punch.at.toISOString(),
          direction: punch.direction,
          source: punch.source,
        })),
      });
    }
    return out;
  }

  /**
   * One employee's resolved period, WITH THE CALLER'S SCOPE APPLIED.
   *
   * The scope question is answered by the one authority that decides it — the employee list with
   * the selector attached — rather than by spelling the branch/department hierarchy again here. A
   * reader who cannot see this person gets nothing, which is also what they get for a person who
   * does not exist: a narrower question is never answered with somebody else's days.
   */
  async employeePeriodScoped(
    employeeId: string,
    from: Date,
    to: Date,
    scope?: ScopeSelector,
  ): Promise<AttendanceEmployeeDayDto[]> {
    if (scope !== undefined && scope.scope === 'own') {
      const own = await employeeRepository.findByUserIdSystem(scope.userId);
      if (own === null) throw new NotFoundError('no employee is linked to this login');
      // "Show me employee X" must not come back as "here is you" — it would read as an answer
      // about X. The same stance `list()` takes.
      if (String(own._id) !== employeeId) return [];
      return this.employeePeriod(employeeId, from, to);
    }
    const visible = await employeeRepository.listEmployees({
      filter: { ids: [employeeId] },
      page: 1,
      pageSize: 1,
      sortBy: 'code',
      sortDir: 'asc',
      ...(scope === undefined ? {} : { scope }),
    });
    if (visible.items.length === 0) return [];
    return this.employeePeriod(employeeId, from, to);
  }

  /** The caller's own resolved period — own by construction, the employee comes from the login. */
  async employeePeriodMine(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<AttendanceEmployeeDayDto[]> {
    const employee = await employeeRepository.findByUserIdSystem(userId);
    if (employee === null) throw new NotFoundError('no employee is linked to this login');
    return this.employeePeriod(String(employee._id), from, to);
  }

  /**
   * The shared half: the arithmetic, the roster for the last day, and the newest scan.
   *
   * IT ADDS UP THE RESOLVED PERIOD, not the stored rows it was handed. The figures above the page
   * have to be the figures of the days drawn beneath it — «حضر 12 يومًا» over a table showing
   * fourteen presences is the same disagreement in miniature — so the days are resolved once here
   * and both the figures and the list are read off that one answer.
   */
  private async figuresFor(
    query: { from: Date; to: Date },
    employeeId: string,
    _rows: AttendanceDayDoc[],
  ): Promise<AttendanceEmployeeSummaryDto> {
    const employee = await employeeRepository.findById(employeeId);
    const to = toDateOnly(query.to);
    const from = toDateOnly(query.from);
    const days = await this.employeePeriod(employeeId, from, to);
    const figures = periodFigures(
      days.map((day) => ({
        status: day.status,
        firstInAt: day.firstInAt === null ? null : new Date(day.firstInAt),
        lastOutAt: day.lastOutAt === null ? null : new Date(day.lastOutAt),
        workedMinutes: day.workedMinutes,
        lateMinutes: day.lateMinutes,
      })),
    );

    const [expectations, lastPunchAt, firstPunchAt] = await Promise.all([
      employee === null
        ? Promise.resolve(new Map<string, DayExpectation | null>())
        : expectationsForDate(
            [{ id: employeeId, branchId: String(employee.employment.branchId) }],
            to,
          ),
      punchRepository.lastPunchIn(
        [new Types.ObjectId(employeeId)],
        cairoInstant(from, '00:00'),
        cairoInstant(addDays(to, 1), '00:00'),
      ),
      // THE FLOOR THE PERIOD PICKER STOPS AT, and deliberately not bounded by the period being
      // asked about: «previous month» has to know whether there is an earlier month to go to.
      punchRepository.firstPunchEver(new Types.ObjectId(employeeId)),
    ]);
    const roster = rosterOf(expectations);

    return {
      from: dateOnlyIso(from),
      to: dateOnlyIso(to),
      // Who the figures are about. Carried here because the resolved period is one person's days
      // and carries no directory label — a reader holding `attendance.view` and not `employee.view`
      // would otherwise be looking at a nameless page.
      employeeName: employee === null ? null : employee.personal.fullNameAr,
      employeeCode: employee === null ? null : employee.code,
      ...figures,
      noRecordDays: days.filter((day) => day.status === 'noRecord').length,
      noScheduleDays: days.filter((day) => day.status === 'noSchedule').length,
      dayStart: roster.dayStart,
      graceMinutes: roster.graceMinutes,
      lastPunchAt: lastPunchAt === null ? null : lastPunchAt.toISOString(),
      firstPunchAt: firstPunchAt === null ? null : firstPunchAt.toISOString(),
    };
  }

  /**
   * THE DAILY SHEET (stage 2) — and it starts from EMPLOYEES, not from day rows.
   *
   * WHY IT IS NOT JUST `list()` WITH `from = to`. `listDays` filters day DOCUMENTS, so an employee
   * the engine has written no row for is absent from the ANSWER rather than shown as absent from
   * WORK. On this deployment that is not an edge case: the branch servers call `days/recompute`
   * only for the employees who scanned, so the people a supervisor opens this screen to find — the
   * ones who have not turned up — are precisely the ones with no row to find. The sheet was
   * therefore reporting a near-perfect attendance rate every morning by construction.
   *
   * So the page is a page of employees, left-joined to whatever day rows exist, and the status on
   * each line is RESOLVED (`resolveDisplayStatus`) rather than read off a row: «لم يحضر بعد»
   * before the hour they were due, «غائب» after it. NOTHING IS WRITTEN. Minting rows to make
   * people visible would mean 1,300 writes per branch for a date that is not over yet, every time
   * somebody opened a screen — and each of those rows would then have to be corrected when the
   * person walked in.
   *
   * ONE DATE, and the expectations for the whole page are resolved together
   * (`expectationsForDate`): one assignment query, one shift query, and one settings read per
   * distinct branch, instead of three per employee.
   *
   * KNOWN AND DELIBERATE: the page is the CURRENTLY employed, so a sheet for a date in the past
   * does not list somebody who has since left the company. The sheet is a live operational screen;
   * the day list and the CSV export remain the record for people who are no longer employed, and
   * they are unchanged.
   */
  /**
   * EVERY line of one branch-day, resolved — the single pass both the page and the counts are
   * built from.
   *
   * IT RESOLVES THE WHOLE DAY RATHER THAN A PAGE, and that is forced by what the sheet shows. The
   * display status is not a stored field: it is worked out from the clock, the calendar and the
   * hour each person was due. So a count of absences, and a filter on "show me the absences",
   * cannot be a database query — they can only be read off the resolved set. Paging first would
   * give a card that says "3 absent" when it means "3 absent on this page".
   *
   * The cost is bounded by what a sheet IS: one date, one branch, the people in it. The queries
   * are three regardless of headcount — employees, their day rows, their expectations — and the
   * target is about 1,300 employees per branch. `SHEET_CAP` is a guard against a filter nobody
   * meant (every branch at once), not an expected limit.
   */
  private async resolveSheetDay(
    query: {
      date: Date;
      branchId?: readonly string[] | undefined;
      sectionId?: readonly string[] | undefined;
      search?: string | undefined;
    },
    scope?: ScopeSelector,
  ): Promise<ResolvedSheetDay> {
    const workDate = toDateOnly(query.date);
    const branchFilter = query.branchId === undefined ? [] : [...query.branchId];
    const sectionFilter = query.sectionId === undefined ? [] : [...query.sectionId];

    let employees: EmployeeDoc[];
    if (scope !== undefined && scope.scope === 'own') {
      // Mirrors `list()`: own scope answers for the caller and never widens, and a filter that
      // excludes them is answered with nothing rather than with themselves anyway.
      const own = await employeeRepository.findByUserIdSystem(scope.userId);
      if (own === null) throw new NotFoundError('no employee is linked to this login');
      const excluded =
        (branchFilter.length > 0 && !branchFilter.includes(String(own.employment.branchId))) ||
        (sectionFilter.length > 0 &&
          !sectionFilter.includes(String(own.employment.sectionId ?? '')));
      employees = excluded ? [] : [own];
    } else {
      // UNPAGED, and that is a fix rather than a flourish. This asked `listEmployees` for
      // `pageSize: SHEET_CAP` to mean "all of them", and `BaseRepository.list` clamps pageSize to
      // `MAX_PAGE_SIZE` — 100. So the sheet resolved the first HUNDRED employees by code on every
      // date, and every count beneath it counted those hundred: a company of 1,755 reading «100»,
      // with four of the thirty-nine who had scanned visible because they sorted early.
      employees = await employeeRepository.listAllForSheet(
        {
          employed: true,
          ...(branchFilter.length === 0 ? {} : { branchId: branchFilter }),
          ...(sectionFilter.length === 0 ? {} : { sectionId: sectionFilter }),
          // Name or code, matched by the directory's own rule — Arabic normalized, so a search
          // typed without diacritics still finds the person.
          ...(query.search === undefined ? {} : { search: query.search }),
        },
        SHEET_CAP,
        scope,
      );
    }
    if (employees.length === 0) {
      return { rows: [], employeeIds: [], dayStart: null, graceMinutes: 0 };
    }

    // THE WHOLE DAY'S INPUTS IN ONE BATCH — the punches included, which is the change that makes
    // this sheet complete. It used to load day ROWS and resolve a label beside them, so a person
    // who scanned on a date no recompute had reached contributed nothing to the screen: thirty-nine
    // fingers on the glass, five lines in the table. Now every line is DERIVED by the same pure
    // function the stored rows come from, so a scan shows up the moment it is imported and the
    // sheet says exactly what a recompute would store.
    const [dayRows, inputs, placements] = await Promise.all([
      AttendanceDayModel.find({
        employeeId: { $in: employees.map((employee) => employee._id) },
        workDate,
        isDeleted: false,
      })
        .lean<AttendanceDayDoc[]>()
        .exec(),
      loadDayInputs(employees, workDate, workDate),
      // One read per catalogue for the whole sheet, never one per row — and resolved here because
      // naming a department on the client would need the catalogue and the key that guards it.
      resolvePlacements(employees),
    ]);
    const dayByEmployee = new Map(dayRows.map((row) => [String(row.employeeId), row]));

    // ONE reading of the clock for the whole day, so two lines of the same sheet cannot land on
    // opposite sides of an expected end — and so the cards cannot disagree with the rows beneath.
    const now = new Date();

    const expectations = new Map<string, DayExpectation | null>();
    const rows: AttendanceSheetRowDto[] = [];
    for (const employee of employees) {
      const employeeId = String(employee._id);
      // null means NOT EMPLOYED ON THIS DATE, and it is now the only reason a line is left out.
      // Previously a missing row was treated the same way, which is how a sheet for a past date
      // came to list four or five people out of a hundred.
      const assembled = inputs.assemble(employee, workDate, now);
      if (assembled === null) continue;
      const { expectation } = assembled;
      expectations.set(employeeId, expectation);

      const day = dayByEmployee.get(employeeId) ?? null;
      const derived = deriveDay(assembled.input);
      const status = resolveDayStatus({
        stored: day === null ? null : day.status,
        derived: derived === null ? null : derived.status,
      });
      if (status === null) continue;
      rows.push({
        employeeId,
        employeeCode: employee.code,
        employeeName: employee.personal.fullNameAr,
        employeePhotoFileId:
          employee.personal.photoFileId === null || employee.personal.photoFileId === undefined
            ? null
            : String(employee.personal.photoFileId),
        employeeDepartment: placements.for(employee).department?.name ?? null,
        branchId: String(employee.employment.branchId),
        date: dateOnlyIso(workDate),
        status,
        expectedStartAt: expectation === null ? null : expectation.start.toISOString(),
        expectedEndAt: expectation === null ? null : expectation.end.toISOString(),
        day: day === null ? null : toAttendanceDayDto(day),
        // The times of a day nothing has concluded, so a scan is visible before any recompute —
        // and deliberately a SEPARATE field from `day`, so nobody mistakes a reading for a record.
        provisionalDay:
          day !== null || derived === null
            ? null
            : {
                firstInAt: derived.firstInAt === null ? null : derived.firstInAt.toISOString(),
                lastOutAt: derived.lastOutAt === null ? null : derived.lastOutAt.toISOString(),
                workedMinutes: derived.workedMinutes,
                lateMinutes: derived.lateMinutes,
                earlyLeaveMinutes: derived.earlyLeaveMinutes,
              },
      });
    }
    return { rows, employeeIds: employees.map((employee) => employee._id), ...rosterOf(expectations) };
  }

  /**
   * THE DAILY SHEET (stage 2, redesigned in stage 6) — and it starts from EMPLOYEES, not day rows.
   *
   * WHY IT IS NOT JUST `list()` WITH `from = to`. `listDays` filters day DOCUMENTS, so an employee
   * the engine has written no row for is absent from the ANSWER rather than shown as absent from
   * WORK. On this deployment that is not an edge case: the branch servers call `days/recompute`
   * only for the employees who scanned, so the people a supervisor opens this screen to find — the
   * ones who have not turned up — are precisely the ones with no row to find.
   *
   * NOTHING IS WRITTEN. Minting rows to make people visible would mean 1,300 writes per branch for
   * a date that is not over yet, every time somebody opened a screen — and each of those rows
   * would then have to be corrected when the person walked in.
   *
   * KNOWN AND DELIBERATE: the page is the CURRENTLY employed, so a sheet for a date in the past
   * does not list somebody who has since left. The sheet is a live operational screen; the day
   * list and the CSV export remain the record for people who are no longer employed.
   */
  async sheet(
    query: ListAttendanceSheetQuery,
    scope?: ScopeSelector,
  ): Promise<Paginated<AttendanceSheetRowDto>> {
    const { rows: resolved } = await this.resolveSheetDay(query, scope);
    // The quick filter, applied AFTER resolution because that is the only place the status exists.
    const wanted = query.status === undefined ? [] : query.status;
    const filtered =
      wanted.length === 0 ? resolved : resolved.filter((row) => wanted.includes(row.status));

    const from = (query.page - 1) * query.pageSize;
    return {
      items: filtered.slice(from, from + query.pageSize),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: filtered.length,
        totalPages: Math.ceil(filtered.length / query.pageSize),
      },
    };
  }

  /**
   * The sheet's counts — over the WHOLE day, which is the only way a card reading "18 absent" can
   * be true while the table below it shows fifty rows of thirteen hundred.
   *
   * Every status is counted separately and nothing is grouped here. The screen decides that
   * `late` belongs beside `present` or apart from it; a count the server had already blended
   * could not be unblended by a reader who wanted the other grouping.
   */
  async sheetSummary(
    query: AttendanceSheetSummaryQuery,
    scope?: ScopeSelector,
  ): Promise<AttendanceSheetSummaryDto> {
    const workDate = toDateOnly(query.date);
    const day = await this.resolveSheetDay(query, scope);
    const byStatus = Object.fromEntries(
      ATTENDANCE_DAY_STATUSES.map((status) => [status, 0]),
    ) as Record<AttendanceDayStatus, number>;
    for (const row of day.rows) byStatus[row.status] += 1;

    // THE LAST SCAN COMES FROM THE PUNCHES, not from the derived rows. A punch is a fact the
    // moment it is imported; the row it belongs to is rewritten a second later by the recompute.
    // Reading the rows would make the device look silent for exactly the seconds that matter.
    const [lastPunchAt, unlinked] = await Promise.all([
      day.employeeIds.length === 0
        ? Promise.resolve(null)
        : punchRepository.lastPunchIn(
            day.employeeIds,
            cairoInstant(workDate, '00:00'),
            cairoInstant(addDays(workDate, 1), '00:00'),
          ),
      // THE SCANS THIS SHEET CANNOT SHOW. Deliberately NOT narrowed by the branch or section
      // filters: a machine id linked to nobody belongs to no branch, so narrowing it would hide it
      // on exactly the filtered screens HR works from.
      unlinkedScansOn(
        cairoInstant(workDate, '00:00'),
        cairoInstant(addDays(workDate, 1), '00:00'),
      ),
    ]);

    return {
      date: dateOnlyIso(workDate),
      total: day.rows.length,
      byStatus,
      arrivals: arrivalSlots(day.rows),
      dayStart: day.dayStart,
      graceMinutes: day.graceMinutes,
      lastPunchAt: lastPunchAt === null ? null : lastPunchAt.toISOString(),
      unlinkedScans: {
        identities: unlinked.length,
        rows: unlinked.reduce((sum, group) => sum + group.rows, 0),
        // Capped for the screen; `identities` stays the true count, so a page saying "50 of 153"
        // is reading one number rather than estimating the other.
        ids: unlinked.slice(0, 50),
      },
    };
  }

  /**
   * Compute (or recompute) one employee-day. Returns the row, `'frozen'` when the §4 guard
   * refused, or null when the employee was not employed that day (no row — and a stale row from
   * an employment correction is removed so the answer stays exactly one or exactly none).
   */
  async computeDay(
    employeeId: string,
    workDateInput: Date,
  ): Promise<AttendanceDayDoc | 'frozen' | null> {
    const workDate = toDateOnly(workDateInput);
    const employee = await employeeRepository.findById(employeeId);
    if (employee === null) return null;

    const existing = await AttendanceDayModel.findOne({
      employeeId: employee._id,
      workDate,
      isDeleted: false,
    })
      .lean<AttendanceDayDoc>()
      .exec();
    if (existing !== null && existing.frozenAt !== null) return 'frozen';

    if (!employedOn(employee, workDate)) {
      if (existing !== null) {
        await AttendanceDayModel.deleteOne({ _id: existing._id }).exec();
      }
      return null;
    }

    // Inputs, in the order the resolution consumes them.
    const leaveDoc = await LeaveRequestModel.findOne({
      employeeId: employee._id,
      status: { $in: [...COVERING_LEAVE_STATUSES] },
      startDate: { $lte: workDate },
      endDate: { $gte: workDate },
      isDeleted: false,
    })
      .lean<LeaveRequestDoc>()
      .exec();
    const leave =
      leaveDoc === null
        ? null
        : {
            leaveId: String(leaveDoc._id),
            halfDay:
              (leaveDoc.halfDayStart && toDateOnly(leaveDoc.startDate).getTime() === workDate.getTime()) ||
              (leaveDoc.halfDayEnd && toDateOnly(leaveDoc.endDate).getTime() === workDate.getTime()),
          };

    const [holidays, weekendDays, decision] = await Promise.all([
      workCalendarService.listHolidays(workDate, workDate),
      workCalendarService.weekendDays(),
      // THE MANAGER'S JUDGEMENT IS AN INPUT, re-read on every derivation (stage 3). The branch
      // servers recompute constantly, so anything written onto the row would be gone by the next
      // call — this is what makes a decision survive a re-send instead of being erased by it.
      liveDecisionFor(String(employee._id), workDate),
    ]);

    const shiftId = await shiftAssignmentService.resolveShiftIdForDate(
      String(employee._id),
      workDate,
    );
    const shift: ShiftDoc | null = shiftId === null ? null : await shiftRepository.findById(shiftId);

    // WHAT THIS EMPLOYEE WAS EXPECTED TO WORK — a real assignment, else the branch's default
    // working pattern (1b), else nothing.
    //
    // A REAL ASSIGNMENT ALWAYS WINS, and the pattern is only read when there is none: somebody
    // took the trouble to say what this person works, and a company-wide default must not argue
    // with them.
    //
    // `shift` and `expectation` stay SEPARATE VARIABLES on purpose. The derivation wants the
    // expectation, whatever its source; the stored row wants `shiftId`, which must be null when no
    // shift document was involved — a day that says it belongs to a shift that was never assigned
    // would be a lie that the payroll feed then carries.
    const expectation: EngineShift | null =
      shift ?? (await defaultPatternForBranch(String(employee.employment.branchId)));

    // THE PUNCHES ARE LOADED WHETHER OR NOT THERE IS AN EXPECTATION. This used to sit inside
    // `if (shift !== null)`, so an employee with no shift assignment had an empty punch list by
    // construction and their scans could not be reported although they were in the database.
    // `punchWindowFor` owns which window, and why the two differ.
    const punchWindow = punchWindowFor(workDate, expectation);
    const punchRows = await punchRepository.listForWindow(
      employee._id as Types.ObjectId,
      punchWindow.from,
      punchWindow.to,
    );
    const punches: EnginePunch[] = punchRows.map((p) => ({
      at: p.at,
      direction: p.direction,
      source: p.source,
      branchIdAtPunch: p.branchIdAtPunch === null ? null : String(p.branchIdAtPunch),
    }));

    // ONE READING OF THE CLOCK for the whole computation, passed in rather than taken inside the
    // engine: it decides `pending` versus `absent` for an expected day with no punches, and it
    // stamps `computedAt` — two answers that must agree about when "now" was.
    const now = new Date();

    const derived = deriveDay({
      workDate,
      employed: true,
      leave,
      holiday: holidays.length > 0,
      weekend: weekendDays.includes(isoWeekday(workDate)),
      shift: expectation,
      punches,
      employeeBranchId: String(employee.employment.branchId),
      decision,
      now,
    });
    if (derived === null) return null;

    const updated = await AttendanceDayModel.findOneAndUpdate(
      // The freeze guard rides INSIDE the atomic upsert: a row frozen between the read above and
      // this write is matched out, so the engine cannot overtake a concurrent freeze.
      { employeeId: employee._id, workDate, frozenAt: null },
      {
        $set: {
          status: derived.status,
          shiftId: shift === null ? null : shift._id,
          firstInAt: derived.firstInAt,
          lastOutAt: derived.lastOutAt,
          workedMinutes: derived.workedMinutes,
          lateMinutes: derived.lateMinutes,
          earlyLeaveMinutes: derived.earlyLeaveMinutes,
          overtimeMinutes: derived.overtimeMinutes,
          leaveId: derived.leaveId === null ? null : new Types.ObjectId(derived.leaveId),
          flags: derived.flags,
          branchId: employee.employment.branchId,
          computedAt: now,
          isDeleted: false,
        },
        $setOnInsert: {
          frozenAt: null,
          approvedOvertimeMinutes: 0,
          createdBy: null,
          updatedBy: null,
        },
      },
      { new: true, upsert: true },
    )
      .lean<AttendanceDayDoc>()
      .exec();

    // D5 on recompute (AT-5). The released quantity follows the derivation from both sides:
    // when approval is required, a re-derivation that LOWERED the overtime clamps a previously
    // approved value down (the ceiling is absolute); when the setting says approval is not
    // required, the derived minutes release themselves. Same freeze condition as everything else.
    const requiresApproval = await settingsService.resolve<boolean>(
      HrAttendanceSettingKeys.OvertimeRequiresApproval,
      ORG_SUBJECT,
    );
    const releasable = requiresApproval
      ? Math.min(updated.approvedOvertimeMinutes, updated.overtimeMinutes)
      : updated.overtimeMinutes;
    if (releasable !== updated.approvedOvertimeMinutes) {
      await AttendanceDayModel.updateOne(
        { _id: updated._id, frozenAt: null },
        { $set: { approvedOvertimeMinutes: releasable } },
      ).exec();
      updated.approvedOvertimeMinutes = releasable;
    }

    await emit(HrAttendanceEvents.DayComputed, {
      employeeId: String(employee._id),
      workDate: dateOnlyIso(workDate),
      status: updated.status,
      branchId: String(updated.branchId),
    });
    if (updated.status === 'absent') {
      await emit(HrAttendanceEvents.DayAbsent, {
        employeeId: String(employee._id),
        workDate: dateOnlyIso(workDate),
        status: updated.status,
        branchId: String(updated.branchId),
      });
    }
    return updated;
  }

  /** Recompute a window for one employee or everyone. Frozen days are counted, never touched. */
  async recompute(
    ctx: AuthContext,
    input: RecomputeAttendanceDays,
  ): Promise<{ computed: number; skippedFrozen: number }> {
    const from = toDateOnly(input.from);
    const to = toDateOnly(input.to);
    const employeeIds =
      input.employeeId !== undefined
        ? [input.employeeId]
        : await this.allComputableEmployeeIds();

    let computed = 0;
    let skippedFrozen = 0;
    for (const employeeId of employeeIds) {
      for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) {
        const outcome = await this.computeDay(employeeId, d);
        if (outcome === 'frozen') skippedFrozen += 1;
        else if (outcome !== null) computed += 1;
      }
    }
    await auditService.record({
      entityRef: { moduleId: 'hr', entityType: 'attendanceDays', entityId: dateOnlyIso(from) },
      action: 'attendanceRecompute',
      changes: [
        { field: 'from', old: null, new: dateOnlyIso(from) },
        { field: 'to', old: null, new: dateOnlyIso(to) },
        { field: 'employeeId', old: null, new: input.employeeId ?? 'all' },
        { field: 'computed', old: null, new: String(computed) },
        { field: 'skippedFrozen', old: null, new: String(skippedFrozen) },
      ],
    });
    return { computed, skippedFrozen };
  }

  /** The nightly compute (§9): the previous Cairo day, at the configured hour, idempotent. */
  async computePreviousDayIfDue(): Promise<void> {
    const hour = await settingsService.resolve<number>(
      HrAttendanceSettingKeys.AutoComputeHour,
      ORG_SUBJECT,
    );
    const cairoHour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo',
        hour: 'numeric',
        hour12: false,
      }).format(new Date()),
    );
    if (cairoHour !== hour) return;

    const workDate = addDays(cairoToday(), -1);
    const employeeIds = await this.allComputableEmployeeIds();
    let computed = 0;
    for (const employeeId of employeeIds) {
      try {
        const outcome = await this.computeDay(employeeId, workDate);
        if (outcome !== null && outcome !== 'frozen') computed += 1;
      } catch (error) {
        // One employee's bad data must not starve the rest of the sweep.
        logger.error({ err: error, employeeId }, 'attendance: nightly compute failed for employee');
      }
    }
    logger.info({ workDate: dateOnlyIso(workDate), computed }, 'attendance: nightly compute done');
  }

  /** Event subscriber (leave started/ended, employee exited): recompute the affected span. */
  async recomputeSpanForEmployee(employeeId: string, from: Date, to: Date): Promise<void> {
    const start = toDateOnly(from);
    const end = toDateOnly(to);
    // Bounded defensively: an event carrying a year-long span must not stall the bus.
    const cap = 366;
    let steps = 0;
    for (let d = start; d.getTime() <= end.getTime() && steps < cap; d = addDays(d, 1), steps += 1) {
      try {
        await this.computeDay(employeeId, d);
      } catch (error) {
        logger.error({ err: error, employeeId }, 'attendance: event-driven recompute failed');
        return;
      }
    }
  }

  /** Everyone the engine may owe a row: the not-yet-exited, plus anyone exited (their past days). */
  private async allComputableEmployeeIds(): Promise<string[]> {
    const rows = await employeeRepository.listIdsForAttendance();
    return rows;
  }

  // ── AT-4 — the freeze + the Payroll feed seam (D-PR-07 Option A) ──────────

  /**
   * Freeze one Cairo calendar month. INTERNAL SEAM ONLY: no route mounts this and no permission
   * names it — the caller is the Payroll Run's freeze step (PY-6), which reaches it through
   * `payroll/runs/attendance-freeze.port.ts` and nowhere else. (An earlier note here named a run
   * status `calculating`; a run's states are `draft`, `frozen` and `cancelled`.) There is no
   * unfreeze, here or anywhere.
   *
   * Order of operations, each deliberate:
   *
   *   1. **Refuse a period still being lived.** Freezing a month before its last day has passed
   *      would mint frozen `absent` rows for days that have not happened.
   *   2. **Derive first.** Every employee-day in the period is recomputed so a punch imported
   *      after the nightly sweep is captured NOW, while the truth may still move — this is the
   *      last derivation those rows will ever get. Already-frozen rows refuse inside `computeDay`
   *      and cost one read each, which is what makes re-freezing cheap.
   *   3. **Stamp once, filtered on `frozenAt: null`.** The filter is the idempotency: a second
   *      freeze matches zero rows, publishes nothing and audits nothing.
   */
  async freezePeriod(
    period: string,
  ): Promise<{ period: string; computed: number; frozen: number; alreadyFrozen: boolean }> {
    const { from, to } = monthRange(period);
    if (to.getTime() >= cairoToday().getTime()) {
      throw new BusinessRuleError('a period may only be frozen after its last day has passed');
    }

    let computed = 0;
    for (const employeeId of await this.allComputableEmployeeIds()) {
      for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) {
        const outcome = await this.computeDay(employeeId, d);
        if (outcome !== null && outcome !== 'frozen') computed += 1;
      }
    }

    const now = new Date();
    const res = await AttendanceDayModel.updateMany(
      { workDate: { $gte: from, $lte: to }, frozenAt: null, isDeleted: false },
      { $set: { frozenAt: now } },
    ).exec();
    const frozen = res.modifiedCount;

    if (frozen > 0) {
      await auditService.record({
        entityRef: { moduleId: 'hr', entityType: 'attendancePeriod', entityId: period },
        action: 'attendanceFreeze',
        changes: [
          { field: 'period', old: null, new: period },
          { field: 'frozenRows', old: null, new: String(frozen) },
          { field: 'computed', old: null, new: String(computed) },
        ],
      });
      await emit(HrAttendanceEvents.PeriodFrozen, {
        period,
        from: dateOnlyIso(from),
        to: dateOnlyIso(to),
        frozenRows: frozen,
      });
    }
    return { period, computed, frozen, alreadyFrozen: frozen === 0 };
  }

  /**
   * The §15.1 feed — the ONLY way attendance leaves this module. Complete-or-nothing: a period
   * with even one unfrozen row is refused, because a partial feed would let Payroll price a
   * month whose truth was still moving. Rows carry exactly the twelve contract fields.
   */
  async readFrozenFeed(period: string, employeeId?: string): Promise<AttendanceFeedRow[]> {
    const { from, to } = monthRange(period);
    const unfrozen = await AttendanceDayModel.countDocuments({
      workDate: { $gte: from, $lte: to },
      frozenAt: null,
      isDeleted: false,
    }).exec();
    if (unfrozen > 0) {
      throw new BusinessRuleError(
        `period ${period} is not frozen (${String(unfrozen)} rows still fluid) — freeze it first`,
      );
    }
    const rows = await AttendanceDayModel.find({
      workDate: { $gte: from, $lte: to },
      isDeleted: false,
      ...(employeeId === undefined ? {} : { employeeId: new Types.ObjectId(employeeId) }),
    })
      .sort({ employeeId: 1, workDate: 1 })
      .lean<AttendanceDayDoc[]>()
      .exec();
    return rows.map(toFeedRow);
  }
}

export const dayRecordService = new DayRecordService();
