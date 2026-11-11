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
  type AssignSecuredDeliveryLeg,
  type CancelVaultReceipt,
  type CompleteOperationsShipment,
  type ConfirmSecuredPickup,
  type CreateOperationsArea,
  type CreateOperationsBank,
  type CreateOperationsBankBranch,
  type CreateOperationsCurrency,
  type CreateOperationsShipment,
  type DispatchSecuredShipments,
  type ListOperationsCrewRequirementsQuery,
  type ListSecuredBacklogQuery,
  type OperationsExecutionResultDto,
  type OrderOperationsCurrencies,
  type PlanOperationsCrew,
  type SetOperationsStandingCrew,
  type ReceiveIntoVault,
  type SetOperationsCrewRequirements,
  type UpdateOperationsArea,
  type UpdateOperationsBank,
  type UpdateOperationsBankBranch,
  type UpdateOperationsCurrency,
  type UpdateOperationsShipment,
} from '@ecms/contracts';
import { featureKey, listKey } from '../../../shared/lib/query-keys';
import { ApiError } from '../../../shared/lib/api-client';
import { useSetSetting } from '../../../platform/settings/settings-api';
import { store } from '../../../store';
import { toast } from '../../../shared/ui/toast/toast-store';
import { executionErrorMessage, isStateConflict } from '../mobile/execution-errors';
import { isLockedRefusal } from '../lib/shipment-form';
import * as api from './operations-api';
import { type OperationsListParams } from './operations-api';

const MODULE = 'operations';

// Feature-subtree invalidation targets — internal: every consumer outside this file goes through
// the hooks, never the keys.
const operationsKeys = {
  banks: featureKey(MODULE, 'banks'),
  branches: featureKey(MODULE, 'bankBranches'),
  currencies: featureKey(MODULE, 'currencies'),
  // The board and the shipment list are two views of the SAME facts, so every shipment write
  // stales both. Getting this wrong shows up as a receive toggle that appears not to have worked.
  shipments: featureKey(MODULE, 'shipments'),
  // The shipments history is the day board over a range, so it lives UNDER the board's subtree
  // (`shipmentHistoryKey`): every write that stales the board — a shipment saved, received, deleted
  // or photographed, a bank or branch renamed, a captain's act — stales the history with it,
  // without a second list that one of those mutations could forget.
  dayBoard: featureKey(MODULE, 'dayBoard'),
  // The board, its pool and the roster move together: planning changes who is taken, and editing
  // the roster changes who is offered. Splitting them would leave a stale pool beside a fresh board.
  crewBoard: featureKey(MODULE, 'crewBoard'),
  crewDirectory: featureKey(MODULE, 'crewDirectory'),
  crewRequirements: featureKey(MODULE, 'crewRequirements'),
  standingCrew: featureKey(MODULE, 'standingCrew'),
  // The four secured screens are four views of ONE lifecycle: receiving into the vault changes the
  // backlog, the vault and the due list at once. They stale together for that reason.
  securedBacklog: featureKey(MODULE, 'securedBacklog'),
  securedDue: featureKey(MODULE, 'securedDue'),
  vault: featureKey(MODULE, 'vault'),
  // B5. Reports are roll-ups of a SETTLED past and attendance is another module's record, so
  // neither belongs to any Operations mutation's fan-out — they are listed here to be named, and
  // the spec pins that no write stales them. A report that refetched on every shipment write
  // would be churn; one that refetched on none is correct, because completing a shipment TODAY
  // cannot change last month's totals.
  // B6. The area list is reference data like the other three catalogs; the vault ROLL-UP is a
  // view of the vault, so it stales with every secured act exactly as the inventory does.
  areas: featureKey(MODULE, 'areas'),
  vaultReport: featureKey(MODULE, 'vaultReport'),
  reportCaptains: featureKey(MODULE, 'reportCaptains'),
  reportBanks: featureKey(MODULE, 'reportBanks'),
  crewAttendance: featureKey(MODULE, 'crewAttendance'),
};

/** Everything one secured act can move — one list, so no mutation forgets a screen. */
const securedSubtrees = [
  featureKey(MODULE, 'securedBacklog'),
  featureKey(MODULE, 'securedDue'),
  featureKey(MODULE, 'vault'),
  // The roll-up is the SAME question as the inventory, asked differently — receiving a shipment
  // changes both, and staling one without the other is how two vault screens disagree.
  featureKey(MODULE, 'vaultReport'),
  featureKey(MODULE, 'shipments'),
  featureKey(MODULE, 'dayBoard'),
];

