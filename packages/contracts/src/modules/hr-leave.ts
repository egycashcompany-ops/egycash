// Leave Management contracts (frozen design docs/12-planning/leave-management-design.md).
// Law and policy are DATA: every entitlement amount, approval shape, counting mode and pay
// tier lives on the Leave Type catalog — seeded with Egyptian Labor Law defaults that HR
// verifies before production (decision L4). The balance ledger is append-only truth; the
// balance row is a rebuildable cache and the atomic reservation gate (R1).
import { z } from 'zod';
import { objectId } from '../common/index.js';
import { LocalizedStringSchema } from '../common/localized.js';

// ── Leave Types (the policy catalog, §2 of the frozen design) ───────────────

export const LEAVE_PAY_MODELS = ['paid', 'unpaid', 'tiered'] as const;
export const LeavePayModelSchema = z.enum(LEAVE_PAY_MODELS);
export type LeavePayModel = z.infer<typeof LeavePayModelSchema>;

/** Ordered partial-pay tiers (sick leave): first `days` at `payRate`%, then the next tier. */
export const LeavePayTierSchema = z
  .object({ days: z.number().int().min(1).max(730), payRate: z.number().min(0).max(100) })
  .strict();
export type LeavePayTier = z.infer<typeof LeavePayTierSchema>;

/**
 * Whose balance a request consumes (R11/C5): `self` = the type's own banked entitlement,
 * `otherType` = another type's balance (casual → annual), `none` = untracked (validated from
 * history — sick/maternity/Hajj/unpaid).
 */
export const LEAVE_BALANCE_SOURCES = ['self', 'otherType', 'none'] as const;
export const LeaveBalanceSourceSchema = z.enum(LEAVE_BALANCE_SOURCES);
export type LeaveBalanceSource = z.infer<typeof LeaveBalanceSourceSchema>;

export const LEAVE_COUNTING_MODES = ['workdays', 'calendarDays'] as const;
export const LeaveCountingModeSchema = z.enum(LEAVE_COUNTING_MODES);
export type LeaveCountingMode = z.infer<typeof LeaveCountingModeSchema>;

export const LEAVE_APPROVAL_SHAPES = ['managerOnly', 'managerThenHr'] as const;
export const LeaveApprovalShapeSchema = z.enum(LEAVE_APPROVAL_SHAPES);
export type LeaveApprovalShape = z.infer<typeof LeaveApprovalShapeSchema>;

export const LEAVE_ATTACHMENT_STAGES = ['beforeApproval', 'atSubmission'] as const;
export const LeaveAttachmentStageSchema = z.enum(LEAVE_ATTACHMENT_STAGES);
export type LeaveAttachmentStage = z.infer<typeof LeaveAttachmentStageSchema>;

export const LEAVE_CARRYOVER_MODES = ['carryAll', 'cap', 'none'] as const;
export const LeaveCarryoverModeSchema = z.enum(LEAVE_CARRYOVER_MODES);
export type LeaveCarryoverMode = z.infer<typeof LeaveCarryoverModeSchema>;

/** Service-years entitlement step: from `afterServiceYears` onward the grant is `days`. */
export const LeaveEntitlementStepSchema = z
  .object({ afterServiceYears: z.number().int().min(1).max(50), days: z.number().min(0).max(365) })
  .strict();
export type LeaveEntitlementStep = z.infer<typeof LeaveEntitlementStepSchema>;

