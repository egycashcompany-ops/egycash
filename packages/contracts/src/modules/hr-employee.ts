// HR / Employee Management — the employee registry. Originally Stage 5 of the recruitment
// workflow (an applicant whose Job Offer was Accepted becomes an Employee), now the system of
// record for the whole post-hire lifecycle per the frozen design
// (docs/12-planning/employee-module-design.md): probation-first entry, a single `exited`
// terminal status with typed exits, personal data owned by the employee after a one-time copy
// from the applicant, employment periods that survive rehires on the SAME employee number, and
// the Personnel Actions engine (see hr-employee-actions.ts) as the only writer of employment
// facts. Recruitment references stay preserved for pipeline hires and are null for direct
// registrations (go-live workforce onboarding).
import { z } from 'zod';
import {
  type CompensationEffectsDto,
  type PayrollAdjustmentKind,
  type PayrollAdjustmentStatus,
} from './hr-payroll.js';
import {
  objectId,
  AddressSchema,
  LocaleSchema,
  LocalizedStringSchema,
  PaginationQuerySchema,
  PhoneNumberSchema,
  type Address,
  listQuery,
} from '../common/index.js';
import { UsernameSchema, type UserDto } from '../platform/users.js';
import { type CredentialsDeliveryResultDto } from '../platform/auth.js';
import {
  AllowanceSchema,
  EmploymentTypeSchema,
  MoneySchema,
  type EmploymentType,
  type OfferAllowanceDto,
} from './hr-job-offer.js';
import {
  ContactInputSchema,
  DrivingLicenseSchema,
  EducationSchema,
  ExperienceEntrySchema,
  IdentityInputSchema,
  MilitaryServiceSchema,
  ReferenceSchema,
  type ApplicantChannelContact,
  type EducationLevel,
  type Gender,
  type MaritalStatus,
  type MilitaryStatus,
} from './hr-recruitment.js';

// ── Closed vocabularies ─────────────────────────────────────────────────────

/**
 * Employee lifecycle status. Every new hire starts in `probation` (D1; 0 probation months
 * skips straight to `active`). `exited` is the SINGLE terminal status — the exit *type*
 * (resignation, termination, …) is data on the exit record, not a status. `exited → probation`
 * happens only through a Rehire action, which reopens the SAME employee (same number, same file).
 */
export const EMPLOYEE_STATUSES = ['probation', 'active', 'onLeave', 'suspended', 'exited'] as const;
export const EmployeeStatusSchema = z.enum(EMPLOYEE_STATUSES);
export type EmployeeStatus = z.infer<typeof EmployeeStatusSchema>;

/** How an employment ended. Retirement is an exit type only (D5 — no age automation yet). */
export const EMPLOYEE_EXIT_TYPES = [
  'resignation',
  'termination',
  'endOfContract',
  'retirement',
  'death',
] as const;
export const EmployeeExitTypeSchema = z.enum(EMPLOYEE_EXIT_TYPES);
export type EmployeeExitType = z.infer<typeof EmployeeExitTypeSchema>;

/** How the employee entered the registry. Recruitment refs are null for `direct`. */
export const EMPLOYEE_ORIGINS = ['recruitment', 'direct'] as const;
export const EmployeeOriginSchema = z.enum(EMPLOYEE_ORIGINS);
export type EmployeeOrigin = z.infer<typeof EmployeeOriginSchema>;

/**
 * Allowed employee status transitions — the single source of truth shared by the API (which
 * enforces them) and the web (which offers only the valid actions). A transition to the same
 * status is never allowed (guarded separately). Leaving `onLeave`/`suspended` returns to the
 * employee's BASE status (see {@link employeeBaseStatus}) — the table lists both candidates;
 * the service picks the base. `exited → probation` is reachable through Rehire ONLY.
 */
export const EMPLOYEE_STATUS_TRANSITIONS = {
  probation: ['active', 'onLeave', 'suspended', 'exited'],
  active: ['onLeave', 'suspended', 'exited'],
  onLeave: ['probation', 'active', 'suspended', 'exited'],
  suspended: ['probation', 'active', 'exited'],
  exited: ['probation'],
} as const satisfies Record<EmployeeStatus, readonly EmployeeStatus[]>;

/** True when `to` is a legal next status for an employee currently in `from`. */
export const canTransitionEmployeeStatus = (from: EmployeeStatus, to: EmployeeStatus): boolean =>
  from !== to && (EMPLOYEE_STATUS_TRANSITIONS[from] as readonly EmployeeStatus[]).includes(to);

