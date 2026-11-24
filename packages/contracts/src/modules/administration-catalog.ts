// Administrative Affairs — the catalog (docs/12-planning/administration-module-design.md §2.3.2–§2.3.3,
// §19.4): units of measure and item categories in P1a.1; items join this file in P1a.2.
//
// Master data is organization-wide and never deleted: a row retires with `isActive: false` and keeps
// its name and code, so a retired name is reactivated, never typed again. No schema here takes
// `nameKey`: the service folds it from `name.ar` (`foldName`, §2.1), so a client cannot store two
// spellings of one name as two keys. No schema takes a stock figure either (ADR-024).
import { z } from 'zod';
import { type LocalizedString } from '../common/localized.js';
import { PaginationQuerySchema, booleanQuery, objectId } from '../common/index.js';

// ── Shared field shapes ─────────────────────────────────────────────────────

/**
 * A master row's name. Both languages required, as every master name is (§2.1), trimmed so a
 * trailing space is not a second name, and strict so a stray key is refused rather than dropped.
 */
export const AdministrationNameSchema = z
  .object({
    ar: z.string().trim().min(1).max(200),
    en: z.string().trim().min(1).max(200),
  })
  .strict();

/** A typed short code (OD-05 A): a unit's symbol, a category's code. Optional; unique when set. */
const typedCode = z.string().trim().min(1).max(30);
const description = z.string().trim().max(500);
const sortOrder = z.number().int().min(0);

/** What a duplicate refusal names (`ADMINISTRATION_DUPLICATE`'s detail `field`). */
export const ADMINISTRATION_DUPLICATE_FIELDS = ['name', 'code'] as const;
export type AdministrationDuplicateField = (typeof ADMINISTRATION_DUPLICATE_FIELDS)[number];

// ── Units — `administration_catalog_items`, kind `unit` (§2.3.2) ────────────

/**
 * One collection, kind-discriminated: a later plain name list joins as a kind, never as a
 * collection (IT's rule). Units are the only kind in Phase 1, and one base unit per item (OD-07).
 */
export const ADMINISTRATION_CATALOG_KINDS = ['unit'] as const;
export const AdministrationCatalogKindSchema = z.enum(ADMINISTRATION_CATALOG_KINDS);
export type AdministrationCatalogKind = z.infer<typeof AdministrationCatalogKindSchema>;

export interface AdministrationCatalogItemDto {
  id: string;
  kind: AdministrationCatalogKind;
  code: string | null;
  name: LocalizedString;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const CreateAdministrationCatalogItemSchema = z
  .object({
    kind: AdministrationCatalogKindSchema,
    code: typedCode.optional(),
    name: AdministrationNameSchema,
    description: description.optional(),
    sortOrder: sortOrder.default(0),
  })
  .strict();
export type CreateAdministrationCatalogItem = z.infer<typeof CreateAdministrationCatalogItemSchema>;

/** The kind never changes: a unit stays a unit. `isActive: false` is the deactivation (§5.3). */
export const UpdateAdministrationCatalogItemSchema = z
  .object({
    code: typedCode.nullable().optional(),
    name: AdministrationNameSchema.optional(),
    description: description.nullable().optional(),
    sortOrder: sortOrder.optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAdministrationCatalogItem = z.infer<typeof UpdateAdministrationCatalogItemSchema>;

/** `kind` is required: the list is always one catalog, so a screen never reads two by mistake. */
export const ListAdministrationCatalogItemsQuerySchema = PaginationQuerySchema.extend({
  kind: AdministrationCatalogKindSchema,
  search: z.string().trim().max(200).optional(),
  isActive: booleanQuery().optional(),
}).strict();
export type ListAdministrationCatalogItemsQuery = z.infer<
  typeof ListAdministrationCatalogItemsQuerySchema
>;

// ── Item categories — `administration_item_categories` (§2.3.3) ─────────────

/**
 * Why a parent is refused (`ADMINISTRATION_CATEGORY_PARENT_INVALID`'s detail `code`). Two levels
 * (OD-06 A): a parent must itself be top level, and a category with subcategories never moves.
 */
export const ADMINISTRATION_CATEGORY_PARENT_PROBLEMS = [
  'self',
  'cycle',
  'tooDeep',
  'inactive',
  'hasChildren',
] as const;
export type AdministrationCategoryParentProblem =
  (typeof ADMINISTRATION_CATEGORY_PARENT_PROBLEMS)[number];

export interface AdministrationItemCategoryDto {
  id: string;
  code: string | null;
  name: LocalizedString;
  /** Null for a top-level category. */
  parentId: string | null;
  /** The parent's name, resolved at read time (a retired parent still names itself). */
  parentName: LocalizedString | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const CreateAdministrationItemCategorySchema = z
  .object({
    code: typedCode.optional(),
    name: AdministrationNameSchema,
    /** Absent or null: a top-level category. */
    parentId: objectId().nullable().optional(),
    description: description.optional(),
    sortOrder: sortOrder.default(0),
  })
  .strict();
export type CreateAdministrationItemCategory = z.infer<
  typeof CreateAdministrationItemCategorySchema
>;

/** `parentId: null` moves a subcategory to the top level; the service judges every other move. */
export const UpdateAdministrationItemCategorySchema = z
  .object({
    code: typedCode.nullable().optional(),
    name: AdministrationNameSchema.optional(),
    parentId: objectId().nullable().optional(),
    description: description.nullable().optional(),
    sortOrder: sortOrder.optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAdministrationItemCategory = z.infer<
  typeof UpdateAdministrationItemCategorySchema
>;

export const ListAdministrationItemCategoriesQuerySchema = PaginationQuerySchema.extend({
  /** The subcategories of one category. */
  parentId: objectId().optional(),
  search: z.string().trim().max(200).optional(),
  isActive: booleanQuery().optional(),
}).strict();
export type ListAdministrationItemCategoriesQuery = z.infer<
  typeof ListAdministrationItemCategoriesQuerySchema
>;
