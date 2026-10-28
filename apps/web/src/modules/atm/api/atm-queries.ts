// TanStack Query hooks for the ATM module (ADR-013). Keys follow the platform factory —
// ['atm', feature, kind, params]. Invalidation facts worth stating:
//
//   · a replenishment/maintenance write stales its own list, its done list AND its facets — the
//     filter dropdowns are distinct values over the open rows, so opening or closing changes them;
//     the open board is read WHOLE (every page, one cache entry), so the refresh re-reads it all;
//   · a mail DECISION stales maintenances too — accepting creates a maintenance row, and restoring
//     an accepted mail removes it — and the unread badge, which is a count of pending tickets;
//   · a machine-master write stales machines and the label lists it references — and, since a
//     data-edit add lands in the register (DEC-36), the register's entries and its Data Report:
//     an add records an open receipt, and any area write moves the machine's open period (DEC-4).
//     Every one of those writes can also file an area label on the server (DEC-38), so the
//     dialogs' options go stale too;
//   · a bank catalog write (DEC-35) stales every screen that names or orders banks.
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AtmBankDto,
  type AtmMachineDto,
  type AtmMachinesSummaryDto,
  type AtmOperationFacetsDto,
  type BulkCreateAtmMachines,
  type BulkDeleteAtmMachines,
  type BulkUpdateAtmMaintenances,
  type BulkUpdateAtmReplenishments,
  type CreateAtmBankInput,
  type CreateAtmMachine,
  type CreateAtmRefLabel,
  type Paginated,
  type ReassignAtmMachineArea,
  type UpdateAtmBank,
  type UpdateAtmMachine,
  type UpdateAtmMachineArea,
  type UpdateAtmRefLabel,
} from '@ecms/contracts';
import { featureKey, listKey } from '../../../shared/lib/query-keys';
import { errorMessage } from '../../../shared/lib/errors';
import { store } from '../../../store';
import { toast } from '../../../shared/ui/toast/toast-store';
import { isAlreadyOpenRefusal } from '../lib/operation-view';
import { boardQuery } from '../lib/board-filters';
import { makeBankLookup, type BankLookup } from '../lib/bank-catalog';
import { fetchWholeBoard } from '../lib/whole-board';
import * as api from './atm-api';
import { type AtmListParams } from './atm-api';

const MODULE = 'atm';

const atmKeys = {
  machines: featureKey(MODULE, 'machines'),
  refLabels: featureKey(MODULE, 'refLabels'),
  refLabelOptions: featureKey(MODULE, 'refLabelOptions'),
  banks: featureKey(MODULE, 'banks'),
  // The register's families, by the same keys `register-queries.ts` builds.
  registerEntries: featureKey(MODULE, 'registerEntries'),
  registerReport: featureKey(MODULE, 'registerReport'),
  registerMeta: featureKey(MODULE, 'registerMeta'),
  mapPoints: featureKey(MODULE, 'mapPoints'),
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

/**
 * One page of the machine directory (/atm/machines). The page in hand stands while the next is
 * read — another page, order, size or filter — as the vehicles registry's does (`useVehicles`):
 * without it every step dropped the table to skeleton rows and took the pager from under the
 * pointer. Its own query, so the data-edit screen's machine list keeps its behaviour.
 */
export const atmMachineDirectoryQuery = (params: AtmListParams) => ({
  queryKey: listKey(MODULE, 'machines', params),
  queryFn: () => api.listMachines(params),
  placeholderData: (previous: Paginated<AtmMachineDto> | undefined) => previous,
});

export const useAtmMachineDirectory = (params: AtmListParams) =>
  useQuery(atmMachineDirectoryQuery(params));

/**
 * The machine directory's summary — counts and dropdown sources over the whole filtered set. The
 * previous filter's answer stands while the next is read, so the figures and the lists do not
 * blink empty on every tick.
 */
export const useAtmMachinesSummary = (params: AtmListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'machines', { kind: 'summary', ...params }),
    queryFn: () => api.machinesSummary(params),
    placeholderData: (previous: AtmMachinesSummaryDto | undefined) => previous,
  });