/** Every surface a shipment write can move. One list, so no mutation forgets one. */
const shipmentSubtrees = [featureKey(MODULE, 'shipments'), featureKey(MODULE, 'dayBoard')];

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
/** One branch — cached under the branches feature, so a branch edit refreshes it too. */
export const useBankBranch = (id: string) =>
  useQuery({
    queryKey: listKey(MODULE, 'bankBranches', { id }),
    queryFn: () => api.getBankBranch(id),
    enabled: id !== '',
    staleTime: 60_000,
  });

/**
 * A bank's active branches matching `search` — the branch picker's options. `placeholderData`
 * keeps the previous answer on screen while the next one is fetched, so the list does not blink
 * empty under the operator's fingers on every keystroke.
 */
export const useBranchSearch = (bankId: string, search: string) =>
  useQuery({
    queryKey: listKey(MODULE, 'bankBranches', { bankId, search: search.trim(), picker: true }),
    queryFn: () => api.searchBranchesOfBank(bankId, search),
    enabled: bankId !== '',
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

export const useBranchesOfBank = (bankId: string | null) =>
  useQuery({
    queryKey: listKey(MODULE, 'bankBranches', { bankId: bankId ?? '', all: true }),
    queryFn: () => api.branchesOfBank(bankId ?? ''),
    enabled: bankId !== null && bankId !== '',
  });

/**
 * One day's board. «اليوم التشغيلي» names its day — Cairo's today (`useCairoToday`) — so the day on
 * screen and the day a new shipment is floored at are one day, even in the hours after a Cairo
 * midnight. `date` null still means "today", resolved by the server (today in Cairo there too), which
 * echoes back the day it used.
 */
export const useOperationsDayBoard = (date: string | null, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'dayBoard', { date: date ?? 'today' }),
    queryFn: () => api.getDayBoard(date),
    enabled,
  });

/** A 4xx is an answer (not found, not allowed, too large) that asking again cannot change. */
const retryUnless4xx = (failures: number, error: unknown): boolean =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 1;

/** The history's cache entry: one per range, inside the day board's subtree (see `operationsKeys`). */
const shipmentHistoryKey = (range: { from: string; to: string }): readonly unknown[] => [
  ...featureKey(MODULE, 'dayBoard'),
  'history',
  { from: range.from, to: range.to },
];

/**
 * The shipments over a range of days — «سجل الشحنات». `enabled` is false while the page holds a
 * range the endpoint would refuse anyway (inverted, or too long), so no request is spent on it.
 *
 * A 4xx is an ANSWER, not a failure: the range holds too many shipments, or the reader may not see
 * them. Asking again cannot change it, so it is not retried; only a network or server failure is.
 */
export const useOperationsShipmentHistory = (range: { from: string; to: string }, enabled = true) =>
  useQuery({
    queryKey: shipmentHistoryKey(range),
    queryFn: () => api.getShipmentHistory(range),
    enabled,
    retry: retryUnless4xx,
  });

/**
 * One shipment's log, inside the day board's subtree like the history. Every act that stales the
 * board — a shipment saved, received, deleted, restored or photographed, a secured act, a
 * captain's act from this browser — writes an entry into SOME shipment's log, so the same
 * invalidation that refreshes the board refreshes an open log, with no list of its own to forget.
 */
const shipmentLogKey = (id: string): readonly unknown[] => [
  ...featureKey(MODULE, 'dayBoard'),
  'log',
  { id },
];

/**
 * «هيكون فى سجل بالاكشنز اللى حصلت على الشحنة» — asked only while the log is open (`id` set): a
 * board of a hundred rows does not read a hundred logs it may never show.
 */
export const useOperationsShipmentLog = (id: string | null) =>
  useQuery({
    queryKey: shipmentLogKey(id ?? ''),
    queryFn: () => api.getShipmentLog(id ?? ''),
    enabled: id !== null,
    retry: retryUnless4xx,
  });

/**
 * The deleted shipments of a range, beside the history's own entry in the day board's subtree: a
 * delete takes a row OUT of the history and INTO this list, and a restore the other way, so the
 * invalidation every shipment write runs refreshes both at once.
 */
const deletedShipmentsKey = (range: { from: string; to: string }): readonly unknown[] => [
  ...featureKey(MODULE, 'dayBoard'),
  'deleted',
  { from: range.from, to: range.to },
];

