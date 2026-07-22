// HR / Recruitment — Employee Creation (Stage 5). Shared contracts for the fifth stage of
// the approved seven-stage recruitment workflow: an applicant whose Job Offer was Accepted
// becomes an Employee. The employment data is read EXCLUSIVELY from the offer's immutable
// Accepted Snapshot (never the live, mutable offer terms). The Employee preserves references
// back to the Applicant, the Job Requisition, and the Accepted Job Offer. Scope is Stage 5
// only: nothing here describes Hiring Documents / Electronic File or later stages.
import { z } from 'zod';
import {
  objectId,
  LocaleSchema,
  LocalizedStringSchema,
  PaginationQuerySchema,
  PhoneNumberSchema,
} from '../common/index.js';
import { UsernameSchema, type UserDto } from '../platform/users.js';
import { type EmploymentType, type OfferAllowanceDto } from './hr-job-offer.js';

// ── Closed vocabulary ───────────────────────────────────────────────────────

/** Employee lifecycle status. A newly-hired employee starts `active`. */
export const EMPLOYEE_STATUSES = ['active', 'onLeave', 'suspended', 'terminated'] as const;
export const EmployeeStatusSchema = z.enum(EMPLOYEE_STATUSES);
export type EmployeeStatus = z.infer<typeof EmployeeStatusSchema>;

// ── Create (the only mutation this stage adds) ──────────────────────────────

/**
 * Create an Employee from an Accepted Job Offer. The employment terms are NOT supplied by the
 * caller — they are copied server-side from the offer's immutable Accepted Snapshot. Only the
 * offer reference and an optional explicit hiring date are accepted.
 */
export const CreateEmployeeSchema = z
  .object({
    jobOfferId: objectId(),
    /** Defaults to now when omitted. */
    hiringDate: z.coerce.date().optional(),
  })
  .strict();
export type CreateEmployee = z.infer<typeof CreateEmployeeSchema>;

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

// ── List ─────────────────────────────────────────────────────────────────────

export const ListEmployeesQuerySchema = PaginationQuerySchema.extend({
  status: EmployeeStatusSchema.optional(),
  applicantId: objectId().optional(),
  jobOfferId: objectId().optional(),
  branchId: objectId().optional(),
  /** Free-text over the employee number (`code`) and applicant code (partial, case-insensitive). */
  search: z.string().max(100).optional(),
}).strict();
export type ListEmployeesQuery = z.infer<typeof ListEmployeesQuerySchema>;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/** The employment terms copied from the Accepted Offer Snapshot (excludes offer-only fields). */
export interface EmploymentDetailsDto {
  jobTitleId: string;
  departmentId: string;
  /** Section within the department; null when the offer did not specify one. */
  sectionId: string | null;
  branchId: string;
  /** Approved Job Position, when one exists — OPTIONAL forever (ADR-016 Talent Pool). */
  jobPositionId: string | null;
  managerId: string;
  employmentType: EmploymentType;
  salary: { amount: number; currency: string };
  allowances: OfferAllowanceDto[];
  benefits: string[];
  probationMonths: number;
  startDate: string;
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
  /** The linked login account, or null when the employee has no login yet (ADR-017). */
  userId: string | null;
  // Preserved references.
  applicantId: string;
  applicantCode: string;
  /** null when the source applicant had no linked Job Request (direct intake). */
  jobRequisitionId: string | null;
  jobOfferId: string;
  offerCode: string;
  /** The offer revision that was accepted (from the Accepted Snapshot). */
  acceptedOfferRevision: number;
  // Copied employment terms.
  employment: EmploymentDetailsDto;
  hiredAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Events (ADR-008 naming `<module>.<entity>.<event>`) ─────────────────────

export const HrEmployeeEvents = {
  EmployeeCreated: 'hr.employee.created',
} as const;
export type HrEmployeeEventName = (typeof HrEmployeeEvents)[keyof typeof HrEmployeeEvents];

export const EmployeeCreatedPayloadV1 = z.object({
  employeeId: objectId(),
  code: z.string(),
  applicantId: objectId(),
  jobOfferId: objectId(),
});

// ── Notification template key (seeded at boot by the HR module) ─────────────

export const HrEmployeeTemplates = {
  Created: 'hr.employeeCreated',
} as const;
