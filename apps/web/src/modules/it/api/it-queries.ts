// TanStack Query hooks for the IT app (ADR-013). Keys follow the platform factory —
// ['it', feature, kind, params] — so every write invalidates exactly its own subtree.
//
// One rule carries this file: an asset mutation invalidates the ASSETS subtree and reseeds the
// detail cache, because the server derives `status` and allocates `assetCode` — a client that
// kept its own copy would show a stale truth the moment either changed.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateItAsset,
  type CreateItCatalogItem,
  type CreateItVendor,
  type ItCatalogKind,
  type UpdateItAsset,
  type UpdateItCatalogItem,
  type UpdateItVendor,
} from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import * as api from './it-api';
import { type ItListParams } from './it-api';

const MODULE = 'it';

// Feature-subtree invalidation targets — internal: every consumer outside this file goes through
// the hooks, never the keys.
const itKeys = {
  assets: featureKey(MODULE, 'assets'),
  catalogs: featureKey(MODULE, 'catalogs'),
  vendors: featureKey(MODULE, 'vendors'),
} as const;

// ── Platform references ─────────────────────────────────────────────────────

/** Branches for the asset form and the list filter. Rarely changes — cached for the session. */
export const useItBranchOptions = () =>
  useQuery({
    queryKey: listKey(MODULE, 'branchOptions'),
    queryFn: api.listBranchOptions,
    staleTime: 5 * 60_000,
  });

// ── Catalog items ───────────────────────────────────────────────────────────

/** Admin list for the catalogs screen — same subtree as the selects' cached lists. */
export const useItCatalogItems = (params: ItListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'catalogs', params),
    queryFn: () => api.listCatalogItems(params),
    placeholderData: (prev) => prev,
  });

/**
 * The active rows of one kind, for a form select. Catalog items are a small fixed list with no
 * server-side `search`, so loading the kind is the intended read — ADR-019 rule 5 governs GROWTH
 * catalogs (vendors, assets), which search instead. `pageSize: 100` is the API's own bound.
 */
export const useItCatalog = (kind: ItCatalogKind) =>
  useQuery({
    queryKey: listKey(MODULE, 'catalogs', { kind, select: true }),
    queryFn: () => api.listCatalogItems({ kind, pageSize: 100, sortBy: 'sortOrder' }),
    staleTime: 60_000,
  });

const useCatalogMutation = <TInput>(mutationFn: (input: TInput) => Promise<unknown>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: itKeys.catalogs });
      // A category rename or archive changes what asset rows and forms display.
      void qc.invalidateQueries({ queryKey: itKeys.assets });
    },
  });
};

export const useCreateItCatalogItem = () =>
  useCatalogMutation((body: CreateItCatalogItem) => api.createCatalogItem(body));
export const useUpdateItCatalogItem = () =>
  useCatalogMutation(({ id, body }: { id: string; body: UpdateItCatalogItem }) =>
    api.updateCatalogItem(id, body),
  );

// ── Vendors ─────────────────────────────────────────────────────────────────

export const useItVendors = (params: ItListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'vendors', params),
    queryFn: () => api.listVendors(params),
    placeholderData: (prev) => prev,
    enabled,
  });

const useVendorMutation = <TInput>(mutationFn: (input: TInput) => Promise<unknown>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: itKeys.vendors });
      void qc.invalidateQueries({ queryKey: itKeys.assets });
    },
  });
};

export const useCreateItVendor = () =>
  useVendorMutation((body: CreateItVendor) => api.createVendor(body));
export const useUpdateItVendor = () =>
  useVendorMutation(({ id, body }: { id: string; body: UpdateItVendor }) =>
    api.updateVendor(id, body),
  );

// ── Assets ──────────────────────────────────────────────────────────────────

/** `enabled` mirrors the caller's §7 permission, so a card never fetches what it may not show. */
export const useItAssets = (params: ItListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'assets', params),
    queryFn: () => api.listAssets(params),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useItAsset = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, 'assets', id),
    queryFn: () => api.getAsset(id),
    enabled: id !== '',
  });

/**
 * Scan resolve. Deliberately NOT cached long: the point of scanning is to see the asset's state
 * right now, and a scan is a deliberate, low-frequency action.
 */
export const useItAssetByCode = (code: string) =>
  useQuery({
    queryKey: listKey(MODULE, 'assets', { byCode: code }),
    queryFn: () => api.getAssetByCode(code),
    enabled: code.trim() !== '',
    retry: false,
    staleTime: 0,
  });

const useAssetMutation = <TInput, TResult extends { id: string } | void>(
  mutationFn: (input: TInput) => Promise<TResult>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (doc) => {
      if (doc !== undefined && doc !== null) {
        qc.setQueryData(detailKey(MODULE, 'assets', doc.id), doc);
      }
      void qc.invalidateQueries({ queryKey: itKeys.assets });
    },
  });
};

export const useCreateItAsset = () =>
  useAssetMutation((body: CreateItAsset) => api.createAsset(body));
export const useUpdateItAsset = () =>
  useAssetMutation(({ id, body }: { id: string; body: UpdateItAsset }) =>
    api.updateAsset(id, body),
  );
export const useDeleteItAsset = () => useAssetMutation((id: string) => api.deleteAsset(id));
