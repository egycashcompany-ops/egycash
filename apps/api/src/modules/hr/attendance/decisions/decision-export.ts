// The decisions CSV (stage 4 §4) — the same audit-style shape the attendance export uses:
// streamed through a cursor, audited after the stream completes, and read from the decision rows
// themselves rather than re-derived from anything.
//
// WHY IT IS A SEPARATE FILE FROM THE ATTENDANCE EXPORT. They answer different questions and are
// read by different people: one is a month of derived days, the other is a record of JUDGEMENTS
// about those days, with the reason in its own column. A reviewer wants the second without the
// first, and the two column sets have nothing in common but the employee.
//
// THE REASON IS A COLUMN, not a note somewhere else. The whole evidential value of this file is
// that it carries, for each change, who made it and why they said they made it.
import { type Response } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import { type ExportAttendanceDecisionsQuery } from '@ecms/contracts';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { orgScopeMatch } from '../../../../shared/base/org-scope-match';
import { NotFoundError } from '../../../../shared/errors';
import { drainingWriter } from '../../../../shared/utils/draining-writer';
import { isHeadRequest, streamRows, type StreamedRows } from '../../../../shared/utils/stream-rows';
import { auditService } from '../../../../platform/audit';
import { csvEscape } from '../../../../platform/audit/audit.export';
import { directoryProfileService } from '../../../../platform/directory/directory-profile.service';
import { dateOnlyIso } from '../../shared/business-date';
import { employeeRepository } from '../../employee-management/employees';
import { employeeLabelMap, type EmployeeLabel } from '../../shared/employee-labels';
import { AttendanceDecisionModel, type AttendanceDecisionDoc } from './decision.model';

const CSV_COLUMNS = [
  'employeeCode',
  'employeeName',
  'workDate',
  'type',
  'status',
  'inAt',
  'outAt',
  'overrodePunch',
  'decidedBy',
  'decidedAt',
  'hrDecidedBy',
  'hrDecidedAt',
  'hrComment',
  'reason',
  'branchId',
  'recordedAt',
] as const;

const rowToCsv = (
  doc: AttendanceDecisionDoc,
  label: EmployeeLabel | undefined,
  names: Map<string, string>,
): string => {
  const who = (id: AttendanceDecisionDoc['decidedBy']): string =>
    id === null ? '' : (names.get(String(id)) ?? String(id));
  const fields = [
    label?.code ?? '',
    label?.name ?? '',
    dateOnlyIso(doc.workDate),
    doc.type,
    doc.status,
    doc.inAt === null ? '' : doc.inAt.toISOString(),
    doc.outAt === null ? '' : doc.outAt.toISOString(),
    doc.overrodePunch ? 'yes' : 'no',
    who(doc.decidedBy),
    doc.decidedAt === null ? '' : doc.decidedAt.toISOString(),
    who(doc.hrDecidedBy),
    doc.hrDecidedAt === null ? '' : doc.hrDecidedAt.toISOString(),
    doc.hrComment ?? '',
    doc.reason,
    doc.branchId === null ? '' : String(doc.branchId),
    doc.createdAt.toISOString(),
  ];
  return fields.map(csvEscape).join(',');
};

const buildFilter = async (
  query: ExportAttendanceDecisionsQuery,
  scope: ScopeSelector,
): Promise<FilterQuery<AttendanceDecisionDoc>> => {
  const filter: FilterQuery<AttendanceDecisionDoc> = {
    workDate: { $gte: query.from, $lte: query.to },
    isDeleted: false,
  };
  if (query.employeeId !== undefined) filter.employeeId = new Types.ObjectId(query.employeeId);
  if (query.branchId !== undefined && query.branchId.length > 0) {
    filter.branchId = { $in: query.branchId.map((id) => new Types.ObjectId(id)) };
  }
  if (query.status !== undefined && query.status.length > 0) filter.status = { $in: query.status };
  if (query.type !== undefined && query.type.length > 0) filter.type = { $in: query.type };
  if (query.decidedBy !== undefined) filter.decidedBy = new Types.ObjectId(query.decidedBy);

  // The caller's data scope, applied exactly as the attendance export applies it: own exports the
  // caller's own rows and nothing else, and asking for somebody else under an `own` grant exports
  // NOTHING rather than the caller's rows under another employee's heading.
  if (scope.scope === 'own') {
    const own = await employeeRepository.findByUserIdSystem(scope.userId);
    if (own === null) throw new NotFoundError('no employee is linked to this login');
    filter.employeeId =
      query.employeeId !== undefined && query.employeeId !== String(own._id)
        ? { $in: [] }
        : own._id;
  } else {
    const reach = orgScopeMatch(scope, { branch: 'branchId' }, { finerNarrowsToBranch: true });
    if (reach != null) return { $and: [filter, reach] } as FilterQuery<AttendanceDecisionDoc>;
  }
  return filter;
};

export const streamDecisionExport = async (
  res: Response,
  ctx: AuthContext,
  query: ExportAttendanceDecisionsQuery,
  scope: ScopeSelector,
): Promise<void> => {
  const filter = await buildFilter(query, scope);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="attendance-decisions-${Date.now()}.csv"`,
  );
  res.setHeader('Cache-Control', 'private, no-store');

  if (isHeadRequest(res)) {
    res.end();
    return;
  }

  const write = drainingWriter(res);
  let outcome: StreamedRows = { rowCount: 0, completed: false };
  if (await write(`${CSV_COLUMNS.join(',')}\n`)) {
    // Both lookups batched over the whole range, not per row: an export is one pass.
    const employeeIds = await AttendanceDecisionModel.distinct('employeeId', filter).exec();
    const labels = await employeeLabelMap(employeeIds.map((id) => String(id)));
    const deciderIds = [
      ...new Set(
        [
          ...(await AttendanceDecisionModel.distinct('decidedBy', filter).exec()),
          ...(await AttendanceDecisionModel.distinct('hrDecidedBy', filter).exec()),
        ]
          .filter((id) => id !== null)
          .map((id) => String(id)),
      ),
    ];
    const profiles = await directoryProfileService.resolve(deciderIds);
    // The Arabic name in the file: these are read in Arabic by the people who review them, and a
    // CSV carries no locale of its own to choose by.
    const names = new Map(
      [...profiles.entries()].map(([id, profile]) => [id, profile.displayName.ar]),
    );

    const cursor = AttendanceDecisionModel.find(filter)
      .sort({ workDate: 1, createdAt: 1 })
      .lean<AttendanceDecisionDoc[]>()
      .cursor();
    outcome = await streamRows(
      cursor,
      write,
      (doc) => `${rowToCsv(doc, labels.get(String(doc.employeeId)), names)}\n`,
    );
  }
  if (outcome.failure === undefined) res.end();

  await auditService.record({
    entityRef: { moduleId: 'hr', entityType: 'attendanceDayDecision', entityId: 'export' },
    action: 'export',
    changes: [
      { field: 'rowCount', old: null, new: outcome.rowCount },
      { field: 'completed', old: null, new: outcome.completed },
      { field: 'from', old: null, new: dateOnlyIso(query.from) },
      { field: 'to', old: null, new: dateOnlyIso(query.to) },
      { field: 'filter', old: null, new: JSON.stringify(query) },
    ],
  });
  if (outcome.failure !== undefined) throw outcome.failure;
};
