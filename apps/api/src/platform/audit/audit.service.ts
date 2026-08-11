// The system's memory (ADR-012). Writes are fire-and-forget through the queue with
// an in-request fallback — audit must never fail a business operation, but loss is alarmed.
import { Types } from 'mongoose';
import {
  type AuditAction,
  type AuditChange,
  type AuditLogDto,
  type ActivityLogDto,
  type EntityRef,
  type ExportAuditLogsQuery,
  type ListAuditLogsQuery,
  type ListActivityLogsQuery,
  type Paginated,
} from '@ecms/contracts';
import { logger } from '../../infrastructure/logging/logger';
import {
  getContext,
  getRequestId,
  type ActorIdentity,
} from '../../infrastructure/http/request-context';
import { enqueue, registerJobHandler } from '../../infrastructure/queue/jobs';
import { captureError } from '../../infrastructure/observability/sentry';
import {
  AuditLogModel,
  ActivityLogModel,
  type AuditLogDoc,
  type ActivityLogDoc,
} from './audit.model';
import { maskChanges } from './audit.masking';
import { toActorSnapshotDto } from './audit.actor-dto';
import { type ActorSnapshotDoc } from './audit.model';
import { directoryProfileService } from '../directory/directory-profile.service';

export interface AuditEntry {
  entityRef: EntityRef;
  action: AuditAction;
  changes?: AuditChange[];
  /** Defaults to the request-context actor. */
  actor?: { userId: string | null; ip: string | null; userAgent: string | null };
}

export interface ActivityEntry {
  entityRef: EntityRef;
  messageKey: string;
  params?: Record<string, string>;
  actorId?: string | null;
}

const AUDIT_WRITE_JOB = 'audit.write';
const ACTIVITY_WRITE_JOB = 'audit.writeActivity';

interface AuditWritePayload extends AuditEntry {
  requestId: string | null;
  at: string;
  /** Decided when the action happened, not when the row lands. Optional: older messages lack it. */
  actorIdentity?: ActorIdentity | null;
}

const toObjectIdOrNull = (id: string | null | undefined): Types.ObjectId | null =>
  id !== null && id !== undefined && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;

/** Shared by the list endpoint and the CSV export (F1/F5) — same filter vocabulary. */
export const buildAuditFilter = (
  query: ListAuditLogsQuery | ExportAuditLogsQuery,
): Record<string, unknown> => {
  const filter: Record<string, unknown> = {};
  if (query.entityType !== undefined) filter['entityRef.entityType'] = query.entityType;
  if (query.entityId !== undefined) filter['entityRef.entityId'] = query.entityId;
  if (query.moduleId !== undefined) filter['entityRef.moduleId'] = query.moduleId;
  if (query.actorUserId !== undefined)
    filter['actor.userId'] = new Types.ObjectId(query.actorUserId);
  if (query.action !== undefined) filter.action = query.action;
  if (query.from !== undefined || query.to !== undefined) {
    filter.at = {
      ...(query.from === undefined ? {} : { $gte: query.from }),
      ...(query.to === undefined ? {} : { $lte: query.to }),
    };
  }
  return filter;
};

/**
 * The identity the REQUEST already knows, when it is the same person the entry is about. An
 * authenticated caller was named once when their token was verified, so naming them again per row
 * would be a database read the request has already paid for.
 */
const identityFromContext = (userId: string | null | undefined): ActorIdentity | null => {
  const actor = getContext()?.actor;
  if (actor === undefined || actor.identity == null) return null;
  return actor.userId === userId ? actor.identity : null;
};

/**
 * Who the actor was, as recorded when the event happened — never resolved at read time, because a
 * rename or a deletion must not be able to rewrite what history says.
 *
 * The identity normally arrives with the entry, captured from the request. The lookup below is the
 * fallback for writes with no authenticated request behind them — logging in (the context has no
 * identity yet), background jobs, and callers that name a different actor than themselves.
 */
const captureActor = async (
  userId: string | null | undefined,
  known: ActorIdentity | null | undefined,
): Promise<ActorSnapshotDoc | null> => {
  if (userId === null || userId === undefined) return null;
  const identity = known ?? (await directoryProfileService.get(userId).catch(() => null));
  return identity === null || identity === undefined
    ? null
    : {
        displayName: identity.displayName,
        jobTitle: identity.jobTitle,
        avatarFileId: identity.avatarFileId,
        deletedAt: null,
      };
};

const writeAuditRow = async (payload: AuditWritePayload): Promise<void> => {
  await AuditLogModel.create([
    {
      entityRef: payload.entityRef,
      action: payload.action,
      changes: payload.changes ?? [],
      actor: {
        userId: toObjectIdOrNull(payload.actor?.userId),
        ip: payload.actor?.ip ?? null,
        userAgent: payload.actor?.userAgent ?? null,
      },
      actorSnapshot: await captureActor(payload.actor?.userId, payload.actorIdentity),
      requestId: payload.requestId,
      at: new Date(payload.at),
    },
  ]);
};

