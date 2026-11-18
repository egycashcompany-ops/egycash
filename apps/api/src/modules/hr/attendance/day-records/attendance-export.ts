// THE ATTENDANCE CSV — and it is the SHEET, not a query over day documents.
//
// What it used to be: `AttendanceDayModel.find(filter).sort({ workDate, employeeId }).cursor()`,
// emitting the §15.1 feed columns. That shape had three defects and they were all the same defect
// wearing different clothes — IT ASKED THE DATABASE A QUESTION THE SCREEN DOES NOT ASK.
//
//   · A person with no stored row had no line in the file, while the screen showed them. The
//     branch servers recompute only the employees who scanned, so the people a supervisor exports
//     a day to look at — the ones who did not turn up — were precisely the ones missing.
//   · The statuses were the STORED ones, so a legacy `dayOff` row read «يوم راحة» in the file
//     while the screen beside it, which resolves the day, read «حاضر» over the same scans.
//   · The order was by employee code, so the file could not be the thing the reader was looking at
//     however they had sorted, filtered or searched it.
//
// So it resolves the days through `dayRecordService`, by the same call the screens make, and then
// formats them with `attendance-report.ts`. One resolution, one vocabulary, one order.
//
// IT IS STILL STREAMED, and still PER DATE. A day of the sheet resolves every employed person on
// it, so a 92-day export must never hold 92 days of rows at once: the loop resolves one date,
// writes it, and lets it go. Memory is one branch-day whatever the range, which is what makes the
// range cap a policy rather than a safety limit.
//
// Audited after the stream completes, like every export here (the F1 shape): a download the client
// abandoned is audited too, with the rows that reached it.
import { type Response } from 'express';
import {
  figuresOf,
  type AttendanceSheetSort,
  type ExportAttendanceQuery,
  type LocalizedString,
} from '@ecms/contracts';
import { auditService } from '../../../../platform/audit';
import { NotFoundError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { drainingWriter } from '../../../../shared/utils/draining-writer';
import { isHeadRequest } from '../../../../shared/utils/stream-rows';
import { addDays, dateOnlyIso, toDateOnly } from '../../shared/business-date';
import { employeeRepository, resolvePlacements } from '../../employee-management/employees';
import { dayRecordService } from './day-record.service';
import {
  csvRow,
  reportCells,
  reportHeaders,
  type ReportLocale,
  type ReportRow,
} from './attendance-report';
import { sortSheetRows } from './sheet-order';


/**
 * U+FEFF, as a character at the head of the file.
 *
 * Excel on Windows opens a UTF-8 CSV as the system code page unless it finds this, and Arabic
 * read as Windows-1252 is the mojibake every Egyptian office has seen. It is written as a string
 * rather than as bytes because the response stream is already encoding UTF-8; the three bytes
 * EF BB BF are what reaches the client.
 */
const UTF8_BOM = '﻿';

/** The reader's language, from the auth context — the same one the screen rendered in. */
const localeOf = (ctx: AuthContext): ReportLocale => (ctx.locale === 'ar' ? 'ar' : 'en');

/** Every date from `from` to `to` inclusive, as date-only values. */
const datesBetween = (from: Date, to: Date): Date[] => {
  const out: Date[] = [];
  for (let d = toDateOnly(from); d.getTime() <= toDateOnly(to).getTime(); d = addDays(d, 1)) {
    out.push(d);
  }
  return out;
};

/**
 * ONE DATE OF THE SHEET, resolved, filtered, searched and ordered exactly as the screen does it.
 *
 * The status filter is applied here rather than in a query for the reason the whole file exists:
 * the status is resolved when somebody looks, so it is not a column anything can be filtered on
 * until after the resolution. `sheet()` does the identical three steps in the identical order, and
 * that duplication is deliberate — the alternative is an exported private helper whose two callers
 * would then be free to drift.
 */
const sheetRowsFor = async (
  date: Date,
  query: ExportAttendanceQuery,
  scope: ScopeSelector,
  sortBy: AttendanceSheetSort,
): Promise<ReportRow[]> => {
  const { rows } = await dayRecordService.resolveSheetDay(
    {
      date,
      branchId: query.branchId,
      sectionId: query.sectionId,
      ...(query.search === undefined ? {} : { search: query.search }),
    },
    scope,
  );
  const wanted = query.status ?? [];
  const kept = wanted.length === 0 ? rows : rows.filter((row) => wanted.includes(row.status));
  return sortSheetRows(kept, sortBy, query.sortDir).map((row) => ({
    employeeCode: row.employeeCode,
    employeeName: row.employeeName,
    branch: row.employeeBranch,
    department: row.employeeDepartment,
    jobTitle: row.employeeJobTitle,
    date: row.date,
    status: row.status,
    firstInAt: row.day?.firstInAt ?? row.provisionalDay?.firstInAt ?? null,
    lastOutAt: row.day?.lastOutAt ?? row.provisionalDay?.lastOutAt ?? null,
    figures: row.figures,
    approvedOvertimeMinutes: row.day?.approvedOvertimeMinutes ?? null,
    punchCount: row.punchCount,
    flags: row.day?.flags ?? [],
    frozen: row.day?.frozenAt != null,
    provisional: row.day === null,
  }));
};

/**
 * ONE EMPLOYEE'S PERIOD — one row per calendar date, which is what the employee page shows.
 *
 * It is a different resolution rather than the sheet narrowed to one person, because the two
 * questions are different shapes: the sheet is one date across many people, this is one person
 * across many dates. `employeePeriodScoped` is the same function the employee page calls, so the
 * file and the page agree line for line, and it already enforces that an `own` grant cannot ask
 * about somebody else.
 */
const employeeRowsFor = async (
  employeeId: string,
  query: ExportAttendanceQuery,
  scope: ScopeSelector,
): Promise<ReportRow[]> => {
  const employee = await employeeRepository.findById(employeeId);
  if (employee === null) throw new NotFoundError('no such employee');
  const placements = await resolvePlacements([employee]);
  const placed = placements.for(employee);
  const identity: {
    code: string;
    name: string;
    branch: LocalizedString | null;
    department: LocalizedString | null;
    jobTitle: LocalizedString | null;
  } = {
    code: employee.code,
    name: employee.personal.fullNameAr,
    branch: placed.branch?.name ?? null,
    department: placed.department?.name ?? null,
    jobTitle: placed.jobTitle?.name ?? null,
  };

  const days = await dayRecordService.employeePeriodScoped(
    employeeId,
    query.from,
    query.to,
    scope,
  );
  const wanted = query.status ?? [];
  const kept = wanted.length === 0 ? days : days.filter((day) => wanted.includes(day.status));
  return kept.map((day) => ({
    employeeCode: identity.code,
    employeeName: identity.name,
    branch: identity.branch,
    department: identity.department,
    jobTitle: identity.jobTitle,
    date: day.date,
    status: day.status,
    firstInAt: day.firstInAt,
    lastOutAt: day.lastOutAt,
    figures: day.figures,
    approvedOvertimeMinutes: day.approvedOvertimeMinutes,
    punchCount: day.punches.length,
    flags: day.flags,
    frozen: day.frozen,
    provisional: day.provisional,
  }));
};

export const streamAttendanceExport = async (
  res: Response,
  ctx: AuthContext,
  query: ExportAttendanceQuery,
  scope: ScopeSelector,
): Promise<void> => {
  const locale = localeOf(ctx);
  const from = toDateOnly(query.from);
  const to = toDateOnly(query.to);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  // The client names the saved file (it knows the branch the reader had picked); this is the
  // fallback for anything that reads the header instead, and it names the DATES rather than the
  // moment of export — a file called `attendance-export-1763...csv` tells nobody anything.
  const span =
    from.getTime() === to.getTime() ? dateOnlyIso(from) : `${dateOnlyIso(from)}_${dateOnlyIso(to)}`;
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${span}.csv"`);
  res.setHeader('Cache-Control', 'private, no-store');

  if (isHeadRequest(res)) {
    res.end();
    return;
  }

  const write = drainingWriter(res);
  let rowCount = 0;
  let completed = false;
  let failure: unknown;

  try {
    if (await write(UTF8_BOM + csvRow(reportHeaders(locale)))) {
      if (query.employeeId !== undefined) {
        // ONE EMPLOYEE, the whole period in one resolution: it is one person's days, so there is
        // no per-date loop to keep memory down and the period cap is the only bound needed.
        const rows = await employeeRowsFor(query.employeeId, query, scope);
        for (const row of rows) {
          if (!(await write(csvRow(reportCells(row, locale))))) break;
          rowCount += 1;
        }
        completed = rowCount === rows.length;
      } else {
        // THE SHEET, one date at a time. Resolving the whole range first would hold every
        // employee of every date in memory at once; this holds one branch-day.
        completed = true;
        for (const date of datesBetween(from, to)) {
          const rows = await sheetRowsFor(date, query, scope, query.sortBy);
          for (const row of rows) {
            if (!(await write(csvRow(reportCells(row, locale))))) {
              completed = false;
              break;
            }
            rowCount += 1;
          }
          if (!completed) break;
        }
      }
    }
  } catch (error) {
    // Kept rather than rethrown here: the audit row below is the record that somebody asked for
    // this file, and it is owed whether the read succeeded. Rethrown after it is written.
    failure = error;
  }
  if (failure === undefined) res.end();

  await auditService.record({
    entityRef: { moduleId: 'hr', entityType: 'attendanceDay', entityId: 'export' },
    action: 'export',
    changes: [
      { field: 'rowCount', old: null, new: rowCount },
      { field: 'completed', old: null, new: completed },
      { field: 'from', old: null, new: dateOnlyIso(from) },
      { field: 'to', old: null, new: dateOnlyIso(to) },
      { field: 'filter', old: null, new: JSON.stringify(query) },
    ],
  });
  if (failure !== undefined) throw failure;
};
