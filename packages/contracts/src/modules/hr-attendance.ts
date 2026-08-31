// HR / Attendance — contracts for the frozen design (docs/12-planning/attendance-module-design.md,
// v1.1, decisions D1–D11 settled by the owner on 2026-08-12).
//
// Attendance answers one question per employee per day: were they where they were meant to be,
// for as long as they were meant to be? These contracts carry the vocabulary of that answer —
// QUANTITIES AND FACTS ONLY. Nothing here prices a minute: lateness tiers, overtime multipliers
// and every other monetary rule belong to Payroll (D4/D5), which reads frozen daily rows through
// the §15.1 feed contract and never re-derives attendance from punches (D10).
import { z } from 'zod';
import { objectId, PaginationQuerySchema, type LocalizedString } from '../common/index.js';
// Provenance is one vocabulary across HR, declared where employment lives (P-HR-22, D-JOB-4).
// One direction only: employment knows nothing about attendance.
import { type JobValueSource } from './hr-employee.js';

// ── Closed vocabularies ─────────────────────────────────────────────────────

/** One enum, one value per day (§2) — no parallel set of booleans. */
export const ATTENDANCE_DAY_STATUSES = [
  'present',
  'late',
  'earlyLeave',
  'lateAndEarly',
  'absent',
  'onLeave',
  'weekend',
  'holiday',
  'incomplete',
  'dayOff',
] as const;
export const AttendanceDayStatusSchema = z.enum(ATTENDANCE_DAY_STATUSES);
export type AttendanceDayStatus = z.infer<typeof AttendanceDayStatusSchema>;

/**
 * Where a punch came from (D1). `web` is declared because the design reserves it behind
 * `hr.attendance.selfPunchEnabled` (default OFF) — recording it is refused while the setting is
 * off, so the enum value exists before any surface produces it.
 */
/**
 * Where a punch came from (D12.3, D12.4 — AT-D2).
 *
 * `regularization` IS ITS OWN SOURCE, and separating it from `manual` is the whole of this
 * change. An approved correction travels request → manager → HR before a single minute is
 * written; a `manual` row is somebody typing a time. Until AT-D2 both wrote `manual`, so the two
 * were INDISTINGUISHABLE in the data and raised the same day flag — and under a device-first
 * model (D12.1) that matters, because the only legitimate non-device punch is an approved
 * correction. A reader could not tell the one from the other.
 *
 * NOTHING OUTSIDE THE REGULARIZATION SERVICE MAY CLAIM IT. `RecordPunchSchema` still accepts only
 * `manual` and `web`, so a caller cannot dress a hand-entry up as an approved decision — the
 * source is written by the code that owns the approval, never supplied by a request.
 */
export const ATTENDANCE_PUNCH_SOURCES = ['device', 'manual', 'regularization', 'web'] as const;
export const AttendancePunchSourceSchema = z.enum(ATTENDANCE_PUNCH_SOURCES);
export type AttendancePunchSource = z.infer<typeof AttendancePunchSourceSchema>;

/** Devices that only log presence report `unknown`; the engine pairs first-in / last-out. */
export const ATTENDANCE_PUNCH_DIRECTIONS = ['in', 'out', 'unknown'] as const;
export const AttendancePunchDirectionSchema = z.enum(ATTENDANCE_PUNCH_DIRECTIONS);
export type AttendancePunchDirection = z.infer<typeof AttendancePunchDirectionSchema>;

/**
 * Signals for review, never inputs to arithmetic (§15.1). Closed vocabulary, extended only by
 * contract change: `crossBranchPunch` (D8 — a punch's branch differed from the employee's),
 * `manualPunch` (at least one punch was hand-entered rather than device-recorded), and
 * `regularizedPunch` (AT-D2 — at least one punch came from an APPROVED correction).
 *
 * THE THIRD IS A CONTRACT CHANGE MADE ON PURPOSE, by the rule this comment already stated. Before
 * AT-D2 an approved two-step correction raised `manualPunch`, so a day fixed through manager and
 * HR approval looked on review exactly like a day somebody typed by hand. They are not the same
 * signal and a reviewer should not have to guess which one they are looking at.
 */
