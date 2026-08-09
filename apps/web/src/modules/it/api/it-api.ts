// IT api/ surface (ADR-013): one typed function per IT-1 endpoint, matching the delivered
// backend exactly — no mock data and no client-side fallbacks. Everything the screens show is a
// server fact: `assetCode` is server-allocated (design §2.1) and `status` is server-derived
// (FR-2), so neither is ever computed here.
//
// IT-1 exposes catalogs, vendors and the asset register. Custody (assign/return/transfer/
// dispose), history and export arrive with IT-2/IT-6 and get their functions then.
import {
  type CreateItAsset,
  type CreateItCatalogItem,
  type CreateItVendor,
  type ItAssetDto,
  type ItCatalogItemDto,
  type ItVendorDto,
  type OrgUnitOptionDto,
  type Paginated,
  type UpdateItAsset,
  type UpdateItCatalogItem,
  type UpdateItVendor,
} from '@ecms/contracts';
import {
  buildQuery,
  del,
  get,
  getPage,
  patch,
  post,
  postBinary,
  type QueryParams,
} from '../../../shared/lib/api-client';

export type ItListParams = QueryParams;

/**
 * Branch options for the asset form's required `branchId` (design §2.2 — the data-scope anchor).
 *
 * Read straight from the PLATFORM reference route, not through the Organization module: branches
 * are platform data, and importing another module's hook to reach them would be the cross-module
 * coupling the review checklist forbids. The endpoint is readable by any authenticated user, so
 * the field populates even for a technician without `branch.view`.
 */
export const listBranchOptions = (): Promise<OrgUnitOptionDto[]> =>
  get<OrgUnitOptionDto[]>('/platform/branches/options');

// ── Catalog items (design §2.4 — kind-discriminated: assetCategory | ticketCategory) ─
export const listCatalogItems = (params: ItListParams): Promise<Paginated<ItCatalogItemDto>> =>
  getPage<ItCatalogItemDto>(`/it/catalog-items${buildQuery(params)}`);
export const createCatalogItem = (body: CreateItCatalogItem): Promise<ItCatalogItemDto> =>
  post<ItCatalogItemDto>('/it/catalog-items', body);
export const updateCatalogItem = (
  id: string,
  body: UpdateItCatalogItem,
): Promise<ItCatalogItemDto> => patch<ItCatalogItemDto>(`/it/catalog-items/${id}`, body);

// ── Vendors (design §2.9) ───────────────────────────────────────────────────
export const listVendors = (params: ItListParams): Promise<Paginated<ItVendorDto>> =>
  getPage<ItVendorDto>(`/it/vendors${buildQuery(params)}`);
export const createVendor = (body: CreateItVendor): Promise<ItVendorDto> =>
  post<ItVendorDto>('/it/vendors', body);
export const updateVendor = (id: string, body: UpdateItVendor): Promise<ItVendorDto> =>
  patch<ItVendorDto>(`/it/vendors/${id}`, body);

// ── Asset register (design §2.2, §4.1) ──────────────────────────────────────
export const listAssets = (params: ItListParams): Promise<Paginated<ItAssetDto>> =>
  getPage<ItAssetDto>(`/it/assets${buildQuery(params)}`);
export const getAsset = (id: string): Promise<ItAssetDto> => get<ItAssetDto>(`/it/assets/${id}`);
/** Scan resolve (design §4.2): the QR payload is the plain asset code, so this takes the code. */
export const getAssetByCode = (code: string): Promise<ItAssetDto> =>
  get<ItAssetDto>(`/it/assets/by-code/${encodeURIComponent(code)}`);
export const createAsset = (body: CreateItAsset): Promise<ItAssetDto> =>
  post<ItAssetDto>('/it/assets', body);
export const updateAsset = (id: string, body: UpdateItAsset): Promise<ItAssetDto> =>
  patch<ItAssetDto>(`/it/assets/${id}`, body);
/** FR-5 registered-in-error window only — the server decides, not this call. */
export const deleteAsset = (id: string): Promise<void> => del<void>(`/it/assets/${id}`);

/**
 * Printable label sheet (design §4.2). The server answers with a PDF when the chromium driver is
 * configured and the identical HTML when it is not, so the caller gets both the bytes and the
 * type and decides what to do with them.
 */
export const renderAssetLabels = (
  assetIds: readonly string[],
): Promise<{ contentType: string; blob: Blob }> =>
  postBinary('/it/assets/labels', { assetIds });
