// Gold module api/ surface (ADR-013): one typed function per endpoint the ported backend exposes.
// Nothing is computed here and there is no client-side fallback — the receipt numbers, the drawer
// counters and the report balances are all server facts.
//
// Three of these functions read OTHER modules' public endpoints, and they are the three
// integrations this port exists for: the employee list (crew leader and both vault custodians),
// the Fleet vehicle list (the vehicle number on a receiving receipt), and the platform's branch
// list. Each is the module's own call to a published endpoint — Gold never imports HR's, Fleet's
// or the platform's code.
import {
  type CreateGoldBar,
  type CreateGoldCompany,
  type CreateGoldDelivery,
  type CreateGoldFloor,
  type CreateGoldKeyHandover,
  type CreateGoldReceiving,
  type CreateGoldRepresentative,
  type CreateGoldTransfer,
  type CreateGoldVault,
  type EmployeeDto,
  type FileCategoryDto,
  type FileDto,
  type FleetVehicleDto,
  type GenerateGoldLayout,
  type ChangeGoldPortalAccountStatus,
  type CreateGoldPortalAccount,
  type GoldBarDto,
  type GoldPortalAccountCreatedDto,
  type GoldPortalAccountDto,
  type UpdateGoldPortalAccount,
  type GoldBarFacetsDto,
  type GoldBarHistoryDto,
  type GoldClientBalancesDto,
  type GoldCompanyDto,
  type GoldDashboardChartsDto,
  type GoldDashboardStatsDto,
  type GoldDeliveryReceiptDto,
  type GoldDrawerDetailDto,
  type GoldDrawerDto,
  type GoldFloorDto,
  type GoldFundClosingDto,
  type GoldFundMovementDto,
  type GoldKeyHandoverDto,
  type GoldKeysOverviewDto,
  type GoldLayoutPreviewDto,
  type GoldNextNumberDto,
  type GoldPrintResultDto,
  type GoldReceivingReceiptDto,
  type GoldRepresentativeDto,
  type GoldTransferDto,
  type GoldVaultDto,
  type OrgUnitDto,
  type Paginated,
  type PreviewGoldLayout,
  type ReorderGoldItems,
  type UpdateGoldBar,
  type UpdateGoldCompany,
  type UpdateGoldDelivery,
  type UpdateGoldFloor,
  type UpdateGoldReceiving,
  type UpdateGoldRepresentative,
  type UpdateGoldTransfer,
  type UpdateGoldVault,
} from '@ecms/contracts';
import {
  buildQuery,
  del,
  get,
  getPage,
  patch,
  post,
  upload,
  type QueryParams,
} from '../../../shared/lib/api-client';

export type GoldListParams = QueryParams;

// ── Integration reads (other modules' published endpoints) ─────────────────

/** Integration 1 + 2 — the people picker behind the crew leader and both vault custodians. */
export const searchEmployees = (search: string, pageSize = 10): Promise<Paginated<EmployeeDto>> =>
  getPage<EmployeeDto>(`/hr/employees${buildQuery({ search, employed: true, pageSize })}`);

export const getEmployee = (id: string): Promise<EmployeeDto> =>
  get<EmployeeDto>(`/hr/employees/${id}`);

/** Integration 1 — the vehicle whose plate the receiving receipt prints. */
export const searchVehicles = (
  search: string,
  pageSize = 10,
): Promise<Paginated<FleetVehicleDto>> =>
  getPage<FleetVehicleDto>(`/fleet/vehicles${buildQuery({ search, pageSize })}`);

/** Integration 3 — the ECMS branches every gold document is stamped with. */
export const listBranches = (): Promise<Paginated<OrgUnitDto>> =>
  getPage<OrgUnitDto>(`/platform/organization/branches${buildQuery({ pageSize: 100 })}`);

// ── Companies / funds ──────────────────────────────────────────────────────
export const listCompanies = (params: GoldListParams): Promise<Paginated<GoldCompanyDto>> =>
  getPage<GoldCompanyDto>(`/gold/companies${buildQuery(params)}`);
export const createCompany = (body: CreateGoldCompany): Promise<GoldCompanyDto> =>
  post<GoldCompanyDto>('/gold/companies', body);