/** How many machines the ID picker offers for one search — it narrows as the reader types. */
export const MACHINE_CODE_SEARCH_SIZE = 50;

/**
 * The ID picker's search: active machines whose code holds the typed fragment, among those the
 * other filters match, by code. Asked only once the picker has been opened.
 */
export const useAtmMachineCodeSearch = (params: AtmListParams, enabled: boolean) =>
  useQuery({
    queryKey: listKey(MODULE, 'machines', { kind: 'codeSearch', ...params }),
    queryFn: () =>
      api.listMachines({
        ...params,
        page: 1,
        pageSize: MACHINE_CODE_SEARCH_SIZE,
        sortBy: 'machineCode',
        sortDir: 'asc',
      }),
    enabled,
    placeholderData: (previous: Paginated<AtmMachineDto> | undefined) => previous,
  });

/**
 * After a machine-master write: the machines, and what the write did on the register's side — an
 * add's receipt, an area move's open period, an area label filed on save (critic gap 4: only the
 * Operations area move used to refresh the register, though every area write moves it).
 */
const invalidateMachineWrite = (client: ReturnType<typeof useQueryClient>): void => {
  for (const queryKey of [
    atmKeys.machines,
    atmKeys.refLabels,
    atmKeys.refLabelOptions,
    atmKeys.registerEntries,
    atmKeys.registerReport,
  ]) {
    void client.invalidateQueries({ queryKey });
  }
};

export const useBulkCreateAtmMachines = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkCreateAtmMachines) => api.bulkCreateMachines(body),
    onSuccess: () => invalidateMachineWrite(client),
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
    onSuccess: () => invalidateMachineWrite(client),
  });
};

/**
 * The single add. Its refusals are worded by the dialog (`machineAddErrorText`: the code active or
 * open in another branch, an archived bank, the code taken here), so it opts out of the global
 * toast — declaring `onError` is what opts out. One failure, one message.
 */
export const useCreateAtmMachine = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAtmMachine) => api.createMachine(body),
    onSuccess: () => invalidateMachineWrite(client),
    onError: () => undefined,
  });
};

export const useUpdateAtmMachine = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAtmMachine }) =>
      api.updateMachine(id, body),
    onSuccess: () => invalidateMachineWrite(client),
  });
};

/** Operations' area move — the server moves the machine's open register entry with it (DEC-4). */
export const useUpdateAtmMachineArea = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAtmMachineArea }) =>
      api.updateMachineArea(id, body),
    onSuccess: () => invalidateMachineWrite(client),
  });
};

// ── Reference labels ────────────────────────────────────────────────────────
export const useAtmRefLabels = (kind: 'bank' | 'area', params: AtmListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'refLabels', { kind, ...params }),
    queryFn: () => api.listRefLabels(kind, params),
    enabled,
  });

/** The options query's key — exported so the dialogs' specs fill exactly the entry they read. */
export const atmRefLabelOptionsKey = (branchId: string | null): readonly unknown[] =>
  listKey(MODULE, 'refLabelOptions', { branchId });

/**
 * The data-edit dialogs' pick lists for ONE branch (`null` = the acting branch): asked only while
 * a dialog is open, since every machine row carries a closed one.
 */
export const useAtmRefLabelOptions = (branchId: string | null, enabled = true) =>
  useQuery({
    queryKey: atmRefLabelOptionsKey(branchId),
    queryFn: () => api.refLabelOptions(branchId),
    enabled,
  });

// The label dialog reports its own failures — "already exists" for the 409, the reader's own
// words for anything else (`refLabelErrorText`) — so these two opt out of the global toast:
// declaring `onError` is what opts out (`shared/lib/query-client.ts`). One failure, one message.
/** A label write moves the table, the dialogs' options and the register's branch options. */
const invalidateLabelWrite = (client: ReturnType<typeof useQueryClient>): void => {
  void client.invalidateQueries({ queryKey: atmKeys.refLabels });
  void client.invalidateQueries({ queryKey: atmKeys.refLabelOptions });
  void client.invalidateQueries({ queryKey: featureKey(MODULE, 'registerBranchOptions') });
};