/**
 * «اعملى ايقون اقدر اجيب منه اللى اتمسح» — read while the history is open (the icon's count) and
 * whenever its dialog is. `enabled` is false while the page holds a range the endpoint would refuse.
 */
export const useOperationsDeletedShipments = (
  range: { from: string; to: string },
  enabled = true,
) =>
  useQuery({
    queryKey: deletedShipmentsKey(range),
    queryFn: () => api.getDeletedShipments(range),
    enabled,
    retry: retryUnless4xx,
  });

/**
 * The secured screen's entry — every open محصنة as board rows — inside the DAY BOARD's subtree,
 * like the history: its rows move with every act that moves the board's. A shipment saved,
 * received or deleted (`useShipmentInvalidation`), the captain's ✓ in the mobile app that turns a
 * row yellow (`useExecutionInvalidation`), the vault's receive that turns it green and its dispatch
 * (the secured acts, whose list includes the board's subtree), a bank or branch renamed — each
 * already stales the board, so living under its key the screen can miss none of them. Realtime
 * reaches it the same way: every shipment topic sweeps `['operations', 'dayBoard']`, and unlike the
 * history's whole range it is re-read, not only marked stale (`isStaleOnlyKey`).
 */
const securedBoardKey = (): readonly unknown[] => [...featureKey(MODULE, 'dayBoard'), 'secured'];

/**
 * «شاشة الشحنات المحصنة» — every secured shipment not yet completed, as board rows. A 4xx is an
 * answer (more open محصنات than one screen may show, or not allowed), so it is not retried.
 */
export const useOperationsSecuredBoard = (enabled = true) =>
  useQuery({
    queryKey: securedBoardKey(),
    queryFn: () => api.getSecuredBoard(),
    enabled,
    retry: retryUnless4xx,
  });

// ── Writes ─────────────────────────────────────────────────────────────────

/** Shared by every shipment mutation, so none of them can forget a surface. */
const useShipmentInvalidation = () => {
  const qc = useQueryClient();
  return async (): Promise<void> => {
    for (const key of shipmentSubtrees) await qc.invalidateQueries({ queryKey: key });
  };
};

// THE FORM OWNS THESE MUTATIONS' ERRORS — the shipment form's two, and the branch form's two (which
// the shipment form opens over itself for «+ إضافة»). The global notifier would toast the server's
// own sentence — English, for the codes it has no translation of — and the form toasts its Arabic
// one beside it, so a refused save showed two messages. Declaring `onError` here is what
// tells the MutationCache to stay quiet (shared/lib/query-client.ts); the form's catch says it.
const formOwnsTheError = (): void => undefined;

/**
 * Round 10 — a write refused because the vault received this محصنة after its row was read
 * (`OPERATIONS_SECURED_LOCKED`, «ميقدر حد … يعدل عليها»). The row on screen is the stale thing: it
 * still offers the bin or the photo's upload, replace or delete, so the boards are re-read and it
 * comes back green and locked, offering none of them. Only that refusal: any other leaves the row as
 * it is, for the reader to try again. Run from `onSettled`, not `onError`, so the global notifier
 * still words the refusal (shared/lib/query-client.ts).
 */
const rereadIfLocked =
  (invalidate: () => Promise<void>) =>
  async (_data: unknown, error: unknown): Promise<void> => {
    if (isLockedRefusal(error)) await invalidate();
  };

/** Exported for the cache tests — which refusals re-read the boards. */
export const __rereadIfLocked = rereadIfLocked;

export const useCreateOperationsShipment = () => {
  const invalidate = useShipmentInvalidation();
  return useMutation({
    mutationFn: (body: CreateOperationsShipment) => api.createShipment(body),
    onSuccess: invalidate,
    onError: formOwnsTheError,
  });
};

export const useUpdateOperationsShipment = () => {
  const invalidate = useShipmentInvalidation();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateOperationsShipment }) =>
      api.updateShipment(id, body),
    onSuccess: invalidate,
    // The form still owns the message (declaring `onError` keeps the global notifier quiet). One
    // refusal also re-reads the boards: the vault received this محصنة after the form was opened
    // (Round 10, `OPERATIONS_SECURED_LOCKED`) — the row on screen is the stale thing, and the form
    // closes onto it.
    onError: (error: unknown) => {
      formOwnsTheError();
      if (isLockedRefusal(error)) void invalidate();
    },
  });
};

/**
 * The legacy receive toggle, as two explicit acts (contad_app.js:553-566). The caller says which
 * direction it means; nothing infers it from the current value.
 */