/**
 * The status an employee returns to when leaving `onLeave`/`suspended`: `probation` while
 * their probation was never confirmed (and did not fail), else `active` — a suspension during
 * probation must never skip probation (frozen design F4).
 */
export const employeeBaseStatus = (
  probation: { confirmedAt: string | Date | null; failed: boolean } | null,
): 'probation' | 'active' =>
  probation !== null && probation.confirmedAt === null && !probation.failed
    ? 'probation'
    : 'active';

/** Statuses that count as "employed" (the Employees list default view). */
export const EMPLOYED_STATUSES: readonly EmployeeStatus[] = [
  'probation',
  'active',
  'onLeave',
  'suspended',
];

// ── Personal data (owned by the employee AFTER hire) ────────────────────────
// Copied ONCE from the applicant at hire (snapshot-then-own — the applicant record stays
// immutable pre-hire history), or supplied directly for direct registrations. The building
// blocks are the applicant's own schemas — one shape, no drift.

export const EmployeePersonalSchema = z
  .object({
    identity: IdentityInputSchema,
    contact: ContactInputSchema,
    officialAddress: AddressSchema.optional(),
    currentAddress: AddressSchema.optional(),
    military: MilitaryServiceSchema.optional(),
    education: EducationSchema.optional(),
    experience: z.array(ExperienceEntrySchema).max(30).default([]),
    drivingLicenses: z.array(DrivingLicenseSchema).max(10).default([]),
    certifications: z.array(z.string().max(200)).max(50).default([]),
    references: z.array(ReferenceSchema).max(20).default([]),
  })
  .strict();
export type EmployeePersonal = z.infer<typeof EmployeePersonalSchema>;

/**
 * Post-hire personal-data edits (audited field-by-field; NOT a personnel action — frozen
 * design I4). Groups are replaced whole when present; identity/contact accept partial sets.
 */
