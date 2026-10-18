// F1/F3 — audited CSV export. Streams via a Mongo cursor (no full-result buffering,
// Plan §4 NFR); the export itself is audited (actor, filter, row count) after the
// stream completes. Row-capped by the `audit.export.maxRows` setting.
import { type Response } from 'express';
import { SettingKeys, type ExportAuditLogsQuery } from '@ecms/contracts';
import { currentBranchId, type AuthContext } from '../../shared/types';
import { drainingWriter } from '../../shared/utils/draining-writer';
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

  // Made before the first write: see `drainingWriter`. A false from it means the client has gone,
  // and the export stops reading the cursor.
  const write = drainingWriter(res);
  let rowCount = 0;
  // False when the client left before the last row, so the audit row says the count is partial.
  let completed = false;
  if (await write(`${CSV_COLUMNS.join(',')}\n`)) {
    const cursor = AuditLogModel.find(filter)
      .sort({ at: -1 })
      .limit(maxRows)
      .lean<AuditLogDoc[]>()
      .cursor();
    // The cursor is closed whether the export finished or the client left part-way: a `break`
    // only stops reading, and the server would keep the cursor open until it times out.
    try {
      let left = false;
      for await (const doc of cursor) {
        if (!(await write(`${rowToCsv(doc)}\n`))) {
          left = true;
          break;
        }
        rowCount += 1;
      }
      completed = !left;
    } finally {
      await cursor.close();
    }
  }
  res.end();

  // Audited after the stream completes — never blocks the export itself. A download the client
  // left part-way is audited too, with the rows written before it left.
  await auditService.record({
    entityRef: { moduleId: 'platform', entityType: 'auditLog', entityId: 'export' },
    action: 'export',
    changes: [
      { field: 'rowCount', old: null, new: rowCount },
      { field: 'completed', old: null, new: completed },
      { field: 'maxRows', old: null, new: maxRows },
      { field: 'filter', old: null, new: JSON.stringify(query) },
    ],
  });
};