export const useSetShipmentReceived = () => {
  const invalidate = useShipmentInvalidation();
  return useMutation({
    mutationFn: ({
      id,
      received,
      body,
    }: {
      id: string;
      received: boolean;
      body: CompleteOperationsShipment;
    }) => (received ? api.completeShipment(id, body) : api.reopenShipment(id, body)),
    onSuccess: invalidate,
  });
};

export const useDeleteOperationsShipment = () => {
  const invalidate = useShipmentInvalidation();
  return useMutation({
    mutationFn: (id: string) => api.deleteShipment(id),
    onSuccess: invalidate,
    // A محصنة the vault received since the board was read cannot be deleted (Round 10).
    onSettled: rereadIfLocked(invalidate),
  });
};

/**
 * Bring a deleted shipment back — it returns to its day's board and to the history, and leaves the
 * deleted list. Refreshed on failure too (`onSettled`): a 409 means someone else restored it first,
 * and the list on screen is the stale thing. No `onError`: the global notifier words the refusal.
 */
export const useRestoreOperationsShipment = () => {
  const invalidate = useShipmentInvalidation();
  return useMutation({
    mutationFn: (id: string) => api.restoreShipment(id),
    onSettled: invalidate,
  });
};

// «صورة الإيصال». The photo is a field of the shipment row, so both acts stale the board and the
// list like any other shipment write. No `onError` on purpose: the global notifier names the
// refusal (FILE_TOO_LARGE, a type the category does not accept…), and no form owns it. A photo on
// a محصنة the vault received since the board was read is locked (Round 10): that refusal re-reads.
export const useUploadShipmentReceiptImage = () => {
  const invalidate = useShipmentInvalidation();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      api.uploadShipmentReceiptImage(id, file),
    onSuccess: invalidate,
    onSettled: rereadIfLocked(invalidate),
  });
};

export const useDeleteShipmentReceiptImage = () => {
  const invalidate = useShipmentInvalidation();
  return useMutation({
    mutationFn: (id: string) => api.deleteShipmentReceiptImage(id),
    onSuccess: invalidate,
    onSettled: rereadIfLocked(invalidate),
  });
};
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
      // The day board prints the banks of a row's branches, joined on the server.
      await qc.invalidateQueries({ queryKey: operationsKeys.dayBoard });
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
    onError: formOwnsTheError,
  });
};

export const useUpdateOperationsBankBranch = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateOperationsBankBranch }) =>
      api.updateBankBranch(id, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: operationsKeys.branches });
      // The day board prints branch names (and their banks) joined on the server.
      await qc.invalidateQueries({ queryKey: operationsKeys.dayBoard });
    },
    onError: formOwnsTheError,
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

/**
 * «زى شاشة الحركة بالظبط» — save the currencies' dragged order, as Fleet's `useOrderCatalog` saves
 * its catalogs'. The list is refreshed whatever the answer (`onSettled`): after a success it is the
 * order just saved, after a refusal the order that still stands. The refresh is RETURNED, so the
 * screen's own `onSettled` runs once the fresh list is in — it lets go of the order it was showing
 * only when there is a newer one to show. Every currency list rides the same subtree, so a board's
 * money lines and the form's pickers follow the new order too.
 */
export const useOrderOperationsCurrencies = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OrderOperationsCurrencies) => api.orderCurrencies(body),
    onSettled: () => qc.invalidateQueries({ queryKey: operationsKeys.currencies }),
    // The screen words the refusal itself (it also puts the rows back), so the global notifier
    // stays quiet — one failure, one message.
    onError: formOwnsTheError,
  });
};

/** Exported for the cache tests, which assert what a mutation moves — never used by a screen. */
export const __operationsKeys = operationsKeys;
/** Exported for the cache tests — the history's key, to prove the board's writes reach it. */
export const __shipmentHistoryKey = shipmentHistoryKey;
/** Exported for the cache tests — the log's and the deleted list's keys, for the same proof. */
export const __shipmentLogKey = shipmentLogKey;
export const __deletedShipmentsKey = deletedShipmentsKey;
/** Exported for the cache tests — the secured screen rides the board's subtree too. */
export const __securedBoardKey = securedBoardKey;

// ── Crew board, pool and roster (B3) ───────────────────────────────────────

/** No date → TOMORROW, resolved server-side: crews are planned a day ahead (legacy :2239). */
export const useOperationsCrewBoard = (date: string | null, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'crewBoard', { date: date ?? 'tomorrow' }),
    queryFn: () => api.getCrewBoard(date),
    enabled,
  });

