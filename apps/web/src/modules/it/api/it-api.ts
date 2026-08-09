// IT api/ surface (ADR-013): one typed function per IT-1 endpoint, matching the delivered
// backend exactly — no mock data and no client-side fallbacks. Everything the screens show is a
// server fact: `assetCode` is server-allocated (design §2.1) and `status` is server-derived
// (FR-2), so neither is ever computed here.
//
// IT-1 exposed catalogs, vendors and the asset register; IT-2 adds the custody lifecycle and its
// history. Export arrives with IT-6 and gets its function then.
import {
  type EmployeeDto,
  type AssignItAsset,
  type CreateItAsset,
  type CreateItCatalogItem,
  type CreateItVendor,
  type DisposeItAsset,
  type ItAssetAssignmentDto,
  type ItAssetDto,
  type ItAssetHistoryEntryDto,
  type ItCatalogItemDto,
  type ItVendorDto,
  type OrgUnitOptionDto,
  type Paginated,
  type ReturnItAsset,
  type TransferItAsset,
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

/**
 * Employee search for the custody picker (ADR-019 rule 5 — searched, never loaded).
 *
 * Custody references employees, which the design establishes as a live HR integration (§9.1), so
 * this depends on HR's PUBLIC HTTP surface — deliberately as a URL rather than by importing HR's
 * api module, which would be the code-level cross-module coupling the review checklist forbids.
 * Gated server-side by `employee.view`; the picker says so rather than searching into a 403.
 */
export const searchEmployees = (
  search: string,
  pageSize = 8,
): Promise<Paginated<EmployeeDto>> =>
  getPage<EmployeeDto>(`/hr/employees${buildQuery({ search, employed: true, pageSize })}`);

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
/** Resolve-by-id for the picker — the other half of ADR-019 rule 5. */
export const getVendor = (id: string): Promise<ItVendorDto> =>
  get<ItVendorDto>(`/it/vendors/${id}`);
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

// ── Custody (design §4.3) ───────────────────────────────────────────────────
// Four NAMED actions, matching the API exactly. Each answers with the ASSET in its new state, so
// the caller never re-fetches to learn what its own action did — and never derives `status`
// itself, which stays a server fact (FR-2).

export const assignAsset = (id: string, body: AssignItAsset): Promise<ItAssetDto> =>
  post<ItAssetDto>(`/it/assets/${id}/assign`, body);
export const returnAsset = (id: string, body: ReturnItAsset): Promise<ItAssetDto> =>
  post<ItAssetDto>(`/it/assets/${id}/return`, body);
export const transferAsset = (id: string, body: TransferItAsset): Promise<ItAssetDto> =>
  post<ItAssetDto>(`/it/assets/${id}/transfer`, body);
export const disposeAsset = (id: string, body: DisposeItAsset): Promise<ItAssetDto> =>
  post<ItAssetDto>(`/it/assets/${id}/dispose`, body);

/** The asset's business history — rendered from `it_asset_events`, never from the audit trail. */
export const listAssetHistory = (
  id: string,
  params: ItListParams,
): Promise<Paginated<ItAssetHistoryEntryDto>> =>
  getPage<ItAssetHistoryEntryDto>(`/it/assets/${id}/history${buildQuery(params)}`);

/** One asset's custody intervals. */
export const listAssetAssignments = (
  id: string,
  params: ItListParams,
): Promise<Paginated<ItAssetAssignmentDto>> =>
  getPage<ItAssetAssignmentDto>(`/it/assets/${id}/assignments${buildQuery(params)}`);

/** The cross-asset custody register — "what is out, and who has it". */
export const listAssignments = (
  params: ItListParams,
): Promise<Paginated<ItAssetAssignmentDto>> =>
  getPage<ItAssetAssignmentDto>(`/it/assignments${buildQuery(params)}`);
