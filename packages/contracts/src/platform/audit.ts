import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';
import { type ActorSnapshotDto } from './directory.js';

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
  'accountAutoCreated',
  'credentialsDelivered',
  'firstLogin',
  'invitationCreated',
  'invitationResent',
  'invitationExpired',
  'invitationUsed',
  'invitationAttemptInvalid',
  'invitationRevoked',
  'totpReset',
  'totpRequiredChanged',
  'usernameChanged',
  'download',
  'archive',
  'restore',
  'purge',
  'alertRaised',
  'contractGenerated',
  'contractRendered',
  'contractSigned',
  'contractAmended',
  'contractRenewed',
  'templateCloned',
  'templatePublished',
  // Automation (A-3). Enabling is recorded separately from editing because it is the moment a
  // workflow starts acting in production, and ownership transfer separately again because it
  // changes the principal a workflow runs as.
  'automationEnabled',
  'automationDisabled',
  'automationSuspended',
  'automationTransferred',
  /** A credential was opened for an execution (A-4.1). The row carries traceability metadata,
   *  never the secret — which is the whole point of auditing usage rather than exposing it. */
  'automationCredentialUsed',
  // Fleet (FL-4): the odometer correction flow and the workshop custody transitions are distinct
  // audited acts, not generic updates — filtering the trail on them is how a dispute is settled.
  'correct',
  'checkOut',
  'reopen',
  // IT (design §10, ADR-021): the four custody transitions, for the same reason as Fleet's — a
  // dispute about who held an asset is settled by filtering the trail on the act, not by reading
  // change diffs on a generic `update`. The business record itself is `it_asset_events`; these
  // rows answer "who performed it", which is a different question with a different retention.
  'assign',
  'return',
  'transfer',
  'dispose',
  // IT-3 (design §10): resolving a ticket and a system-stamped SLA breach are distinct audited
  // acts. `slaBreached` is written by the sweep under the SYSTEM actor — the contract-generation
  // precedent for an audited act with no human behind it.
  'resolve',
  'slaBreached',
  // IT-4 (design §10): the maintenance transitions and the store's one inbound movement. Same
  // argument as the custody four — "when did this asset go under repair, and who released it" is
  // answered by filtering on the act, not by reading a diff on a generic `update`. `receive` is
  // audited because it is the only way stock enters the store without a maintenance order behind
  // it (ADR-024), so the audit row is the only record of who put it there.
  'start',
  'complete',
  'cancel',
  'activate',
  'deactivate',
  'receive',
  // System Administration (SA-2). Three administrative acts that had no name of their own.
  //
  // `unlock` is not a `statusChange`: the account's lifecycle status never moved. What changed is
  // the automatic lockout the failed-login counter armed, and "who cleared it, and when" is the
  // question an incident asks — a generic `update` diff cannot answer it.
  //
  // The link pair is recorded against BOTH entities, which is deliberate rather than duplication:
  // HR reads the employee's trail and an administrator reads the account's, neither can see the
  // other's, and "when did this login become this person's" is a question both are asked.
  'unlock',
  'employeeLinked',
  'employeeUnlinked',
  // SA-3. Moving a grant's validity window is neither a new grant nor a revocation: the role, the
  // user and the scope are unchanged, and expressing it as `roleRevoked` + `roleAssigned` would
  // split one decision into two rows and lose when the grant was first made.
  'roleAssignmentUpdated',
  // Attendance (v1.1). The import is one decision over thousands of rows, so it audits as one
  // record carrying the batch totals; a recompute rewrites derived data in bulk and deserves its
  // own verb rather than hiding under `update`. Individual punches audit as plain `create`.
  'attendancePunchImport',
  'attendanceRecompute',
  // AT-4: freezing a period makes a month's rows immutable — the single most consequential
  // mutation of derived attendance data, so it audits under its own verb.
  'attendanceFreeze',
  // AT-5, the leave precedent (leaveRequest/leaveDecision): a correction request and each
  // decision step are filterable acts, and the overtime release is the moment recorded minutes
  // become payable quantity — three verbs a dispute filters on, not diffs on a generic update.
  'attendanceRegularization',
  'attendanceRegularizationDecision',
  'attendanceOvertimeApproval',
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
  /**
   * Field-level diff. Values pass through the same masking the CSV export applies (G-1) — the two
   * readers of this data must not disagree about what may be shown.
   */
  changes: AuditChange[];
  /**
   * Where the act came from. `userId` is kept as the join key; `ip`/`userAgent` are here because
   * an audit row is investigative data, and the screen shows them in the detail panel only.
   */
  actor: { userId: string | null; ip: string | null; userAgent: string | null };
  /**
   * WHO they were at the time (G-2). The row has stored this since actor snapshots shipped, and
   * `ActivityLogDto` and `TimelineEntryDto` have always returned it — this one did not, which left
   * a reader with an id and no way to name it except by resolving the User at read time. That is
   * precisely what the snapshot exists to prevent: a rename, a transfer or a deletion would
   * silently rewrite the past. `null` on rows written before snapshots existed.
   */
  actorSnapshot: ActorSnapshotDto | null;
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
  /** Who did it, as recorded at write time. `null` on rows written before actor snapshots. */
  actor: ActorSnapshotDto | null;
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
  /** Who did it, as recorded at write time. `null` on rows written before actor snapshots. */
  actor: ActorSnapshotDto | null;
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