export const useOperationsCrewDirectory = (date: string | null, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'crewDirectory', { date: date ?? 'tomorrow' }),
    queryFn: () => api.getCrewDirectory(date),
    enabled,
  });

export const useOperationsCrewRequirements = (
  params: ListOperationsCrewRequirementsQuery,
  enabled = true,
) =>
  useQuery({
    queryKey: listKey(MODULE, 'crewRequirements', params),
    queryFn: () => api.listCrewRequirements(params),
    enabled,
  });

/** Planning changes who is taken, so the POOL is staled alongside the board. */
export const usePlanOperationsCrew = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PlanOperationsCrew) => api.planCrew(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: operationsKeys.crewBoard });
      await qc.invalidateQueries({ queryKey: operationsKeys.crewDirectory });
    },
  });
};

// ── The standing crew (الطاقم الثابت) ───────────────────────────────────────────────────────────

/** No date in the key, because there is no date in the entity. */
export const useOperationsStandingCrew = (enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'standingCrew', {}),
    queryFn: () => api.getStandingCrew(),
    enabled,
  });

/**
 * Saving the standing crew stales the DAILY board and the pool too.
 *
 * Not because today's plan changes — it does not; the standing crew never rewrites a day that has
 * already been planned. It is because the daily board offers to seed itself from this, so a board
 * left open beside this screen would go on offering the crew that was here a minute ago.
 */
const useStandingCrewInvalidation = () => {
  const qc = useQueryClient();
  return async (): Promise<void> => {
    await qc.invalidateQueries({ queryKey: operationsKeys.standingCrew });
    await qc.invalidateQueries({ queryKey: operationsKeys.crewBoard });
    await qc.invalidateQueries({ queryKey: operationsKeys.crewDirectory });
  };
};

export const useSetOperationsStandingCrew = () => {
  const invalidate = useStandingCrewInvalidation();
  return useMutation({
    mutationFn: (body: SetOperationsStandingCrew) => api.setStandingCrew(body),
    onSuccess: invalidate,
  });
};

export const useRemoveOperationsStandingCrew = () => {
  const invalidate = useStandingCrewInvalidation();
  return useMutation({
    mutationFn: (vehicleId: string) => api.removeStandingCrew(vehicleId),
    onSuccess: invalidate,
  });
};

/** Editing the roster changes who is OFFERED, so the pool stales with the roster. */
const useRosterInvalidation = () => {
  const qc = useQueryClient();
  return async (): Promise<void> => {
    await qc.invalidateQueries({ queryKey: operationsKeys.crewRequirements });
    await qc.invalidateQueries({ queryKey: operationsKeys.crewDirectory });
  };
};

export const useSetCrewRequirements = () => {
  const invalidate = useRosterInvalidation();
  return useMutation({
    mutationFn: ({
      employeeId,
      body,
    }: {
      employeeId: string;
      body: SetOperationsCrewRequirements;
    }) => api.setCrewRequirements(employeeId, body),
    onSuccess: invalidate,
  });
};

/**
 * Operations settings write. The platform owns the endpoint; what OPERATIONS knows is that
 * `operations.crewDepartmentIds` decides who the crew IS — so changing it moves the pool, the
 * board that draws from the pool, and the standing crew built out of the same people. Invalidating
 * only the roster would leave a planner looking at a board whose empty slots no longer match the
 * names now on offer.
 */
export const useSetOperationsSetting = () => {
  const qc = useQueryClient();
  const invalidate = useRosterInvalidation();
  return useSetSetting(() => {
    void invalidate();
    void qc.invalidateQueries({ queryKey: operationsKeys.crewBoard });
    void qc.invalidateQueries({ queryKey: operationsKeys.standingCrew });
  });
};

// ── Secured shipments and the vault (B4) ───────────────────────────────────

export const useSecuredBacklog = (params: ListSecuredBacklogQuery, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'securedBacklog', params),
    queryFn: () => api.listSecuredBacklog(params),
    enabled,
  });

export const useSecuredDue = (date: string, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'securedDue', { date }),
    queryFn: () => api.listSecuredDue(date),
    enabled: enabled && date !== '',
  });

export const useVaultInventory = (params: OperationsListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'vault', params),
    queryFn: () => api.listVaultInventory(params),
    enabled,
  });