export const updateCompany = (id: string, body: UpdateGoldCompany): Promise<GoldCompanyDto> =>
  patch<GoldCompanyDto>(`/gold/companies/${id}`, body);
export const deleteCompany = (id: string): Promise<void> => del<void>(`/gold/companies/${id}`);

/** The company logo, through the platform Files service (the port's answer to Cloudinary). */
export const listFileCategories = (): Promise<Paginated<FileCategoryDto>> =>
  getPage<FileCategoryDto>(`/platform/file-categories${buildQuery({ pageSize: 50 })}`);
export const uploadCompanyLogo = (file: File, categoryId: string): Promise<FileDto> => {
  const form = new FormData();
  form.append('file', file);
  form.append('moduleId', 'gold');
  form.append('entityType', 'company');
  form.append('categoryId', categoryId);
  return upload<FileDto>('/platform/files', form);
};

// ── Representatives ────────────────────────────────────────────────────────
export const listRepresentatives = (
  params: GoldListParams,
): Promise<Paginated<GoldRepresentativeDto>> =>
  getPage<GoldRepresentativeDto>(`/gold/representatives${buildQuery(params)}`);
export const createRepresentative = (
  body: CreateGoldRepresentative,
): Promise<GoldRepresentativeDto> => post<GoldRepresentativeDto>('/gold/representatives', body);
export const updateRepresentative = (
  id: string,
  body: UpdateGoldRepresentative,
): Promise<GoldRepresentativeDto> =>
  patch<GoldRepresentativeDto>(`/gold/representatives/${id}`, body);
export const deleteRepresentative = (id: string): Promise<void> =>
  del<void>(`/gold/representatives/${id}`);

// ── Floors ─────────────────────────────────────────────────────────────────
export const listFloors = (): Promise<GoldFloorDto[]> => get<GoldFloorDto[]>('/gold/floors');
export const createFloor = (body: CreateGoldFloor): Promise<GoldFloorDto> =>
  post<GoldFloorDto>('/gold/floors', body);
export const updateFloor = (id: string, body: UpdateGoldFloor): Promise<GoldFloorDto> =>
  patch<GoldFloorDto>(`/gold/floors/${id}`, body);
export const reorderFloors = (body: ReorderGoldItems): Promise<void> =>
  patch<void>('/gold/floors/reorder', body);
export const deleteFloor = (id: string): Promise<void> => del<void>(`/gold/floors/${id}`);

// ── Vaults and drawers ─────────────────────────────────────────────────────
export const listVaults = (params: GoldListParams): Promise<Paginated<GoldVaultDto>> =>
  getPage<GoldVaultDto>(`/gold/vaults${buildQuery(params)}`);
export const createVault = (body: CreateGoldVault): Promise<GoldVaultDto> =>
  post<GoldVaultDto>('/gold/vaults', body);
export const updateVault = (id: string, body: UpdateGoldVault): Promise<GoldVaultDto> =>
  patch<GoldVaultDto>(`/gold/vaults/${id}`, body);
export const deleteVault = (id: string): Promise<void> => del<void>(`/gold/vaults/${id}`);
export const reorderVaults = (body: ReorderGoldItems): Promise<void> =>
  patch<void>('/gold/vaults/reorder', body);
export const previewLayout = (body: PreviewGoldLayout): Promise<GoldLayoutPreviewDto> =>
  post<GoldLayoutPreviewDto>('/gold/vaults/preview-layout', body);
export const generateLayout = (
  id: string,
  body: GenerateGoldLayout,
): Promise<{ vault: GoldVaultDto; drawerCount: number }> =>
  post<{ vault: GoldVaultDto; drawerCount: number }>(`/gold/vaults/${id}/generate-layout`, body);
export const reshapeLayout = (
  id: string,
  body: GenerateGoldLayout,
): Promise<{ vault: GoldVaultDto; drawerCount: number }> =>
  post<{ vault: GoldVaultDto; drawerCount: number }>(`/gold/vaults/${id}/reshape-layout`, body);
export const listVaultDrawers = (vaultId: string): Promise<GoldDrawerDto[]> =>
  get<GoldDrawerDto[]>(`/gold/vaults/${vaultId}/drawers`);
export const getDrawer = (drawerId: string): Promise<GoldDrawerDetailDto> =>
  get<GoldDrawerDetailDto>(`/gold/drawers/${drawerId}`);

