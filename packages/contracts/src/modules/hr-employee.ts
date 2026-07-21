// HR / Recruitment — Employee Creation (Stage 5). Shared contracts for the fifth stage of
// the approved seven-stage recruitment workflow: an applicant whose Job Offer was Accepted
// becomes an Employee. The employment data is read EXCLUSIVELY from the offer's immutable
// Accepted Snapshot (never the live, mutable offer terms). The Employee preserves references
// back to the Applicant, the Job Requisition, and the Accepted Job Offer. Scope is Stage 5
// only: nothing here describes Hiring Documents / Electronic File or later stages.
import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';
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
  branchId: string;
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
  /** Immutable, unique, human-readable employee number, e.g. `EMP-2026-000001`. */
  code: string;
  status: EmployeeStatus;
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