/**
 * The vault's receive queue, inside the DAY BOARD's subtree like the history: its rows are board
 * rows whose colour moves with three kinds of act — the captain's ✓ in the mobile app (a pickup
 * turns a row yellow: `useExecutionInvalidation`), the vault's receive (green: the secured acts,
 * whose list includes the board's subtree) and any shipment write (`useShipmentInvalidation`). All
 * three already stale the board, so living under its key, the queue can miss none of them.
 */
const vaultQueueKey = (all: boolean): readonly unknown[] => [
  ...featureKey(MODULE, 'dayBoard'),
  'vaultQueue',
  { all },
];

/**
 * How often the queue re-reads itself for a treasurer who hears no shipment signal. The captain's
 * ✓ that turns a row yellow — «وساعتها هيظهر للخزنة فى شاشة استلام الخزينه» — is announced on the
 * shipment topics, whose rooms need `operationsShipment.view`; a reader holding only the vault's
 * grants hears the vault's own topic (a colleague's receive) and nothing else, so without this a
 * shipment the captain has just collected would reach the screen only on a reload. Once a minute,
 * only while the tab is visible — Settlements' rule for a screen that must keep up (DS-26).
 */
export const VAULT_QUEUE_POLL_MS = 60_000;

/**
 * «شاشة استلام الخزينه» — `all` false: the shipments with the captain and today's receipts; true:
 * the ones no captain has collected yet as well. A 4xx (too many rows, not allowed) is an answer.
 * `poll`: the reader hears no shipment signal (see `VAULT_QUEUE_POLL_MS`).
 */
export const useOperationsVaultQueue = (all: boolean, enabled = true, poll = false) =>
  useQuery({
    queryKey: vaultQueueKey(all),
    queryFn: () => api.getVaultQueue(all),
    enabled,
    retry: retryUnless4xx,
    refetchInterval: poll ? VAULT_QUEUE_POLL_MS : false,
    refetchIntervalInBackground: false,
  });

/** Exported for the cache tests — the vault's receive queue rides the board's subtree too. */
export const __vaultQueueKey = vaultQueueKey;

/**
 * «صرف الخزينة» (Round 10) — every محصنة in the vault, as board rows, inside the DAY BOARD's subtree
 * like the vault's receive queue: a receipt puts a row on it, a cancelled receipt or a dispatch takes
 * one off, and a crew assigned changes one. Every one of those is a secured act, whose list
 * includes the board's subtree, and every one is announced on the shipment topics, which sweep it —
 * the vault custody topic too (`invalidation-registry.ts`), for a treasurer holding only the vault's
 * grants. One entry per delivery-day filter; `null` is every day.
 */
const securedDispatchBoardKey = (date: string | null): readonly unknown[] => [
  ...featureKey(MODULE, 'dayBoard'),
  'securedDispatch',
  { date: date ?? 'all' },
];

/**
 * «صرف الخزينة — كله يبقى موجود فى تاريخ يتفلتر»: `date` null lists every shipment in the vault,
 * a day lists that delivery day's. A 4xx (more rows than one screen may show, not allowed) is an
 * answer, not retried.
 *
 * `poll`: the reader hears no shipment signal (`VAULT_QUEUE_POLL_MS`, the receive queue's rule). A
 * treasurer holding only the vault's grants hears the vault custody topic — a receipt, a cancelled
 * receipt, a release — but NOT the delivery crew Operations assigns, which is announced on the
 * shipment topics alone; and a crew is what a row waits for before it can go out.
 */
export const useOperationsSecuredDispatchBoard = (
  date: string | null,
  enabled = true,
  poll = false,
) =>
  useQuery({
    queryKey: securedDispatchBoardKey(date === '' ? null : date),
    queryFn: () => api.getSecuredDispatchBoard(date === '' ? null : date),
    enabled,
    retry: retryUnless4xx,
    refetchInterval: poll ? VAULT_QUEUE_POLL_MS : false,
    refetchIntervalInBackground: false,
  });

/** Exported for the cache tests — «صرف الخزينة» rides the board's subtree too. */
export const __securedDispatchBoardKey = securedDispatchBoardKey;

/**
 * A secured act moves several screens at once — receiving takes a shipment OUT of the backlog and
 * INTO the vault, dispatching takes it out of the vault and onto the day board. Staling one and
 * not the others is how a treasurer ends up receiving the same shipment twice.
 */
const useSecuredInvalidation = () => {
  const qc = useQueryClient();
  return async (): Promise<void> => {
    for (const key of securedSubtrees) await qc.invalidateQueries({ queryKey: key });
  };
};

