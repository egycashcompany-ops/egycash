// The company org chart and where each job sits (P-ORG-3, ADR-038, docs/12-planning/org-chart-design.md).
//
// «عبارة عن شارت بالشركة كلها .. فيه الإدارات والأقسام والمسميات الوظيفية»: one chart of the whole
// company, read from the rows every branch keeps and folded into the company's units, and «الأتنين
// يسمعوا فى بعض»: a job's place in it is one record that the chart and the job form both read and
// write.
//
// A JOB PLACE is a job title's place in the structure: a company department (its catalog entry),
// optionally narrowed to one of that department's section entries. A job may have several. It
// describes; nothing checks a person's registration against it, and it carries no headcount (ADR-030).
import { z } from 'zod';
import { objectId, LocalizedStringSchema } from '../common/index.js';

/** One job place as a write names it: the department entry, and a section entry of it or none. */
export const JobPlaceInputSchema = z
  .object({
    departmentCatalogId: objectId(),
    /** null: directly under the department (a department may have no sections at all). */
    sectionCatalogId: objectId().nullable(),
  })
  .strict();
export type JobPlaceInput = z.infer<typeof JobPlaceInputSchema>;

/**
 * A job's WHOLE set of places, as the job form and the chart send it. At most 50 — a job sits in a
 * handful of departments, and the cap is what keeps a request from naming the whole catalog.
 * Duplicates are allowed on the wire and merged by the server: a «نقل إلى» onto a place the job
 * already has is a removal of the moved one, not an error.
 */
export const JobPlacesInputSchema = z.array(JobPlaceInputSchema).max(50);

const distinct = (ids: readonly string[]): boolean =>
  new Set(ids.map((id) => id.toLowerCase())).size === ids.length;

/** «إضافة قسم»: a section entry under the department, with one row in each ticked branch. */
export const AddChartSectionSchema = z
  .object({
    departmentCatalogId: objectId(),
    name: LocalizedStringSchema,
    /** D-ORG3-4: at least one branch — a section with no rows could not be chosen anywhere. */
    branchIds: z
      .array(objectId())
      .min(1)
      .max(50)
      .refine(distinct, { message: 'each branch once' }),
  })
  .strict();
export type AddChartSection = z.infer<typeof AddChartSectionSchema>;

/** «تغيير الاسم»: the section entry and every row of its group, with the entry's version. */
export const RenameChartSectionSchema = z
  .object({ name: LocalizedStringSchema, version: z.number().int().min(0) })
  .strict();
export type RenameChartSection = z.infer<typeof RenameChartSectionSchema>;

/** «إيقاف القسم»: the section entry and every active row of its group stop. */
export const StopChartSectionSchema = z.object({ version: z.number().int().min(0) }).strict();
export type StopChartSection = z.infer<typeof StopChartSectionSchema>;

/** A branch, named — the branches a department or section exists in. */
export interface OrgChartBranchDto {
  id: string;
  name: { ar: string; en: string };
}

export interface OrgChartSectionDto {
  /** The group key (`catalog:<id>`, `name:<folded>` or `unit:<rowId>`) — see `orgUnitGroupKeys`. */
  key: string;
  /** The section entry, or null for a group with none (a name group, read-only here). */
  sectionCatalogId: string | null;
  /** Writable here: a catalog group whose entry is active (design §4.2). */
  editable: boolean;
  name: { ar: string; en: string };
  /** The branches with an active row of this section. */
  branches: OrgChartBranchDto[];
  /** The section entry's `__v`, sent back by rename and stop; null for a name group. */
  catalogVersion: number | null;
}

export interface OrgChartDepartmentDto {
  key: string;
  departmentCatalogId: string | null;
  editable: boolean;
  /** The entry's name, else the group's oldest row's. */
  name: { ar: string; en: string };
  branches: OrgChartBranchDto[];
  /**
   * The branches «إضافة قسم» may tick: those whose active row of this department is linked to its
   * entry. A branch with only an unlinked row is in `branches` and not here (design §5.3).
   */
  linkedBranchIds: string[];
  sections: OrgChartSectionDto[];
}

/** One place of a job, as the chart reads it. `shown` is false while its group is stopped. */
export interface OrgChartJobPlaceDto {
  departmentCatalogId: string;
  sectionCatalogId: string | null;
  shown: boolean;
}

export interface OrgChartJobDto {
  id: string;
  code: string;
  name: { ar: string; en: string };
  /** The job's `__v` — a change of places is a job update and sends it back. */
  version: number;
  places: OrgChartJobPlaceDto[];
}

/** `GET /api/v1/platform/org-chart`: the whole company. Each column is derived from `jobs`. */
export interface OrgChartDto {
  departments: OrgChartDepartmentDto[];
  /** Every active job, with its places. */
  jobs: OrgChartJobDto[];
}

/** A job place on the job's own DTO, named from the catalog entries. */
export interface JobTitlePlaceDto {
  id: string;
  department: { departmentCatalogId: string; name: { ar: string; en: string } };
  section: { sectionCatalogId: string; name: { ar: string; en: string } } | null;
  /** False while the place's department or section is stopped — kept, not deleted. */
  shown: boolean;
}
