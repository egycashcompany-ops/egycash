// Thin HTTP mapping only (ADR-003). The scoped list rides `attendance.view`'s data scope the
// same way leave's list rides `leave.view` (AT-6); `/me` stays own-by-construction.
import { type Request, type Response } from 'express';
import {
  type AttendanceDayDto,
  type ExportAttendanceQuery,
  type ListAttendanceDaysQuery,
  type RecomputeAttendanceDays,
} from '@ecms/contracts';
import { ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { employeeLabelMap, labelFields } from '../../shared/employee-labels';
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
