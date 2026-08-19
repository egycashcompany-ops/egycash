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
  type CompleteOperationsShipment,
  type CreateOperationsArea,
  type CreateOperationsBank,
  type CreateOperationsBankBranch,
  type CreateOperationsCurrency,
  type CreateOperationsShipment,
  type DispatchSecuredShipments,
  type ListOperationsCrewRequirementsQuery,
  type ListSecuredBacklogQuery,
  type OperationsExecutionResultDto,
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
import { store } from '../../../store';
import { toast } from '../../../shared/ui/toast/toast-store';
import { executionErrorMessage, isStateConflict } from '../mobile/execution-errors';
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
const shipmentSubtrees = [
  featureKey(MODULE, 'shipments'),
  featureKey(MODULE, 'dayBoard'),
];

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

/**
 * One day's board. `date` null means "today" — resolved by the SERVER, which also echoes back the
 * day it used, so a client near midnight can never disagree with it about which day this is.
 */
export const useOperationsDayBoard = (date: string | null, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'dayBoard', { date: date ?? 'today' }),
    queryFn: () => api.getDayBoard(date),
    enabled,
  });

// ── Writes ─────────────────────────────────────────────────────────────────

/** Shared by every shipment mutation, so none of them can forget a surface. */
const useShipmentInvalidation = () => {
  const qc = useQueryClient();
  return async (): Promise<void> => {
    for (const key of shipmentSubtrees) await qc.invalidateQueries({ queryKey: key });
  };
};

export const useCreateOperationsShipment = () => {
  const invalidate = useShipmentInvalidation();
  return useMutation({
    mutationFn: (body: CreateOperationsShipment) => api.createShipment(body),
    onSuccess: invalidate,
  });
};

export const useUpdateOperationsShipment = () => {
  const invalidate = useShipmentInvalidation();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateOperationsShipment }) =>
      api.updateShipment(id, body),
    onSuccess: invalidate,
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

export const useAssignSecuredDelivery = () => {
  const invalidate = useSecuredInvalidation();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AssignSecuredDeliveryLeg }) =>
      api.assignSecuredDelivery(id, body),
    onSuccess: invalidate,
  });
};

export const useDispatchSecured = () => {
  const qc = useQueryClient();
  const invalidate = useSecuredInvalidation();
  return useMutation({
    mutationFn: (body: DispatchSecuredShipments) => api.dispatchSecured(body),
    onSuccess: async () => {
      await invalidate();
      // Dispatch locks the crew row, so the board's state changed too.
      await qc.invalidateQueries({ queryKey: operationsKeys.crewBoard });
    },
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
