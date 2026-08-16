import { z } from 'zod';
import {
  objectId,
  AddressSchema,
  LocalizedStringSchema,
  PaginationQuerySchema,
  type Address,
} from '../common/index.js';

// Single-organization model (ADR-015): Organization is a singleton profile;
// Branch → Department → Section is the fixed hierarchy; Job Titles are
// organization-level catalogs. Org units carry managers + acting-manager
// delegation windows (Review R11).

export const UpdateOrganizationSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    legalName: LocalizedStringSchema.optional(),
    taxNumber: z.string().max(50).nullable().optional(),
    commercialRegistry: z.string().max(50).nullable().optional(),
    fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateOrganization = z.infer<typeof UpdateOrganizationSchema>;

export interface OrganizationDto {
  id: string;
  name: { ar: string; en: string };
  legalName: { ar: string; en: string } | null;
  taxNumber: string | null;
  commercialRegistry: string | null;
  fiscalYearStartMonth: number;
  version: number;
  updatedAt: string;
}

// ── Org units ───────────────────────────────────────────────────────────────

export const ActingManagerSchema = z
  .object({
    userId: objectId(),
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .strict()
  .refine((v) => v.from < v.to, { message: 'from must be before to', path: ['to'] });
export type ActingManager = z.infer<typeof ActingManagerSchema>;

const orgUnitBase = {
  code: z
    .string()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,19}$/, 'uppercase letters/digits, e.g. 01 or BR-CAI-1')
    .describe('Unique unit code (sequence-generated codes arrive with phase 2.2)'),
  name: LocalizedStringSchema,
  managerId: objectId().nullable().optional(),
  actingManager: ActingManagerSchema.nullable().optional(),
};

export const CreateBranchSchema = z
  .object({ ...orgUnitBase, address: AddressSchema.optional() })
  .strict();
export type CreateBranch = z.infer<typeof CreateBranchSchema>;

export const CreateDepartmentSchema = z
  .object({
    ...orgUnitBase,
    branchId: objectId(),
    description: LocalizedStringSchema.nullable().optional(),
  })
  .strict();
export type CreateDepartment = z.infer<typeof CreateDepartmentSchema>;

export const CreateSectionSchema = z
  .object({
    ...orgUnitBase,
    departmentId: objectId(),
    description: LocalizedStringSchema.nullable().optional(),
  })
  .strict();
export type CreateSection = z.infer<typeof CreateSectionSchema>;

// Job Titles are an organization-wide catalog (ADR-015): they carry the *definition* of a role —
// grade, salary band, and hiring requirements — but they do NOT belong to a Branch/Department/
// Section. Linking a title to a concrete organizational location is the job of Job Positions
// (a later phase). Only `jobGrade` is required; salary/description/qualifications/experience are
// optional so a title can be created quickly and enriched over time.
/**
 * The Job's fixed salary — the DEFAULT a new assignment starts from (P-HR-22, D-JOB-2).
 *
 * Shaped exactly like the offer's `MoneySchema`, and deliberately NOT imported from it: this file
 * is a platform contract and the offer is a module one, so borrowing the type would invert the
 * dependency the whole package is arranged around. The duplication is four tokens wide and the
 * guard spec holds the two shapes equal.
 *
 * NOT the salary band. `salaryMin`/`salaryMax` stay what they have always been — an advisory range
 * that nothing prices from. This is the figure that is actually copied onto an employee.
 */
const JobFixedSalarySchema = z
  .object({ amount: z.number().nonnegative(), currency: z.string().length(3).default('EGP') })
  .strict();

