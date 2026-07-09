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

export const CreateJobTitleSchema = z
  .object({ code: orgUnitBase.code, name: LocalizedStringSchema })
  .strict();
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
    version: z.number().int().min(0),
  })
  .strict();
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
  status: 'active' | 'inactive';
  version: number;
  createdAt: string;
  updatedAt: string;
}
