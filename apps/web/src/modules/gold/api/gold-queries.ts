// TanStack Query hooks for the Gold module (ADR-013). Keys come from the shared factory so
// invalidation stays surgical, and every mutation invalidates the feature it touched PLUS the
// things that feature moves: confirming a receipt creates bars and fills drawers, so it stales the
// vault board and the dashboard as well as its own list.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  type ChangeGoldPortalAccountStatus,
  type CreateGoldBar,
  type CreateGoldPortalAccount,
  type GoldPortalAccountDto,
  type Paginated,
  type UpdateGoldPortalAccount,
  type CreateGoldCompany,
  type CreateGoldDelivery,
  type CreateGoldFloor,
  type CreateGoldKeyHandover,
  type CreateGoldReceiving,
  type CreateGoldRepresentative,
  type CreateGoldTransfer,
  type CreateGoldVault,
  type GenerateGoldLayout,
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
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import * as api from './gold-api';

const MODULE = 'gold';

/** Everything a movement of metal changes: the inventory, the board and the numbers on it. */
const invalidateInventory = (qc: QueryClient): void => {
  void qc.invalidateQueries({ queryKey: featureKey(MODULE, 'bars') });
  void qc.invalidateQueries({ queryKey: featureKey(MODULE, 'drawers') });
  void qc.invalidateQueries({ queryKey: featureKey(MODULE, 'vaults') });
  void qc.invalidateQueries({ queryKey: featureKey(MODULE, 'dashboard') });
  void qc.invalidateQueries({ queryKey: featureKey(MODULE, 'reports') });
};

// ── Integration reads ──────────────────────────────────────────────────────
export const useEmployeeSearch = (search: string, enabled: boolean) =>
  useQuery({
    queryKey: listKey(MODULE, 'employeeSearch', search),
    queryFn: async () => api.searchEmployees(search),
    enabled: enabled && search.trim() !== '',
    staleTime: 30_000,
  });

export const useVehicleSearch = (search: string, enabled: boolean) =>
  useQuery({
    queryKey: listKey(MODULE, 'vehicleSearch', search),
    queryFn: async () => api.searchVehicles(search),
    enabled: enabled && search.trim() !== '',
    staleTime: 30_000,
  });

export const useGoldBranches = () =>
  useQuery({ queryKey: listKey(MODULE, 'branches'), queryFn: async () => api.listBranches() });

export const useGoldFileCategories = (enabled: boolean) =>
  useQuery({
    queryKey: listKey(MODULE, 'fileCategories'),
    queryFn: async () => api.listFileCategories(),
    enabled,
  });

// ── Companies ──────────────────────────────────────────────────────────────
export const useGoldCompanies = (params: api.GoldListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'companies', params),
    queryFn: async () => api.listCompanies(params),
  });

export const useCreateGoldCompany = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateGoldCompany) => api.createCompany(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: featureKey(MODULE, 'companies') }),
  });
};

export const useUpdateGoldCompany = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; body: UpdateGoldCompany }) =>
      api.updateCompany(input.id, input.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: featureKey(MODULE, 'companies') }),
  });
};

export const useDeleteGoldCompany = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.deleteCompany(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: featureKey(MODULE, 'companies') }),
  });
};

// ── Representatives ────────────────────────────────────────────────────────
export const useGoldRepresentatives = (params: api.GoldListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'representatives', params),
    queryFn: async () => api.listRepresentatives(params),
    enabled,
  });

export const useCreateGoldRepresentative = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateGoldRepresentative) => api.createRepresentative(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: featureKey(MODULE, 'representatives') }),
  });
};

export const useUpdateGoldRepresentative = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; body: UpdateGoldRepresentative }) =>
      api.updateRepresentative(input.id, input.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: featureKey(MODULE, 'representatives') }),
  });
};

export const useDeleteGoldRepresentative = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.deleteRepresentative(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: featureKey(MODULE, 'representatives') }),
  });
};

// ── Floors and vaults ──────────────────────────────────────────────────────
export const useGoldFloors = () =>
  useQuery({ queryKey: listKey(MODULE, 'floors'), queryFn: async () => api.listFloors() });

export const useGoldVaults = (params: api.GoldListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'vaults', params),
    queryFn: async () => api.listVaults(params),
  });

export const useGoldVaultDrawers = (vaultId: string, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'drawers', vaultId),
    queryFn: async () => api.listVaultDrawers(vaultId),
    enabled: enabled && vaultId !== '',
  });

export const useGoldDrawer = (drawerId: string | null) =>
  useQuery({
    queryKey: detailKey(MODULE, 'drawers', drawerId ?? 'none'),
    queryFn: async () => api.getDrawer(drawerId ?? ''),
    enabled: drawerId !== null,
  });

const useVaultMutation = <TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: featureKey(MODULE, 'vaults') });
      void qc.invalidateQueries({ queryKey: featureKey(MODULE, 'drawers') });
      void qc.invalidateQueries({ queryKey: featureKey(MODULE, 'floors') });
    },
  });
};

