// TanStack Query hooks for Settlements & Review, Preparation and Control & Supplies (ADR-013;
// docs/12-planning/atm-settlements-phase1.md §9.2). Keys follow the platform factory —
// ['atm', feature, kind, params] — and name the same families the realtime registry invalidates
// for the `atm.*` settlement topics (§6.11), so a write here and a write somebody else made go stale
// identically.
//
// Invalidation facts worth stating (§9.2):
//   · a layout save stales the layouts, the open layout and the plans (a layout change raises
//     `LAYOUT_CHANGED` on their lines);
//   · a standard-load write stales the profiles and the layouts (a layout row flags a profile of
//     another bank);
//   · every plan and line write, and the issue, stales the plan;
//   · a capture stales Preparation's lines and context and Control's day;
//   · a route or assignment write stales Control's day.
//
// PREPARATION AND CONTROL REFETCH EVERY MINUTE while the tab is visible (DS-26): audit signals carry
// no branch, so a branch-scoped user hears only the day signals, and the minute closes what remains.
//
// Every mutation declares `onError`, which opts it out of the global toast
// (`shared/lib/query-client.ts`): each page maps its own refusals (§9.4–§9.7), and the global
// handler would add a second toast with the server's English sentence. A `STALE_DOCUMENT` also
// re-reads the family it was about, so the page shows what changed underneath it.
//
// PRINTS ARE MUTATIONS WITH `gcTime: 0`: a print's snapshot is a paper, written into its tab once,
// never a cache entry another screen could read later (§8, §9.2).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ErrorCodes,
  type AddAtmPlanLines,
  type AddAtmSpareLine,
  type AssignAtmRoutes,
  type AtmControlPrint,
  type AtmLineReason,
  type AtmRoutesFromZones,
  type AtmSettlementPage,
  type AtmSettlementPrint,
  type AtmSpareUse,
  type AtmVersion,
  type CreateAtmPlan,
  type CreateAtmRoute,
  type IssueAtmPlan,
  type SaveAtmCassetteLayout,
  type SaveAtmPreparation,
  type SaveAtmStandardLoad,
  type UpdateAtmPlanLine,
  type UpdateAtmRoute,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import * as api from './settlements-api';
import {
  type LayoutImportOptions,
  type SettlementBankParams,
  type SettlementPlanParams,
} from './settlements-api';

const MODULE = 'atm';

/** The settlement key families — also the prefixes the realtime registry names (§6.11). */
export const settlementKeys = {
  context: featureKey(MODULE, 'settlementContext'),
  layouts: featureKey(MODULE, 'cassetteLayouts'),
  layout: featureKey(MODULE, 'cassetteLayout'),
  standardLoads: featureKey(MODULE, 'standardLoads'),
  plan: featureKey(MODULE, 'settlementPlan'),
  importRuns: featureKey(MODULE, 'layoutImportRuns'),
  preparationContext: featureKey(MODULE, 'preparationContext'),
  preparationLines: featureKey(MODULE, 'preparationLines'),
  controlDay: featureKey(MODULE, 'controlDay'),
};

export const settlementContextKey = (page: AtmSettlementPage): readonly unknown[] =>
  listKey(MODULE, 'settlementContext', { page });
export const cassetteLayoutsKey = ({ bankCode, branchId }: SettlementBankParams) =>
  listKey(MODULE, 'cassetteLayouts', { bankCode, branchId });
export const cassetteLayoutKey = (machineId: string): readonly unknown[] =>
  detailKey(MODULE, 'cassetteLayout', machineId);
export const standardLoadsKey = ({ bankCode, branchId }: SettlementBankParams) =>
  listKey(MODULE, 'standardLoads', { bankCode, branchId });
export const settlementPlanKey = ({ bankCode, date, branchId }: SettlementPlanParams) =>
  listKey(MODULE, 'settlementPlan', { bankCode, date, branchId });
export const layoutImportRunsKey = ({ bankCode, branchId }: SettlementBankParams) =>
  listKey(MODULE, 'layoutImportRuns', { bankCode, branchId });
export const preparationContextKey = (date: string | null): readonly unknown[] =>
  listKey(MODULE, 'preparationContext', { date });
export const preparationLinesKey = (planId: string): readonly unknown[] =>
  listKey(MODULE, 'preparationLines', { planId });
export const controlDayKey = (date: string | null, branchId: string | null) =>
  listKey(MODULE, 'controlDay', { date, branchId });

/** DS-26: Preparation and Control re-read every minute, only while the tab is visible. */
const DAY_REFRESH = { refetchInterval: 60_000, refetchIntervalInBackground: false } as const;

type QueryClientLike = ReturnType<typeof useQueryClient>;

const invalidate = (client: QueryClientLike, families: readonly (readonly unknown[])[]): void => {
  for (const queryKey of families) void client.invalidateQueries({ queryKey });
};

