import { z } from 'zod';
import { LocalizedStringSchema, PaginationQuerySchema, objectId } from '../common/index.js';

// Applications (Modules) are a standalone platform catalog. Each Application is a navigable module
// (icon + client route) that belongs to an Application Category and is ordered by `sortOrder`. This
// is the future source of navigation and module access; the Organization hierarchy remains
// responsible only for data scope. This slice covers the master entity CRUD only.

// ── Application Categories ───────────────────────────────────────────────────
// A standalone catalog that groups Applications in the sidebar (bilingual name, optional icon,
// ascending sort order, status).
const applicationCategoryBase = {
  name: LocalizedStringSchema,
  icon: z.string().trim().min(1).max(64).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000),
};

export const CreateApplicationCategorySchema = z
  .object({ ...applicationCategoryBase, sortOrder: applicationCategoryBase.sortOrder.optional() })
  .strict();
export type CreateApplicationCategory = z.infer<typeof CreateApplicationCategorySchema>;

export const UpdateApplicationCategorySchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    icon: z.string().trim().min(1).max(64).nullable().optional(),
    sortOrder: applicationCategoryBase.sortOrder.optional(),
    status: z.enum(['active', 'inactive']).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateApplicationCategory = z.infer<typeof UpdateApplicationCategorySchema>;

export const ListApplicationCategoriesQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['active', 'inactive']).optional(),
  search: z.string().max(200).optional(),
}).strict();
export type ListApplicationCategoriesQuery = z.infer<typeof ListApplicationCategoriesQuerySchema>;

export interface ApplicationCategoryDto {
  id: string;
  name: { ar: string; en: string };
  icon: string | null;
  sortOrder: number;
  status: 'active' | 'inactive';
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Application Sections ─────────────────────────────────────────────────────
// A Section groups Applications INSIDE one category, so a module whose page list has outgrown a
// flat column can be read as a few named groups instead. It is purely organizational:
//
//   • it grants nothing and withholds nothing — RBAC is unchanged, and a row still appears exactly
//     when the caller holds its application's `permissionKey`;
//   • it is CONFIGURABLE, never hardcoded: names live here, in the catalog, editable and
//     deletable from the administration screen like any other catalog row;
//   • it is OPTIONAL. An application with no section renders directly under its module, which is
//     what every application does today and what keeps this change backward compatible.
const applicationSectionBase = {
  name: LocalizedStringSchema,
  categoryId: objectId(),
  sortOrder: z.number().int().min(0).max(100_000),
};

export const CreateApplicationSectionSchema = z
  .object({ ...applicationSectionBase, sortOrder: applicationSectionBase.sortOrder.optional() })
  .strict();
export type CreateApplicationSection = z.infer<typeof CreateApplicationSectionSchema>;

export const UpdateApplicationSectionSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    // A section belongs to the category it organizes; moving one wholesale is a real edit.
    categoryId: objectId().optional(),
    sortOrder: applicationSectionBase.sortOrder.optional(),
    status: z.enum(['active', 'inactive']).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateApplicationSection = z.infer<typeof UpdateApplicationSectionSchema>;

export const ListApplicationSectionsQuerySchema = PaginationQuerySchema.extend({
  categoryId: objectId().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  search: z.string().max(200).optional(),
}).strict();
export type ListApplicationSectionsQuery = z.infer<typeof ListApplicationSectionsQuerySchema>;

export interface ApplicationSectionDto {
  id: string;
  name: { ar: string; en: string };
  categoryId: string;
  sortOrder: number;
  status: 'active' | 'inactive';
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Reordering by POSITION, never by number.
 *
 * The client sends the ids in the order it wants to see them and the server renumbers from that
 * list; nobody types a `sortOrder` and no neighbour has to be edited to make room. Sending the
 * same list twice is the same write twice — the operation is idempotent by construction, which is
 * what makes a drag that fires twice, or a retried request, harmless.
 */
export const ReorderApplicationSectionsSchema = z
  .object({
    categoryId: objectId(),
    /** Every ACTIVE section of that category, in the intended order. */
    sectionIds: z.array(objectId()).max(200),
  })
  .strict();
export type ReorderApplicationSections = z.infer<typeof ReorderApplicationSectionsSchema>;

/**
 * The one write behind every drag on the applications board: it sets the bucket an application
 * sits in AND its position inside it, because dragging a row into another section is the same
 * gesture as dragging it within one. `sectionId: null` is the unsectioned bucket — the rows that
 * hang directly off the module.
 */
export const ReorderApplicationsSchema = z
  .object({
    categoryId: objectId(),
    sectionId: objectId().nullable(),
    /** Every application in that bucket, in the intended order. */
    applicationIds: z.array(objectId()).max(500),
  })
  .strict();
export type ReorderApplications = z.infer<typeof ReorderApplicationsSchema>;

// ── Applications ─────────────────────────────────────────────────────────────
const applicationBase = {
  name: LocalizedStringSchema,
  icon: z.string().trim().min(1).max(64),
  route: z.string().trim().min(1).max(200),
  categoryId: objectId(),
  sortOrder: z.number().int().min(0).max(100_000),
  /**
   * The permission that opening this application requires — the SAME key the page's route guard and
   * its API endpoints check.
   *
   * It is the ONLY thing that puts the application in anybody's navigation: the sidebar is the set
   * of applications whose key the caller holds. So it is REQUIRED on create and cannot be cleared on
   * update — an application without one is entitled to nobody and would simply be invisible, which
   * is a broken catalog row rather than a configuration choice.
   *
   * The stored field stays nullable for rows catalogued before it existed. Those are invisible until
   * given a key, which is the fail-closed answer: "nobody declared who may open this" must not
   * resolve to "everybody may".
   */
  permissionKey: z.string().trim().min(1).max(120),
};

export const CreateApplicationSchema = z
  .object({
    ...applicationBase,
    sortOrder: applicationBase.sortOrder.optional(),
    /** Optional — omitted or null puts it directly under the module (the pre-sections shape). */
    sectionId: objectId().nullable().optional(),
  })
  .strict();
export type CreateApplication = z.infer<typeof CreateApplicationSchema>;

export const UpdateApplicationSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    icon: applicationBase.icon.optional(),
    route: applicationBase.route.optional(),
    categoryId: objectId().optional(),
    // Nullable on purpose: taking an application OUT of a section is an ordinary edit, and the
    // result — a row directly under the module — is a valid, supported shape.
    sectionId: objectId().nullable().optional(),
    sortOrder: applicationBase.sortOrder.optional(),
    // Optional to OMIT, but not nullable: an existing key may be changed, never removed.
    permissionKey: applicationBase.permissionKey.optional(),
    status: z.enum(['active', 'inactive']).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateApplication = z.infer<typeof UpdateApplicationSchema>;

export const ListApplicationsQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['active', 'inactive']).optional(),
  categoryId: objectId().optional(),
  sectionId: objectId().optional(),
  search: z.string().max(200).optional(),
}).strict();
export type ListApplicationsQuery = z.infer<typeof ListApplicationsQuerySchema>;

