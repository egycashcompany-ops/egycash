// TanStack Query hooks for the ATM module (ADR-013). Keys follow the platform factory —
// ['atm', feature, kind, params]. Invalidation facts worth stating:
//
//   · a replenishment/maintenance write stales its own list, its done list AND its facets — the
//     filter dropdowns are distinct values over the open rows, so opening or closing changes them;
//   · a mail DECISION stales maintenances too — accepting creates a maintenance row — and the
//     unread badge, which is a count of pending tickets;
//   · a machine-master write stales machines and the label lists it references.
//   · an area move stales the efficiency register too: the machine's open period follows its area.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type BulkCreateAtmMachines,
  type BulkDeleteAtmMachines,
  type BulkUpdateAtmMaintenances,
  type BulkUpdateAtmReplenishments,
  type CreateAtmMachine,
  type CreateAtmRefLabel,
  type ReassignAtmMachineArea,
  type UpdateAtmMachine,
  type UpdateAtmMachineArea,
  type UpdateAtmRefLabel,
} from '@ecms/contracts';
import { featureKey, listKey } from '../../../shared/lib/query-keys';
import { errorMessage } from '../../../shared/lib/errors';
import { store } from '../../../store';
import { toast } from '../../../shared/ui/toast/toast-store';
import { isAlreadyOpenRefusal } from '../lib/operation-view';
import * as api from './atm-api';
import { type AtmListParams } from './atm-api';

const MODULE = 'atm';

const atmKeys = {
  machines: featureKey(MODULE, 'machines'),
  refLabels: featureKey(MODULE, 'refLabels'),
  replenishments: featureKey(MODULE, 'replenishments'),
  maintenances: featureKey(MODULE, 'maintenances'),
  mailTickets: featureKey(MODULE, 'mailTickets'),
};

// ── Machines ────────────────────────────────────────────────────────────────
export const useAtmMachines = (params: AtmListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'machines', params),
    queryFn: () => api.listMachines(params),
    enabled,
  });

export const useBulkCreateAtmMachines = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkCreateAtmMachines) => api.bulkCreateMachines(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: atmKeys.machines }),
  });
};

export const useBulkDeleteAtmMachines = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkDeleteAtmMachines) => api.bulkDeleteMachines(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: atmKeys.machines }),
  });
};

export const useReassignAtmMachineArea = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ReassignAtmMachineArea) => api.reassignMachineArea(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: atmKeys.machines }),
  });
};

export const useCreateAtmMachine = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAtmMachine) => api.createMachine(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: atmKeys.machines }),
  });
};

export const useUpdateAtmMachine = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAtmMachine }) =>
      api.updateMachine(id, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: atmKeys.machines }),
  });
};

/** Operations' area move — the server moves the machine's open register entry with it (DEC-4). */
export const useUpdateAtmMachineArea = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAtmMachineArea }) =>
      api.updateMachineArea(id, body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: atmKeys.machines });
      void client.invalidateQueries({ queryKey: featureKey(MODULE, 'registerEntries') });
    },
  });
};

// ── Reference labels ────────────────────────────────────────────────────────
export const useAtmRefLabels = (kind: 'bank' | 'area', params: AtmListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'refLabels', { kind, ...params }),
    queryFn: () => api.listRefLabels(kind, params),
    enabled,
  });

// The label dialog reports its own failures — "already exists" for the 409, the reader's own
// words for anything else (`refLabelErrorText`) — so these two opt out of the global toast:
// declaring `onError` is what opts out (`shared/lib/query-client.ts`). One failure, one message.
export const useCreateAtmRefLabel = (kind: 'bank' | 'area') => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAtmRefLabel) => api.createRefLabel(kind, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: atmKeys.refLabels }),
    onError: () => undefined,
  });
};

export const useUpdateAtmRefLabel = (kind: 'bank' | 'area') => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAtmRefLabel }) =>
      api.updateRefLabel(kind, id, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: atmKeys.refLabels }),
    onError: () => undefined,
  });
};

export const useDeleteAtmRefLabel = (kind: 'bank' | 'area') => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteRefLabel(kind, id),
    onSuccess: () => void client.invalidateQueries({ queryKey: atmKeys.refLabels }),
  });
};

// ── Replenishments ──────────────────────────────────────────────────────────
export const useOpenAtmReplenishmentsList = (params: AtmListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'replenishments', { kind: 'open', ...params }),
    queryFn: () => api.listOpenReplenishments(params),
  });

export const useAtmReplenishmentFacets = (banks: readonly string[]) =>
  useQuery({
    queryKey: listKey(MODULE, 'replenishments', { kind: 'facets', banks }),
    queryFn: () => api.replenishmentFacets(banks),
  });

export const useDoneAtmReplenishments = (params: AtmListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'replenishments', { kind: 'done', ...params }),
    queryFn: () => api.listDoneReplenishments(params),
  });

const invalidateReplenishments = (client: ReturnType<typeof useQueryClient>) =>
  void client.invalidateQueries({ queryKey: atmKeys.replenishments });

export const useOpenAtmReplenishments = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      rows: { machineCode: string; scheduleTime: string | null }[];
      forceDate: string | null;
    }) => api.openReplenishments(body),
    onSuccess: () => invalidateReplenishments(client),
  });
};

export const useCloseAtmReplenishments = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.closeReplenishments(ids),
    onSuccess: () => invalidateReplenishments(client),
  });
};

