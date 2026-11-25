// TanStack Query hooks for the catalog (ADR-013): units, item categories and items. Every write
// invalidates exactly the subtrees its row is shown in — a unit or category is named on every item
// row and record (`unitName`, `categoryName`, `categoryParentName`), so its writes reach `items`
// too — and a refusal for a moved `version` (409 `STALE_DOCUMENT`) re-reads them as well, so the
// screen behind the dialog shows the row as it now is.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  ErrorCodes,
  type AdministrationCatalogItemDto,
  type AdministrationItemCategoryDto,
  type AdministrationItemDto,
  type CreateAdministrationCatalogItem,
  type CreateAdministrationItem,
  type CreateAdministrationItemCategory,
  type UpdateAdministrationCatalogItem,
  type UpdateAdministrationItem,
  type UpdateAdministrationItemCategory,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import {
  administrationKeys,
  catalogListKey,
  itemKey,
  itemListKey,
  wholeCatalogKey,
} from './administration-keys';
import * as api from './catalog-api';
import { type AdministrationListParams } from './catalog-api';

/**
 * What a write does once the server answers: a success re-reads every subtree its row is shown
 * in; a refusal for a moved `version` (409 `STALE_DOCUMENT`) re-reads them too, so the screen
 * behind the dialog shows the row as it now is; any other refusal changed nothing, so nothing is
 * re-read. Pure over the client, so a spec proves each answer without a browser.
 */
export const writeCallbacks = (
  qc: QueryClient,
  subtrees: readonly (readonly unknown[])[],
): { onSuccess: () => void; onError: (error: unknown) => void } => {
  const reread = (): void => {
    for (const queryKey of subtrees) void qc.invalidateQueries({ queryKey });
  };
  return {
    onSuccess: reread,
    onError: (error) => {
      if (error instanceof ApiError && error.code === ErrorCodes.STALE_DOCUMENT) reread();
    },
  };
};

/** A write, and the subtrees its success — or its stale refusal — re-reads. */
export const useAdministrationWrite = <TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  subtrees: readonly (readonly unknown[])[],
) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn, ...writeCallbacks(qc, subtrees) });
};

// ── The catalogs screen's lists ─────────────────────────────────────────────

export const useAdministrationUnits = (params: AdministrationListParams, enabled = true) =>
  useQuery({
    queryKey: catalogListKey({ kind: 'unit', ...params }),
    queryFn: () => api.listUnits(params),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useAdministrationCategories = (params: AdministrationListParams, enabled = true) =>
  useQuery({
    queryKey: catalogListKey({ kind: 'category', ...params }),
    queryFn: () => api.listCategories(params),
    placeholderData: (prev) => prev,
    enabled,
  });

// ── The selects' whole lists ────────────────────────────────────────────────

/**
 * Every unit, retired ones too: a select offers the active ones and keeps a retired current value
 * visible (IT's `ItCatalogSelect` rule). Readable under `administrationItem.view` or
 * `administrationCatalog.manage`.
 */
export const useWholeUnits = (enabled = true) =>
  useQuery({
    queryKey: wholeCatalogKey('unit'),
    queryFn: () => api.readWhole(api.listUnits),
    staleTime: 60_000,
    enabled,
  });

/** Every item category, both levels and retired ones too — the selects filter what they offer. */
export const useWholeCategories = (enabled = true) =>
  useQuery({
    queryKey: wholeCatalogKey('category'),
    queryFn: () => api.readWhole(api.listCategories),
    staleTime: 60_000,
    enabled,
  });

// ── A record as it now is, after a stale save ───────────────────────────────
// The open form rebases on it: the reader sees what was saved meanwhile, and the next Save is
// judged against the version it carries. Units and categories have no read by id, so they are
// found in their catalog read whole, fetched afresh; null when the row is no longer there.

export const useRereadUnit = (): ((id: string) => Promise<AdministrationCatalogItemDto | null>) => {
  const qc = useQueryClient();
  return async (id) => {
    const units = await qc.fetchQuery({
      queryKey: wholeCatalogKey('unit'),
      queryFn: () => api.readWhole(api.listUnits),
      staleTime: 0,
    });
    return units.find((unit) => unit.id === id) ?? null;
  };
};

export const useRereadCategory = (): ((
  id: string,
) => Promise<AdministrationItemCategoryDto | null>) => {
  const qc = useQueryClient();
  return async (id) => {
    const categories = await qc.fetchQuery({
      queryKey: wholeCatalogKey('category'),
      queryFn: () => api.readWhole(api.listCategories),
      staleTime: 0,
    });
    return categories.find((category) => category.id === id) ?? null;
  };
};

export const useRereadItem = (): ((id: string) => Promise<AdministrationItemDto>) => {
  const qc = useQueryClient();
  return (id) =>
    qc.fetchQuery({ queryKey: itemKey(id), queryFn: () => api.getItem(id), staleTime: 0 });
};

// ── Catalog writes ──────────────────────────────────────────────────────────

/** A unit or a category is named on every item row and record, so its writes reach `items` too. */
export const CATALOG_SUBTREES = [administrationKeys.catalogs, administrationKeys.items] as const;

/** An item is shown on the item screens only. */
export const ITEM_SUBTREES = [administrationKeys.items] as const;

export const useCreateUnit = () =>
  useAdministrationWrite(
    (body: Omit<CreateAdministrationCatalogItem, 'kind'>) => api.createUnit(body),
    CATALOG_SUBTREES,
  );

export const useUpdateUnit = () =>
  useAdministrationWrite(
    ({ id, body }: { id: string; body: UpdateAdministrationCatalogItem }) =>
      api.updateUnit(id, body),
    CATALOG_SUBTREES,
  );

export const useCreateCategory = () =>
  useAdministrationWrite(
    (body: CreateAdministrationItemCategory) => api.createCategory(body),
    CATALOG_SUBTREES,
  );

export const useUpdateCategory = () =>
  useAdministrationWrite(
    ({ id, body }: { id: string; body: UpdateAdministrationItemCategory }) =>
      api.updateCategory(id, body),
    CATALOG_SUBTREES,
  );

// ── Items ───────────────────────────────────────────────────────────────────

export const useAdministrationItems = (params: AdministrationListParams, enabled = true) =>
  useQuery({
    queryKey: itemListKey(params),
    queryFn: () => api.listItems(params),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useAdministrationItem = (id: string) =>
  useQuery({
    queryKey: itemKey(id),
    queryFn: () => api.getItem(id),
    enabled: id !== '',
    retry: false,
  });

export const useCreateItem = () =>
  useAdministrationWrite((body: CreateAdministrationItem) => api.createItem(body), ITEM_SUBTREES);

export const useUpdateItem = () =>
  useAdministrationWrite(
    ({ id, body }: { id: string; body: UpdateAdministrationItem }) => api.updateItem(id, body),
    ITEM_SUBTREES,
  );
