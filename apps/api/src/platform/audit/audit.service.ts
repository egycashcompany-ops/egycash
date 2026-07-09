// The system's memory (ADR-012). Writes are fire-and-forget through the queue with
// an in-request fallback — audit must never fail a business operation, but loss is alarmed.
import { Types } from 'mongoose';
import {
  type AuditAction,
  type AuditChange,
  type AuditLogDto,
  type ActivityLogDto,
  type EntityRef,
  type ListAuditLogsQuery,
  type ListActivityLogsQuery,
  type Paginated,
} from '@ecms/contracts';
import { logger } from '../../infrastructure/logging/logger';
import { getContext, getRequestId } from '../../infrastructure/http/request-context';
import { enqueue, registerJobHandler } from '../../infrastructure/queue/jobs';
import { captureError } from '../../infrastructure/observability/sentry';
import {
  AuditLogModel,
  ActivityLogModel,
  type AuditLogDoc,
  type ActivityLogDoc,
} from './audit.model';

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
}

const toObjectIdOrNull = (id: string | null | undefined): Types.ObjectId | null =>
  id !== null && id !== undefined && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;

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
      requestId: payload.requestId,
      at: new Date(payload.at),
    },
  ]);
};

class AuditService {
  /** Never throws — a failed audit write is alarmed, not propagated. */
  async record(entry: AuditEntry): Promise<void> {
    const context = getContext();
    const payload: AuditWritePayload = {
      ...entry,
      actor: entry.actor ?? context?.actor ?? { userId: null, ip: null, userAgent: null },
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
    const payload = { ...entry, actorId, at: new Date().toISOString() };
    try {
      await enqueue('audit', ACTIVITY_WRITE_JOB, payload);
    } catch {
      try {
        await ActivityLogModel.create([
          {
            entityRef: payload.entityRef,
            messageKey: payload.messageKey,
            params: payload.params ?? {},
            actorId: toObjectIdOrNull(payload.actorId),
            at: new Date(payload.at),
          },
        ]);
      } catch (writeError) {
        logger.error({ err: writeError }, 'activity write failed');
      }
    }
  }

  async listAuditLogs(query: ListAuditLogsQuery): Promise<Paginated<AuditLogDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.entityType !== undefined) filter['entityRef.entityType'] = query.entityType;
    if (query.entityId !== undefined) filter['entityRef.entityId'] = query.entityId;
    if (query.actorUserId !== undefined)
      filter['actor.userId'] = new Types.ObjectId(query.actorUserId);
    if (query.action !== undefined) filter.action = query.action;
    if (query.from !== undefined || query.to !== undefined) {
      filter.at = {
        ...(query.from === undefined ? {} : { $gte: query.from }),
        ...(query.to === undefined ? {} : { $lte: query.to }),
      };
    }
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
      changes: doc.changes,
      actor: {
        userId: doc.actor.userId === null ? null : String(doc.actor.userId),
        ip: doc.actor.ip,
        userAgent: doc.actor.userAgent,
      },
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
    const payload = data as ActivityEntry & { at: string };
    await ActivityLogModel.create([
      {
        entityRef: payload.entityRef,
        messageKey: payload.messageKey,
        params: payload.params ?? {},
        actorId: toObjectIdOrNull(payload.actorId),
        at: new Date(payload.at),
      },
    ]);
  });
};