export const useReceiveIntoVault = () => {
  const invalidate = useSecuredInvalidation();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReceiveIntoVault }) =>
      api.receiveIntoVault(id, body),
    onSuccess: invalidate,
  });
};

/**
 * Round 10 — the desk's pickup ✓ on the secured screen and its undo, as one toggle: the caller says
 * which way it means (`pickedUp`), nothing infers it. Each moves the row's colour on every screen
 * that shows it — the secured screen, the day board, the vault's receive queue (a yellow row is the
 * vault's work, a white one is not) — so it runs the secured acts' invalidation. On a refusal too
 * (`onSettled`): `OPERATIONS_SECURED_ALREADY_PICKED_UP` means the captain pressed ✓ in the app while
 * the desk looked, `OPERATIONS_SECURED_LOCKED` that the vault received it — either way the row on
 * screen is the stale thing. No `onError`: the global notifier words the refusal (`errors.ts`).
 */
export const useSetSecuredPickup = () => {
  const invalidate = useSecuredInvalidation();
  return useMutation({
    mutationFn: ({
      id,
      pickedUp,
      body,
    }: {
      id: string;
      pickedUp: boolean;
      body: ConfirmSecuredPickup;
    }) => (pickedUp ? api.confirmSecuredPickup(id, body) : api.undoSecuredPickup(id, body)),
    onSettled: invalidate,
  });
};

/**
 * Round 10 — the vault's receipt cancelled (`operationsVault.cancelReceipt`): the row goes back from
 * green to yellow on every screen, leaves «صرف الخزينة» and the vault's contents and roll-up, and its
 * log gains the reason — all of it the secured acts' invalidation. The dialog owns the refusal's
 * message (declaring `onError` keeps the global notifier quiet), and a refusal re-reads too: one
 * dispatched meanwhile (`OPERATIONS_SECURED_NOT_IN_VAULT`) is a row the screen still shows green.
 */
export const useCancelVaultReceipt = () => {
  const invalidate = useSecuredInvalidation();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CancelVaultReceipt }) =>
      api.cancelVaultReceipt(id, body),
    onSettled: invalidate,
    onError: formOwnsTheError,
  });
};

/**
 * «صرف الخزينة»'s assign dialog — the delivery crew of a محصنة in the vault. The dialog owns the
 * refusal's message (declaring `onError` keeps the global notifier quiet, so it is said once), and
 * a refusal re-reads as well as a success (`onSettled`): a STALE leg version or a shipment that
 * left the vault meanwhile is a row the screen is still showing as it was.
 */
export const useAssignSecuredDelivery = () => {
  const invalidate = useSecuredInvalidation();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AssignSecuredDeliveryLeg }) =>
      api.assignSecuredDelivery(id, body),
    onSettled: invalidate,
    onError: formOwnsTheError,
  });
};

/**
 * «صرف الخزينة»'s release — one vehicle's load per call. As the assignment: the dialog words a
 * refusal, and a refusal re-reads too (a shipment dispatched by a colleague, a crew changed).
 */
export const useDispatchSecured = () => {
  const qc = useQueryClient();
  const invalidate = useSecuredInvalidation();
  return useMutation({
    mutationFn: (body: DispatchSecuredShipments) => api.dispatchSecured(body),
    onSettled: async () => {
      await invalidate();
      // Dispatch locks the crew row, so the board's state changed too.
      await qc.invalidateQueries({ queryKey: operationsKeys.crewBoard });
    },
    onError: formOwnsTheError,
  });
};

// ── Reports + attendance (B5) ───────────────────────────────────────────────────────────────────
//
// Reports are pure reads over a settled past: nothing in the app invalidates them, and re-fetching
// a month's roll-up because a shipment changed today would be churn for no gain. They are keyed by
// their range so switching months is a cache hit on the way back.

export const useCaptainReport = (range: { from: string; to: string }, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'reportCaptains', range),
    queryFn: () => api.getCaptainReport(range),
    enabled: enabled && range.from !== '' && range.to !== '',
  });

export const useBankReport = (range: { from: string; to: string }, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'reportBanks', range),
    queryFn: () => api.getBankReport(range),
    enabled: enabled && range.from !== '' && range.to !== '',
  });

export const useCrewAttendance = (date: string, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'crewAttendance', { date }),
    queryFn: () => api.getCrewAttendance(date),
    enabled: enabled && date !== '',
  });

// ── Areas + vault roll-up (B6) ──────────────────────────────────────────────────────────────────

