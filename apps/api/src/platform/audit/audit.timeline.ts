// F1/F2 — entity timeline: a merged VIEW over the audit + activity streams for one
// entity, not a new entity or collection (Domain Model). BD-007 (approved 2026-07-09):
// content degrades to whichever of `activityLog.view` / `auditLog.view` the caller
// holds — activity-only, audit-only, or merged — never requiring both; neither ⇒ 403
// (audited, same as `authorize()`'s deny path).
import { type PageMeta, type TimelineDto, type TimelineEntryDto, type TimelineQuery } from '@ecms/contracts';
import { ForbiddenError } from '../../shared/errors';
import { hasPermission, type AuthContext } from '../../shared/types';
import { auditService } from './audit.service';
import { AuditLogModel, ActivityLogModel, type AuditLogDoc, type ActivityLogDoc } from './audit.model';

/**
 * Per-entity histories are naturally bounded (a single record's trail, not a global
 * feed); this cap bounds worst case for pathologically long-lived entities. A true
 * k-way-merge cursor would remove the cap — deferred until a real entity needs it
 * (logged as technical debt).
 */
const MAX_ROWS_PER_STREAM = 1_000;

const toAuditEntry = (doc: AuditLogDoc): TimelineEntryDto => ({
  source: 'audit',
  id: String(doc._id),
  at: doc.at.toISOString(),
  actorId: doc.actor.userId === null ? null : String(doc.actor.userId),
  action: doc.action,
  changes: doc.changes,
});

const toActivityEntry = (doc: ActivityLogDoc): TimelineEntryDto => ({
  source: 'activity',
  id: String(doc._id),
  at: doc.at.toISOString(),
  actorId: doc.actorId === null ? null : String(doc.actorId),
  messageKey: doc.messageKey,
  params: doc.params,
});

export interface TimelineResult extends TimelineDto {
  meta: PageMeta;
}

/** Pure newest-first merge — unit-testable without touching Mongo. */
export const mergeTimelineEntries = (entries: TimelineEntryDto[]): TimelineEntryDto[] =>
  [...entries].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

export const getTimeline = async (
  ctx: AuthContext,
  query: TimelineQuery,
): Promise<TimelineResult> => {
  const canActivity = hasPermission(ctx, 'activityLog.view');
  const canAudit = hasPermission(ctx, 'auditLog.view');

  if (!canActivity && !canAudit) {
    // Same shape as authorize()'s deny path: 403 is itself an audited event.
    await auditService.record({
      entityRef: { moduleId: 'platform', entityType: 'user', entityId: ctx.userId },
      action: 'permissionDenied',
      changes: [{ field: 'permission', old: null, new: 'activityLog.view|auditLog.view' }],
    });
    throw new ForbiddenError();
  }

  const entityRefFilter = {
    'entityRef.entityType': query.entityType,
    'entityRef.entityId': query.entityId,
  };
  const included: TimelineDto['included'] = [];
  const entries: TimelineEntryDto[] = [];

  if (canActivity) {
    included.push('activity');
    const rows = await ActivityLogModel.find(entityRefFilter)
      .sort({ at: -1 })
      .limit(MAX_ROWS_PER_STREAM)
      .lean<ActivityLogDoc[]>()
      .exec();
    entries.push(...rows.map(toActivityEntry));
  }
  if (canAudit) {
    included.push('audit');
    const rows = await AuditLogModel.find(entityRefFilter)
      .sort({ at: -1 })
      .limit(MAX_ROWS_PER_STREAM)
      .lean<AuditLogDoc[]>()
      .exec();
    entries.push(...rows.map(toAuditEntry));
  }

  const merged = mergeTimelineEntries(entries);

  const totalItems = merged.length;
  const start = (query.page - 1) * query.pageSize;
  const items = merged.slice(start, start + query.pageSize);

  return {
    items,
    included,
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
    },
  };
};