export const useCreateGoldVault = () =>
  useVaultMutation(async (body: CreateGoldVault) => api.createVault(body));
export const useUpdateGoldVault = () =>
  useVaultMutation(async (input: { id: string; body: UpdateGoldVault }) =>
    api.updateVault(input.id, input.body),
  );
export const useDeleteGoldVault = () => useVaultMutation(async (id: string) => api.deleteVault(id));
export const useReorderGoldVaults = () =>
  useVaultMutation(async (body: ReorderGoldItems) => api.reorderVaults(body));
export const useGenerateGoldLayout = () =>
  useVaultMutation(async (input: { id: string; body: GenerateGoldLayout }) =>
    api.generateLayout(input.id, input.body),
  );
export const useReshapeGoldLayout = () =>
  useVaultMutation(async (input: { id: string; body: GenerateGoldLayout }) =>
    api.reshapeLayout(input.id, input.body),
  );
export const useCreateGoldFloor = () =>
  useVaultMutation(async (body: CreateGoldFloor) => api.createFloor(body));
export const useUpdateGoldFloor = () =>
  useVaultMutation(async (input: { id: string; body: UpdateGoldFloor }) =>
    api.updateFloor(input.id, input.body),
  );
export const useReorderGoldFloors = () =>
  useVaultMutation(async (body: ReorderGoldItems) => api.reorderFloors(body));
export const useDeleteGoldFloor = () => useVaultMutation(async (id: string) => api.deleteFloor(id));

/** The layout preview is a POST that changes nothing, so it is a mutation with no invalidation. */
export const usePreviewGoldLayout = () =>
  useMutation({ mutationFn: async (body: PreviewGoldLayout) => api.previewLayout(body) });

// ── Bars ───────────────────────────────────────────────────────────────────
export const useGoldBars = (params: api.GoldListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'bars', params),
    queryFn: async () => api.listBars(params),
    enabled,
  });

export const useGoldBarFacets = () =>
  useQuery({ queryKey: listKey(MODULE, 'barFacets'), queryFn: async () => api.getBarFacets() });

export const useGoldBarHistory = (id: string | null) =>
  useQuery({
    queryKey: detailKey(MODULE, 'barHistory', id ?? 'none'),
    queryFn: async () => api.getBarHistory(id ?? ''),
    enabled: id !== null,
  });

export const useUpdateGoldBar = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; body: UpdateGoldBar }) =>
      api.updateBar(input.id, input.body),
    onSuccess: () => {
      invalidateInventory(qc);
    },
  });
};

export const useCreateGoldBar = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateGoldBar) => api.createBar(body),
    onSuccess: () => {
      invalidateInventory(qc);
    },
  });
};

// ── The three documents ────────────────────────────────────────────────────
const useDocumentMutation = <TVars, TResult>(
  feature: string,
  fn: (vars: TVars) => Promise<TResult>,
  movesMetal: boolean,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: featureKey(MODULE, feature) });
      if (movesMetal) invalidateInventory(qc);
    },
  });
};

export const useGoldReceivingList = (params: api.GoldListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'receiving', params),
    queryFn: async () => api.listReceiving(params),
  });
export const useGoldReceiving = (id: string | null) =>
  useQuery({
    queryKey: detailKey(MODULE, 'receiving', id ?? 'none'),
    queryFn: async () => api.getReceiving(id ?? ''),
    enabled: id !== null,
  });
export const useCreateGoldReceiving = () =>
  useDocumentMutation(
    'receiving',
    async (body: CreateGoldReceiving) => api.createReceiving(body),
    false,
  );
export const useUpdateGoldReceiving = () =>
  useDocumentMutation(
    'receiving',
    async (input: { id: string; body: UpdateGoldReceiving }) =>
      api.updateReceiving(input.id, input.body),
    false,
  );
export const useConfirmGoldReceiving = () =>
  useDocumentMutation(
    'receiving',
    async (input: { id: string; version: number }) => api.confirmReceiving(input.id, input.version),
    true,
  );
export const useRevertGoldReceiving = () =>
  useDocumentMutation(
    'receiving',
    async (input: { id: string; version: number }) => api.revertReceiving(input.id, input.version),
    true,
  );

export const useGoldDeliveryList = (params: api.GoldListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'delivery', params),
    queryFn: async () => api.listDelivery(params),
  });
export const useGoldDelivery = (id: string | null) =>
  useQuery({
    queryKey: detailKey(MODULE, 'delivery', id ?? 'none'),
    queryFn: async () => api.getDelivery(id ?? ''),
    enabled: id !== null,
  });
export const useCreateGoldDelivery = () =>
  useDocumentMutation(
    'delivery',
    async (body: CreateGoldDelivery) => api.createDelivery(body),
    false,
  );
export const useUpdateGoldDelivery = () =>
  useDocumentMutation(
    'delivery',
    async (input: { id: string; body: UpdateGoldDelivery }) =>
      api.updateDelivery(input.id, input.body),
    false,
  );