const jobTitleRichFields = {
  jobGrade: z.string().trim().min(1).max(32).describe('Grade label/code, e.g. G7 or M2'),
  description: LocalizedStringSchema.nullable().optional(),
  salaryMin: z.number().min(0).max(100_000_000).nullable().optional(),
  salaryMax: z.number().min(0).max(100_000_000).nullable().optional(),
  requiredQualifications: LocalizedStringSchema.nullable().optional(),
  requiredExperienceYears: z.number().int().min(0).max(60).nullable().optional(),
  requiresDrivingTest: z.boolean().optional(),
  /** The default an assignment copies when it is not given a salary of its own (D-JOB-2). */
  fixedSalary: JobFixedSalarySchema.nullable().optional(),
  /**
   * The shifts this job may be worked on — a CANDIDATE LIST, never a set of concurrent
   * assignments (D-JOB-5 option A).
   *
   * An employee still has exactly one open shift assignment; `hr_shift_assignments` enforces that
   * with a partial unique index and this list does not touch it. What the list does is say which
   * choice follows the job and which is a departure from it — which is the whole of what a future
   * re-apply needs in order to leave a departure alone (D-JOB-4).
   */
  defaultShiftIds: z.array(objectId()).max(50).optional(),
};

/** A salary band is coherent only when both ends are present and min ≤ max. */
const salaryBandOk = (v: {
  salaryMin?: number | null | undefined;
  salaryMax?: number | null | undefined;
}): boolean => v.salaryMin == null || v.salaryMax == null || v.salaryMin <= v.salaryMax;
const salaryBandError = { message: 'salaryMax must be ≥ salaryMin', path: ['salaryMax'] };

export const CreateJobTitleSchema = z
  .object({ code: orgUnitBase.code, name: LocalizedStringSchema, ...jobTitleRichFields })
  .strict()
  .refine(salaryBandOk, salaryBandError);
export type CreateJobTitle = z.infer<typeof CreateJobTitleSchema>;

const updatableUnitFields = {
  name: LocalizedStringSchema.optional(),
  status: z.enum(['active', 'inactive']).optional(),
  managerId: objectId().nullable().optional(),
  actingManager: ActingManagerSchema.nullable().optional(),
  version: z.number().int().min(0),
};

export const UpdateBranchSchema = z
  .object({ ...updatableUnitFields, address: AddressSchema.optional() })
  .strict();
export type UpdateBranch = z.infer<typeof UpdateBranchSchema>;

// The Branch Code is immutable after creation (it is part of every employee's identity, ADR-017)
// EXCEPT for a super-admin, who may correct it through this dedicated, privileged path.
export const ChangeBranchCodeSchema = z
  .object({ code: orgUnitBase.code, version: z.number().int().min(0) })
  .strict();
export type ChangeBranchCode = z.infer<typeof ChangeBranchCodeSchema>;

export const UpdateDepartmentSchema = z
  .object({ ...updatableUnitFields, description: LocalizedStringSchema.nullable().optional() })
  .strict();
export type UpdateDepartment = z.infer<typeof UpdateDepartmentSchema>;

export const UpdateSectionSchema = z
  .object({ ...updatableUnitFields, description: LocalizedStringSchema.nullable().optional() })
  .strict();
export type UpdateSection = z.infer<typeof UpdateSectionSchema>;

export const UpdateJobTitleSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    status: z.enum(['active', 'inactive']).optional(),
    jobGrade: z.string().trim().min(1).max(32).optional(),
    description: LocalizedStringSchema.nullable().optional(),
    salaryMin: z.number().min(0).max(100_000_000).nullable().optional(),
    salaryMax: z.number().min(0).max(100_000_000).nullable().optional(),
    requiredQualifications: LocalizedStringSchema.nullable().optional(),
    requiredExperienceYears: z.number().int().min(0).max(60).nullable().optional(),
  requiresDrivingTest: z.boolean().optional(),
    fixedSalary: JobFixedSalarySchema.nullable().optional(),
    defaultShiftIds: z.array(objectId()).max(50).optional(),
    version: z.number().int().min(0),
  })
  .strict()
  // When both bounds arrive together they must be coherent; a partial update touching only one
  // bound is re-checked against the stored value in the service (merged-state validation).
  .refine(salaryBandOk, salaryBandError);
export type UpdateJobTitle = z.infer<typeof UpdateJobTitleSchema>;

