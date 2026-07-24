// HR / Employee Management — Personnel Actions (the spine of the frozen design,
// docs/12-planning/employee-module-design.md §3). Every change to employment is an append-only
// Personnel Action: typed, effective-dated (past applies immediately, future is scheduled and
// applied by the scheduler strictly in effective-date order), audited, and immutable once
// written — a scheduled action can only be CANCELLED (append-only status change), never edited.
// `to` values are captured at creation; the authoritative `from` values are captured at
// APPLICATION time so scheduled actions never record stale state (C1). The employee document
// holds only the current snapshot; the action log IS the employment history.
//
// Transport note: the four create endpoints are grouped BY PERMISSION (F5):
//   /actions/employment    → employee.manageActions
//   /actions/compensation  → employee.manageCompensation
//   /actions/exit          → employee.exit
//   /actions/rehire        → employee.rehire (+ employee.rehireOverride when the exit said no)
import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';
import { AllowanceSchema, MoneySchema } from './hr-job-offer.js';
import { DirectEmploymentTermsSchema, EmployeeExitTypeSchema } from './hr-employee.js';

// ── Closed vocabularies ─────────────────────────────────────────────────────

export const EMPLOYEE_ACTION_TYPES = [
  'hire',
  'probationConfirm',
  'probationExtend',
  'probationFail',
  'promotion',
  'transfer',
  'salaryChange',
  'managerChange',
  'suspend',
  'reinstate',
  'leaveStart',
  'leaveEnd',
  'resignation',
  'termination',
  'endOfContract',
  'retirement',
  'death',
  'rehire',
  'dataCorrection',
] as const;
export const EmployeeActionTypeSchema = z.enum(EMPLOYEE_ACTION_TYPES);
export type EmployeeActionType = z.infer<typeof EmployeeActionTypeSchema>;

/**
 * `pendingApproval` is RESERVED for the ADR-011 approval-workflow seam — nothing sets it yet.
 * `failed` marks a scheduled action whose application-time validation failed (org referent
 * deactivated, illegal transition by then, …) — recorded, notified, never silently applied.
 */
export const EMPLOYEE_ACTION_STATUSES = ['scheduled', 'applied', 'cancelled', 'failed', 'pendingApproval'] as const;
export const EmployeeActionStatusSchema = z.enum(EMPLOYEE_ACTION_STATUSES);
export type EmployeeActionStatus = z.infer<typeof EmployeeActionStatusSchema>;

/** Action types that carry salary data and therefore obey compensation redaction. */
export const SALARY_BEARING_ACTION_TYPES: readonly EmployeeActionType[] = ['salaryChange', 'promotion', 'hire', 'rehire'];

// ── Create schemas (grouped by permission route) ────────────────────────────

const base = {
  /** The date the change takes business effect. Defaults to now; past applies immediately; future ⇒ scheduled. */
  effectiveDate: z.coerce.date().optional(),
  note: z.string().max(1000).optional(),
  /** Optimistic concurrency on the EMPLOYEE aggregate (API Standards §6). */
  version: z.number().int().min(0),
};

// Employment group — employee.manageActions
// (a promotion carrying a salary additionally requires employee.manageCompensation server-side).

const PromotionSchema = z
  .object({
    type: z.literal('promotion'),
    jobTitleId: objectId(),
    /** Optional salary revision folded into the promotion. */
    salary: MoneySchema.nullish(),
    reason: z.string().max(500).optional(),
    ...base,
  })
  .strict();

const TransferSchema = z
  .object({
    type: z.literal('transfer'),
    branchId: objectId().optional(),
    departmentId: objectId().optional(),
    /** null clears the section (a department-level placement). */
    sectionId: objectId().nullish(),
    /** null clears the manager. Omitted = unchanged. */
    managerId: objectId().nullish(),
    reason: z.string().max(500).optional(),
    ...base,
  })
  .strict();
// NOTE: "a transfer must change at least one placement field" is enforced in the service —
// a refined schema cannot be a discriminated-union member (zod v3).

const ManagerChangeSchema = z
  .object({
    type: z.literal('managerChange'),
    /** null clears the manager. */
    managerId: objectId().nullable(),
    reason: z.string().max(500).optional(),
    ...base,
  })
  .strict();

const ProbationConfirmSchema = z.object({ type: z.literal('probationConfirm'), ...base }).strict();

const ProbationExtendSchema = z
  .object({
    type: z.literal('probationExtend'),
    newEndDate: z.coerce.date(),
    reason: z.string().max(500).optional(),
    ...base,
  })
  .strict();

/** Failing probation exits the employee (termination-typed exit; D2 default: not rehirable). */
const ProbationFailSchema = z
  .object({
    type: z.literal('probationFail'),
    reason: z.string().trim().min(1).max(500),
    eligibleForRehire: z.boolean().default(false),
    ...base,
  })
  .strict();

const SuspendSchema = z
  .object({
    type: z.literal('suspend'),
    reason: z.string().trim().min(1).max(500),
    /** D6 — checked by default in the UI; HR may untick. */
    disableLogin: z.boolean().default(true),
    ...base,
  })
  .strict();

const ReinstateSchema = z
  .object({
    type: z.literal('reinstate'),
    /** Re-enable a login disabled by the suspension. */
    enableLogin: z.boolean().default(true),
    reason: z.string().max(500).optional(),
    ...base,
  })
  .strict();

const LeaveStartSchema = z
  .object({ type: z.literal('leaveStart'), reason: z.string().max(500).optional(), ...base })
  .strict();

