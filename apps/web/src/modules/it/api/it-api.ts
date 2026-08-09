// IT api/ surface (ADR-013): one typed function per IT-1 endpoint, matching the delivered
// backend exactly — no mock data and no client-side fallbacks. Everything the screens show is a
// server fact: `assetCode` is server-allocated (design §2.1) and `status` is server-derived
// (FR-2), so neither is ever computed here.
//
// IT-1 exposed catalogs, vendors and the asset register; IT-2 added the custody lifecycle and its
// history; IT-3 added the help desk; IT-4 adds maintenance and the spare-parts store. Export
// arrives with IT-6 and gets its function then.
import {
  type EmployeeDto,
  type FileCategoryDto,
  type FileDto,
  type AssignItAsset,
  type AssignItTicket,
  type CancelItMaintenanceOrder,
  type CompleteItMaintenanceOrder,
  type CreateItMaintenanceOrder,
  type CreateItMaintenancePlan,
  type CreateItSparePart,
  type ItMaintenanceOrderDto,
  type ItMaintenancePlanDto,
  type ItSparePartDto,
  type ItSparePartMovementDto,
  type ReceiveItSparePart,
  type StartItMaintenanceOrder,
  type UpdateItMaintenanceOrder,
  type UpdateItMaintenancePlan,
  type UpdateItSparePart,
  type CancelItTicket,
  type ChangeItTicketStatus,
  type CloseItTicket,
  type CreateItTicket,
  type CreateItTicketComment,
  type CreateItTicketPriority,
  type ItTicketDto,
  type ItTicketEventDto,
  type ItTicketPriorityDto,
  type ReopenItTicket,
  type ResolveItTicket,
  type UpdateItTicket,
  type UpdateItTicketPriority,
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
  type UserDto,
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
  upload,
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

// ── Help desk: priorities (design §2.6 — the priority IS the SLA policy) ────
export const listTicketPriorities = (
  params: ItListParams,
): Promise<Paginated<ItTicketPriorityDto>> =>
  getPage<ItTicketPriorityDto>(`/it/ticket-priorities${buildQuery(params)}`);
export const createTicketPriority = (
  body: CreateItTicketPriority,
): Promise<ItTicketPriorityDto> => post<ItTicketPriorityDto>('/it/ticket-priorities', body);
export const updateTicketPriority = (
  id: string,
  body: UpdateItTicketPriority,
): Promise<ItTicketPriorityDto> =>
  patch<ItTicketPriorityDto>(`/it/ticket-priorities/${id}`, body);

// ── Help desk: tickets (design §4.4) ────────────────────────────────────────
export const listTickets = (params: ItListParams): Promise<Paginated<ItTicketDto>> =>
  getPage<ItTicketDto>(`/it/tickets${buildQuery(params)}`);
export const getTicket = (id: string): Promise<ItTicketDto> =>
  get<ItTicketDto>(`/it/tickets/${id}`);
export const createTicket = (body: CreateItTicket): Promise<ItTicketDto> =>
  post<ItTicketDto>('/it/tickets', body);
export const updateTicket = (id: string, body: UpdateItTicket): Promise<ItTicketDto> =>
  patch<ItTicketDto>(`/it/tickets/${id}`, body);

// Transitions. Each answers with the ticket in its new state, so nothing is re-derived here.
export const assignTicket = (id: string, body: AssignItTicket): Promise<ItTicketDto> =>
  post<ItTicketDto>(`/it/tickets/${id}/assign`, body);
export const changeTicketStatus = (
  id: string,
  body: ChangeItTicketStatus,
): Promise<ItTicketDto> => post<ItTicketDto>(`/it/tickets/${id}/status`, body);
export const resolveTicket = (id: string, body: ResolveItTicket): Promise<ItTicketDto> =>
  post<ItTicketDto>(`/it/tickets/${id}/resolve`, body);
export const closeTicket = (id: string, body: CloseItTicket): Promise<ItTicketDto> =>
  post<ItTicketDto>(`/it/tickets/${id}/close`, body);
export const reopenTicket = (id: string, body: ReopenItTicket): Promise<ItTicketDto> =>
  post<ItTicketDto>(`/it/tickets/${id}/reopen`, body);
export const cancelTicket = (id: string, body: CancelItTicket): Promise<ItTicketDto> =>
  post<ItTicketDto>(`/it/tickets/${id}/cancel`, body);

/**
 * The ticket's stream — history AND conversation in one list (design §2.6).
 *
 * Internal comments are filtered SERVER-side for callers without `itTicket.edit` (FR-7); this
 * client never sees them, which is why there is no "hide internal" flag to pass.
 */
export const listTicketComments = (
  id: string,
  params: ItListParams,
): Promise<Paginated<ItTicketEventDto>> =>
  getPage<ItTicketEventDto>(`/it/tickets/${id}/comments${buildQuery(params)}`);
export const createTicketComment = (
  id: string,
  body: CreateItTicketComment,
): Promise<ItTicketEventDto> => post<ItTicketEventDto>(`/it/tickets/${id}/comments`, body);

/** Technician picker — platform users, the same public surface the org screens read. */
export const searchUsers = (search: string, pageSize = 8): Promise<Paginated<UserDto>> =>
  getPage<UserDto>(`/platform/users${buildQuery({ search, status: 'active', pageSize })}`);

/**
 * Resolve one user by id — the other half of ADR-019 rule 5, and what turns a stored
 * `requesterUserId` / `assignedTechnicianUserId` into a name. Gated by `user.view`; a caller
 * without it sees a short reference instead, never an unexplained 403.
 */
export const getUser = (id: string): Promise<UserDto> => get<UserDto>(`/platform/users/${id}`);

// ── Ticket attachments (design §2 files row, §15) ───────────────────────────
//
// "Additive attachments · NO NEW UPLOAD PATH". IT mints no upload endpoint of its own: the
// platform Files service already takes the owning `entityRef` from the caller, so a ticket
// attachment is an ordinary platform file tagged `it/ticket/<id>`. Gated by the platform's own
// `file.view` / `file.create` — no IT permission is invented for it.
//
// Direct ticket attachments are PUBLIC to anyone who can see the ticket (design §13-Q9), which is
// why they carry no visibility decision here.

export const listTicketAttachments = (ticketId: string): Promise<Paginated<FileDto>> =>
  getPage<FileDto>(
    `/platform/files${buildQuery({
      moduleId: 'it',
      entityType: 'ticket',
      entityId: ticketId,
      pageSize: 50,
    })}`,
  );

export const uploadTicketAttachment = (
  ticketId: string,
  file: File,
  categoryId: string,
): Promise<FileDto> => {
  const form = new FormData();
  form.append('file', file);
  form.append('moduleId', 'it');
  form.append('entityType', 'ticket');
  form.append('entityId', ticketId);
  form.append('categoryId', categoryId);
  return upload<FileDto>('/platform/files', form);
};

/**
 * One comment's attachments. Same platform surface, a different `entityType` — and the server now
 * refuses these for anyone who may not read the parent comment (ADR-023 + FR-7), so an internal
 * note's file is unreachable even with its id.
 */
export const listCommentAttachments = (commentId: string): Promise<Paginated<FileDto>> =>
  getPage<FileDto>(
    `/platform/files${buildQuery({
      moduleId: 'it',
      entityType: 'ticketComment',
      entityId: commentId,
      pageSize: 20,
    })}`,
  );

export const uploadCommentAttachment = (
  commentId: string,
  file: File,
  categoryId: string,
): Promise<FileDto> => {
  const form = new FormData();
  form.append('file', file);
  form.append('moduleId', 'it');
  form.append('entityType', 'ticketComment');
  form.append('entityId', commentId);
  form.append('categoryId', categoryId);
  return upload<FileDto>('/platform/files', form);
};

/** The category the upload must name. Read once and cached — it is platform reference data. */
export const listFileCategories = (): Promise<Paginated<FileCategoryDto>> =>
  getPage<FileCategoryDto>(`/platform/file-categories${buildQuery({ pageSize: 100 })}`);

// ── Maintenance plans (design §2.7, §4.6) ───────────────────────────────────
//
// Activate/deactivate are NAMED actions, matching the API: pausing a schedule is an operational
// decision and the one thing that takes a plan out of the sweep's sight — not a PATCH field.

export const listMaintenancePlans = (
  params: ItListParams,
): Promise<Paginated<ItMaintenancePlanDto>> =>
  getPage<ItMaintenancePlanDto>(`/it/maintenance-plans${buildQuery(params)}`);
export const getMaintenancePlan = (id: string): Promise<ItMaintenancePlanDto> =>
  get<ItMaintenancePlanDto>(`/it/maintenance-plans/${id}`);
export const createMaintenancePlan = (
  body: CreateItMaintenancePlan,
): Promise<ItMaintenancePlanDto> => post<ItMaintenancePlanDto>('/it/maintenance-plans', body);
export const updateMaintenancePlan = (
  id: string,
  body: UpdateItMaintenancePlan,
): Promise<ItMaintenancePlanDto> =>
  patch<ItMaintenancePlanDto>(`/it/maintenance-plans/${id}`, body);
export const setMaintenancePlanActive = (
  id: string,
  active: boolean,
): Promise<ItMaintenancePlanDto> =>
  post<ItMaintenancePlanDto>(
    `/it/maintenance-plans/${id}/${active ? 'activate' : 'deactivate'}`,
    {},
  );

// ── Maintenance orders (design §2.7, §4.7) ──────────────────────────────────
//
// Three NAMED transitions, each answering with the order in its new state — so the caller never
// re-derives a status, and never guesses what its own action did.

export const listMaintenanceOrders = (
  params: ItListParams,
): Promise<Paginated<ItMaintenanceOrderDto>> =>
  getPage<ItMaintenanceOrderDto>(`/it/maintenance-orders${buildQuery(params)}`);
export const getMaintenanceOrder = (id: string): Promise<ItMaintenanceOrderDto> =>
  get<ItMaintenanceOrderDto>(`/it/maintenance-orders/${id}`);
export const createMaintenanceOrder = (
  body: CreateItMaintenanceOrder,
): Promise<ItMaintenanceOrderDto> => post<ItMaintenanceOrderDto>('/it/maintenance-orders', body);
export const updateMaintenanceOrder = (
  id: string,
  body: UpdateItMaintenanceOrder,
): Promise<ItMaintenanceOrderDto> =>
  patch<ItMaintenanceOrderDto>(`/it/maintenance-orders/${id}`, body);

export const startMaintenanceOrder = (
  id: string,
  body: StartItMaintenanceOrder,
): Promise<ItMaintenanceOrderDto> =>
  post<ItMaintenanceOrderDto>(`/it/maintenance-orders/${id}/start`, body);
export const completeMaintenanceOrder = (
  id: string,
  body: CompleteItMaintenanceOrder,
): Promise<ItMaintenanceOrderDto> =>
  post<ItMaintenanceOrderDto>(`/it/maintenance-orders/${id}/complete`, body);
export const cancelMaintenanceOrder = (
  id: string,
  body: CancelItMaintenanceOrder,
): Promise<ItMaintenanceOrderDto> =>
  post<ItMaintenanceOrderDto>(`/it/maintenance-orders/${id}/cancel`, body);

/**
 * The parts an order consumed. They are movement ROWS keyed by `orderId` (ADR-024), not a list
 * stored on the order — so this is a second read rather than a field, and that is deliberate: one
 * source of truth, and no drift between an embedded copy and the ledger.
 */
export const listMaintenanceOrderParts = (id: string): Promise<ItSparePartMovementDto[]> =>
  get<ItSparePartMovementDto[]>(`/it/maintenance-orders/${id}/parts`);

// ── Spare parts and the ledger (ADR-024) ────────────────────────────────────
//
// There is NO consume function here, and its absence is the design: stock leaves the store only
// through a maintenance order's completion (FR-9), so `completeMaintenanceOrder` above is the only
// caller that ever writes a negative movement.

export const listSpareParts = (params: ItListParams): Promise<Paginated<ItSparePartDto>> =>
  getPage<ItSparePartDto>(`/it/spare-parts${buildQuery(params)}`);
export const getSparePart = (id: string): Promise<ItSparePartDto> =>
  get<ItSparePartDto>(`/it/spare-parts/${id}`);
export const createSparePart = (body: CreateItSparePart): Promise<ItSparePartDto> =>
  post<ItSparePartDto>('/it/spare-parts', body);
export const updateSparePart = (id: string, body: UpdateItSparePart): Promise<ItSparePartDto> =>
  patch<ItSparePartDto>(`/it/spare-parts/${id}`, body);

/** A receipt answers with BOTH the new level and the row that moved it — the ledger is the point. */
export const receiveSparePart = (
  id: string,
  body: ReceiveItSparePart,
): Promise<{ part: ItSparePartDto; movement: ItSparePartMovementDto }> =>
  post<{ part: ItSparePartDto; movement: ItSparePartMovementDto }>(
    `/it/spare-parts/${id}/receipts`,
    body,
  );

export const listSparePartMovements = (
  id: string,
  params: ItListParams,
): Promise<Paginated<ItSparePartMovementDto>> =>
  getPage<ItSparePartMovementDto>(`/it/spare-parts/${id}/movements${buildQuery(params)}`);