export const ATTENDANCE_DAY_FLAGS = [
  'crossBranchPunch',
  'manualPunch',
  'regularizedPunch',
] as const;
export const AttendanceDayFlagSchema = z.enum(ATTENDANCE_DAY_FLAGS);
export type AttendanceDayFlag = z.infer<typeof AttendanceDayFlagSchema>;

// ── Shifts (D2) ─────────────────────────────────────────────────────────────

/** `HH:mm`, 24-hour. Times are Cairo wall-clock; the date they attach to is the work date (D3). */
const timeOfDay = () => z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:mm');

const ShiftConfigSchema = z.object({
  name: z.object({ ar: z.string().min(1).max(200), en: z.string().min(1).max(200) }).strict(),
  startTime: timeOfDay(),
  endTime: timeOfDay(),
  /** A night shift: `endTime` falls on the calendar day after `startTime`'s (D3). */
  crossesMidnight: z.boolean().default(false),
  breakMinutes: z.number().int().min(0).max(480).default(0),
  graceInMinutes: z.number().int().min(0).max(240).default(0),
  graceOutMinutes: z.number().int().min(0).max(240).default(0),
  /**
   * Thresholds carried as shift CONFIG for downstream interpretation (half/full-day rules are a
   * pricing concern). The v1 engine records minutes and does not classify against these.
   */
  minMinutesForFullDay: z.number().int().min(0).max(1440).default(0),
  minMinutesForHalfDay: z.number().int().min(0).max(1440).default(0),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export const CreateShiftSchema = ShiftConfigSchema.extend({
  /** Uppercase mnemonic (`GENERAL`, `NIGHT-A`) — unique, referenced by assignments forever. */
  code: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[A-Z][A-Z0-9-]*$/, 'expected an uppercase code'),
})
  .strict()
  .superRefine((v, ctx) => {
    if (!v.crossesMidnight && v.endTime <= v.startTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'a same-day shift must end after it starts (crossesMidnight for night shifts)',
      });
    }
    if (v.crossesMidnight && v.endTime >= v.startTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['crossesMidnight'],
        message: 'a midnight-crossing shift must end before its start time on the next day',
      });
    }
  });
export type CreateShift = z.infer<typeof CreateShiftSchema>;

/** Same coherence rules re-checked in the service against the MERGED result (leave-types idiom). */
export const UpdateShiftSchema = ShiftConfigSchema.partial()
  .extend({ version: z.number().int().min(0) })
  .strict();
export type UpdateShift = z.infer<typeof UpdateShiftSchema>;