export const useOperationsAreas = (params: OperationsListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'areas', params),
    queryFn: () => api.listOperationsAreas(params),
    enabled,
  });

export const useCreateOperationsArea = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateOperationsArea) => api.createOperationsArea(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: operationsKeys.areas });
      // Branch rows do not reference an area by id, but the branch FORM suggests from this list,
      // so a new area must be offerable straight away.
      await qc.invalidateQueries({ queryKey: operationsKeys.branches });
    },
  });
};

export const useUpdateOperationsArea = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateOperationsArea }) =>
      api.updateOperationsArea(id, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: operationsKeys.areas });
      await qc.invalidateQueries({ queryKey: operationsKeys.branches });
    },
  });
};

/** The vault roll-up. No parameters at all — the legacy picker never filtered (Q32 PRESERVE). */
export const useVaultReport = (enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'vaultReport', {}),
    queryFn: () => api.getVaultReport(),
    enabled,
  });

// ── Captain mobile (Phase C) ────────────────────────────────────────────────

/**
 * The captain's own day. Whose day it is comes from the TOKEN, server-side — this hook takes no
 * captain and there is none to take, so nothing here can be pointed at somebody else's route.
 *
 * The date is part of the key so yesterday and today are separate cache entries; `'today'` stands
 * for "no date sent", which the server resolves.
 */
export const useMyDay = (date: string | null, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'myDay', { date: date ?? 'today' }),
    queryFn: () => api.getMyDay(date),
    enabled,
    // A PHONE IS NOT A DESKTOP TAB. The app-wide default is `refetchOnWindowFocus: false` with a
    // 30-second `staleTime`, which is right for a console somebody leaves open all day. A captain
    // locks his phone between stops, and the back office can complete a shipment while it is in
    // his pocket — so this one query re-reads whenever the app comes back to the foreground, and
    // treats what it holds as stale the moment it has it. The dataset is a handful of stops.
    //
    // `refetchOnReconnect` is TanStack's own default and is deliberately not overridden here:
    // coming back from a dead zone is the same problem with the same answer.
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

/**
 * The four execution acts, sharing one invalidation.
 *
 * REFETCH IS NOT A NICETY HERE, it is how the sequential lock reaches the screen. The server
 * decides which stop is `current` — after any act, the next stop unlocks only because the server
 * says so on the next read. There is deliberately no optimistic update and no client-side
 * unlocking: a phone that guessed wrong would offer a captain a button the server then refuses.
 *
 * The whole `myDay` feature subtree is invalidated rather than one date's key, because an act can
 * change the day the client is not looking at (a stop completed at 00:05 belongs to a date the
 * screen may have already left).
 */
const useExecutionInvalidation = () => {
  const qc = useQueryClient();
  return async (): Promise<void> => {
    await qc.invalidateQueries({ queryKey: featureKey(MODULE, 'myDay') });
    // The desk's views of the same shipments move too — the day board and the captain report both
    // read statuses this act just changed.
    await qc.invalidateQueries({ queryKey: featureKey(MODULE, 'dayBoard') });
  };
};

const useExecutionAct = (act: (assignmentId: string) => Promise<OperationsExecutionResultDto>) => {
  const invalidate = useExecutionInvalidation();
  return useMutation({
    mutationFn: (assignmentId: string) => act(assignmentId),
    // DECLARING `onError` IS WHAT OPTS OUT OF THE GLOBAL TOAST. `query-client.ts` toasts the
    // generic `errorMessage` for any mutation that declares none — which for a refused execution
    // act would say "something went wrong" beside the precise reason this surface can give. One
    // failure must produce one message, and this is the one that knows which message.
    //
    // A lost race is not a failure the captain caused: somebody else moved the stop while he was
    // looking at it, so it is reported as news rather than as an error, and `onSettled` below has
    // already gone to fetch the new truth.
    onError: (error: unknown) => {
      const locale = store.getState().locale.locale;
      toast[isStateConflict(error) ? 'info' : 'error'](executionErrorMessage(error, locale));
    },
    // ALWAYS, on success and on failure alike. After a conflict the server's state is the one fact
    // worth having; after a success it is what unlocks the next stop.
    onSettled: invalidate,
  });
};

export const useStartStop = () => useExecutionAct(api.startStop);
export const useConfirmStopPickup = () => useExecutionAct(api.confirmStopPickup);
export const useConfirmStopDelivery = () => useExecutionAct(api.confirmStopDelivery);
export const useCompleteStop = () => useExecutionAct(api.completeStop);
