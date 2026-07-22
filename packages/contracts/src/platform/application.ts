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

// ── Applications ─────────────────────────────────────────────────────────────
const applicationBase = {
  name: LocalizedStringSchema,
  icon: z.string().trim().min(1).max(64),
  route: z.string().trim().min(1).max(200),
  categoryId: objectId(),
  sortOrder: z.number().int().min(0).max(100_000),
};

export const CreateApplicationSchema = z
  .object({ ...applicationBase, sortOrder: applicationBase.sortOrder.optional() })
  .strict();
export type CreateApplication = z.infer<typeof CreateApplicationSchema>;

export const UpdateApplicationSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    icon: applicationBase.icon.optional(),
    route: applicationBase.route.optional(),
    categoryId: objectId().optional(),
    sortOrder: applicationBase.sortOrder.optional(),
    status: z.enum(['active', 'inactive']).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateApplication = z.infer<typeof UpdateApplicationSchema>;

export const ListApplicationsQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['active', 'inactive']).optional(),
  categoryId: objectId().optional(),
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
  /** Ascending display order within a category. */
  sortOrder: number;
  status: 'active' | 'inactive';
  version: number;
  createdAt: string;
  updatedAt: string;
}