export const useConfirmGoldDelivery = () =>
  useDocumentMutation(
    'delivery',
    async (input: { id: string; version: number }) => api.confirmDelivery(input.id, input.version),
    true,
  );
export const useRevertGoldDelivery = () =>
  useDocumentMutation(
    'delivery',
    async (input: { id: string; version: number }) => api.revertDelivery(input.id, input.version),
    true,
  );

export const useGoldTransfersList = (params: api.GoldListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'transfers', params),
    queryFn: async () => api.listTransfers(params),
  });
export const useGoldTransfer = (id: string | null) =>
  useQuery({
    queryKey: detailKey(MODULE, 'transfers', id ?? 'none'),
    queryFn: async () => api.getTransfer(id ?? ''),
    enabled: id !== null,
  });
export const useCreateGoldTransfer = () =>
  useDocumentMutation(
    'transfers',
    async (body: CreateGoldTransfer) => api.createTransfer(body),
    false,
  );
export const useUpdateGoldTransfer = () =>
  useDocumentMutation(
    'transfers',
    async (input: { id: string; body: UpdateGoldTransfer }) =>
      api.updateTransfer(input.id, input.body),
    false,
  );
export const useConfirmGoldTransfer = () =>
  useDocumentMutation(
    'transfers',
    async (input: { id: string; version: number }) => api.confirmTransfer(input.id, input.version),
    true,
  );
export const useRevertGoldTransfer = () =>
  useDocumentMutation(
    'transfers',
    async (input: { id: string; version: number }) => api.revertTransfer(input.id, input.version),
    true,
  );

// ── Drawer keys ────────────────────────────────────────────────────────────
export const useGoldKeys = (params: api.GoldListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'keys', params),
    queryFn: async () => api.listKeys(params),
  });

export const useGoldKeysOverview = () =>
  useQuery({ queryKey: listKey(MODULE, 'keysOverview'), queryFn: async () => api.keysOverview() });

const useKeyMutation = <TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: featureKey(MODULE, 'keys') });
      void qc.invalidateQueries({ queryKey: featureKey(MODULE, 'keysOverview') });
    },
  });
};

export const useCreateGoldKey = () =>
  useKeyMutation(async (body: CreateGoldKeyHandover) => api.createKey(body));
export const useReturnGoldKey = () => useKeyMutation(async (id: string) => api.returnKey(id));
export const useDeleteGoldKey = () => useKeyMutation(async (id: string) => api.deleteKey(id));

// ── Dashboard and reports ──────────────────────────────────────────────────
export const useGoldDashboardStats = () =>
  useQuery({
    queryKey: listKey(MODULE, 'dashboard', 'stats'),
    queryFn: async () => api.dashboardStats(),
  });

export const useGoldDashboardCharts = () =>
  useQuery({
    queryKey: listKey(MODULE, 'dashboard', 'charts'),
    queryFn: async () => api.dashboardCharts(),
  });

export const useGoldClientBalances = (params: api.GoldListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'reports', ['balances', params]),
    queryFn: async () => api.clientBalances(params),
  });

export const useGoldFundMovement = (params: api.GoldListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'reports', ['movement', params]),
    queryFn: async () => api.fundMovement(params),
  });

export const useGoldFundClosing = (params: api.GoldListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'reports', ['closing', params]),
    queryFn: async () => api.fundClosing(params),
  });

// ── Portal accounts ────────────────────────────────────────────────────────

const PORTAL_ACCOUNTS = 'portal-accounts';

export const useGoldPortalAccounts = (
  params: { page: number; pageSize: number; search?: string },
): UseQueryResult<Paginated<GoldPortalAccountDto>> =>
  useQuery({
    queryKey: listKey(MODULE, PORTAL_ACCOUNTS, params),
    queryFn: () => api.listPortalAccounts(params),
  });

const invalidatePortalAccounts = (qc: QueryClient): void => {
  void qc.invalidateQueries({ queryKey: featureKey(MODULE, PORTAL_ACCOUNTS) });
};

export const useCreateGoldPortalAccount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGoldPortalAccount) => api.createPortalAccount(body),
    onSuccess: () => {
      invalidatePortalAccounts(qc);
    },
  });
};

export const useUpdateGoldPortalAccount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateGoldPortalAccount }) =>
      api.updatePortalAccount(id, body),
    onSuccess: () => {
      invalidatePortalAccounts(qc);
    },
  });
};

export const useChangeGoldPortalAccountStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChangeGoldPortalAccountStatus }) =>
      api.changePortalAccountStatus(id, body),
    onSuccess: () => {
      invalidatePortalAccounts(qc);
    },
  });
};

export const useResendGoldPortalSetupLink = () =>
  useMutation({ mutationFn: (id: string) => api.resendPortalSetupLink(id) });

export const useDeleteGoldPortalAccount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePortalAccount(id),
    onSuccess: () => {
      invalidatePortalAccounts(qc);
    },
  });
};
