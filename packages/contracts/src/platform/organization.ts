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
    .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'uppercase code, e.g. BR-CAI-1')
    .describe('Unique unit code (sequence-generated codes arrive with phase 2.2)'),
  name: LocalizedStringSchema,
  managerId: objectId().nullable().optional(),
  actingManager: ActingManagerSchema.nullable().optional(),
};

export const CreateBranchSchema = z
  .object({ ...orgUnitBase, address: AddressSchema.optional() })
  .strict();
export type CreateBranch = z.infer<typeof CreateBranchSchema>;

export const CreateDepartmentSchema = z.object({ ...orgUnitBase, branchId: objectId() }).strict();
export type CreateDepartment = z.infer<typeof CreateDepartmentSchema>;

export const CreateSectionSchema = z.object({ ...orgUnitBase, departmentId: objectId() }).strict();
export type CreateSection = z.infer<typeof CreateSectionSchema>;

// Job Titles are an organization-wide catalog (ADR-015): they carry the *definition* of a role —
// grade, salary band, and hiring requirements — but they do NOT belong to a Branch/Department/
// Section. Linking a title to a concrete organizational location is the job of Job Positions
// (a later phase). Only `jobGrade` is required; salary/description/qualifications/experience are
// optional so a title can be created quickly and enriched over time.
const jobTitleRichFields = {
  jobGrade: z.string().trim().min(1).max(32).describe('Grade label/code, e.g. G7 or M2'),
  description: LocalizedStringSchema.nullable().optional(),
  salaryMin: z.number().min(0).max(100_000_000).nullable().optional(),
  salaryMax: z.number().min(0).max(100_000_000).nullable().optional(),
  requiredQualifications: LocalizedStringSchema.nullable().optional(),
  requiredExperienceYears: z.number().int().min(0).max(60).nullable().optional(),
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

export const UpdateDepartmentSchema = z.object(updatableUnitFields).strict();
export type UpdateDepartment = z.infer<typeof UpdateDepartmentSchema>;

export const UpdateSectionSchema = z.object(updatableUnitFields).strict();
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
    version: z.number().int().min(0),
  })
  .strict()
  // When both bounds arrive together they must be coherent; a partial update touching only one
  // bound is re-checked against the stored value in the service (merged-state validation).
  .refine(salaryBandOk, salaryBandError);
export type UpdateJobTitle = z.infer<typeof UpdateJobTitleSchema>;

export const ListOrgUnitsQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['active', 'inactive']).optional(),
  branchId: objectId().optional(),
  departmentId: objectId().optional(),
  search: z.string().max(200).optional(),
}).strict();
export type ListOrgUnitsQuery = z.infer<typeof ListOrgUnitsQuerySchema>;

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

export interface DepartmentDto extends OrgUnitDto {
  branchId: string;
}

export interface SectionDto extends OrgUnitDto {
  branchId: string;
  departmentId: string;
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
  status: 'active' | 'inactive';
  version: number;
  createdAt: string;
  updatedAt: string;
}