interface ActivityWritePayload extends ActivityEntry {
  actorId: string | null;
  at: string;
  actorIdentity?: ActorIdentity | null;
}

/**
 * One writer for both paths. The queued handler and the in-request fallback used to build the row
 * separately, and the queued one silently dropped the actor snapshot — which is exactly the kind of
 * divergence that makes half a history nameless.
 */
const writeActivityRow = async (payload: ActivityWritePayload): Promise<void> => {
  await ActivityLogModel.create([
    {
      entityRef: payload.entityRef,
      messageKey: payload.messageKey,
      params: payload.params ?? {},
      actorId: toObjectIdOrNull(payload.actorId),
      actorSnapshot: await captureActor(payload.actorId, payload.actorIdentity),
      at: new Date(payload.at),
    },
  ]);
};

class AuditService {
  /** Never throws — a failed audit write is alarmed, not propagated. */
  async record(entry: AuditEntry): Promise<void> {
    const context = getContext();
    const actor = entry.actor ?? context?.actor ?? { userId: null, ip: null, userAgent: null };
    const payload: AuditWritePayload = {
      ...entry,
      actor: { userId: actor.userId, ip: actor.ip, userAgent: actor.userAgent },
      actorIdentity: identityFromContext(actor.userId),
      requestId: getRequestId() ?? null,
      at: new Date().toISOString(),
    };
    try {
      await enqueue('audit', AUDIT_WRITE_JOB, payload);
    } catch (queueError) {
      try {
        await writeAuditRow(payload);
      } catch (writeError) {
        logger.error({ err: writeError, entry: payload.entityRef }, 'AUDIT LOSS — write failed');
        captureError(writeError, { audit: true, queueError: String(queueError) });
      }
    }
  }

  async recordActivity(entry: ActivityEntry): Promise<void> {
    const actorId = entry.actorId ?? getContext()?.actor?.userId ?? null;
    const payload: ActivityWritePayload = {
      ...entry,
      actorId,
      actorIdentity: identityFromContext(actorId),
      at: new Date().toISOString(),
    };
    try {
      await enqueue('audit', ACTIVITY_WRITE_JOB, payload);
    } catch {
      try {
        await writeActivityRow(payload);
      } catch (writeError) {
        logger.error({ err: writeError }, 'activity write failed');
      }
    }
  }

  async listAuditLogs(query: ListAuditLogsQuery): Promise<Paginated<AuditLogDoc>> {
    const filter = buildAuditFilter(query);
    const [items, totalItems] = await Promise.all([
      AuditLogModel.find(filter)
        .sort({ at: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<AuditLogDoc[]>()
        .exec(),
      AuditLogModel.countDocuments(filter).exec(),
    ]);
    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
      },
    };
  }

  async listActivityLogs(query: ListActivityLogsQuery): Promise<Paginated<ActivityLogDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.entityType !== undefined) filter['entityRef.entityType'] = query.entityType;
    if (query.entityId !== undefined) filter['entityRef.entityId'] = query.entityId;
    const [items, totalItems] = await Promise.all([
      ActivityLogModel.find(filter)
        .sort({ at: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<ActivityLogDoc[]>()
        .exec(),
      ActivityLogModel.countDocuments(filter).exec(),
    ]);
    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
      },
    };
  }

  toAuditDto(doc: AuditLogDoc): AuditLogDto {
    return {
      id: String(doc._id),
      entityRef: doc.entityRef,
      action: doc.action,
      // G-1 — the same masking the CSV export applies. It used to apply only there, which made
      // this endpoint the weaker of two readers of identical rows.
      changes: maskChanges(doc.changes),
      actor: {
        userId: doc.actor.userId === null ? null : String(doc.actor.userId),
        ip: doc.actor.ip,
        userAgent: doc.actor.userAgent,
      },
      // G-2 — who they were AT THE TIME, from the row itself. The document has carried this since
      // actor snapshots shipped and both sibling DTOs already returned it; only this one dropped
      // it, leaving a reader to resolve the User at read time — which is exactly what the stored
      // snapshot exists to prevent.
      actorSnapshot: toActorSnapshotDto(doc.actor.userId, doc.actorSnapshot),
      requestId: doc.requestId,
      at: doc.at.toISOString(),
    };
  }

  toActivityDto(doc: ActivityLogDoc): ActivityLogDto {
    return {
      id: String(doc._id),
      entityRef: doc.entityRef,
      messageKey: doc.messageKey,
      params: doc.params,
      actor: toActorSnapshotDto(doc.actorId, doc.actorSnapshot),
      actorId: doc.actorId === null ? null : String(doc.actorId),
      at: doc.at.toISOString(),
    };
  }
}

export const auditService = new AuditService();

export const registerAuditJobHandlers = (): void => {
  registerJobHandler('audit', AUDIT_WRITE_JOB, async (data) => {
    await writeAuditRow(data as AuditWritePayload);
  });
  registerJobHandler('audit', ACTIVITY_WRITE_JOB, async (data) => {
    await writeActivityRow(data as ActivityWritePayload);
  });
};