export const useCreateAtmRefLabel = (kind: 'bank' | 'area') => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAtmRefLabel) => api.createRefLabel(kind, body),
    onSuccess: () => invalidateLabelWrite(client),
    onError: () => undefined,
  });
};

export const useUpdateAtmRefLabel = (kind: 'bank' | 'area') => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAtmRefLabel }) =>
      api.updateRefLabel(kind, id, body),
    onSuccess: () => invalidateLabelWrite(client),
    onError: () => undefined,
  });
};

export const useDeleteAtmRefLabel = (kind: 'bank' | 'area') => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteRefLabel(kind, id),
    onSuccess: () => invalidateLabelWrite(client),
  });
};

// ── Bank catalog (DEC-35) ───────────────────────────────────────────────────
/** The catalog's key — exported so specs fill the entry every bank-naming screen reads. */
export const atmBanksKey = (): readonly unknown[] => listKey(MODULE, 'banks');

/**
 * The company-wide bank catalog, whole (fewer than fifty rows; `GET /atm/banks` answers any ATM
 * key). A bank is added a few times a year, so five minutes stale is plenty — a catalog write, here
 * or on another screen (realtime `atm.bank`), refreshes it at once anyway.
 */
export const useAtmBanks = (enabled = true) =>
  useQuery({
    queryKey: atmBanksKey(),
    queryFn: () => api.listBanks(),
    staleTime: 5 * 60_000,
    enabled,
  });

/**
 * The lookup every bank-naming screen reads its names, colours and order from (`lib/bank-catalog`).
 * The six seeds until the catalog answers, so nothing waits on it.
 */
export const useAtmBankLookup = (): BankLookup => {
  const { data } = useAtmBanks();
  return useMemo(() => makeBankLookup(data), [data]);
};

/**
 * A catalog write reaches everything that names, orders or colours banks: the catalog itself, the
 * register's meta and Data Report, the dialogs' bank options, and the map's points (their bank).
 */
const invalidateBankWrite = (client: ReturnType<typeof useQueryClient>): void => {
  for (const queryKey of [
    atmKeys.banks,
    atmKeys.registerMeta,
    atmKeys.registerReport,
    atmKeys.refLabelOptions,
    atmKeys.mapPoints,
  ]) {
    void client.invalidateQueries({ queryKey });
  }
};

// The bank dialog words its own refusals (`bankErrorText`: the code, label or name already a
// bank's), so both writes opt out of the global toast.
export const useCreateAtmBank = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAtmBankInput): Promise<AtmBankDto> => api.createBank(body),
    onSuccess: () => invalidateBankWrite(client),
    onError: () => undefined,
  });
};

export const useUpdateAtmBank = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ code, body }: { code: string; body: UpdateAtmBank }): Promise<AtmBankDto> =>
      api.updateBank(code, body),
    onSuccess: () => invalidateBankWrite(client),
    onError: () => undefined,
  });
};

// ── The two open boards ─────────────────────────────────────────────────────
/** An open board's two filters, as the screen holds them. */
export interface AtmBoardFilters {
  banks: readonly string[];
  areas: readonly string[];
}

/**
 * The open boards' cache keys — under each kind's feature key, so every write of that kind and its
 * realtime signal refresh the board and its dropdowns together. Exported for the screens' specs.
 */
export const atmBoardKeys = {
  open: (feature: 'replenishments' | 'maintenances', filters: AtmBoardFilters) =>
    listKey(MODULE, feature, {
      kind: 'open',
      whole: true,
      banks: [...filters.banks],
      areas: [...filters.areas],
    }),
  facets: (feature: 'replenishments' | 'maintenances', banks: readonly string[]) =>
    listKey(MODULE, feature, { kind: 'facets', banks: [...banks] }),
};

/**
 * EVERY open operation the filters match — the board has no pager, and a busy day has more than
 * one page of them. Walked page by page into one cache entry (`lib/whole-board.ts`), so a refresh
 * (a write's own invalidation, or its realtime signal) re-reads the whole board. Exported as
 * options so the cache-layer spec runs the very query function the boards run.
 */