// ── Cost centres (P-HR-23) ──────────────────────────────────────────────────
//
// WHAT A COST CENTRE IS HERE. An organizational axis the company defines for itself, carried by a
// person over dated intervals and stamped onto a payslip when it is issued. That is the whole of
// it in this phase.
//
// WHAT IT IS NOT. Not an account, not a mapping, not a posting rule — the Accounting phase owns
// all three and nothing here anticipates any of them. Not a second scope axis either: `branchId`
// is what ADR-004 filters on and a cost centre never competes with it.
//
// NO HIERARCHY (D-CC-4) and NO MEMBERSHIP RULES (D-CC-1/D-CC-6). Membership is an explicit dated
// assignment, because the organizational tree it would otherwise be derived from carries no dates
// of its own — a rule evaluated later would answer with today's tree, not the one that was true.

export const CreateCostCenterSchema = z
  .object({
    code: orgUnitBase.code,
    name: LocalizedStringSchema,
    description: LocalizedStringSchema.nullable().optional(),
  })
  .strict();
export type CreateCostCenter = z.infer<typeof CreateCostCenterSchema>;

export const UpdateCostCenterSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    description: LocalizedStringSchema.nullable().optional(),
    status: z.enum(['active', 'inactive']).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateCostCenter = z.infer<typeof UpdateCostCenterSchema>;

export interface CostCenterDto {
  id: string;
  code: string;
  name: { ar: string; en: string };
  description: { ar: string; en: string } | null;
  status: 'active' | 'inactive';
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One employee's membership over a dated interval (D-CC-1 — explicit, never derived).
 *
 * `effectiveTo: null` is the open interval — the current membership. Intervals may not overlap for
 * one employee: on any given day a person is in exactly one cost centre, or in none.
 */
export const CreateCostCenterAssignmentSchema = z
  .object({
    costCenterId: objectId(),
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().nullish(),
    note: z.string().trim().max(500).nullish(),
  })
  .strict()
  .refine((v) => v.effectiveTo == null || v.effectiveTo >= v.effectiveFrom, {
    message: 'effectiveTo must be on or after effectiveFrom',
    path: ['effectiveTo'],
  });
export type CreateCostCenterAssignment = z.infer<typeof CreateCostCenterAssignmentSchema>;

export interface CostCenterAssignmentDto {
  id: string;
  employeeId: string;
  costCenterId: string;
  /** The centre's own label, resolved on the read so a screen never renders a bare id. */
  costCenter: { id: string; code: string; name: { ar: string; en: string } } | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const ListOrgUnitsQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['active', 'inactive']).optional(),
  branchId: objectId().optional(),
  departmentId: objectId().optional(),
  search: z.string().max(200).optional(),
}).strict();
export type ListOrgUnitsQuery = z.infer<typeof ListOrgUnitsQuerySchema>;

// Job Positions are a reusable organization master entity: a role that lives at a Department
// (required) and optionally at a Section within it. They are NOT tied to Recruitment and require no
// Job Requisition (ADR-016). The owning Department is set at creation and immutable thereafter.
export const CreateJobPositionSchema = z
  .object({
    name: LocalizedStringSchema,
    departmentId: objectId(),
    sectionId: objectId().nullable().optional(),
    description: LocalizedStringSchema.nullable().optional(),
  })
  .strict();
export type CreateJobPosition = z.infer<typeof CreateJobPositionSchema>;

export const UpdateJobPositionSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    sectionId: objectId().nullable().optional(),
    description: LocalizedStringSchema.nullable().optional(),
    status: z.enum(['active', 'inactive']).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateJobPosition = z.infer<typeof UpdateJobPositionSchema>;

export const ListJobPositionsQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['active', 'inactive']).optional(),
  departmentId: objectId().optional(),
  sectionId: objectId().optional(),
  search: z.string().max(200).optional(),
}).strict();
export type ListJobPositionsQuery = z.infer<typeof ListJobPositionsQuerySchema>;