const leaveTypeConfigFields = {
  payModel: LeavePayModelSchema.default('paid'),
  payTiers: z.array(LeavePayTierSchema).max(10).default([]),
  balanceSource: LeaveBalanceSourceSchema.default('self'),
  /** Required when balanceSource = otherType: the type whose balance is consumed. */
  balanceTypeId: objectId().nullable().default(null),
  /** Banked grant per leave-year; null for untracked types. */
  baseDays: z.number().min(0).max(365).nullable().default(null),
  entitlementSteps: z.array(LeaveEntitlementStepSchema).max(10).default([]),
  /** Age-based step (annual: 30 days at age 50 — Egyptian law). */
  ageStepAge: z.number().int().min(18).max(70).nullable().default(null),
  ageStepDays: z.number().min(0).max(365).nullable().default(null),
  minServiceMonths: z.number().int().min(0).max(240).default(0),
  gender: z.enum(['male', 'female']).nullable().default(null),
  /** Lifetime cap across the whole service (Hajj 1, maternity 3); null = unlimited. */
  maxPerService: z.number().int().min(1).max(20).nullable().default(null),
  allowedDuringProbation: z.boolean().default(true),
  minNoticeDays: z.number().int().min(0).max(90).default(0),
  maxConsecutiveDays: z.number().int().min(1).max(730).nullable().default(null),
  /** Yearly usage cap in days (casual 6); independent of the balance gate. */
  maxPerYearDays: z.number().min(0).max(365).nullable().default(null),
  /** Per-occasion cap in days (casual 2). */
  maxPerOccasionDays: z.number().min(0).max(365).nullable().default(null),
  /** How many days in the past a request may start (sick/casual call-ins). */
  backdateDays: z.number().int().min(0).max(90).default(0),
  requiresAttachment: z.boolean().default(false),
  attachmentStage: LeaveAttachmentStageSchema.default('beforeApproval'),
  allowHalfDay: z.boolean().default(false),
  countingMode: LeaveCountingModeSchema.default('workdays'),
  affectsEmployeeStatus: z.boolean().default(false),
  /** For unpaid leave: only spans LONGER than this drive the employee to onLeave. */
  statusThresholdDays: z.number().int().min(0).max(365).nullable().default(null),
  approvalShape: LeaveApprovalShapeSchema.default('managerOnly'),
  carryoverMode: LeaveCarryoverModeSchema.default('carryAll'),
  carryoverCapDays: z.number().min(0).max(365).nullable().default(null),
  carryoverExpiryMonths: z.number().int().min(1).max(24).nullable().default(null),
  /** L5: how far below zero the balance may go. Default 0 = never negative. */
  negativeCapDays: z.number().min(0).max(90).default(0),
  sortOrder: z.number().int().min(0).max(1000).default(0),
};

/** R13 + structural coherence for the catalog. */
const leaveTypeCoherent = (v: {
  affectsEmployeeStatus: boolean;
  allowHalfDay: boolean;
  balanceSource: LeaveBalanceSource;
  balanceTypeId: string | null;
  baseDays: number | null;
  payModel: LeavePayModel;
  payTiers: LeavePayTier[];
}): boolean => {
  if (v.affectsEmployeeStatus && v.allowHalfDay) return false;
  if (v.balanceSource === 'otherType' && v.balanceTypeId === null) return false;
  if (v.balanceSource === 'self' && v.baseDays === null) return false;
  if (v.payModel === 'tiered' && v.payTiers.length === 0) return false;
  return true;
};
const leaveTypeError = {
  message:
    'incoherent type: status-affecting types cannot allow half-days; otherType needs balanceTypeId; banked types need baseDays; tiered pay needs tiers',
};

const LeaveTypeConfigSchema = z.object(leaveTypeConfigFields);

export const CreateLeaveTypeSchema = z
  .object({
    code: z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'uppercase code, e.g. ANNUAL'),
    name: LocalizedStringSchema,
    ...leaveTypeConfigFields,
  })
  .strict()
  .refine(leaveTypeCoherent, leaveTypeError);
export type CreateLeaveType = z.infer<typeof CreateLeaveTypeSchema>;