export const atmOpenBoardQueries = {
  replenishments: (filters: AtmBoardFilters) => ({
    queryKey: atmBoardKeys.open('replenishments', filters),
    queryFn: () =>
      fetchWholeBoard((page, pageSize) =>
        api.listOpenReplenishments({ ...boardQuery(filters), page, pageSize }),
      ),
  }),
  maintenances: (filters: AtmBoardFilters) => ({
    queryKey: atmBoardKeys.open('maintenances', filters),
    queryFn: () =>
      fetchWholeBoard((page, pageSize) =>
        api.listOpenMaintenances({ ...boardQuery(filters), page, pageSize }),
      ),
  }),
};

/** The previous bank selection's dropdown sources, held while the new selection's are read. */
const previousFacets = (
  previous: AtmOperationFacetsDto | undefined,
): AtmOperationFacetsDto | undefined => previous;

/**
 * The filter dropdowns' sources for one bank selection. Each bank tick is a new key; until it
 * answers, the previous selection's answer is held as placeholder data, so the bank list — the
 * same whatever the banks chosen — does not collapse to the ticked banks under the reader. Which
 * parts of a placeholder may be shown, and that it never prunes, is `lib/board-filters.ts`.
 * Exported as options so the cache-layer spec runs the very query the boards run.
 */
export const atmBoardFacetsQueries = {
  replenishments: (banks: readonly string[]) => ({
    queryKey: atmBoardKeys.facets('replenishments', banks),
    queryFn: () => api.replenishmentFacets(banks),
    placeholderData: previousFacets,
  }),
  maintenances: (banks: readonly string[]) => ({
    queryKey: atmBoardKeys.facets('maintenances', banks),
    queryFn: () => api.maintenanceFacets(banks),
    placeholderData: previousFacets,
  }),
};

// ── Replenishments ──────────────────────────────────────────────────────────
/** The open replenishment board, whole — see `atmOpenBoardQueries`. */
export const useOpenAtmReplenishmentsList = (filters: AtmBoardFilters, enabled = true) =>
  useQuery({ ...atmOpenBoardQueries.replenishments(filters), enabled });

export const useAtmReplenishmentFacets = (banks: readonly string[]) =>
  useQuery(atmBoardFacetsQueries.replenishments(banks));

/**
 * Every replenishment closed in a day range — WHOLE, like the boards (`lib/whole-board.ts`). The
 * page has no pager and asked for one page of a hundred, so on a busy range the rest were simply
 * not there; its sort and its Excel/PDF (2026-10-27) are about every closed row of the range.
 */
export const useDoneAtmReplenishments = (range: { from: string; to: string }) =>
  useQuery({
    queryKey: listKey(MODULE, 'replenishments', { kind: 'done', whole: true, ...range }),
    queryFn: () =>
      fetchWholeBoard((page, pageSize) => api.listDoneReplenishments({ ...range, page, pageSize })),
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
 * A reopen — or an edit moving the open time — the owner's rule refused (port doc OD-1: the
 * machine already has another open operation of that kind that day) is worded by its own screen,
 * in the reader's language. Every OTHER
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
        cascadeLeader?: boolean;
        version: number;
      };
    }) => api.updateReplenishment(id, body),
    onSuccess: () => invalidateReplenishments(client),
    // An edit moving the open time onto a day the machine is already open on is the rule's
    // refusal (OD-1): the dialog words it, so it raises no second toast.
    onError: toastUnlessAlreadyOpen,
  });
};

export const useBulkUpdateAtmReplenishments = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkUpdateAtmReplenishments) => api.bulkUpdateReplenishments(body),
    onSuccess: () => invalidateReplenishments(client),
    // An edit moving the open time onto a day the machine is already open on is the rule's
    // refusal (OD-1): the dialog words it, so it raises no second toast.
    onError: toastUnlessAlreadyOpen,
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
/** The open maintenance board, whole — see `atmOpenBoardQueries`. */
export const useOpenAtmMaintenancesList = (filters: AtmBoardFilters, enabled = true) =>
  useQuery({ ...atmOpenBoardQueries.maintenances(filters), enabled });