/** The caller words the refusal; a stale write also re-reads what it was about. */
const onRefusal =
  (client: QueryClientLike, families: readonly (readonly unknown[])[]) =>
  (error: unknown): void => {
    if (error instanceof ApiError && error.code === ErrorCodes.STALE_DOCUMENT) {
      invalidate(client, families);
    }
  };

const reportedByCaller = (): void => undefined;

const LAYOUT_SAVE = [settlementKeys.layouts, settlementKeys.layout, settlementKeys.plan];
const STANDARD_LOAD_WRITE = [settlementKeys.standardLoads, settlementKeys.layouts];
const PLAN_WRITE = [settlementKeys.plan];
const CAPTURE = [
  settlementKeys.preparationLines,
  settlementKeys.preparationContext,
  settlementKeys.controlDay,
];
const ROUTE_WRITE = [settlementKeys.controlDay];

// ── Reads ───────────────────────────────────────────────────────────────────
export const useSettlementContext = (page: AtmSettlementPage) =>
  useQuery({
    queryKey: settlementContextKey(page),
    queryFn: () => api.getSettlementContext(page),
  });

/** Enabled once the context has resolved the work branch and the bank is one it offers. */
export const useCassetteLayouts = (params: SettlementBankParams, enabled: boolean) =>
  useQuery({
    queryKey: cassetteLayoutsKey(params),
    queryFn: () => api.listCassetteLayouts(params),
    enabled,
  });

export const useCassetteLayout = (machineId: string | null) =>
  useQuery({
    queryKey: cassetteLayoutKey(machineId ?? ''),
    queryFn: () => api.getCassetteLayout(machineId ?? ''),
    enabled: machineId !== null && machineId !== '',
  });

export const useStandardLoads = (params: SettlementBankParams, enabled: boolean) =>
  useQuery({
    queryKey: standardLoadsKey(params),
    queryFn: () => api.listStandardLoads(params),
    enabled,
  });

export const useLayoutImportRuns = (params: SettlementBankParams, enabled: boolean) =>
  useQuery({
    queryKey: layoutImportRunsKey(params),
    queryFn: () => api.listLayoutImportRuns(params),
    enabled,
  });

export const useSettlementPlan = (params: SettlementPlanParams, enabled: boolean) =>
  useQuery({
    queryKey: settlementPlanKey(params),
    queryFn: () => api.getPlanByDay(params),
    enabled,
  });

/** `date` null asks the server for the day being prepared (DS-25). */
export const usePreparationContext = (date: string | null) =>
  useQuery({
    queryKey: preparationContextKey(date),
    queryFn: () => api.getPreparationContext({ date }),
    ...DAY_REFRESH,
  });

export const usePreparationLines = (planId: string | null) =>
  useQuery({
    queryKey: preparationLinesKey(planId ?? ''),
    queryFn: () => api.listPreparationLines(planId ?? ''),
    enabled: planId !== null && planId !== '',
    ...DAY_REFRESH,
  });

/** `date` null asks the server for the day being dispatched (DS-25). */
export const useControlDay = (date: string | null, branchId: string | null = null) =>
  useQuery({
    queryKey: controlDayKey(date, branchId),
    queryFn: () => api.getControlDay({ date, branchId }),
    ...DAY_REFRESH,
  });

// ── Layouts and standard loads ──────────────────────────────────────────────
export const useSaveCassetteLayout = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ machineId, body }: { machineId: string; body: SaveAtmCassetteLayout }) =>
      api.saveCassetteLayout(machineId, body),
    onSuccess: () => invalidate(client, LAYOUT_SAVE),
    onError: onRefusal(client, LAYOUT_SAVE),
  });
};

export const useCreateStandardLoad = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveAtmStandardLoad) => api.createStandardLoad(body),
    onSuccess: () => invalidate(client, STANDARD_LOAD_WRITE),
    onError: onRefusal(client, STANDARD_LOAD_WRITE),
  });
};

export const useUpdateStandardLoad = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SaveAtmStandardLoad }) =>
      api.updateStandardLoad(id, body),
    onSuccess: () => invalidate(client, STANDARD_LOAD_WRITE),
    onError: onRefusal(client, STANDARD_LOAD_WRITE),
  });
};

export const useDeleteStandardLoad = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.deleteStandardLoad(id, version),
    onSuccess: () => invalidate(client, STANDARD_LOAD_WRITE),
    onError: onRefusal(client, STANDARD_LOAD_WRITE),
  });
};

/**
 * The Full list import. A preview writes no layout and invalidates nothing; an apply writes
 * layouts, perhaps standard loads, and a run row, so it stales those and the plans their lines
 * belong to. `gcTime: 0`: the preview's rows live in the page, not in a cache (§5.3).
 */
export const useImportLayouts = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ file, options }: { file: File; options: LayoutImportOptions }) =>
      api.importLayouts(file, options),
    gcTime: 0,
    onSuccess: (result) => {
      if (!result.applied) return;
      invalidate(client, [
        settlementKeys.layouts,
        settlementKeys.layout,
        settlementKeys.standardLoads,
        settlementKeys.importRuns,
        settlementKeys.plan,
      ]);
    },
    onError: reportedByCaller,
  });
};