export const UpdateEmployeePersonalSchema = z
  .object({
    identity: IdentityInputSchema.partial().optional(),
    contact: ContactInputSchema.partial().optional(),
    officialAddress: AddressSchema.nullish(),
    currentAddress: AddressSchema.nullish(),
    military: MilitaryServiceSchema.nullish(),
    education: EducationSchema.nullish(),
    experience: z.array(ExperienceEntrySchema).max(30).optional(),
    drivingLicenses: z.array(DrivingLicenseSchema).max(10).optional(),
    certifications: z.array(z.string().max(200)).max(50).optional(),
    references: z.array(ReferenceSchema).max(20).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateEmployeePersonal = z.infer<typeof UpdateEmployeePersonalSchema>;

// ── Create from an Accepted Job Offer (recruitment hire path) ───────────────

/**
 * Create an Employee from an Accepted Job Offer. The employment terms are NOT supplied by the
 * caller — they are copied server-side from the offer's immutable Accepted Snapshot, and the
 * personal data is copied once from the applicant. Entry status is `probation` (D1). If the
 * applicant's national id matches an EXITED employee the server refuses and routes to Rehire;
 * a match on an employed one is a hard block (frozen design F2).
 */
export const CreateEmployeeSchema = z
  .object({
    jobOfferId: objectId(),
    /** Defaults to now when omitted. */
    hiringDate: z.coerce.date().optional(),
  })
  .strict();
export type CreateEmployee = z.infer<typeof CreateEmployeeSchema>;

// ── Direct registration (D4 — go-live workforce onboarding / walk-in hire) ──

/** Employment terms supplied directly (no offer). Same shape the offer snapshot provides. */
export const DirectEmploymentTermsSchema = z
  .object({
    jobTitleId: objectId(),
    departmentId: objectId(),
    sectionId: objectId().nullish(),
    branchId: objectId(),
    managerId: objectId().nullish(),
    employmentType: EmploymentTypeSchema,
    salary: MoneySchema.nullish(),
    allowances: z.array(AllowanceSchema).max(30).default([]),
    benefits: z.array(z.string().min(1).max(200)).max(50).default([]),
    probationMonths: z.number().int().min(0).max(24),
    startDate: z.coerce.date(),
  })
  .strict();
export type DirectEmploymentTerms = z.infer<typeof DirectEmploymentTermsSchema>;

export const DirectRegisterEmployeeSchema = z
  .object({
    personal: EmployeePersonalSchema,
    employment: DirectEmploymentTermsSchema,
    /** Defaults to now when omitted. */
    hiringDate: z.coerce.date().optional(),
    /** Tenured staff being backfilled may start straight at `active`. */
    entryStatus: z.enum(['probation', 'active']).default('probation'),
  })
  .strict();
export type DirectRegisterEmployee = z.infer<typeof DirectRegisterEmployeeSchema>;

// ── Status-change ALIAS (deprecated — superseded by the actions engine) ─────
/**
 * Thin alias kept for one release over the Personnel Actions engine: suspension, leave and
 * return are translated to the equivalent actions. Exits are REFUSED here (an exit needs a
 * typed exit + an explicit `eligibleForRehire` decision — use the exit actions endpoint).
 */
export const ChangeEmployeeStatusSchema = z
  .object({
    status: EmployeeStatusSchema,
    effectiveDate: z.coerce.date().optional(),
    reason: z.string().trim().min(1).max(500).optional(),
    version: z.number().int().nonnegative(),
  })
  .strict()
  .refine((v) => v.status !== 'suspended' || (v.reason !== undefined && v.reason.length > 0), {
    path: ['reason'],
    message: 'a reason is required when suspending an employee',
  });
export type ChangeEmployeeStatus = z.infer<typeof ChangeEmployeeStatusSchema>;

// ── Login account for an Employee (ADR-017) ─────────────────────────────────
// Every login belongs to one Employee. The organizational placement (branch/department/section/
// job title) is copied from the Employee, never supplied here. `username` defaults to the Employee
// Code when omitted. An email is required and remains a valid login identifier.
export const CreateEmployeeLoginSchema = z
  .object({
    email: z.string().email(),
    username: UsernameSchema.optional(),
    firstName: LocalizedStringSchema,
    lastName: LocalizedStringSchema,
    phone: PhoneNumberSchema.optional(),
    locale: LocaleSchema.default('ar'),
  })
  .strict();
export type CreateEmployeeLogin = z.infer<typeof CreateEmployeeLoginSchema>;

export interface EmployeeLoginDto {
  user: UserDto;
  /** Returned once at creation — used to build the activation link (dev: logged). */
  activationToken: string;
  /** Echo of the Employee Code the username defaulted from. */
  employeeCode: string;
}

/**
 * Attach an EXISTING login to this employee (SA-2 / decision E1).
 *
 * The sibling of `CreateEmployeeLoginSchema`: that one makes a new account for an employee who has
 * none, this one adopts an account that already exists — the case of someone who was a
 * non-employee user first and has now been hired. Both live in HR because HR owns the employee ↔
 * login relationship (ADR-017); System Administration invokes this endpoint rather than writing
 * `user.employeeId`, which would make it a second, unowned writer of the same fact.
 */
export const LinkEmployeeUserSchema = z.object({ userId: objectId() }).strict();
export type LinkEmployeeUser = z.infer<typeof LinkEmployeeUserSchema>;

// ── List ─────────────────────────────────────────────────────────────────────

export const ListEmployeesQuerySchema = PaginationQuerySchema.extend({
  status: EmployeeStatusSchema.optional(),
  /** true → only employed statuses (probation/active/onLeave/suspended); false → exited only. */
  employed: z.coerce.boolean().optional(),
  origin: EmployeeOriginSchema.optional(),
  applicantId: objectId().optional(),
  jobOfferId: objectId().optional(),
  branchId: listQuery(objectId()),
  departmentId: objectId().optional(),
  sectionId: objectId().optional(),
  jobTitleId: objectId().optional(),
  managerId: objectId().optional(),
  employmentType: EmploymentTypeSchema.optional(),
  /** Free-text over the employee number (`code`), applicant code and full name (partial). */
  search: z.string().max(100).optional(),
}).strict();
export type ListEmployeesQuery = z.infer<typeof ListEmployeesQuerySchema>;

/** Look up exited employees matching a national id (powers the Rehire prompt). */
export const RehireCheckQuerySchema = z.object({ nationalId: z.string().min(5).max(30) }).strict();
export type RehireCheckQuery = z.infer<typeof RehireCheckQuerySchema>;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/** The employment terms snapshot (from the Accepted Offer or direct registration). */
export interface EmploymentDetailsDto {
  jobTitleId: string;
  departmentId: string;
  /** Section within the department; null when none was specified. */
  sectionId: string | null;
  branchId: string;
  /** Approved Job Position, when one exists — OPTIONAL forever (ADR-016 Talent Pool). */
  jobPositionId: string | null;
  /** Reporting manager — null when none is set. */
  managerId: string | null;
  employmentType: EmploymentType;
  /**
   * Compensation — null when none was set OR when the caller lacks
   * `employee.viewCompensation` (see {@link EmployeeDto.compensationVisible}).
   */
  salary: { amount: number; currency: string } | null;
  allowances: OfferAllowanceDto[];
  benefits: string[];
  probationMonths: number;
  startDate: string;
}

/** Personal data owned by the employee (masked NID by default — Security Architecture §3). */
export interface EmployeePersonalDto {
  fullNameAr: string;
  fullNameEn: string | null;
  nationalIdMasked: string | null;
  birthDate: string | null;
  gender: Gender | null;
  nationality: string;
  placeOfBirth: string | null;
  photoFileId: string | null;
  maritalStatus: MaritalStatus | null;
  religion: string | null;
  nationalIdExpiry: string | null;
  dependentsCount: number | null;
  contact: ApplicantChannelContact;
  officialAddress: Address | null;
  currentAddress: Address | null;
  military: { status: MilitaryStatus; certificateRef?: string; completedAt?: string } | null;
  education: {
    level: EducationLevel;
    institution?: string;
    specialization?: string;
    graduationYear?: number;
    grade?: string;
  } | null;
  experience: {
    employer: string;
    position?: string;
    from?: string;
    to?: string;
    leavingReason?: string;
  }[];
  drivingLicenses: { class: string; expiry?: string }[];
  certifications: string[];
  references: { name: string; relationship?: string; phone?: string }[];
}

/** Probation state (null when the employee never entered probation, e.g. migrated actives). */
export interface EmployeeProbationDto {
  /** null when probationMonths was 0 (entered straight as active). */
  endDate: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  /** Set when HR extended the probation (replaces endDate as the operative deadline). */
  extendedTo: string | null;
  failed: boolean;
}

/** How the current (last) employment ended. null while employed. */
export interface EmployeeExitDto {
  type: EmployeeExitType;
  reason: string | null;
  effectiveDate: string;
  /** Recorded at exit; rehiring against `false` needs `employee.rehireOverride` (D2). */
  eligibleForRehire: boolean;
  by: string | null;
}

/** One hire→exit span. DERIVED from hire/rehire/exit actions — rebuildable, never hand-edited. */
export interface EmploymentPeriodDto {
  hiredAt: string;
  exitedAt: string | null;
  exitType: EmployeeExitType | null;
}

/**
 * One entry in an employee's LEGACY status trail (frozen at migration — history is read from
 * the Personnel Actions since; `actionId` links entries the migration could attribute).
 */
export interface EmployeeStatusEventDto {
  from: EmployeeStatus | null;
  to: EmployeeStatus;
  reason: string | null;
  /** The date the change takes business effect (ISO date-time). */
  effectiveDate: string;
  /** When the change was recorded (ISO date-time). */
  at: string;
  /** The user who made the change, or null for a system/seed action. */
  by: string | null;
  /** The personnel action this entry corresponds to, when attributable. */
  actionId: string | null;
}

export interface EmployeeDto {
  id: string;
  /** Permanent identity: the Global Employee Number, e.g. `000125` — never changes (ADR-017). */
  employeeNumber: string;
  /**
   * Displayed Employee Code, derived as `<CurrentBranchCode><employeeNumber>`, e.g. `001000125`.
   * On a branch transfer only the prefix changes (→ `004000125`); the number stays fixed.
   */
  code: string;
  status: EmployeeStatus;
  origin: EmployeeOrigin;
  personal: EmployeePersonalDto;
  probation: EmployeeProbationDto | null;
  exit: EmployeeExitDto | null;
  employmentPeriods: EmploymentPeriodDto[];
  /** Legacy pre-actions status trail, oldest first (frozen at migration). */
  statusHistory: EmployeeStatusEventDto[];
  /** The linked login account, or null when the employee has no login yet (ADR-017). */
  userId: string | null;
  // Preserved recruitment references — null for direct registrations.
  applicantId: string | null;
  applicantCode: string | null;
  /** null when the source applicant had no linked Job Request (direct intake). */
  jobRequisitionId: string | null;
  jobOfferId: string | null;
  offerCode: string | null;
  /** The offer revision that was accepted (from the Accepted Snapshot). */
  acceptedOfferRevision: number | null;
  // Employment snapshot (mutated ONLY by applied personnel actions).
  employment: EmploymentDetailsDto;
  /** false when salary/allowances were redacted for the caller (no `employee.viewCompensation`). */
  compensationVisible: boolean;
  hiredAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Exited-employee match for a national id (the Rehire prompt / duplicate guard). */
/** Auto-provisioned login (frozen auth design 4.1) — present on the CREATING response only. */
export interface EmployeeLoginProvisionDto {
  username: string;
  /** Per-channel credential-delivery outcomes (design §12 R3) — never the password itself. */
  delivery: CredentialsDeliveryResultDto[];
}

export interface RehireCheckResultDto {
  employeeId: string;
  employeeNumber: string;
  code: string;
  fullNameAr: string;
  status: EmployeeStatus;
  exit: EmployeeExitDto | null;
}

// ── Composed timeline (file milestones + personnel actions + audited edits) ─

export interface EmployeeTimelineItemDto {
  at: string;
  /**
   * Where the entry comes from: an Employee File entry, a personnel action, a file note, an
   * audited personal edit, or leave. `recruitment` means the hiring handoff the file records —
   * the candidate's recruitment history itself is NOT here, it is on the recruitment timeline (I5).
   */
  source: 'recruitment' | 'action' | 'note' | 'personal' | 'leave';
  /** Entry/action type token (e.g. `hiringDocumentsCompleted`, `transfer`, `note`). */
  type: string;
  refType: string | null;
  refId: string | null;
  detail: string | null;
  by: string | null;
}

// ── Events (ADR-008 naming `<module>.<entity>.<event>`) ─────────────────────

export const HrEmployeeEvents = {
  EmployeeCreated: 'hr.employee.created',
  EmployeeStatusChanged: 'hr.employee.statusChanged',
  EmployeeActionApplied: 'hr.employee.actionApplied',
  EmployeeTransferred: 'hr.employee.transferred',
  EmployeeExited: 'hr.employee.exited',
  EmployeeRehired: 'hr.employee.rehired',
  /** C1-R: a login was linked to an employee — own-scope owner-field backfill hook. */
  EmployeeLoginLinked: 'hr.employee.loginLinked',
} as const;
export type HrEmployeeEventName = (typeof HrEmployeeEvents)[keyof typeof HrEmployeeEvents];

export const EmployeeCreatedPayloadV1 = z.object({
  employeeId: objectId(),
  code: z.string(),
  applicantId: objectId().nullable(),
  jobOfferId: objectId().nullable(),
  origin: EmployeeOriginSchema,
});

export const EmployeeStatusChangedPayloadV1 = z.object({
  employeeId: objectId(),
  code: z.string(),
  from: EmployeeStatusSchema,
  to: EmployeeStatusSchema,
});

export const EmployeeActionAppliedPayloadV1 = z.object({
  employeeId: objectId(),
  actionId: objectId(),
  code: z.string(),
  type: z.string(),
});

/** Emitted on branch transfers so future modules (badges, payroll keys) can re-key. */
export const EmployeeTransferredPayloadV1 = z.object({
  employeeId: objectId(),
  oldCode: z.string(),
  newCode: z.string(),
  branchId: objectId().nullable(),
});

/** C1-R: consumed by employee-subject modules to backfill their denormalized owner field. */
export const EmployeeLoginLinkedPayloadV1 = z.object({
  employeeId: objectId(),
  userId: objectId(),
  code: z.string(),
});

/**
 * `effectiveDate` is the day the exit takes business effect, as a date-only ISO string.
 *
 * It is on the payload rather than left to a consumer to look up, and that is not a convenience:
 * this event is emitted from inside the exit's application, BEFORE the employee document is saved,
 * so a consumer that re-read the employee to find the date would read the state from before the
 * exit. An event that announces somebody has left has to say when.
 */
export const EmployeeExitedPayloadV1 = z.object({
  employeeId: objectId(),
  code: z.string(),
  exitType: EmployeeExitTypeSchema,
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date is YYYY-MM-DD'),
});

export const EmployeeRehiredPayloadV1 = z.object({
  employeeId: objectId(),
  code: z.string(),
});

// ── Notification template keys (seeded at boot by the HR module) ────────────

export const HrEmployeeTemplates = {
  Created: 'hr.employeeCreated',
  ProbationEnding: 'hr.employeeProbationEnding',
  ScheduledActionApplied: 'hr.employeeScheduledActionApplied',
  ScheduledActionFailed: 'hr.employeeScheduledActionFailed',
  Exited: 'hr.employeeExited',
  Rehired: 'hr.employeeRehired',
} as const;

// ── Final settlement (P-HR-11) ──────────────────────────────────────────────
//
// A SUMMARY, not a calculation. Every figure below is quoted from the service that already owns it:
// the exit month's pay from the compensation engine, the loan balance from the loans feature, the
// leave balances from the leave ledger. Nothing here computes, and nothing here is stored — so this
// shape cannot disagree with its sources, because it has no opinion of its own to disagree with.
//
// WHAT IT DELIBERATELY DOES NOT CARRY. No end-of-service gratuity, no leave encashment, no notice
// pay. Each needs a legal rule this repository has not been given, and a field with no rule behind
// it is an invitation to fill it with a guess. `unresolved` names them instead, so an incomplete
// settlement reads as incomplete rather than as a total.
export const SETTLEMENT_UNRESOLVED_ITEMS = [
  /** Service-length gratuity — the formula, the wage base and which exit types qualify. */
  'endOfServiceGratuity',
  /** Whether unused leave is paid out. Today the balances are EXPIRED at exit, not encashed. */
  'leaveEncashment',
  /** Length and pay-in-lieu. The only one whose data does not exist either — see the design note. */
  'noticePeriod',
] as const;
export const SettlementUnresolvedItemSchema = z.enum(SETTLEMENT_UNRESOLVED_ITEMS);
export type SettlementUnresolvedItem = z.infer<typeof SettlementUnresolvedItemSchema>;

/** One loan still owing when the employee left — at most one, because D3 allows one live loan. */
export interface SettlementLoanDto {
  loanId: string;
  type: string;
  status: string;
  /** DERIVED live by the loans feature, never snapshotted here. */
  remaining: number;
  remainingMinor: number;
  repaid: number;
  currency: string;
}

/**
 * One `expire` entry the exit wrote into the leave ledger.
 *
 * Read from the LEDGER rather than from the balance, and that is not a detail: the exit zeroes the
 * balance, so by the time anybody settles, the balance says nothing was lost. The ledger is where
 * the days that were given up still exist.
 */
export interface SettlementLeaveBalanceDto {
  typeId: string;
  year: number;
  /** Days that were available at the moment of exit — expired, not paid (see `unresolved`). */
  expiredDays: number;
}

/**
 * An adjustment on the exit month that NOBODY HAS DECIDED YET.
 *
 * Only the undecided ones, and that is the whole point of the field. An approved adjustment is
 * already priced into `finalPeriod` as a line, so repeating it here would invite somebody to add
 * the same money twice. An undecided one is the opposite problem: it is real, it is about this
 * month, and it is in nobody's total — so a settlement computed today could be wrong tomorrow for
 * a reason the screen never showed.
 */
export interface SettlementPendingAdjustmentDto {
  adjustmentId: string;
  kind: PayrollAdjustmentKind;
  status: PayrollAdjustmentStatus;
  amount: number;
  currency: string;
  reason: string;
}

export interface EmployeeSettlementDto {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  exitType: EmployeeExitType;
  /** The last day of employment — what every span, batch and proration in the system clips to. */
  effectiveDate: string;
  /** The Cairo month the exit fell in; the period the final pay belongs to. */
  exitPeriod: string;
  /**
   * The exit month's pay, exactly as the payroll engine reports it.
   *
   * NOT a separate final-pay calculation: `employedDuring` already puts a leaver in that month's
   * batch and `employmentSpansOf` already prorates to the exit day, so a second answer here would
   * be a second opinion about somebody's last salary.
   */
  finalPeriod: CompensationEffectsDto;
  /** Whether that month's payroll run is frozen — a settled figure rather than a moving one. */
  finalPeriodFrozen: boolean;
  outstandingLoan: SettlementLoanDto | null;
  expiredLeave: SettlementLeaveBalanceDto[];
  /** Undecided adjustments on the exit month — NOT included in `finalPeriod`. */
  pendingAdjustments: SettlementPendingAdjustmentDto[];
  /** The amounts that need a policy decision before they can exist. Never zero — absent. */
  unresolved: SettlementUnresolvedItem[];
}