export interface ShiftDto {
  id: string;
  code: string;
  name: LocalizedString;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
  graceInMinutes: number;
  graceOutMinutes: number;
  minMinutesForFullDay: number;
  minMinutesForHalfDay: number;
  active: boolean;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Shift assignments (D2) ──────────────────────────────────────────────────

export const CreateShiftAssignmentSchema = z
  .object({
    employeeId: objectId(),
    shiftId: objectId(),
    /** Date-only, Cairo calendar. */
    fromDate: z.coerce.date(),
    /**
     * Omitted/null = the open interval (the current assignment; one per employee). A bounded
     * interval — down to a single day — is an override that wins over the open one (D2).
     */
    toDate: z.coerce.date().nullish(),
    note: z.string().max(500).optional(),
  })
  .strict()
  .refine((v) => v.toDate == null || v.toDate >= v.fromDate, {
    path: ['toDate'],
    message: 'toDate must be on or after fromDate',
  });
export type CreateShiftAssignment = z.infer<typeof CreateShiftAssignmentSchema>;

export const ListShiftAssignmentsQuerySchema = PaginationQuerySchema.extend({
  employeeId: objectId().optional(),
  shiftId: objectId().optional(),
  /** Assignments whose interval covers this date. */
  activeOn: z.coerce.date().optional(),
}).strict();
export type ListShiftAssignmentsQuery = z.infer<typeof ListShiftAssignmentsQuerySchema>;

export interface ShiftAssignmentDto {
  id: string;
  employeeId: string;
  shiftId: string;
  fromDate: string;
  toDate: string | null;
  note: string | null;
  branchId: string | null;
  /**
   * Whether the shift chosen here is one the employee's job lists, or a departure from it
   * (P-HR-22, D-JOB-4). DERIVED ON THE SERVER at creation — never sent by the caller, because a
   * caller that could declare its own provenance could declare a departure to be compliance.
   *
   * A job with an empty candidate list produces `manual` for everyone, which is correct: there is
   * no default to follow.
   */
  source: JobValueSource;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Punches (D1, D9) ────────────────────────────────────────────────────────

export const RecordPunchSchema = z
  .object({
    employeeId: objectId(),
    at: z.coerce.date(),
    direction: AttendancePunchDirectionSchema.default('unknown'),
    /**
     * `manual` is what an HR hand-entry records. `web` is refused while
     * `hr.attendance.selfPunchEnabled` is off (D1); `device` rows arrive via import only, and
     * `regularization` is written ONLY by the service that owns the approval (D12.3) — a request
     * may not claim it, or a hand-entry could wear the authority of a decision nobody took.
     */
    source: z.enum(['manual', 'web']).default('manual'),
    /** Where the punch physically happened (D8); defaults to the employee's branch. */
    branchIdAtPunch: objectId().optional(),
    /** D9: a wrong punch is never edited — this record supersedes the referenced one. */
    supersedesId: objectId().optional(),
    note: z.string().max(500).optional(),
  })
  .strict();
export type RecordPunch = z.infer<typeof RecordPunchSchema>;

/**
 * One device row, carrying EXACTLY ONE identity (AT-D3).
 *
 * `employeeNumber` is the permanent ECMS identity — the displayed `code` changes on transfer and
 * device exports outlive transfers, so the number is what a hand-built or legacy batch names.
 *
 * `enrollmentNo` is what a real device reports: its own enrolment id, resolved through the
 * `{deviceId, enrollmentNo}` mapping. A relay forwarding a device push cannot send an
 * `employeeNumber`, because the device has never been told one.
 *
 * EXACTLY ONE, never both and never neither. Accepting both would create a row with two answers
 * to «who is this», and the day they disagreed the importer would have to pick one silently —
 * which is how a punch ends up on the wrong person's month with nothing recording the choice.
 */
export const ImportPunchRowSchema = z
  .object({
    employeeNumber: z.string().trim().min(1).max(20).optional(),
    enrollmentNo: z.string().trim().min(1).max(64).optional(),
    at: z.coerce.date(),
    direction: AttendancePunchDirectionSchema.default('unknown'),
    deviceId: z.string().trim().min(1).max(100),
  })
  .strict()
  .refine((v) => (v.employeeNumber === undefined) !== (v.enrollmentNo === undefined), {
    message: 'a row carries exactly one of employeeNumber or enrollmentNo',
    path: ['employeeNumber'],
  });
export type ImportPunchRow = z.infer<typeof ImportPunchRowSchema>;

export const ImportPunchesSchema = z
  .object({
    rows: z.array(ImportPunchRowSchema).min(1).max(5000),
    /** The uploaded device artefact this batch came from, when one was stored. */
    fileId: objectId().optional(),
  })
  .strict();
export type ImportPunches = z.infer<typeof ImportPunchesSchema>;

export const ListPunchesQuerySchema = PaginationQuerySchema.extend({
  employeeId: objectId().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  source: AttendancePunchSourceSchema.optional(),
  importBatchId: z.string().trim().min(1).max(100).optional(),
}).strict();
export type ListPunchesQuery = z.infer<typeof ListPunchesQuerySchema>;

export interface AttendancePunchDto {
  id: string;
  employeeId: string;
  at: string;
  direction: AttendancePunchDirection;
  source: AttendancePunchSource;
  deviceId: string | null;
  /** D12.7 — where the punch physically happened: the DEVICE's branch on an imported row. */
  branchIdAtPunch: string | null;
  /** The employee's branch at the moment of the punch — the reader's axis (AT-D1). */
  employeeBranchId: string | null;
  importBatchId: string | null;
  /** D9: set when a later record superseded this one; the row itself never changes. */
  supersededBy: string | null;
  note: string | null;
  recordedBy: string | null;
  createdAt: string;
}

/** Import outcome — quarantined rows are REPORTED, never silently dropped (§13). */
export interface ImportPunchesResultDto {
  batchId: string;
  imported: number;
  /** Rows already present (unique {deviceId, at, employeeId}) — idempotent re-import. */
  duplicates: number;
  quarantined: { index: number; reason: string }[];
}

// ── Day records (§2, §4) ────────────────────────────────────────────────────

export const ListAttendanceDaysQuerySchema = PaginationQuerySchema.extend({
  from: z.coerce.date(),
  to: z.coerce.date(),
  employeeId: objectId().optional(),
  branchId: objectId().optional(),
  /** Day rows carry no section; the server resolves the section's employees (AT-6 daily sheet). */
  sectionId: objectId().optional(),
  status: AttendanceDayStatusSchema.optional(),
}).strict();
export type ListAttendanceDaysQuery = z.infer<typeof ListAttendanceDaysQuerySchema>;

/**
 * The AT-6 CSV export — the §15.1 columns plus the two display labels, read from the day rows
 * (frozen and live alike), NEVER re-derived from punches. Range-capped like recompute: an export
 * is a report, not a dump.
 */
export const ExportAttendanceQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    employeeId: objectId().optional(),
    branchId: objectId().optional(),
    sectionId: objectId().optional(),
    status: AttendanceDayStatusSchema.optional(),
  })
  .strict()
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'to must be on or after from' })
  .refine((v) => (v.to.getTime() - v.from.getTime()) / 86_400_000 <= 92, {
    path: ['to'],
    message: 'the export window is capped at 92 days',
  });