// ── Plans and lines ─────────────────────────────────────────────────────────
const usePlanMutation = <V, R>(mutationFn: (variables: V) => Promise<R>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidate(client, PLAN_WRITE),
    onError: onRefusal(client, PLAN_WRITE),
  });
};

export const useCreatePlan = () => usePlanMutation((body: CreateAtmPlan) => api.createPlan(body));

export const useAddPlanLines = () =>
  usePlanMutation(({ planId, body }: { planId: string; body: AddAtmPlanLines }) =>
    api.addPlanLines(planId, body),
  );

export const useAddSpareLine = () =>
  usePlanMutation(({ planId, body }: { planId: string; body: AddAtmSpareLine }) =>
    api.addSpareLine(planId, body),
  );

export const useUpdatePlanLine = () =>
  usePlanMutation(
    ({ planId, lineId, body }: { planId: string; lineId: string; body: UpdateAtmPlanLine }) =>
      api.updatePlanLine(planId, lineId, body),
  );

export const useDeletePlanLine = () =>
  usePlanMutation(
    ({ planId, lineId, version }: { planId: string; lineId: string; version: number }) =>
      api.deletePlanLine(planId, lineId, version),
  );

export const useIssuePlan = () =>
  usePlanMutation(({ planId, body }: { planId: string; body: IssueAtmPlan }) =>
    api.issuePlan(planId, body),
  );

export const useReopenPlanLine = () =>
  usePlanMutation(
    ({ planId, lineId, body }: { planId: string; lineId: string; body: AtmLineReason }) =>
      api.reopenPlanLine(planId, lineId, body),
  );

export const useCancelPlanLine = () =>
  usePlanMutation(
    ({ planId, lineId, body }: { planId: string; lineId: string; body: AtmLineReason }) =>
      api.cancelPlanLine(planId, lineId, body),
  );

export const useRecordSpareUse = () =>
  usePlanMutation(
    ({ planId, lineId, body }: { planId: string; lineId: string; body: AtmSpareUse }) =>
      api.recordSpareUse(planId, lineId, body),
  );

// ── Prints (§8: the tab first, then the request) ────────────────────────────
/**
 * S22. A print counts Notes and records what «بيان التغذية» and «سيلزات» covered, so the plan is
 * re-read afterwards (its print counts and the stale notices move); the `.xlsx` changes nothing on
 * the plan but is re-read the same way, which costs one request.
 */
export const usePrintPlan = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, body }: { planId: string; body: AtmSettlementPrint }) =>
      api.printPlan(planId, body),
    gcTime: 0,
    onSuccess: () => invalidate(client, PLAN_WRITE),
    onError: onRefusal(client, PLAN_WRITE),
  });
};

/** C7. Control's «سيلزات» records on the plan what it covered, too. */
export const usePrintControl = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: AtmControlPrint) => api.printControl(body),
    gcTime: 0,
    onSuccess: () => invalidate(client, [settlementKeys.plan, settlementKeys.controlDay]),
    onError: reportedByCaller,
  });
};

// ── Preparation ─────────────────────────────────────────────────────────────
const useCaptureMutation = <V, R>(mutationFn: (variables: V) => Promise<R>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidate(client, CAPTURE),
    onError: onRefusal(client, CAPTURE),
  });
};

export const useSavePreparation = () =>
  useCaptureMutation(({ lineId, body }: { lineId: string; body: SaveAtmPreparation }) =>
    api.savePreparation(lineId, body),
  );

export const useMarkPrepared = () =>
  useCaptureMutation(({ lineId, body }: { lineId: string; body: AtmVersion }) =>
    api.markPrepared(lineId, body),
  );

export const useReopenPreparation = () =>
  useCaptureMutation(({ lineId, body }: { lineId: string; body: AtmVersion }) =>
    api.reopenPreparation(lineId, body),
  );

// ── Control & Supplies ──────────────────────────────────────────────────────
const useRouteMutation = <V, R>(mutationFn: (variables: V) => Promise<R>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidate(client, ROUTE_WRITE),
    // A stale route, and a move whose `from` no longer holds (`MOVED`), both re-read the day.
    onError: onRefusal(client, ROUTE_WRITE),
  });
};

export const useCreateRoute = () =>
  useRouteMutation((body: CreateAtmRoute) => api.createRoute(body));

export const useRoutesFromZones = () =>
  useRouteMutation((body: AtmRoutesFromZones) => api.routesFromZones(body));

export const useUpdateRoute = () =>
  useRouteMutation(({ routeId, body }: { routeId: string; body: UpdateAtmRoute }) =>
    api.updateRoute(routeId, body),
  );

export const useDeleteRoute = () =>
  useRouteMutation(({ routeId, version }: { routeId: string; version: number }) =>
    api.deleteRoute(routeId, version),
  );

export const useAssignRoutes = () =>
  useRouteMutation((body: AssignAtmRoutes) => api.assignRoutes(body));