export const useAtmMaintenanceFacets = (banks: readonly string[]) =>
  useQuery(atmBoardFacetsQueries.maintenances(banks));

/** Every maintenance closed in a day range — whole, as `useDoneAtmReplenishments`. */
export const useDoneAtmMaintenances = (range: { from: string; to: string }) =>
  useQuery({
    queryKey: listKey(MODULE, 'maintenances', { kind: 'done', whole: true, ...range }),
    queryFn: () =>
      fetchWholeBoard((page, pageSize) => api.listDoneMaintenances({ ...range, page, pageSize })),
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
        cascadeLeader?: boolean;
        version: number;
      };
    }) => api.updateMaintenance(id, body),
    onSuccess: () => invalidateMaintenances(client),
    // An edit moving the open time onto a day the machine is already open on is the rule's
    // refusal (OD-1): the dialog words it, so it raises no second toast.
    onError: toastUnlessAlreadyOpen,
  });
};

export const useBulkUpdateAtmMaintenances = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkUpdateAtmMaintenances) => api.bulkUpdateMaintenances(body),
    onSuccess: () => invalidateMaintenances(client),
    // An edit moving the open time onto a day the machine is already open on is the rule's
    // refusal (OD-1): the dialog words it, so it raises no second toast.
    onError: toastUnlessAlreadyOpen,
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
/**
 * The two mail pages' cache keys — under the mail feature key, so a decision, a restore and their
 * realtime signal refresh both pages. Exported for the screens' specs.
 */
export const atmMailKeys = {
  pending: () => listKey(MODULE, 'mailTickets', { kind: 'pending', whole: true }),
  log: (range: { from: string; to: string }) =>
    listKey(MODULE, 'mailTickets', { kind: 'log', whole: true, ...range }),
};

/**
 * EVERY pending mail, walked page by page into one cache entry (`lib/whole-board.ts`). The page
 * asked for one page of a hundred; since it filters by bank, area and text in the browser
 * (2026-10-28), one page would answer «which of the newest hundred», not «which mails».
 */
export const usePendingAtmMailTickets = () =>
  useQuery({
    queryKey: atmMailKeys.pending(),
    queryFn: () =>
      fetchWholeBoard((page, pageSize) => api.listPendingMailTickets({ page, pageSize })),
  });

/** Every mail of a received-day range — whole, as the done pages read theirs, for the same filter. */
export const useAtmMailLog = (range: { from: string; to: string }) =>
  useQuery({
    queryKey: atmMailKeys.log(range),
    queryFn: () =>
      fetchWholeBoard((page, pageSize) => api.listMailLog({ ...range, page, pageSize })),
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
  // Accepting opened a maintenance and restoring an accepted mail removed it; rejecting, or
  // restoring a rejected mail, touched none — but one stale-check costs nothing.
  void client.invalidateQueries({ queryKey: atmKeys.maintenances });
};

// Accept and reject go in batches (`inBulkBatches`), and a failing batch leaves the ones before it
// decided. A decision is no realtime broadcast (`accept`/`reject` are not broadcast actions), so
// nothing else would tell this page — it re-reads whether the decision succeeded or not.
export const useAcceptAtmMailTickets = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.acceptMailTickets(ids),
    onSettled: () => invalidateMailDecision(client),
  });
};

export const useRejectAtmMailTickets = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.rejectMailTickets(ids),
    onSettled: () => invalidateMailDecision(client),
  });
};

/** Put decided mails back to pending, from the log — the mail lists and the boards go stale. */
export const useRestoreAtmMailTickets = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.restoreMailTickets(ids),
    onSuccess: () => invalidateMailDecision(client),
  });
};

// ── Daily report ────────────────────────────────────────────────────────────
export const useAtmDailyReport = (date: string | null) =>
  useQuery({
    queryKey: listKey(MODULE, 'reports', { kind: 'daily', date }),
    queryFn: () => api.atmDailyReport(date),
  });