/** Partial config update; the SERVICE re-validates coherence on the merged result. */
export const UpdateLeaveTypeSchema = LeaveTypeConfigSchema.partial()
  .extend({
    name: LocalizedStringSchema.optional(),
    active: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateLeaveType = z.infer<typeof UpdateLeaveTypeSchema>;

export interface LeaveTypeDto {
  id: string;
  code: string;
  name: { ar: string; en: string };
  payModel: LeavePayModel;
  payTiers: LeavePayTier[];
  balanceSource: LeaveBalanceSource;
  balanceTypeId: string | null;
  baseDays: number | null;
  entitlementSteps: LeaveEntitlementStep[];
  ageStepAge: number | null;
  ageStepDays: number | null;
  minServiceMonths: number;
  gender: 'male' | 'female' | null;
  maxPerService: number | null;
  allowedDuringProbation: boolean;
  minNoticeDays: number;
  maxConsecutiveDays: number | null;
  maxPerYearDays: number | null;
  maxPerOccasionDays: number | null;
  backdateDays: number;
  requiresAttachment: boolean;
  attachmentStage: LeaveAttachmentStage;
  allowHalfDay: boolean;
  countingMode: LeaveCountingMode;
  affectsEmployeeStatus: boolean;
  statusThresholdDays: number | null;
  approvalShape: LeaveApprovalShape;
  carryoverMode: LeaveCarryoverMode;
  carryoverCapDays: number | null;
  carryoverExpiryMonths: number | null;
  negativeCapDays: number;
  active: boolean;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Work calendar (shared with future Attendance) ───────────────────────────

export const CreateHolidaySchema = z
  .object({ date: z.coerce.date(), name: LocalizedStringSchema })
  .strict();
export type CreateHoliday = z.infer<typeof CreateHolidaySchema>;

export const UpdateHolidaySchema = z
  .object({ date: z.coerce.date().optional(), name: LocalizedStringSchema.optional(), version: z.number().int().min(0) })
  .strict();
export type UpdateHoliday = z.infer<typeof UpdateHolidaySchema>;

export interface HolidayDto {
  id: string;
  /** Date-only ISO (yyyy-mm-dd) on the Africa/Cairo business calendar (R10). */
  date: string;
  name: { ar: string; en: string };
  version: number;
}

export const WorkCalendarQuerySchema = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .strict()
  .refine((v) => v.from <= v.to, { message: 'from must be ≤ to', path: ['to'] });
export type WorkCalendarQuery = z.infer<typeof WorkCalendarQuerySchema>;

export interface WorkCalendarDto {
  /** ISO weekday numbers that are weekly rest days (Mon=1 … Sun=7); Egypt default Fri+Sat = [5,6]. */
  weekendDays: number[];
  holidays: HolidayDto[];
}

// ── Leave requests (§3 — final status enum C3) ──────────────────────────────

export const LEAVE_REQUEST_STATUSES = [
  'pendingManager',
  'pendingHr',
  'approved',
  'active',
  'completed',
  'rejected',
  'cancelled',
] as const;
export const LeaveRequestStatusSchema = z.enum(LEAVE_REQUEST_STATUSES);
export type LeaveRequestStatus = z.infer<typeof LeaveRequestStatusSchema>;

export const LEAVE_PENDING_STATUSES = ['pendingManager', 'pendingHr'] as const;
/** Requests that occupy days (overlap checks + reservation): everything not terminalized. */
export const LEAVE_BLOCKING_STATUSES = ['pendingManager', 'pendingHr', 'approved', 'active'] as const;

export const CreateLeaveRequestSchema = z
  .object({
    /** Only with `leave.requestForOthers`; omitted = the caller's own employee record. */
    employeeId: objectId().optional(),
    typeId: objectId(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    /** First day is a half-day (type must allow half-days — R13 keeps these off status-affecting types). */
    halfDayStart: z.boolean().default(false),
    /** Last day is a half-day. */
    halfDayEnd: z.boolean().default(false),
    reason: z.string().max(1000).optional(),
  })
  .strict()
  .refine((v) => v.startDate <= v.endDate, { message: 'startDate must be ≤ endDate', path: ['endDate'] })
  .refine((v) => !(v.halfDayStart && v.halfDayEnd && v.startDate.getTime() === v.endDate.getTime()), {
    message: 'a single day cannot be two half-days',
    path: ['halfDayEnd'],
  });
export type CreateLeaveRequest = z.infer<typeof CreateLeaveRequestSchema>;

export const DecideLeaveRequestSchema = z
  .object({ comment: z.string().max(1000).optional(), version: z.number().int().min(0) })
  .strict();
export type DecideLeaveRequest = z.infer<typeof DecideLeaveRequestSchema>;

export const CancelLeaveRequestSchema = z
  .object({ reason: z.string().max(500).optional(), version: z.number().int().min(0) })
  .strict();
export type CancelLeaveRequest = z.infer<typeof CancelLeaveRequestSchema>;

export const ReturnLeaveRequestSchema = z
  .object({ actualReturnDate: z.coerce.date(), version: z.number().int().min(0) })
  .strict();
export type ReturnLeaveRequest = z.infer<typeof ReturnLeaveRequestSchema>;

export const ListLeaveRequestsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: LeaveRequestStatusSchema.optional(),
    typeId: objectId().optional(),
    employeeId: objectId().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    sortBy: z.enum(['createdAt', 'startDate']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .strict();
export type ListLeaveRequestsQuery = z.infer<typeof ListLeaveRequestsQuerySchema>;

export const LeaveCalendarQuerySchema = WorkCalendarQuerySchema;
export type LeaveCalendarQuery = WorkCalendarQuery;

/** One decided approval step — the ADR-011 workflow-instance history shape. */
export interface LeaveApprovalStepDto {
  step: 'manager' | 'hr';
  deciderUserId: string;
  decision: 'approved' | 'rejected';
  comment: string | null;
  at: string;
}

/** R5 — outcome of driving leaveStart/leaveEnd for status-affecting types. */
export const LEAVE_STATUS_DRIVE_OUTCOMES = ['pending', 'applied', 'failed', 'skipped'] as const;
export type LeaveStatusDriveOutcome = (typeof LEAVE_STATUS_DRIVE_OUTCOMES)[number];

export interface LeaveRequestDto {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchId: string | null;
  departmentId: string | null;
  sectionId: string | null;
  typeId: string;
  typeCode: string;
  status: LeaveRequestStatus;
  startDate: string;
  endDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  /** Frozen at submission (R7): calendar/type edits never recompute a request. */
  days: number;
  reason: string | null;
  attachments: string[];
  approvals: LeaveApprovalStepDto[];
  /** The step the request is waiting on, when pending. */
  pendingStep: 'manager' | 'hr' | null;
  actualReturnDate: string | null;
  statusDriveOutcome: LeaveStatusDriveOutcome | null;
  cancelReason: string | null;
  createdBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Balances & ledger (§4) ──────────────────────────────────────────────────

export const LEAVE_LEDGER_KINDS = [
  'grant',
  'carryover',
  'reserve',
  'consume',
  'release',
  'adjust',
  'expire',
] as const;
export const LeaveLedgerKindSchema = z.enum(LEAVE_LEDGER_KINDS);
export type LeaveLedgerKind = z.infer<typeof LeaveLedgerKindSchema>;

/** Frozen Payroll read contract (R7): pay split of consumed days, snapshotted at consumption. */
export interface LeavePaidBreakdownDto {
  days: number;
  payRate: number;
}

export interface LeaveLedgerEntryDto {
  id: string;
  employeeId: string;
  /** What the absence was (reporting). */
  typeId: string;
  /** Whose balance it hits (accounting, R11); null for untracked consumption. */
  balanceTypeId: string | null;
  year: number;
  kind: LeaveLedgerKind;
  days: number;
  requestId: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  paidBreakdown: LeavePaidBreakdownDto[];
  note: string | null;
  by: string | null;
  createdAt: string;
}

export interface LeaveBalanceDto {
  typeId: string;
  typeCode: string;
  year: number;
  granted: number;
  carriedOver: number;
  adjusted: number;
  reserved: number;
  consumed: number;
  available: number;
}

export const AdjustLeaveBalanceSchema = z
  .object({
    typeId: objectId(),
    year: z.number().int().min(2000).max(2100),
    /** Signed, half-day granularity. */
    days: z
      .number()
      .refine((d) => d !== 0 && Number.isInteger(d * 2), { message: 'non-zero, in half-day steps' }),
    reason: z.string().min(3).max(500),
  })
  .strict();
export type AdjustLeaveBalance = z.infer<typeof AdjustLeaveBalanceSchema>;

export const LeaveBalancesQuerySchema = z
  .object({ year: z.coerce.number().int().min(2000).max(2100).optional() })
  .strict();
export type LeaveBalancesQuery = z.infer<typeof LeaveBalancesQuerySchema>;

export const LeaveLedgerQuerySchema = z
  .object({
    typeId: objectId().optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type LeaveLedgerQuery = z.infer<typeof LeaveLedgerQuerySchema>;

// ── Eligibility preflight (powers live wizard validation) ───────────────────

export const LeaveEligibilityQuerySchema = z
  .object({
    typeId: objectId(),
    start: z.coerce.date(),
    end: z.coerce.date(),
    halfDayStart: z.coerce.boolean().optional(),
    halfDayEnd: z.coerce.boolean().optional(),
  })
  .strict()
  .refine((v) => v.start <= v.end, { message: 'start must be ≤ end', path: ['end'] });
export type LeaveEligibilityQuery = z.infer<typeof LeaveEligibilityQuerySchema>;

export interface LeaveRuleViolationDto {
  rule: string;
  /** Hard rules always block; soft rules block self-service but HR on-behalf may override (L8). */
  severity: 'hard' | 'soft';
  detail: string | null;
}

export interface LeaveEligibilityDto {
  days: number;
  /** Balance figures for banked sources; null for untracked types. */
  available: number | null;
  balanceAfter: number | null;
  violations: LeaveRuleViolationDto[];
}

/** Migration §12 ③ — an employee left `onLeave` by manual actions, with no leave request. */
export interface UnreconciledLeaveDto {
  employeeId: string;
  code: string;
  fullNameAr: string;
}

// ── Events (ADR-008 `<module>.<entity>.<event>`) ────────────────────────────

export const HrLeaveEvents = {
  Requested: 'hr.leave.requested',
  Decided: 'hr.leave.decided',
  Cancelled: 'hr.leave.cancelled',
  Started: 'hr.leave.started',
  Ended: 'hr.leave.ended',
  BalanceAdjusted: 'hr.leave.balanceAdjusted',
} as const;
export type HrLeaveEventName = (typeof HrLeaveEvents)[keyof typeof HrLeaveEvents];

export const LeaveRequestedPayloadV1 = z.object({
  requestId: objectId(),
  employeeId: objectId(),
  code: z.string(),
  typeId: objectId(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

export const LeaveDecidedPayloadV1 = z.object({
  requestId: objectId(),
  employeeId: objectId(),
  step: z.enum(['manager', 'hr']),
  decision: z.enum(['approved', 'rejected']),
});

/** The Attendance feed: dated absence span with half-day detail. */
export const LeaveSpanPayloadV1 = z.object({
  requestId: objectId(),
  employeeId: objectId(),
  code: z.string(),
  typeId: objectId(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  halfDayStart: z.boolean(),
  halfDayEnd: z.boolean(),
});

// ── Notification templates (§9) ─────────────────────────────────────────────

/** Files-service category leave attachments (medical certificates, …) live under. */
export const LEAVE_ATTACHMENTS_FILE_CATEGORY = 'hr-leave-attachments';

// ── Declared settings (C2 — calendar facts are org-level configuration) ─────

export const HrLeaveSettingKeys = {
  /** ISO weekdays (Mon=1…Sun=7) that are weekly rest days. Egypt default: [5, 6] (Fri+Sat). */
  WeekendDays: 'hr.workCalendar.weekendDays',
  /** Days a request may sit pending before the daily reminder nudges its approver. */
  ApprovalReminderDays: 'hr.leave.approvalReminderDays',
  /** Entitlement service-years count TOTAL employed service across employment periods (§4). */
  ServiceAcrossPeriods: 'hr.leave.serviceAcrossPeriods',
} as const;

export const HrLeaveTemplates = {
  RequestSubmitted: 'hr.leave.requestSubmitted',
  RequestApproved: 'hr.leave.requestApproved',
  RequestRejected: 'hr.leave.requestRejected',
  RequestCancelled: 'hr.leave.requestCancelled',
  ApprovalReminder: 'hr.leave.approvalReminder',
  ReturnDue: 'hr.leave.returnDue',
  LongLeaveStarted: 'hr.leave.longLeaveStarted',
  BalanceAdjusted: 'hr.leave.balanceAdjusted',
} as const;
export type HrLeaveTemplateKey = (typeof HrLeaveTemplates)[keyof typeof HrLeaveTemplates];
