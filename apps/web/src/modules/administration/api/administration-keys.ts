// The module's query keys (ADR-013), in one file because several `*-queries.ts` share them
// (administration-module-decisions-and-phases.md §19.8): `['administration', feature, kind, params]`,
// so a write invalidates exactly its own subtree. The realtime rows repeat the prefixes as literals
// (`platform/realtime/invalidation-registry.ts` imports nothing): `catalogs` and `items` for the two
// catalog topics, `items` for the item topic, `warehouses` for the warehouse topic, `suppliers` for
// the supplier topic and the item-category topic (a supplier row names its categories).
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';

export const ADMINISTRATION_MODULE = 'administration';

/** The feature subtrees a write or a signal invalidates. */
export const administrationKeys = {
  /** Units and item categories: the catalogs screen's lists and the selects' whole lists. */
  catalogs: featureKey(ADMINISTRATION_MODULE, 'catalogs'),
  /** The item register and each item's record. */
  items: featureKey(ADMINISTRATION_MODULE, 'items'),
  /** The warehouse register. */
  warehouses: featureKey(ADMINISTRATION_MODULE, 'warehouses'),
  /** The supplier register and each supplier's record, its papers included (P1b.W). */
  suppliers: featureKey(ADMINISTRATION_MODULE, 'suppliers'),
} as const;

/** One page of a catalogs tab — `kind` keeps the two tabs apart. */
export const catalogListKey = (params: object): readonly unknown[] =>
  listKey(ADMINISTRATION_MODULE, 'catalogs', params);

/** A catalog read whole, for a select — under `catalogs`, so a unit or category write reaches it. */
export const wholeCatalogKey = (kind: 'unit' | 'category'): readonly unknown[] =>
  listKey(ADMINISTRATION_MODULE, 'catalogs', { whole: kind });

export const itemListKey = (params: object): readonly unknown[] =>
  listKey(ADMINISTRATION_MODULE, 'items', params);

export const itemKey = (id: string): readonly unknown[] =>
  detailKey(ADMINISTRATION_MODULE, 'items', id);

export const warehouseListKey = (params: object): readonly unknown[] =>
  listKey(ADMINISTRATION_MODULE, 'warehouses', params);

/** One warehouse, re-read after a stale save — under `warehouses`, so its writes reach it. */
export const warehouseKey = (id: string): readonly unknown[] =>
  detailKey(ADMINISTRATION_MODULE, 'warehouses', id);

/**
 * What the reader may do per branch (`GET /administration/warehouses/branch-options`). Its own
 * subtree: no warehouse write changes a key's reach, so no warehouse signal refetches it.
 */
export const warehouseBranchOptionsKey = (): readonly unknown[] =>
  listKey(ADMINISTRATION_MODULE, 'warehouseBranchOptions');

export const supplierListKey = (params: object): readonly unknown[] =>
  listKey(ADMINISTRATION_MODULE, 'suppliers', params);

export const supplierKey = (id: string): readonly unknown[] =>
  detailKey(ADMINISTRATION_MODULE, 'suppliers', id);

/** The platform's department options, which name a warehouse's department (§19.8). */
export const departmentOptionsKey = (): readonly unknown[] =>
  listKey(ADMINISTRATION_MODULE, 'departmentOptions');

/**
 * The same options with the retired departments too — for NAMING the one a warehouse already
 * points at, never for choosing (`/platform/departments/options?includeInactive=true`).
 */
export const departmentNamesKey = (): readonly unknown[] =>
  listKey(ADMINISTRATION_MODULE, 'departmentOptions', { includeInactive: true });

/** The keeper picker's search: what was typed is the key. */
export const peopleSearchKey = (search: string): readonly unknown[] =>
  listKey(ADMINISTRATION_MODULE, 'people', { search });
