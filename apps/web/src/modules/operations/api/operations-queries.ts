// TanStack Query hooks for the Operations app (ADR-013). Keys follow the platform factory —
// ['operations', feature, kind, params] — so each B slice invalidates surgically.
//
// The reference data here is what the legacy `/data_edit` screen maintained (discovery §F). Two
// invalidation facts are deliberate and worth stating, because getting them wrong shows up as a
// stale dropdown on a shipment form rather than as an error:
//
//   · a branch mutation invalidates BRANCHES ONLY — a branch belongs to a bank but changing it
//     does not change the bank;
//   · a bank mutation invalidates BOTH — the branch rows carry their bank's operational name, so
//     renaming a bank changes what every branch row displays.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateOperationsBank,
  type CreateOperationsBankBranch,
  type CreateOperationsCurrency,
  type UpdateOperationsBank,
  type UpdateOperationsBankBranch,
  type UpdateOperationsCurrency,
} from '@ecms/contracts';
import { featureKey, listKey } from '../../../shared/lib/query-keys';
import * as api from './operations-api';
import { type OperationsListParams } from './operations-api';

const MODULE = 'operations';

// Feature-subtree invalidation targets — internal: every consumer outside this file goes through
// the hooks, never the keys.
const operationsKeys = {
  banks: featureKey(MODULE, 'banks'),
  branches: featureKey(MODULE, 'bankBranches'),
  currencies: featureKey(MODULE, 'currencies'),
};

// ── Reads ──────────────────────────────────────────────────────────────────
// `enabled` follows the fleet precedent: a query never fires for a surface the operator is not
// looking at (an inactive tab) or is not allowed to see.
export const useOperationsBanks = (params: OperationsListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'banks', params),
    queryFn: () => api.listBanks(params),
    enabled,
  });

export const useOperationsBankBranches = (params: OperationsListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'bankBranches', params),
    queryFn: () => api.listBankBranches(params),
    enabled,
  });

export const useOperationsCurrencies = (params: OperationsListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'currencies', params),
    queryFn: () => api.listCurrencies(params),
    enabled,
  });

/** Branches of one bank — the cascading picker. Disabled until a bank is chosen. */
export const useBranchesOfBank = (bankId: string | null) =>
  useQuery({
    queryKey: listKey(MODULE, 'bankBranches', { bankId: bankId ?? '', all: true }),
    queryFn: () => api.branchesOfBank(bankId ?? ''),
    enabled: bankId !== null && bankId !== '',
  });

// ── Writes ─────────────────────────────────────────────────────────────────
export const useCreateOperationsBank = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateOperationsBank) => api.createBank(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: operationsKeys.banks });
      // Branch rows display their bank's operational name.
      await qc.invalidateQueries({ queryKey: operationsKeys.branches });
    },
  });
};

export const useUpdateOperationsBank = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateOperationsBank }) =>
      api.updateBank(id, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: operationsKeys.banks });
      await qc.invalidateQueries({ queryKey: operationsKeys.branches });
    },
  });
};

export const useCreateOperationsBankBranch = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateOperationsBankBranch) => api.createBankBranch(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: operationsKeys.branches });
    },
  });
};

export const useUpdateOperationsBankBranch = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateOperationsBankBranch }) =>
      api.updateBankBranch(id, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: operationsKeys.branches });
    },
  });
};

export const useCreateOperationsCurrency = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateOperationsCurrency) => api.createCurrency(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: operationsKeys.currencies });
    },
  });
};

export const useUpdateOperationsCurrency = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateOperationsCurrency }) =>
      api.updateCurrency(id, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: operationsKeys.currencies });
    },
  });
};

/** Exported for the cache tests, which assert what a mutation moves — never used by a screen. */
export const __operationsKeys = operationsKeys;