export interface OrgUnitDto {
  id: string;
  code: string;
  name: { ar: string; en: string };
  status: 'active' | 'inactive';
  managerId: string | null;
  actingManager: { userId: string; from: string; to: string } | null;
  /** Materialized path for fast subtree queries, e.g. `<branchId>/<departmentId>`. */
  path: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BranchDto extends OrgUnitDto {
  address: Address | null;
}

/**
 * Minimal reference option for populating dropdowns (e.g. the Branch selector on the Department /
 * Section forms). Exposed by `GET /platform/<unit>/options`, authorized for any authenticated user
 * and decoupled from the unit's `view` data-scope permission — it carries only non-sensitive
 * identifiers needed to fill a form.
 */
export interface OrgUnitOptionDto {
  id: string;
  code: string;
  name: { ar: string; en: string };
}

export interface DepartmentDto extends OrgUnitDto {
  branchId: string;
  description: { ar: string; en: string } | null;
}

export interface SectionDto extends OrgUnitDto {
  branchId: string;
  departmentId: string;
  description: { ar: string; en: string } | null;
}

/**
 * A candidate shift as the Job screen shows it — an id and a name, and nothing else.
 *
 * `name` is null when the shift cannot be read: it was deleted, or the HR module that owns shifts
 * is not enabled on this deployment. Null is the honest answer to "what is this called?"; a
 * fabricated label or a failed request would both be worse.
 */
export interface JobShiftLabelDto {
  id: string;
  name: { ar: string; en: string } | null;
}

export interface JobTitleDto {
  id: string;
  code: string;
  name: { ar: string; en: string };
  /** Grade label/code (required). */
  jobGrade: string;
  description: { ar: string; en: string } | null;
  /** Salary band in the organization's currency (EGP); either bound may be null. */
  salaryMin: number | null;
  salaryMax: number | null;
  requiredQualifications: { ar: string; en: string } | null;
  /** Minimum years of experience expected for the role. */
  requiredExperienceYears: number | null;
  /**
   * Whether holding this title means sitting the driving test.
   *
   * A flag rather than a guess. The alternatives both break: matching the title's TEXT breaks the
   * moment a title is renamed or read in the other language, and keying on whether the candidate
   * happens to have entered a licence asks the question of the wrong record — a driver who has not
   * filled that field in yet is still applying to drive.
   */
  requiresDrivingTest: boolean;
  /**
   * The default salary an assignment copies (D-JOB-2), or null when the job states none.
   *
   * Distinct from the band above in kind, not degree: `salaryMin`/`salaryMax` advise a human,
   * this is the figure the system actually writes onto an employee. A `fixedSalary` outside the
   * band is reported as a warning and saved anyway — the band is not a constraint.
   */
  fixedSalary: { amount: number; currency: string } | null;
  /**
   * True when `fixedSalary` falls outside `salaryMin`…`salaryMax` — DERIVED, never stored.
   *
   * A statement of fact for the screen to render, not a rule: the save already succeeded. Keeping
   * it computed means the band can be edited afterwards and this answer stays correct without
   * anything being rewritten.
   */
  fixedSalaryOutsideBand: boolean;
  /** Shifts this job may be worked on — candidates to choose ONE from, never concurrent ones. */
  defaultShiftIds: string[];
  /**
   * The same shifts, named (D-JOB-6 option C) — so the Job screen can render them without holding
   * any attendance grant.
   *
   * The ids stay above rather than being replaced: they are what a write sends back, and this list
   * is what a reader displays. The same shape the payroll queue uses for employee labels (D7).
   */
  defaultShifts: JobShiftLabelDto[];
  status: 'active' | 'inactive';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface JobPositionDto {
  id: string;
  name: { ar: string; en: string };
  /** The owning Department (required, immutable after creation). */
  departmentId: string;
  /** Optional Section within the owning department. */
  sectionId: string | null;
  description: { ar: string; en: string } | null;
  status: 'active' | 'inactive';
  version: number;
  createdAt: string;
  updatedAt: string;
}
