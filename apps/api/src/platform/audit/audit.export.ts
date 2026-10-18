// F1/F3 — audited CSV export. Streams via a Mongo cursor (no full-result buffering,
// Plan §4 NFR); the export itself is audited (actor, filter, row count) after the
// stream completes. Row-capped by the `audit.export.maxRows` setting.
import { type Response } from 'express';
import { SettingKeys, type ExportAuditLogsQuery } from '@ecms/contracts';
import { currentBranchId, type AuthContext } from '../../shared/types';
import { drainingWriter } from '../../shared/utils/draining-writer';
import { isHeadRequest, streamRows, type StreamedRows } from '../../shared/utils/stream-rows';
import { settingsService } from '../settings';
import { auditService, buildAuditFilter } from './audit.service';
import { maskChanges } from './audit.masking';
import { AuditLogModel, type AuditLogDoc } from './audit.model';

const CSV_COLUMNS = [
  'id',
  'moduleId',
  'entityType',
  'entityId',
  'action',
  'actorUserId',
  'actorIp',
  'requestId',
  'at',
  'changes',
] as const;

export const csvEscape = (value: unknown): string => {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The masking rule moved to `audit.masking` in P11 so the LIST endpoint applies it too — it used
// to live here, which quietly made it the CSV's rule rather than the audit stream's, and left the
// list returning raw values the export would have masked. Re-exported: `maskChangeValue` was
// already part of this module's surface and its spec asserts on it directly.
export { maskChangeValue } from './audit.masking';

export const rowToCsv = (doc: AuditLogDoc): string => {
  const maskedChanges = maskChanges(doc.changes);
  const fields = [
    String(doc._id),
    doc.entityRef.moduleId,
    doc.entityRef.entityType,
    doc.entityRef.entityId,
    doc.action,
    doc.actor.userId === null ? '' : String(doc.actor.userId),
    doc.actor.ip ?? '',
    doc.requestId ?? '',
    doc.at.toISOString(),
    JSON.stringify(maskedChanges),
  ];
  return fields.map(csvEscape).join(',');
};

export const streamAuditExport = async (
  res: Response,
  ctx: AuthContext,
  query: ExportAuditLogsQuery,
): Promise<void> => {
  const maxRows = await settingsService.resolve<number>(SettingKeys.AuditExportMaxRows, {
    userId: ctx.userId,
    branchId: currentBranchId(ctx),
  });
  const filter = buildAuditFilter(query);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="audit-export-${Date.now()}.csv"`,
  );
  res.setHeader('Cache-Control', 'private, no-store');

  // A HEAD request gets the headers alone: see `isHeadRequest`.
  if (isHeadRequest(res)) {
    res.end();
    return;
  }

  // Made before the first write: see `drainingWriter`. A false from it means the client has gone,
  // and the export stops reading the cursor.
  const write = drainingWriter(res);
  let outcome: StreamedRows = { rowCount: 0, completed: false };
  if (await write(`${CSV_COLUMNS.join(',')}\n`)) {
    const cursor = AuditLogModel.find(filter)
      .sort({ at: -1 })
      .limit(maxRows)
      .lean<AuditLogDoc[]>()
      .cursor();
    outcome = await streamRows(cursor, write, (doc) => `${rowToCsv(doc)}\n`);
  }
  if (outcome.failure === undefined) res.end();

  // Audited after the stream completes — never blocks the export itself. A download the client
  // left part-way, or that a failed read stopped, is audited too, with the rows written before it
  // ended (`streamRows`); a failure is rethrown after.
  await auditService.record({
    entityRef: { moduleId: 'platform', entityType: 'auditLog', entityId: 'export' },
    action: 'export',
    changes: [
      { field: 'rowCount', old: null, new: outcome.rowCount },
      { field: 'completed', old: null, new: outcome.completed },
      { field: 'maxRows', old: null, new: maxRows },
      { field: 'filter', old: null, new: JSON.stringify(query) },
    ],
  });
  if (outcome.failure !== undefined) throw outcome.failure;
};