export type ExportAttendanceQuery = z.infer<typeof ExportAttendanceQuerySchema>;

/** Range-capped: recomputation is a repair tool, not a batch job (the scheduler owns bulk). */
export const RecomputeAttendanceDaysSchema = z
  .object({
    employeeId: objectId().optional(),
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .strict()
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'to must be on or after from' })
  .refine((v) => (v.to.getTime() - v.from.getTime()) / 86_400_000 <= 92, {
    path: ['to'],
    message: 'recompute window is capped at 92 days',
  });
export type RecomputeAttendanceDays = z.infer<typeof RecomputeAttendanceDaysSchema>;

/**
 * One derived answer for one employee on one work date — the row shape behind the §15.1
 * Attendance → Payroll feed contract. `frozenAt` is stamped by the freeze (AT-4); until then it
 * is null and the row is recomputable.
 */
export interface AttendanceDayDto {
  id: string;
  employeeId: string;
  /** Keyed by SHIFT START (D3): an overnight shift lands whole in its start date. */
  workDate: string;
  status: AttendanceDayStatus;
  shiftId: string | null;
  firstInAt: string | null;
  lastOutAt: string | null;
  workedMinutes: number;
  /** Raw minutes past grace (D4) — priced by Payroll, never here. */
  lateMinutes: number;
  earlyLeaveMinutes: number;
  /** What the engine derived; approval (AT-5) releases some of it into `approvedOvertimeMinutes`. */
  overtimeMinutes: number;
  /** Only this number ever reaches the Payroll feed (D5). */
  approvedOvertimeMinutes: number;
  /** The covering leave request when `status = onLeave`; the paid split stays in Leave (R7). */
  leaveId: string | null;
  flags: AttendanceDayFlag[];
  /** The EMPLOYEE's branch (D8/ADR-015) — the payroll/GL axis, never the punch's. */
  branchId: string;
  computedAt: string;
  frozenAt: string | null;
  /** Optimistic-concurrency token for the one client write the row accepts: overtime approval. */
  version: number;
  /** Display labels, enriched on the scoped list reads (AT-6) — never stored on the row. */
  employeeCode?: string;
  employeeName?: string;
}

// ── Regularizations (§7, D7 as ruled: TWO approval steps) ───────────────────

/**
 * The Leave chain, deliberately: `pendingManager → pendingHr` is the same pair
 * `LEAVE_REQUEST_STATUSES` runs, so the approval machinery and its tests carry over. `draft` is
 * declared for the lifecycle's sake but the API creates SUBMITTED requests — the composing state
 * lives in the client, exactly as it does for leave. An employee with no manager submits straight
 * to `pendingHr` (the Leave precedent for the missing-manager deadlock).
 */
export const ATTENDANCE_REGULARIZATION_STATUSES = [
  'draft',
  'pendingManager',
  'pendingHr',
  'approved',
  'rejected',
  'cancelled',
] as const;
export const AttendanceRegularizationStatusSchema = z.enum(ATTENDANCE_REGULARIZATION_STATUSES);
export type AttendanceRegularizationStatus = z.infer<typeof AttendanceRegularizationStatusSchema>;