// ── Bars ───────────────────────────────────────────────────────────────────
export const listBars = (params: GoldListParams): Promise<Paginated<GoldBarDto>> =>
  getPage<GoldBarDto>(`/gold/bars${buildQuery(params)}`);
export const getBarFacets = (): Promise<GoldBarFacetsDto> =>
  get<GoldBarFacetsDto>('/gold/bars/facets');
export const getBarHistory = (id: string): Promise<GoldBarHistoryDto> =>
  get<GoldBarHistoryDto>(`/gold/bars/${id}/history`);
export const createBar = (body: CreateGoldBar): Promise<GoldBarDto> =>
  post<GoldBarDto>('/gold/bars', body);
export const updateBar = (id: string, body: UpdateGoldBar): Promise<GoldBarDto> =>
  patch<GoldBarDto>(`/gold/bars/${id}`, body);

// ── Receiving ──────────────────────────────────────────────────────────────
export const listReceiving = (
  params: GoldListParams,
): Promise<Paginated<GoldReceivingReceiptDto>> =>
  getPage<GoldReceivingReceiptDto>(`/gold/receiving${buildQuery(params)}`);
export const getReceiving = (id: string): Promise<GoldReceivingReceiptDto> =>
  get<GoldReceivingReceiptDto>(`/gold/receiving/${id}`);
export const receivingNextNumber = (): Promise<GoldNextNumberDto> =>
  get<GoldNextNumberDto>('/gold/receiving/next-number');
export const createReceiving = (body: CreateGoldReceiving): Promise<GoldReceivingReceiptDto> =>
  post<GoldReceivingReceiptDto>('/gold/receiving', body);
export const updateReceiving = (
  id: string,
  body: UpdateGoldReceiving,
): Promise<GoldReceivingReceiptDto> =>
  patch<GoldReceivingReceiptDto>(`/gold/receiving/${id}`, body);
export const confirmReceiving = (id: string, version: number): Promise<GoldReceivingReceiptDto> =>
  post<GoldReceivingReceiptDto>(`/gold/receiving/${id}/confirm`, { version });
export const revertReceiving = (id: string, version: number): Promise<GoldReceivingReceiptDto> =>
  post<GoldReceivingReceiptDto>(`/gold/receiving/${id}/revert`, { version });
export const printReceiving = (id: string): Promise<GoldPrintResultDto> =>
  post<GoldPrintResultDto>(`/gold/receiving/${id}/print`, {});

// ── Delivery ───────────────────────────────────────────────────────────────
export const listDelivery = (params: GoldListParams): Promise<Paginated<GoldDeliveryReceiptDto>> =>
  getPage<GoldDeliveryReceiptDto>(`/gold/delivery${buildQuery(params)}`);
export const getDelivery = (id: string): Promise<GoldDeliveryReceiptDto> =>
  get<GoldDeliveryReceiptDto>(`/gold/delivery/${id}`);
export const deliveryNextNumber = (): Promise<GoldNextNumberDto> =>
  get<GoldNextNumberDto>('/gold/delivery/next-number');
export const createDelivery = (body: CreateGoldDelivery): Promise<GoldDeliveryReceiptDto> =>
  post<GoldDeliveryReceiptDto>('/gold/delivery', body);
export const updateDelivery = (
  id: string,
  body: UpdateGoldDelivery,
): Promise<GoldDeliveryReceiptDto> => patch<GoldDeliveryReceiptDto>(`/gold/delivery/${id}`, body);
export const confirmDelivery = (id: string, version: number): Promise<GoldDeliveryReceiptDto> =>
  post<GoldDeliveryReceiptDto>(`/gold/delivery/${id}/confirm`, { version });
export const revertDelivery = (id: string, version: number): Promise<GoldDeliveryReceiptDto> =>
  post<GoldDeliveryReceiptDto>(`/gold/delivery/${id}/revert`, { version });
export const printDelivery = (id: string): Promise<GoldPrintResultDto> =>
  post<GoldPrintResultDto>(`/gold/delivery/${id}/print`, {});

// ── Transfers ──────────────────────────────────────────────────────────────
export const listTransfers = (params: GoldListParams): Promise<Paginated<GoldTransferDto>> =>
  getPage<GoldTransferDto>(`/gold/transfers${buildQuery(params)}`);
