import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'statusChange',
  'login',
  'loginFailed',
  'logout',
  'refreshReuse',
  'lockout',
  'passwordChanged',
  'passwordReset',
  'totpEnrolled',
  'totpDisabled',
  'sessionRevoked',
  'permissionDenied',
  'export',
  'settingChanged',
  'roleAssigned',
  'roleRevoked',
  'loginCreated',
  'personnelAction',
  'personnelActionCancelled',
  'leaveRequest',
  'leaveDecision',
  'leaveCancellation',
  'leaveBalanceAdjustment',
  'download',
  'archive',
  'restore',
  'purge',
  'alertRaised',
] as const;
export const AuditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export interface AuditChange {
  field: string;
  old: unknown;
  new: unknown;
}

export interface AuditLogDto {
  id: string;
  entityRef: { moduleId: string; entityType: string; entityId: string };
  action: AuditAction;
  changes: AuditChange[];
  actor: { userId: string | null; ip: string | null; userAgent: string | null };
  requestId: string | null;
  at: string;
}

export const ListAuditLogsQuerySchema = PaginationQuerySchema.extend({
  entityType: z.string().max(100).optional(),
  entityId: z.string().max(100).optional(),
  actorUserId: objectId().optional(),
  action: AuditActionSchema.optional(),
  /** F5 — filters `entityRef.moduleId` (owning module, e.g. `platform`). */
  moduleId: z.string().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).strict();
export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQuerySchema>;

/** Same filter set as the list, without pagination — export streams up to the row cap. */
export const ExportAuditLogsQuerySchema = z
  .object({
    entityType: z.string().max(100).optional(),
    entityId: z.string().max(100).optional(),
    actorUserId: objectId().optional(),
    action: AuditActionSchema.optional(),
    moduleId: z.string().max(100).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();
export type ExportAuditLogsQuery = z.infer<typeof ExportAuditLogsQuerySchema>;

export interface ActivityLogDto {
  id: string;
  entityRef: { moduleId: string; entityType: string; entityId: string };
  messageKey: string;
  params: Record<string, string>;
  actorId: string | null;
  at: string;
}

export const ListActivityLogsQuerySchema = PaginationQuerySchema.extend({
  entityType: z.string().max(100).optional(),
  entityId: z.string().max(100).optional(),
}).strict();
export type ListActivityLogsQuery = z.infer<typeof ListActivityLogsQuerySchema>;

// ── Entity timeline (F1/F2, BD-007: graceful degradation) ───────────────────
// A merged VIEW over the two append-only streams — not a new entity or collection
// (Domain Model: Timeline is explicitly a view). Content is scoped to whichever of
// `activityLog.view` / `auditLog.view` the caller holds; neither ⇒ 403 (audited).

export const TIMELINE_SOURCES = ['activity', 'audit'] as const;
export const TimelineSourceSchema = z.enum(TIMELINE_SOURCES);
export type TimelineSource = z.infer<typeof TimelineSourceSchema>;

export interface TimelineEntryDto {
  source: TimelineSource;
  id: string;
  at: string;
  actorId: string | null;
  /** `source: 'audit'` only. */
  action?: AuditAction;
  changes?: AuditChange[];
  /** `source: 'activity'` only. */
  messageKey?: string;
  params?: Record<string, string>;
}

export const TimelineQuerySchema = PaginationQuerySchema.extend({
  entityType: z.string().min(1).max(100),
  entityId: z.string().min(1).max(100),
}).strict();
export type TimelineQuery = z.infer<typeof TimelineQuerySchema>;

export interface TimelineDto {
  items: TimelineEntryDto[];
  /** Which stream(s) contributed, per the caller's permissions (BD-007). */
  included: TimelineSource[];
}
