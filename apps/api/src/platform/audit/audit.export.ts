// F1/F3 — audited CSV export. Streams via a Mongo cursor (no full-result buffering,
// Plan §4 NFR); the export itself is audited (actor, filter, row count) after the
// stream completes. Row-capped by the `audit.export.maxRows` setting.
import { type Response } from 'express';
import { maskNationalId, SettingKeys, type ExportAuditLogsQuery } from '@ecms/contracts';
import { type AuthContext } from '../../shared/types';
import { settingsService } from '../settings';
import { auditService, buildAuditFilter } from './audit.service';
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

/** Field-name-based masking — covers the one PII field named in Plan §13; not a general scanner. */
const MASKED_FIELDS = new Set(['nationalId']);
export const maskChangeValue = (field: string, value: unknown): unknown =>
  MASKED_FIELDS.has(field) && typeof value === 'string' ? maskNationalId(value) : value;

export const rowToCsv = (doc: AuditLogDoc): string => {
  const maskedChanges = doc.changes.map((c) => ({
    field: c.field,
    old: maskChangeValue(c.field, c.old),
    new: maskChangeValue(c.field, c.new),
  }));
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

/** Writes `chunk`, awaiting the `drain` event under backpressure. */
const writeAndDrain = async (res: Response, chunk: string): Promise<void> => {
  if (!res.write(chunk)) {
    await new Promise<void>((resolve) => res.once('drain', resolve));
  }
};

export const streamAuditExport = async (
  res: Response,
  ctx: AuthContext,
  query: ExportAuditLogsQuery,
): Promise<void> => {
  const maxRows = await settingsService.resolve<number>(SettingKeys.AuditExportMaxRows, {
    userId: ctx.userId,
    branchId: ctx.branchId,
  });
  const filter = buildAuditFilter(query);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="audit-export-${Date.now()}.csv"`,
  );
  res.setHeader('Cache-Control', 'private, no-store');

  await writeAndDrain(res, `${CSV_COLUMNS.join(',')}\n`);

  let rowCount = 0;
  const cursor = AuditLogModel.find(filter)
    .sort({ at: -1 })
    .limit(maxRows)
    .lean<AuditLogDoc[]>()
    .cursor();
  for await (const doc of cursor) {
    await writeAndDrain(res, `${rowToCsv(doc)}\n`);
    rowCount += 1;
  }
  res.end();

  // Audited after the stream completes — never blocks the export itself.
  await auditService.record({
    entityRef: { moduleId: 'platform', entityType: 'auditLog', entityId: 'export' },
    action: 'export',
    changes: [
      { field: 'rowCount', old: null, new: rowCount },
      { field: 'maxRows', old: null, new: maxRows },
      { field: 'filter', old: null, new: JSON.stringify(query) },
    ],
  });
};