export interface ApplicationDto {
  id: string;
  name: { ar: string; en: string };
  /** Icon identifier used by the (future) navigation renderer. */
  icon: string;
  /** Client route the application opens at, e.g. `/hr/recruitment`. */
  route: string;
  /** The Application Category this application belongs to. */
  categoryId: string;
  /** The Section within that category, or null when it hangs directly off the module. */
  sectionId: string | null;
  /** Ascending display order within its bucket (its section, or the unsectioned rows). */
  sortOrder: number;
  /** Permission that opens it. Null only on rows predating the field — those are invisible. */
  permissionKey: string | null;
  status: 'active' | 'inactive';
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Effective Applications (the caller's own navigation) ─────────────────────
// The applications a signed-in user can actually open, grouped for the sidebar: those whose
// `permissionKey` is in their effective permission set — deduplicated, active-only, ordered by
// category then application. Nothing else grants a row, so the sidebar follows every RBAC change on
// its own. Only the fields the navigation renderer needs are returned.
export interface MyApplicationDto {
  id: string;
  name: { ar: string; en: string };
  icon: string;
  route: string;
}

/**
 * A named group of applications inside a module. It appears in navigation ONLY when at least one
 * of its applications survived the permission filter — an empty section is not a heading anybody
 * needs to see.
 */
export interface MyApplicationSectionDto {
  id: string;
  name: { ar: string; en: string };
  applications: MyApplicationDto[];
}

export interface MyApplicationCategoryDto {
  id: string;
  name: { ar: string; en: string };
  icon: string | null;
  /**
   * The applications that belong to NO section — rendered directly under the module, which is
   * what every application did before sections existed. Kept as the same field so a client that
   * has never heard of sections keeps working unchanged.
   */
  applications: MyApplicationDto[];
  /** The module's sections, in order; each carries its own visible applications. */
  sections: MyApplicationSectionDto[];
}
