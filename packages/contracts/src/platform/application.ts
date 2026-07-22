import { z } from 'zod';
import { LocalizedStringSchema, PaginationQuerySchema } from '../common/index.js';

// Applications (Modules) are a standalone platform catalog. Each Application is a navigable module
// (icon + client route) grouped by a free-form category and ordered by `sortOrder`. This is the
// future source of navigation and module access; the Organization hierarchy remains responsible only
// for data scope. This slice covers the master entity CRUD only.
const applicationBase = {
  name: LocalizedStringSchema,
  icon: z.string().trim().min(1).max(64),
  route: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(64),
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
    category: applicationBase.category.optional(),
    sortOrder: applicationBase.sortOrder.optional(),
    status: z.enum(['active', 'inactive']).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateApplication = z.infer<typeof UpdateApplicationSchema>;

export const ListApplicationsQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['active', 'inactive']).optional(),
  category: z.string().max(64).optional(),
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
  /** Free-form grouping label used to cluster applications in the sidebar. */
  category: string;
  /** Ascending display order within a category. */
  sortOrder: number;
  status: 'active' | 'inactive';
  version: number;
  createdAt: string;
  updatedAt: string;
}