/**
 * A reopen the owner's rule refused (port doc OD-1: the machine already has another open
 * operation of that kind) is worded by its done page, in the reader's language. Every OTHER
 * failure still gets the global toast exactly as before — declaring `onError` is what opts a hook
 * out of it (`shared/lib/query-client.ts`), so the hook raises that same toast for the rest.
 */
const toastUnlessAlreadyOpen = (error: unknown): void => {
  if (!isAlreadyOpenRefusal(error)) {
    toast.error(errorMessage(error, store.getState().locale.locale));
  }
};

export const useReopenAtmReplenishment = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.reopenReplenishment(id, version),
    onSuccess: () => invalidateReplenishments(client),
    onError: toastUnlessAlreadyOpen,
  });
};

export const useUpdateAtmReplenishment = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: {
        scheduleTime?: string | null;
        openedAt?: string;
        leaderName?: string | null;
        version: number;
      };
    }) => api.updateReplenishment(id, body),
    onSuccess: () => invalidateReplenishments(client),
  });
};

export const useBulkUpdateAtmReplenishments = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkUpdateAtmReplenishments) => api.bulkUpdateReplenishments(body),
    onSuccess: () => invalidateReplenishments(client),
  });
};

export const useDeleteAtmReplenishments = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.deleteReplenishments(ids),
    onSuccess: () => invalidateReplenishments(client),
  });
};

// ── Maintenance ─────────────────────────────────────────────────────────────
export const useOpenAtmMaintenancesList = (params: AtmListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'maintenances', { kind: 'open', ...params }),
    queryFn: () => api.listOpenMaintenances(params),
  });

export const useAtmMaintenanceFacets = (banks: readonly string[]) =>
  useQuery({
    queryKey: listKey(MODULE, 'maintenances', { kind: 'facets', banks }),
    queryFn: () => api.maintenanceFacets(banks),
  });

export const useDoneAtmMaintenances = (params: AtmListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'maintenances', { kind: 'done', ...params }),
    queryFn: () => api.listDoneMaintenances(params),
  });

export const useAtmMaintenanceLeaderOptions = (enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'maintenances', { kind: 'leaderOptions' }),
    queryFn: () => api.maintenanceLeaderOptions(),
    enabled,
  });

const invalidateMaintenances = (client: ReturnType<typeof useQueryClient>) =>
  void client.invalidateQueries({ queryKey: atmKeys.maintenances });

export const useOpenAtmMaintenances = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      rows: { machineCode: string; serviceType: string | null; referenceNumber: string | null }[];
      openedAt: string | null;
    }) => api.openMaintenances(body),
    onSuccess: () => invalidateMaintenances(client),
  });
};

export const useCloseAtmMaintenances = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, leaderEmployeeId }: { ids: string[]; leaderEmployeeId: string }) =>
      api.closeMaintenances(ids, leaderEmployeeId),
    onSuccess: () => invalidateMaintenances(client),
  });
};

export const useReopenAtmMaintenance = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.reopenMaintenance(id, version),
    onSuccess: () => invalidateMaintenances(client),
    onError: toastUnlessAlreadyOpen,
  });
};

export const useUpdateAtmMaintenance = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: {
        serviceType?: string | null;
        notes?: string | null;
        openedAt?: string;
        leaderName?: string | null;
        version: number;
      };
    }) => api.updateMaintenance(id, body),
    onSuccess: () => invalidateMaintenances(client),
  });
};

export const useBulkUpdateAtmMaintenances = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkUpdateAtmMaintenances) => api.bulkUpdateMaintenances(body),
    onSuccess: () => invalidateMaintenances(client),
  });
};

export const useDeleteAtmMaintenances = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.deleteMaintenances(ids),
    onSuccess: () => invalidateMaintenances(client),
  });
};

// ── Mail tickets ────────────────────────────────────────────────────────────
export const usePendingAtmMailTickets = (params: AtmListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'mailTickets', { kind: 'pending', ...params }),
    queryFn: () => api.listPendingMailTickets(params),
  });

export const useAtmMailLog = (params: AtmListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'mailTickets', { kind: 'log', ...params }),
    queryFn: () => api.listMailLog(params),
  });

/** The nav badge — refreshed on an interval, the port of every page's server-rendered count. */
export const useAtmMailUnreadCount = () =>
  useQuery({
    queryKey: listKey(MODULE, 'mailTickets', { kind: 'unreadCount' }),
    queryFn: () => api.mailUnreadCount(),
    refetchInterval: 60_000,
  });

const invalidateMailDecision = (client: ReturnType<typeof useQueryClient>): void => {
  void client.invalidateQueries({ queryKey: atmKeys.mailTickets });
  // Accepting opened a maintenance; rejecting did not, but one stale-check costs nothing.
  void client.invalidateQueries({ queryKey: atmKeys.maintenances });
};

export const useAcceptAtmMailTickets = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.acceptMailTickets(ids),
    onSuccess: () => invalidateMailDecision(client),
  });
};

export const useRejectAtmMailTickets = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.rejectMailTickets(ids),
    onSuccess: () => invalidateMailDecision(client),
  });
};

// ── Daily report ────────────────────────────────────────────────────────────
export const useAtmDailyReport = (date: string | null) =>
  useQuery({
    queryKey: listKey(MODULE, 'reports', { kind: 'daily', date }),
    queryFn: () => api.atmDailyReport(date),
  });
