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
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).strict();
export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQuerySchema>;

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