const LeaveEndSchema = z.object({ type: z.literal('leaveEnd'), ...base }).strict();

/** Correction of an employment FACT (not personal data — those are plain audited edits). */
const DataCorrectionSchema = z
  .object({
    type: z.literal('dataCorrection'),
    /** The only correctable fact for now; extend deliberately. */
    hiringDate: z.coerce.date(),
    reason: z.string().trim().min(1).max(500),
    ...base,
  })
  .strict();

export const EmploymentActionSchema = z.discriminatedUnion('type', [
  PromotionSchema,
  TransferSchema,
  ManagerChangeSchema,
  ProbationConfirmSchema,
  ProbationExtendSchema,
  ProbationFailSchema,
  SuspendSchema,
  ReinstateSchema,
  LeaveStartSchema,
  LeaveEndSchema,
  DataCorrectionSchema,
]);
export type EmploymentAction = z.infer<typeof EmploymentActionSchema>;

// Compensation group — employee.manageCompensation

export const CompensationActionSchema = z
  .object({
    type: z.literal('salaryChange'),
    /** null clears the salary (rare; kept symmetric with the offer contract). */
    salary: MoneySchema.nullish(),
    allowances: z.array(AllowanceSchema).max(30).optional(),
    benefits: z.array(z.string().min(1).max(200)).max(50).optional(),
    reason: z.string().max(500).optional(),
    ...base,
  })
  .strict()
  .refine((v) => v.salary !== undefined || v.allowances !== undefined || v.benefits !== undefined, {
    message: 'a salary change must change salary, allowances or benefits',
  });
export type CompensationAction = z.infer<typeof CompensationActionSchema>;

// Exit group — employee.exit

/** What happens to the exiting employee's direct reports (required when they have any). */
export const DirectReportsDecisionSchema = z.union([
  z.object({ reassignToEmployeeId: objectId() }).strict(),
  z.object({ leaveUnassigned: z.literal(true) }).strict(),
]);
export type DirectReportsDecision = z.infer<typeof DirectReportsDecisionSchema>;

export const ExitActionSchema = z
  .object({
    type: EmployeeExitTypeSchema,
    reason: z.string().max(500).optional(),
    /** The explicit rehire-eligibility decision recorded at exit (D2). */
    eligibleForRehire: z.boolean(),
    /** Required server-side when the employee has direct reports. */
    directReports: DirectReportsDecisionSchema.optional(),
    ...base,
  })
  .strict()
  .refine((v) => v.type !== 'termination' || (v.reason !== undefined && v.reason.trim().length > 0), {
    path: ['reason'],
    message: 'a reason is required when terminating an employee',
  });
export type ExitAction = z.infer<typeof ExitActionSchema>;

// Rehire group — employee.rehire (+ employee.rehireOverride when exit said not eligible)

export const RehireActionSchema = z
  .object({
    type: z.literal('rehire'),
    /** Source the new terms from an ACCEPTED offer (returning through a fresh recruitment cycle). */
    jobOfferId: objectId().optional(),
    /** Or supply the terms directly. Exactly one of jobOfferId/terms must be present. */
    terms: DirectEmploymentTermsSchema.optional(),
    /** Defaults to now when omitted. */
    hiringDate: z.coerce.date().optional(),
    /** Reactivate the previous login account (if any) instead of leaving it suspended. */
    reactivateLogin: z.boolean().default(false),
    reason: z.string().max(500).optional(),
    ...base,
  })
  .strict()
  .refine((v) => (v.jobOfferId === undefined) !== (v.terms === undefined), {
    message: 'provide either jobOfferId or terms (exactly one)',
  });
export type RehireAction = z.infer<typeof RehireActionSchema>;

// Cancel a scheduled action (append-only: status → cancelled).

export const CancelEmployeeActionSchema = z
  .object({ reason: z.string().max(500).optional(), version: z.number().int().min(0) })
  .strict();
export type CancelEmployeeAction = z.infer<typeof CancelEmployeeActionSchema>;

// ── List ─────────────────────────────────────────────────────────────────────

export const ListEmployeeActionsQuerySchema = PaginationQuerySchema.extend({
  type: EmployeeActionTypeSchema.optional(),
  status: EmployeeActionStatusSchema.optional(),
}).strict();
export type ListEmployeeActionsQuery = z.infer<typeof ListEmployeeActionsQuerySchema>;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/**
 * One changed field. `from` is null until the action APPLIES (captured at application time —
 * C1); values are JSON snapshots (ids, money objects, dates as ISO strings).
 */
export interface EmployeeActionChangeDto {
  field: string;
  from: unknown;
  to: unknown;
}

export interface EmployeeActionDto {
  id: string;
  employeeId: string;
  employeeCode: string;
  /** Per-employee monotonic sequence — the total order of the employment history. */
  seq: number;
  type: EmployeeActionType;
  status: EmployeeActionStatus;
  effectiveDate: string;
  /** When the action was actually applied to the snapshot (null while scheduled/cancelled/failed). */
  appliedAt: string | null;
  changes: EmployeeActionChangeDto[];
  reason: string | null;
  note: string | null;
  attachmentFileId: string | null;
  /** Why a scheduled action failed application-time validation. */
  failureReason: string | null;
  /** true when salary-bearing values were redacted (caller lacks employee.viewCompensation). */
  redacted: boolean;
  by: string | null;
  createdAt: string;
  updatedAt: string;
}