/**
 * A regularization proposes the day's PUNCH TRUTH, not its derived numbers (ADR-027): on final
 * approval the proposal becomes `regularization` punches (AT-D2), the old punches are superseded,
 * and the day is recomputed — never hand-edited. `employeeId` is for the D7 HR direct edit only:
 * a caller holding `attendance.decideRegularization` files for someone else and the request applies
 * immediately, with the mandatory reason audited.
 */
export const CreateAttendanceRegularizationSchema = z
  .object({
    workDate: z.coerce.date(),
    proposedInAt: z.coerce.date(),
    proposedOutAt: z.coerce.date(),
    reason: z.string().trim().min(3).max(500),
    /** HR direct edit (D7): omit to file for yourself. */
    employeeId: objectId().optional(),
  })
  .strict()
  .refine((v) => v.proposedOutAt > v.proposedInAt, {
    path: ['proposedOutAt'],
    message: 'the proposed out must be after the proposed in',
  });
export type CreateAttendanceRegularization = z.infer<typeof CreateAttendanceRegularizationSchema>;

export const DecideAttendanceRegularizationSchema = z
  .object({
    verdict: z.enum(['approve', 'reject']),
    comment: z.string().max(500).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type DecideAttendanceRegularization = z.infer<
  typeof DecideAttendanceRegularizationSchema
>;

export const CancelAttendanceRegularizationSchema = z
  .object({ version: z.number().int().min(0) })
  .strict();
export type CancelAttendanceRegularization = z.infer<
  typeof CancelAttendanceRegularizationSchema
>;

export const ListAttendanceRegularizationsQuerySchema = PaginationQuerySchema.extend({
  status: AttendanceRegularizationStatusSchema.optional(),
  employeeId: objectId().optional(),
  branchId: objectId().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /**
   * The post-freeze corrections (P-HR-08) — approved after their month was closed.
   *
   * The stamp has existed since AT-5 and NOTHING could find it: no filter, no screen, no reader
   * outside this module. So a correction that landed after a freeze was recorded, left the frozen
   * row untouched exactly as designed, and then went nowhere — the one case where somebody has to
   * act by hand was the one case nobody could list.
   *
   * A filter, not a new endpoint: the organization-wide read already exists and is already behind
   * `attendance.decideRegularization`.
   *
   * NOT `z.coerce.boolean()`, and the difference is not cosmetic: `Boolean('false')` is `true`, so
   * a coerced query string makes `postFreeze=false` mean `postFreeze=true` — the filter would
   * answer the opposite of the question. Both halves are real questions here ("what needs a human"
   * and "what recomputed normally"), so the string is parsed rather than coerced. The boolean arm
   * is for a caller that already has one.
   */
  postFreeze: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
    .optional(),
}).strict();
export type ListAttendanceRegularizationsQuery = z.infer<
  typeof ListAttendanceRegularizationsQuerySchema
>;

export interface AttendanceRegularizationDto {
  id: string;
  employeeId: string;
  workDate: string;
  proposedInAt: string;
  proposedOutAt: string;
  reason: string;
  status: AttendanceRegularizationStatus;
  /**
   * Stamped at FINAL approval when the day was already frozen (§7): the frozen row was not
   * touched, and Payroll treats the approved correction as a forward adjustment — never a
   * restatement.
   */
  postFreeze: boolean;
  /** D7 HR direct edit — filed and applied by HR in one act, with the mandatory reason. */
  direct: boolean;
  managerDecidedBy: string | null;
  managerDecidedAt: string | null;
  managerComment: string | null;
  hrDecidedBy: string | null;
  hrDecidedAt: string | null;
  hrComment: string | null;
  branchId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Display labels, enriched on the list reads (AT-6) — never stored on the row. */
  employeeCode?: string;
  employeeName?: string;
}

// ── Overtime approval (D5) ──────────────────────────────────────────────────

/**
 * QUANTITY RELEASE ONLY. The ceiling — never above the derived `overtimeMinutes` — is enforced
 * server-side against the day record; nothing here knows what a minute is worth. Pricing is
 * Payroll's: the approved figure crosses as a QUANTITY for a `perMinute` pay item (PY-4), and no
 * overtime premium or multiplier exists to apply to it.
 */
export const ApproveOvertimeSchema = z
  .object({
    approvedMinutes: z.number().int().min(0).max(1440),
    version: z.number().int().min(0),
  })
  .strict();
export type ApproveOvertime = z.infer<typeof ApproveOvertimeSchema>;

// ── Notification templates (§9 — the three AT-5 sends) ─────────────────────

export const HrAttendanceTemplates = {
  RegularizationSubmitted: 'hr.attendance.regularizationSubmitted',
  RegularizationDecided: 'hr.attendance.regularizationDecided',
  OvertimeApproved: 'hr.attendance.overtimeApproved',
  /**
   * The two sweep notices (§9, AT-7). Both are INFORMATIVE: they tell the employee what the
   * engine recorded and how to correct it. Neither carries a consequence — attendance records
   * facts, and no disciplinary step follows from one automatically.
   */
  AbsenceRecorded: 'hr.attendance.absenceRecorded',
  MissingCheckout: 'hr.attendance.missingCheckout',
} as const;
export type HrAttendanceTemplateKey =
  (typeof HrAttendanceTemplates)[keyof typeof HrAttendanceTemplates];

// ── Events (§8) ─────────────────────────────────────────────────────────────

export const HrAttendanceEvents = {
  PunchRecorded: 'hr.attendance.punchRecorded',
  PunchesImported: 'hr.attendance.punchesImported',
  DayComputed: 'hr.attendance.dayComputed',
  DayAbsent: 'hr.attendance.dayAbsent',
  PeriodFrozen: 'hr.attendance.periodFrozen',
  RegularizationRequested: 'hr.attendance.regularizationRequested',
  RegularizationDecided: 'hr.attendance.regularizationDecided',
  OvertimeApproved: 'hr.attendance.overtimeApproved',
} as const;
export type HrAttendanceEventName = (typeof HrAttendanceEvents)[keyof typeof HrAttendanceEvents];

export const AttendancePunchRecordedPayloadV1 = z.object({
  punchId: objectId(),
  employeeId: objectId(),
  at: z.string(),
  direction: AttendancePunchDirectionSchema,
  source: AttendancePunchSourceSchema,
});

export const AttendancePunchesImportedPayloadV1 = z.object({
  batchId: z.string(),
  imported: z.number().int().min(0),
  duplicates: z.number().int().min(0),
  quarantined: z.number().int().min(0),
});

export const AttendanceDayPayloadV1 = z.object({
  employeeId: objectId(),
  workDate: z.string(),
  status: AttendanceDayStatusSchema,
  branchId: objectId(),
});

export const AttendancePeriodFrozenPayloadV1 = z.object({
  /**
   * `YYYY-MM`, Cairo calendar month. A plain string here — the freeze seam is what validates
   * the shape; the catalogue's sample generator only knows how to invent unconstrained strings.
   */
  period: z.string(),
  from: z.string(),
  to: z.string(),
  /** Rows newly stamped by THIS freeze — 0 never publishes (an idempotent re-freeze is silent). */
  frozenRows: z.number().int().min(0),
});

export const AttendanceRegularizationRequestedPayloadV1 = z.object({
  regularizationId: objectId(),
  employeeId: objectId(),
  workDate: z.string(),
  status: AttendanceRegularizationStatusSchema,
});

export const AttendanceRegularizationDecidedPayloadV1 = z.object({
  regularizationId: objectId(),
  employeeId: objectId(),
  workDate: z.string(),
  step: z.enum(['manager', 'hr']),
  verdict: z.enum(['approve', 'reject']),
  status: AttendanceRegularizationStatusSchema,
  /** True when the correction landed on a frozen day and flows forward as an adjustment (§7). */
  postFreeze: z.boolean(),
});

export const AttendanceOvertimeApprovedPayloadV1 = z.object({
  employeeId: objectId(),
  workDate: z.string(),
  approvedMinutes: z.number().int().min(0),
  branchId: objectId(),
});

// ── The Attendance → Payroll feed contract (§15.1, D10 — owner-approved, binding) ──

/**
 * The twelve fields, BY NAME AND IN ORDER. This tuple is the contract's spine: the feed rows
 * carry exactly these keys — no id, no computedAt, no first/last punch instants, and above all
 * no unapproved `overtimeMinutes` — and a test holds the row shape to this list.
 */
export const ATTENDANCE_FEED_FIELDS = [
  'employeeId',
  'workDate',
  'status',
  'shiftId',
  'workedMinutes',
  'lateMinutes',
  'earlyLeaveMinutes',
  'approvedOvertimeMinutes',
  'leaveId',
  'branchId',
  'flags',
  'frozenAt',
] as const;

/**
 * One frozen daily row as Payroll reads it. Quantities and classification only: the paid split
 * of an `onLeave` day stays in Leave's `paidBreakdown` (reached via `leaveId`), and every minute
 * here is a fact, never a price.
 */
export const AttendanceFeedRowSchema = z
  .object({
    employeeId: objectId(),
    /** `YYYY-MM-DD`, keyed by shift start (D3). */
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: AttendanceDayStatusSchema,
    shiftId: objectId().nullable(),
    workedMinutes: z.number().int().min(0),
    lateMinutes: z.number().int().min(0),
    earlyLeaveMinutes: z.number().int().min(0),
    /** Only what the D5 approval released — the derived remainder never reaches this feed. */
    approvedOvertimeMinutes: z.number().int().min(0),
    leaveId: objectId().nullable(),
    branchId: objectId(),
    flags: z.array(AttendanceDayFlagSchema),
    /** ISO instant — always set: an unfrozen row never leaves the module. */
    frozenAt: z.string(),
  })
  .strict();
export type AttendanceFeedRow = z.infer<typeof AttendanceFeedRowSchema>;

// ── Setting keys (§9, `hr.attendance.*` per D-PR-01) ────────────────────────

export const HrAttendanceSettingKeys = {
  /** D1 — the web self-punch gate, default OFF. Recording a `web` punch is refused while off. */
  SelfPunchEnabled: 'hr.attendance.selfPunchEnabled',
  /** Cairo hour (0–23) at which the nightly compute for the previous day runs. */
  AutoComputeHour: 'hr.attendance.autoComputeHour',
  /**
   * D5, default TRUE: derived overtime waits for an explicit approval. When switched off the
   * engine releases the derived minutes automatically — a decision to spend money without a
   * decision, which is why the default says no.
   */
  OvertimeRequiresApproval: 'hr.attendance.overtimeRequiresApproval',
  /**
   * §9, default TRUE: the daily sweep tells an employee their day was recorded as an absence, so
   * a wrong one can be regularized while the facts are still fresh. Switching it off silences the
   * notice only — the day record itself is unaffected either way.
   */
  AbsenceNotify: 'hr.attendance.absenceNotify',
} as const;

// ── Punch devices (D12.5, D12.7 — AT-D1) ────────────────────────────────────

/**
 * A punch device is a REAL THING IN A REAL PLACE, and until AT-D1 it was a string.
 *
 * `deviceId` lived on the punch as free text: nothing said which devices exist, none could be
 * deactivated, and none could be observed to have gone quiet. D12.5 makes it an entity so that
 * those three questions have answers.
 *
 * WHAT IS DELIBERATELY ABSENT: protocol, host, port, credentials, polling interval. D12-T — how
 * rows physically reach ECMS — is OPEN, and a connection field added now would be a guess wearing
 * a schema. The registry answers «which devices exist and where are they»; it does not answer
 * «how do we talk to them», and §17.4 of the design says why the second question waits for the
 * physical unit rather than for an opinion.
 */
export const AttendanceDeviceDtoKeys = ['id', 'code', 'name', 'branchId', 'isActive'] as const;

export interface AttendanceDeviceDto {
  id: string;
  /**
   * The identifier the device itself reports on a punch row, and the key `deviceId` resolves
   * against. Uppercased on write so a device that shouts and a device that whispers are one
   * device — a punch row arriving as `hq-gate-1` must not create a second registry entry.
   */
  code: string;
  name: string;
  /**
   * D12.7 — where the device physically stands. This is what `branchIdAtPunch` records, so a
   * punch says where it HAPPENED rather than where its owner is filed.
   */
  branchId: string;
  branchName: LocalizedString | null;
  /** A retired device keeps its history and stops accepting new rows. */
  isActive: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Device codes are matched case-insensitively; this is the one normalization, applied on write. */
export const normalizeDeviceCode = (code: string): string => code.trim().toUpperCase();

export const CreateAttendanceDeviceSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    /** Required: a device that is nowhere cannot answer the question D12.7 exists to answer. */
    branchId: objectId(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type CreateAttendanceDevice = z.infer<typeof CreateAttendanceDeviceSchema>;

/**
 * `code` is absent on purpose: it is what historical punches were keyed by, so renaming it would
 * silently orphan every row that already carries the old value. A mistyped code is a new device
 * and a deactivated old one — the same stance the punch itself takes towards being wrong.
 */
export const UpdateAttendanceDeviceSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    branchId: objectId().optional(),
    isActive: z.boolean().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.branchId !== undefined ||
      v.isActive !== undefined ||
      v.note !== undefined,
    { message: 'an update must change something' },
  );
export type UpdateAttendanceDevice = z.infer<typeof UpdateAttendanceDeviceSchema>;

export const ListAttendanceDevicesQuerySchema = PaginationQuerySchema.extend({
  branchId: objectId().optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().trim().min(1).max(100).optional(),
}).strict();
export type ListAttendanceDevicesQuery = z.infer<typeof ListAttendanceDevicesQuerySchema>;

/**
 * ENROLMENT MAPPING (AT-D3, D12-T·6) — who the device thinks it saw.
 *
 * A punch device does not know an employee number. It knows the id somebody typed when they
 * enrolled a finger on it, and the confirmed export from the K40 Pro proves those two are not the
 * same namespace: its 257 enrolment ids run `1` … `702255` with prefixes 100/101/102/200/300/301/702,
 * while an ECMS `employeeNumber` is a zero-padded global sequence starting `000001`. Feeding one to
 * the other would not fail loudly — it would resolve nobody today and could resolve the WRONG
 * PERSON the day the sequence reaches six figures.
 *
 * So the mapping is a stored fact, never a derivation. `{deviceId, enrollmentNo}` is the key, per
 * DEVICE rather than global: two devices are two enrolment namespaces unless somebody proves
 * otherwise, and a per-device key that turns out to be globally unique costs nothing, while a
 * global key that turns out to be per-device silently attributes one person's punches to another.
 *
 * The device's own `Name` field is NOT identity and is not stored: 26% of rows in the confirmed
 * export carry the enrolment id in place of a name, because nobody typed one.
 */
export interface AttendanceEnrollmentDto {
  id: string;
  /** The registered device this enrolment belongs to. */
  deviceId: string;
  deviceCode: string;
  deviceName: string | null;
  /** What the device reports for this person — its own id, verbatim. */
  enrollmentNo: string;
  employeeId: string;
  employeeName: LocalizedString | null;
  employeeNumber: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Trim only. Deliberately NOT uppercased and NOT numeric-normalized, unlike a device code.
 *
 * A device code is a name a person chose for a wall, so `hq-gate-1` and `HQ-GATE-1` are one wall.
 * An enrolment number is an opaque token the device compares byte for byte: `01` and `1` may be
 * two different people, and deciding they are one would merge two employees' attendance with
 * nothing to show it happened.
 */
export const normalizeEnrollmentNo = (value: string): string => value.trim();

export const CreateAttendanceEnrollmentSchema = z
  .object({
    deviceId: objectId(),
    enrollmentNo: z.string().trim().min(1).max(64),
    employeeId: objectId(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type CreateAttendanceEnrollment = z.infer<typeof CreateAttendanceEnrollmentSchema>;

/**
 * `deviceId` and `enrollmentNo` are absent on purpose — together they are the identity this row
 * exists to assert, and editing either would silently re-point history that has already been
 * attributed. A mis-typed enrolment is deleted and re-created, not corrected in place.
 */
export const UpdateAttendanceEnrollmentSchema = z
  .object({
    employeeId: objectId().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .refine((v) => v.employeeId !== undefined || v.note !== undefined, {
    message: 'an update must change something',
  });
export type UpdateAttendanceEnrollment = z.infer<typeof UpdateAttendanceEnrollmentSchema>;

export const ListAttendanceEnrollmentsQuerySchema = PaginationQuerySchema.extend({
  deviceId: objectId().optional(),
  employeeId: objectId().optional(),
  search: z.string().trim().min(1).max(100).optional(),
}).strict();
export type ListAttendanceEnrollmentsQuery = z.infer<typeof ListAttendanceEnrollmentsQuerySchema>;
