// Thin HTTP mapping only (ADR-003). The scoped list rides `attendance.view`'s data scope the
// same way leave's list rides `leave.view` (AT-6); `/me` stays own-by-construction.
import { type Request, type Response } from 'express';
import {
  type AttendanceDayDto,
  type ExportAttendanceQuery,
  type ListAttendanceDaysQuery,
  type ListAttendanceSheetQuery,
  type AttendanceEmployeeSummaryQuery,
  type AttendanceSheetSummaryQuery,
  type RecomputeAttendanceDays,
} from '@ecms/contracts';
import { ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { employeeLabelMap, labelFields } from '../../shared/employee-labels';
import { BusinessRuleError } from '../../../../shared/errors';
import { dayRecordService, toAttendanceDayDto } from './day-record.service';
import { streamAttendanceExport } from './attendance-export';

export const listAttendanceDays = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListAttendanceDaysQuery, never>(req);
  const page = await dayRecordService.list(query, scopeSelector(ctx, 'attendance.view'));
  const labels = await employeeLabelMap(page.items.map((doc) => String(doc.employeeId)));
  okPage(
    res,
    page,
    (doc): AttendanceDayDto => ({
      ...toAttendanceDayDto(doc),
      ...labelFields(labels, String(doc.employeeId)),
    }),
  );
};

/**
 * The daily sheet. Same permission and same data scope as the day list — it is the same question
 * about the same rows — but the ANSWER starts from employees, so somebody who has not scanned
 * appears on it. The service already fills the employee labels from the documents it paged
 * through, so there is no second label fetch here.
 */
export const listAttendanceSheet = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListAttendanceSheetQuery, never>(req);
  const page = await dayRecordService.sheet(query, scopeSelector(ctx, 'attendance.view'));
  okPage(res, page, (row) => row);
};

/**
 * The sheet's counts, over the whole day. A sibling of the list rather than a field on it: the
 * page envelope's `meta` is a shape every list in the product returns, and widening it for one
 * screen would change all of them.
 */
export const attendanceSheetSummary = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, AttendanceSheetSummaryQuery, never>(req);
  ok(res, await dayRecordService.sheetSummary(query, scopeSelector(ctx, 'attendance.view')));
};

/** One employee's period, added up — the figures above their attendance page. */
export const attendanceEmployeeSummary = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, AttendanceEmployeeSummaryQuery, never>(req);
  ok(res, await dayRecordService.employeeSummary(query, scopeSelector(ctx, 'attendance.view')));
};

/**
 * EVERY CALENDAR DATE of one employee's period, resolved — the employee page's own source.
 *
 * It is a sibling of `/employee-summary` rather than a field on it because the two are read at
 * different rates: the figures are one small object the header draws once, and this is up to a
 * year of days the table and the calendar page through. Both are resolved from the same days, so
 * they cannot disagree.
 */
export const attendanceEmployeePeriod = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, AttendanceEmployeeSummaryQuery, never>(req);
  if (query.employeeId === undefined) {
    throw new BusinessRuleError('an employee is required for this period');
  }
  ok(
    res,
    await dayRecordService.employeePeriodScoped(
      query.employeeId,
      query.from,
      query.to,
      scopeSelector(ctx, 'attendance.view'),
    ),
  );
};

/** The caller's own resolved period. Own-scope by construction, like `/me` and `/me/summary`. */
export const myAttendancePeriod = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, AttendanceEmployeeSummaryQuery, never>(req);
  ok(res, await dayRecordService.employeePeriodMine(String(ctx.userId), query.from, query.to));
};

/** The same figures about the caller. The employee comes from the login; the query cannot name one. */
export const myAttendanceSummary = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, AttendanceEmployeeSummaryQuery, never>(req);
  ok(
    res,
    await dayRecordService.employeeSummaryMine(String(ctx.userId), {
      from: query.from,
      to: query.to,
    }),
  );
};

export const listMyAttendanceDays = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListAttendanceDaysQuery, never>(req);
  // Whatever employee/branch filters arrived are DROPPED: /me answers for the caller only.
  const own = {
    from: query.from,
    to: query.to,
    page: query.page,
    pageSize: query.pageSize,
    sortDir: query.sortDir,
    ...(query.sortBy === undefined ? {} : { sortBy: query.sortBy }),
    ...(query.status === undefined ? {} : { status: query.status }),
  };
  const page = await dayRecordService.listMine(String(ctx.userId), own);
  okPage(res, page, toAttendanceDayDto);
};

/**
 * The CSV. A separate permission from reading (`attendance.export`) and its own audit row — the
 * export audits ITSELF, exactly as the audit-log export does. The rows come from the day records
 * (the §15.1 columns), never from a re-derivation over punches.
 */
export const exportAttendance = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ExportAttendanceQuery, never>(req);
  await streamAttendanceExport(res, ctx, query, scopeSelector(ctx, 'attendance.export'));
};

export const recomputeAttendanceDays = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<RecomputeAttendanceDays, never, never>(req);
  const result = await dayRecordService.recompute(ctx, body);
  ok(res, result);
};
