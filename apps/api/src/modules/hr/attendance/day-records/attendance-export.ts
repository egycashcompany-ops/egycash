// The AT-6 CSV export — audit-style (the F1/F3 shape): streamed via a cursor, audited after the
// stream completes, and read from the DAY ROWS in the §15.1 column order — frozen and live rows
// alike, never re-derived from punches. Quantities only: nothing here knows what a minute costs.
import { type Response } from 'express';
import { ATTENDANCE_FEED_FIELDS, type ExportAttendanceQuery } from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { NotFoundError } from '../../../../shared/errors';
import { auditService } from '../../../../platform/audit';
import { csvEscape } from '../../../../platform/audit/audit.export';
import { dateOnlyIso } from '../../shared/business-date';
import { employeeRepository } from '../../employee-management/employees';
import { employeeLabelMap, type EmployeeLabel } from '../employee-labels';
import { AttendanceDayModel, type AttendanceDayDoc } from './day-record.model';

/** The two display labels, then the twelve §15.1 feed columns — in the contract's own order. */
const CSV_COLUMNS = ['employeeCode', 'employeeName', ...ATTENDANCE_FEED_FIELDS] as const;

const rowToCsv = (doc: AttendanceDayDoc, label: EmployeeLabel | undefined): string => {
  const fields = [
    label?.code ?? '',
    label?.name ?? '',
    String(doc.employeeId),
    dateOnlyIso(doc.workDate),
    doc.status,
    doc.shiftId === null ? '' : String(doc.shiftId),
    String(doc.workedMinutes),
    String(doc.lateMinutes),
    String(doc.earlyLeaveMinutes),
    String(doc.approvedOvertimeMinutes),
    doc.leaveId === null ? '' : String(doc.leaveId),
    String(doc.branchId),
    doc.flags.join('|'),
    doc.frozenAt === null ? '' : doc.frozenAt.toISOString(),
  ];
  return fields.map(csvEscape).join(',');
};

/** Writes `chunk`, awaiting the `drain` event under backpressure. */
const writeAndDrain = async (res: Response, chunk: string): Promise<void> => {
  if (!res.write(chunk)) {
    await new Promise<void>((resolve) => res.once('drain', resolve));
  }
};

const buildFilter = async (
  query: ExportAttendanceQuery,
  scope: ScopeSelector,
): Promise<FilterQuery<AttendanceDayDoc>> => {
  const filter: FilterQuery<AttendanceDayDoc> = {
    workDate: { $gte: query.from, $lte: query.to },
    isDeleted: false,
  };
  if (query.employeeId !== undefined) filter.employeeId = new Types.ObjectId(query.employeeId);
  if (query.branchId !== undefined) filter.branchId = new Types.ObjectId(query.branchId);
  if (query.status !== undefined) filter.status = query.status;
  if (query.sectionId !== undefined) {
    const ids = await employeeRepository.listIdsBySectionSystem(query.sectionId);
    filter.employeeId =
      query.employeeId !== undefined && !ids.includes(query.employeeId)
        ? { $in: [] }
        : (filter.employeeId ?? { $in: ids.map((id) => new Types.ObjectId(id)) });
  }
  // The caller's data scope, applied the way the list applies it: own = the caller's linked
  // employee only; branch = the caller's branch; organization = everything. Asking for somebody
  // else under an `own` grant exports NOTHING — never the caller's own rows under another
  // employee's heading (the same rule the scoped list follows).
  if (scope.scope === 'own') {
    const own = await employeeRepository.findByUserIdSystem(scope.userId);
    if (own === null) throw new NotFoundError('no employee is linked to this login');
    filter.employeeId =
      query.employeeId !== undefined && query.employeeId !== String(own._id)
        ? { $in: [] }
        : own._id;
  } else if (scope.scope !== 'organization') {
    filter.branchId =
      scope.branchId === null ? { $in: [] } : new Types.ObjectId(scope.branchId);
  }
  return filter;
};

export const streamAttendanceExport = async (
  res: Response,
  ctx: AuthContext,
  query: ExportAttendanceQuery,
  scope: ScopeSelector,
): Promise<void> => {
  const filter = await buildFilter(query, scope);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="attendance-export-${Date.now()}.csv"`,
  );
  res.setHeader('Cache-Control', 'private, no-store');

  await writeAndDrain(res, `${CSV_COLUMNS.join(',')}\n`);

  // Label lookups batched per employee, not per row — an export is one pass over a range.
  const employeeIds = await AttendanceDayModel.distinct('employeeId', filter).exec();
  const labels = await employeeLabelMap(employeeIds.map((id) => String(id)));

  let rowCount = 0;
  const cursor = AttendanceDayModel.find(filter)
    .sort({ workDate: 1, employeeId: 1 })
    .lean<AttendanceDayDoc[]>()
    .cursor();
  for await (const doc of cursor) {
    await writeAndDrain(res, `${rowToCsv(doc, labels.get(String(doc.employeeId)))}\n`);
    rowCount += 1;
  }
  res.end();

  // Audited after the stream completes — never blocks the export itself (the audit F1 shape).
  await auditService.record({
    entityRef: { moduleId: 'hr', entityType: 'attendanceDay', entityId: 'export' },
    action: 'export',
    changes: [
      { field: 'rowCount', old: null, new: rowCount },
      { field: 'from', old: null, new: dateOnlyIso(query.from) },
      { field: 'to', old: null, new: dateOnlyIso(query.to) },
      { field: 'filter', old: null, new: JSON.stringify(query) },
    ],
  });
};
