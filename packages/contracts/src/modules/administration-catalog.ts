// Administrative Affairs — the catalog (docs/12-planning/administration-module-design.md §2.3.2–§2.3.4,
// §19.4): units of measure and item categories (P1a.1), and the items that name them (P1a.2).
//
// Master data is organization-wide and never deleted: a row retires with `isActive: false` and keeps
// its name and code, so a retired name is reactivated, never typed again. No schema here takes
// `nameKey`: the service folds it from `name.ar` (`foldName`, §2.1), so a client cannot store two
// spellings of one name as two keys. No schema takes a stock figure either (ADR-024).
import { z } from 'zod';
import { foldName } from '../common/fold-name.js';
import { type LocalizedString } from '../common/localized.js';
import { PaginationQuerySchema, booleanQuery, objectId } from '../common/index.js';

// ── Shared field shapes ─────────────────────────────────────────────────────

/**
 * A master row's name. Both languages required, as every master name is (§2.1), trimmed so a
 * trailing space is not a second name, and strict so a stray key is refused rather than dropped.
 * The Arabic must keep something once folded: a name of tatweel or harakat alone folds to an empty
 * key, which the database cannot store as a name and every such name would share.
 */
export const AdministrationNameSchema = z
  .object({
    ar: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((ar) => foldName(ar) !== '', {
        message: 'the Arabic name needs a letter or a digit, not marks alone',
      }),
    en: z.string().trim().min(1).max(200),
  })
  .strict();

/** A typed short code (OD-05 A): a unit's symbol, a category's code. Optional; unique when set. */
const typedCode = z.string().trim().min(1).max(30);
const description = z.string().trim().max(500);
const sortOrder = z.number().int().min(0);

/**
 * What a duplicate refusal names (`ADMINISTRATION_DUPLICATE`'s detail `field`). An item's barcode
 * has no check of its own before the write: its unique index is the check (§2.3.4).
 */
export const ADMINISTRATION_DUPLICATE_FIELDS = ['name', 'code', 'barcode'] as const;
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

/**
 * `parentId` reads one category's subcategories; `topLevel` reads the level a parent is picked
 * from (true) or every subcategory (false). The two answer one question, so a list takes one.
 */
export const ListAdministrationItemCategoriesQuerySchema = PaginationQuerySchema.extend({
  parentId: objectId().optional(),
  topLevel: booleanQuery().optional(),
  search: z.string().trim().max(200).optional(),
  isActive: booleanQuery().optional(),
})
  .strict()
  .refine((query) => query.parentId === undefined || query.topLevel === undefined, {
    path: ['topLevel'],
    message: 'filter by parentId or by topLevel, not both',
  });
export type ListAdministrationItemCategoriesQuery = z.infer<
  typeof ListAdministrationItemCategoriesQuerySchema
>;

// ── Items — `administration_items` (§2.3.4) ─────────────────────────────────

/**
 * A stock level (OD-09: on the item, OD-08: whole units of its base unit). Zero is a level — "keep
 * none" — so the floor is 0, not 1; the ceiling is a line quantity's (§2.1), a bound no store's
 * level reaches and that keeps every later sum exact.
 */
export const ADMINISTRATION_STOCK_LEVEL_MAX = 1_000_000;
export const AdministrationStockLevelSchema = z
  .number()
  .int()
  .min(0)
  .max(ADMINISTRATION_STOCK_LEVEL_MAX);

/**
 * The three levels, in the order they must keep where set: min ≤ reorder point ≤ max
 * (`ADMINISTRATION_STOCK_LEVELS_ORDER`'s detail `field`, one per field out of order).
 */
export const ADMINISTRATION_STOCK_LEVEL_FIELDS = ['minQty', 'reorderPointQty', 'maxQty'] as const;
export type AdministrationStockLevelField = (typeof ADMINISTRATION_STOCK_LEVEL_FIELDS)[number];

/** What an item names (`ADMINISTRATION_REFERENCE_INACTIVE`'s detail `field`). */
export const ADMINISTRATION_ITEM_REFERENCE_FIELDS = ['unitId', 'categoryId'] as const;
export type AdministrationItemReferenceField =
  (typeof ADMINISTRATION_ITEM_REFERENCE_FIELDS)[number];

/**
 * A printed or supplier barcode, read by a keyboard wedge (OD-05): what a scan types, so no space
 * inside it. Optional; one item per barcode among live items (OD-05 (i)), held by its index.
 */
const barcode = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^\S+$/, { message: 'a barcode has no spaces' });
const notes = z.string().trim().max(2000);

export interface AdministrationItemDto {
  id: string;
  /** «ITM-00001», generated at creation (OD-05 A): permanent, never reused. */
  code: string;
  barcode: string | null;
  name: LocalizedString;
  categoryId: string;
  /** The category's name, resolved at read time (a retired category still names itself). */
  categoryName: LocalizedString | null;
  /** The category's parent when the item names a subcategory; null under a top-level category. */
  categoryParentId: string | null;
  categoryParentName: LocalizedString | null;
  /** The base unit (OD-07). */
  unitId: string;
  unitName: LocalizedString | null;
  minQty: number | null;
  reorderPointQty: number | null;
  maxQty: number | null;
  description: string | null;
  notes: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * No `code`: the server takes it inside the create's transaction (OD-05 A). No stock figure: an
 * item carries none, its stock is the ledger's (ADR-024). The levels' order is the service's rule
 * (422), judged on the row a write leaves, which an update's schema alone cannot see.
 */
export const CreateAdministrationItemSchema = z
  .object({
    barcode: barcode.optional(),
    name: AdministrationNameSchema,
    categoryId: objectId(),
    unitId: objectId(),
    minQty: AdministrationStockLevelSchema.optional(),
    reorderPointQty: AdministrationStockLevelSchema.optional(),
    maxQty: AdministrationStockLevelSchema.optional(),
    description: description.optional(),
    notes: notes.optional(),
  })
  .strict();
export type CreateAdministrationItem = z.infer<typeof CreateAdministrationItemSchema>;

/** `null` clears a barcode or a level; `isActive: false` retires the item (§5.3, OD-70 A). */
export const UpdateAdministrationItemSchema = z
  .object({
    barcode: barcode.nullable().optional(),
    name: AdministrationNameSchema.optional(),
    categoryId: objectId().optional(),
    unitId: objectId().optional(),
    minQty: AdministrationStockLevelSchema.nullable().optional(),
    reorderPointQty: AdministrationStockLevelSchema.nullable().optional(),
    maxQty: AdministrationStockLevelSchema.nullable().optional(),
    description: description.nullable().optional(),
    notes: notes.nullable().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAdministrationItem = z.infer<typeof UpdateAdministrationItemSchema>;

/**
 * `search` reads the code, both names, the folded Arabic name and the barcode, so a scan finds
 * its item (§19.4). `categoryId` reads a category with its subcategories: the register's filter is
 * picked from the top level down, and a top-level category holds its subcategories' items.
 */
export const ListAdministrationItemsQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  categoryId: objectId().optional(),
  unitId: objectId().optional(),
  isActive: booleanQuery().optional(),
}).strict();
export type ListAdministrationItemsQuery = z.infer<typeof ListAdministrationItemsQuerySchema>;