export const getTransfer = (id: string): Promise<GoldTransferDto> =>
  get<GoldTransferDto>(`/gold/transfers/${id}`);
export const transferNextNumber = (): Promise<GoldNextNumberDto> =>
  get<GoldNextNumberDto>('/gold/transfers/next-number');
export const createTransfer = (body: CreateGoldTransfer): Promise<GoldTransferDto> =>
  post<GoldTransferDto>('/gold/transfers', body);
export const updateTransfer = (id: string, body: UpdateGoldTransfer): Promise<GoldTransferDto> =>
  patch<GoldTransferDto>(`/gold/transfers/${id}`, body);
export const confirmTransfer = (id: string, version: number): Promise<GoldTransferDto> =>
  post<GoldTransferDto>(`/gold/transfers/${id}/confirm`, { version });
export const revertTransfer = (id: string, version: number): Promise<GoldTransferDto> =>
  post<GoldTransferDto>(`/gold/transfers/${id}/revert`, { version });
export const printTransfer = (id: string): Promise<GoldPrintResultDto> =>
  post<GoldPrintResultDto>(`/gold/transfers/${id}/print`, {});

// ── Drawer keys ────────────────────────────────────────────────────────────
export const listKeys = (params: GoldListParams): Promise<Paginated<GoldKeyHandoverDto>> =>
  getPage<GoldKeyHandoverDto>(`/gold/keys${buildQuery(params)}`);
export const keysOverview = (): Promise<GoldKeysOverviewDto> =>
  get<GoldKeysOverviewDto>('/gold/keys/overview');
export const createKey = (body: CreateGoldKeyHandover): Promise<GoldKeyHandoverDto> =>
  post<GoldKeyHandoverDto>('/gold/keys', body);
export const returnKey = (id: string): Promise<GoldKeyHandoverDto> =>
  patch<GoldKeyHandoverDto>(`/gold/keys/${id}/return`, {});
export const deleteKey = (id: string): Promise<void> => del<void>(`/gold/keys/${id}`);

// ── Dashboard and reports ──────────────────────────────────────────────────
export const dashboardStats = (): Promise<GoldDashboardStatsDto> =>
  get<GoldDashboardStatsDto>('/gold/dashboard/stats');
export const dashboardCharts = (): Promise<GoldDashboardChartsDto> =>
  get<GoldDashboardChartsDto>('/gold/dashboard/charts');
export const clientBalances = (params: GoldListParams): Promise<GoldClientBalancesDto> =>
  get<GoldClientBalancesDto>(`/gold/reports/client-balances${buildQuery(params)}`);
export const fundMovement = (params: GoldListParams): Promise<GoldFundMovementDto> =>
  get<GoldFundMovementDto>(`/gold/reports/fund-movement${buildQuery(params)}`);
export const fundClosing = (params: GoldListParams): Promise<GoldFundClosingDto> =>
  get<GoldFundClosingDto>(`/gold/reports/fund-closing${buildQuery(params)}`);

// ── Portal accounts (the STAFF side of the customer portal) ────────────────
export const listPortalAccounts = (
  params: GoldListParams,
): Promise<Paginated<GoldPortalAccountDto>> =>
  getPage<GoldPortalAccountDto>(`/gold/portal-accounts${buildQuery(params)}`);
export const createPortalAccount = (
  body: CreateGoldPortalAccount,
): Promise<GoldPortalAccountCreatedDto> =>
  post<GoldPortalAccountCreatedDto>('/gold/portal-accounts', body);
export const updatePortalAccount = (
  id: string,
  body: UpdateGoldPortalAccount,
): Promise<GoldPortalAccountDto> =>
  patch<GoldPortalAccountDto>(`/gold/portal-accounts/${id}`, body);
export const changePortalAccountStatus = (
  id: string,
  body: ChangeGoldPortalAccountStatus,
): Promise<GoldPortalAccountDto> =>
  post<GoldPortalAccountDto>(`/gold/portal-accounts/${id}/status`, body);
export const resendPortalSetupLink = (id: string): Promise<void> =>
  post<void>(`/gold/portal-accounts/${id}/setup-link`, {});
export const deletePortalAccount = (id: string): Promise<void> =>
  del<void>(`/gold/portal-accounts/${id}`);
