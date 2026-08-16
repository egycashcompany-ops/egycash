// TanStack Query hooks for the pay-item catalog, the employee assignments, and the compensation
// each employee's assignments come to over a period (ADR-013).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type BulkCreatePayrollAdjustments,
  type CancelPayrollAdjustment,
  type CreatePayrollAdjustment,
  type DecidePayrollAdjustment,
  type CreateEmployeePayItem,
  type CreatePayItem,
  type ApprovePayrollRun,
  type ClosePayrollRun,
  type CreatePayrollRun,
  type PayPayrollRun,
  type PayrollReportGroupBy,
  type UpdatePayItem,
} from '@ecms/contracts';
import { featureKey, listKey } from '../../../../shared/lib/query-keys';
import * as api from './payroll-api';

const MODULE = 'hr';
const FEATURE = 'payItems';

export const usePayItems = (params: Record<string, string | number>) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listPayItems(params),
    placeholderData: (prev) => prev,
  });

const useCatalogMutation = <TVars>(fn: (vars: TVars) => Promise<unknown>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void client.invalidateQueries({ queryKey: featureKey(MODULE, FEATURE) }),
  });
};

export const useCreatePayItem = () =>
  useCatalogMutation((body: CreatePayItem) => api.createPayItem(body));

export const useUpdatePayItem = () =>
  useCatalogMutation(({ id, body }: { id: string; body: UpdatePayItem }) =>
    api.updatePayItem(id, body),
  );

export const useDeletePayItem = () => useCatalogMutation((id: string) => api.deletePayItem(id));

// ── Employee pay items (PY-2) ───────────────────────────────────────────────

const EMPLOYEE_FEATURE = 'employeePayItems';

export const useEmployeePayItems = (
  employeeId: string,
  params: Record<string, string | number>,
) =>
  useQuery({
    queryKey: listKey(MODULE, EMPLOYEE_FEATURE, { employeeId, ...params }),
    queryFn: () => api.listEmployeePayItems(employeeId, params),
    placeholderData: (prev) => prev,
  });

/**
 * Both writes invalidate the employee feature AND the catalog: archiving the last assignment of
 * an item changes whether that item may be deleted, and the catalog screen shows that.
 */
const useEmployeePayItemMutation = <TVars, TData>(fn: (vars: TVars) => Promise<TData>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: featureKey(MODULE, EMPLOYEE_FEATURE) });
      void client.invalidateQueries({ queryKey: featureKey(MODULE, FEATURE) });
    },
  });
};

export const useCreateEmployeePayItem = (employeeId: string) =>
  useEmployeePayItemMutation((body: CreateEmployeePayItem) =>
    api.createEmployeePayItem(employeeId, body),
  );

export const useRemoveEmployeePayItem = (employeeId: string) =>
  useEmployeePayItemMutation((id: string) => api.removeEmployeePayItem(employeeId, id));

// ── Compensation effects (PY-3) ─────────────────────────────────────────────

/**
 * A calculation, not a record — so it is never cached across a write: assigning or ending a pay
 * item changes the answer, and the mutations above already invalidate this feature's key.
 */
export const useEmployeeCompensation = (employeeId: string, period: string, enabled: boolean) =>
  useQuery({
    queryKey: listKey(MODULE, 'compensation', { employeeId, period }),
    queryFn: () => api.getEmployeeCompensation(employeeId, period),
    enabled,
    retry: false,
  });

// ── Payroll runs (PY-6) ─────────────────────────────────────────────────────

const RUNS_FEATURE = 'payrollRuns';

export const usePayrollRuns = (params: Record<string, string | number>) =>
  useQuery({
    queryKey: listKey(MODULE, RUNS_FEATURE, params),
    queryFn: () => api.listPayrollRuns(params),
    placeholderData: (prev) => prev,
  });

/**
 * Freezing changes what every compensation figure in that period reads from, so a run mutation
 * invalidates the compensation cache as well as the run list.
 */
const useRunMutation = <TVars, TData>(fn: (vars: TVars) => Promise<TData>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: featureKey(MODULE, RUNS_FEATURE) });
      void client.invalidateQueries({ queryKey: featureKey(MODULE, 'compensation') });
    },
  });
};

export const useCreatePayrollRun = () =>
  useRunMutation((body: CreatePayrollRun) => api.createPayrollRun(body));

export const useFreezePayrollRun = () =>
  useRunMutation(({ id, version }: { id: string; version: number }) =>
    api.freezePayrollRun(id, version),
  );

export const useCancelPayrollRun = () =>
  useRunMutation(({ id, reason, version }: { id: string; reason: string; version: number }) =>
    api.cancelPayrollRun(id, { reason, version }),
  );

// ── Payslips (PY-7) ─────────────────────────────────────────────────────────

const PAYSLIPS_FEATURE = 'payslips';

/**
 * The reconciliation's own feature key (P-HR-15-A).
 *
 * Not a member of the payslip list's key: the two are invalidated by the same act but answer
 * different questions, and a reconciliation cached under a paginated key would be refetched once
 * per page of a list it does not depend on.
 */
const RECONCILIATION_FEATURE = 'runReconciliation';

/** The cost breakdown's own key, for the same reason (P-HR-14 / U14-1). */
const COST_BREAKDOWN_FEATURE = 'runCostBreakdown';

export const useRunPayslips = (runId: string, params: Record<string, string | number>) =>
  useQuery({
    queryKey: listKey(MODULE, PAYSLIPS_FEATURE, { runId, ...params }),
    queryFn: () => api.listRunPayslips(runId, params),
    placeholderData: (prev) => prev,
  });

/**
 * Issuing invalidates the payslip list and nothing else.
 *
 * Not the runs: issuing writes no figure onto the run and does not change its status — the run is
 * frozen before and frozen after, and a list that refetched would report the same row.
 */
export const useGeneratePayslips = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.generatePayslips(runId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: featureKey(MODULE, PAYSLIPS_FEATURE) });
      // …and the reconciliation, which is a statement ABOUT those payslips: issuing changes every
      // figure in it, and a stale total beside a fresh list is the one thing a reconciliation
      // must never show.
      void client.invalidateQueries({ queryKey: featureKey(MODULE, RECONCILIATION_FEATURE) });
      // …and the cost breakdown, which groups the very lines that were just written.
      void client.invalidateQueries({ queryKey: featureKey(MODULE, COST_BREAKDOWN_FEATURE) });
    },
  });
};

/** What the run cost, grouped by origin, pay item and branch (P-HR-14 / U14-1). */
export const useRunCostBreakdown = (runId: string) =>
  useQuery({
    queryKey: listKey(MODULE, COST_BREAKDOWN_FEATURE, { runId }),
    queryFn: () => api.getRunCostBreakdown(runId),
  });

/**
 * The same money along ONE axis the reader chose (P-HR-25).
 *
 * The axis is part of the cache key, so switching axis is a different question with a different
 * answer rather than a refetch of the same one. It shares the cost-breakdown feature key because it
 * groups the very same lines: whatever invalidates one has invalidated the other.
 */
export const useRunCostReport = (runId: string, groupBy: PayrollReportGroupBy) =>
  useQuery({
    queryKey: listKey(MODULE, COST_BREAKDOWN_FEATURE, { runId, groupBy }),
    queryFn: () => api.postRunCostReport(runId, { groupBy, columns: [] }),
    placeholderData: (prev) => prev,
  });

/** The run reconciled against its own payslips (P-HR-15-A). */
export const useRunReconciliation = (runId: string) =>
  useQuery({
    queryKey: listKey(MODULE, RECONCILIATION_FEATURE, { runId }),
    queryFn: () => api.getRunReconciliation(runId),
  });

/**
 * My own payslips (PY-11).
 *
 * Its own key rather than a filter on the run list: this query answers for the caller and no
 * parameter can widen it, so it must not share a cache entry with a list that CAN be widened.
 */
export const useMyPayslips = (params: Record<string, string | number>) =>
  useQuery({
    queryKey: listKey(MODULE, 'myPayslips', params),
    queryFn: () => api.listMyPayslips(params),
    placeholderData: (prev) => prev,
  });

// ── Run governance (P-HR-10) ────────────────────────────────────────────────
// All three reuse `useRunMutation`, so they invalidate the run list AND the compensation cache.
// The second half is redundant for these three — approving or paying changes no figure, because
// the payslips a run issued are immutable — but sharing the existing mutation is worth more than
// saving a refetch, and a second near-identical helper is how two invalidation rules start to
// disagree.

export const useApprovePayrollRun = () =>
  useRunMutation(({ id, body }: { id: string; body: ApprovePayrollRun }) =>
    api.approvePayrollRun(id, body),
  );

export const usePayPayrollRun = () =>
  useRunMutation(({ id, body }: { id: string; body: PayPayrollRun }) =>
    api.payPayrollRun(id, body),
  );

export const useClosePayrollRun = () =>
  useRunMutation(({ id, body }: { id: string; body: ClosePayrollRun }) =>
    api.closePayrollRun(id, body),
  );

// ── Payroll adjustments (P-HR-04) ───────────────────────────────────────────
// Keyed per employee: a bonus is that person's money, and the tab that shows it is on their file.
const ADJUSTMENTS = 'payrollAdjustments';

export const useEmployeeAdjustments = (
  employeeId: string,
  params: Record<string, string | number>,
) =>
  useQuery({
    queryKey: [MODULE, ADJUSTMENTS, employeeId, params],
    queryFn: () => api.listEmployeeAdjustments(employeeId, params),
    enabled: employeeId !== '',
    placeholderData: (prev) => prev,
  });

/** Every write refreshes the list AND the compensation figure the tab beside it shows. */
const useAdjustmentMutation = <TVars>(employeeId: string, fn: (vars: TVars) => Promise<unknown>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [MODULE, ADJUSTMENTS, employeeId] });
      void client.invalidateQueries({ queryKey: [MODULE, 'compensation', employeeId] });
    },
  });
};

export const useCreateAdjustment = (employeeId: string) =>
  useAdjustmentMutation(employeeId, (body: CreatePayrollAdjustment) =>
    api.createAdjustment(employeeId, body),
  );

export const useSubmitAdjustment = (employeeId: string) =>
  useAdjustmentMutation(employeeId, ({ id, version }: { id: string; version: number }) =>
    api.submitAdjustment(employeeId, id, version),
  );

export const useDecideAdjustment = (employeeId: string) =>
  useAdjustmentMutation(employeeId, ({ id, body }: { id: string; body: DecidePayrollAdjustment }) =>
    api.decideAdjustment(employeeId, id, body),
  );

export const useCancelAdjustment = (employeeId: string) =>
  useAdjustmentMutation(employeeId, ({ id, body }: { id: string; body: CancelPayrollAdjustment }) =>
    api.cancelAdjustment(employeeId, id, body),
  );

// ── The organization-wide queue (P-HR-06) ───────────────────────────────────
//
// A SECOND key, not a reshuffle of the one above. The tab's key is per employee because a bonus is
// that person's money; this list crosses everybody, so caching it under any one employee would
// make an approval invalidate the wrong page. `ORG_ADJUSTMENTS` is that list, and the write below
// invalidates BOTH — the queue the approver is looking at and the profile tab they are not.
const ORG_ADJUSTMENTS = 'payrollAdjustmentsAll';

export const useAdjustments = (params: Record<string, string | number>, enabled = true) =>
  useQuery({
    queryKey: [MODULE, ORG_ADJUSTMENTS, params],
    queryFn: () => api.listAdjustments(params),
    enabled,
    placeholderData: (prev) => prev,
  });

/**
 * One decision, recorded for many people at once (P-HR-13).
 *
 * Invalidates BOTH adjustment lists: the batch writes rows that belong to many employees, so the
 * per-employee tabs and the organization-wide queue are equally stale afterwards.
 */
export const useBulkCreateAdjustments = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkCreatePayrollAdjustments) => api.bulkCreateAdjustments(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [MODULE, ORG_ADJUSTMENTS] });
      void client.invalidateQueries({ queryKey: [MODULE, ADJUSTMENTS] });
    },
  });
};

/**
 * Decide from the queue. The employee comes from the ROW, because the endpoint is nested under the
 * employee even when the list that found it was not — one API, reached from two screens.
 */
export const useDecideAdjustmentFromQueue = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      employeeId,
      id,
      body,
    }: {
      employeeId: string;
      id: string;
      body: DecidePayrollAdjustment;
    }) => api.decideAdjustment(employeeId, id, body),
    onSuccess: (_data, vars) => {
      void client.invalidateQueries({ queryKey: [MODULE, ORG_ADJUSTMENTS] });
      void client.invalidateQueries({ queryKey: [MODULE, ADJUSTMENTS, vars.employeeId] });
      void client.invalidateQueries({ queryKey: [MODULE, 'compensation', vars.employeeId] });
    },
  });
};

/** The caller's own adjustments (P-HR-19). A read with no mutation behind it. */
export const useMyAdjustments = (params: Record<string, string | number>) =>
  useQuery({
    queryKey: listKey(MODULE, 'myAdjustments', params),
    queryFn: () => api.listMyAdjustments(params),
    placeholderData: (prev) => prev,
  });

/** One employee's payslip history (P-HR-20) — read-only, like every payslip surface. */
export const useEmployeePayslips = (employeeId: string, params: Record<string, string | number>) =>
  useQuery({
    queryKey: listKey(MODULE, 'employeePayslips', { employeeId, ...params }),
    queryFn: () => api.listEmployeePayslips(employeeId, params),
    enabled: employeeId !== '',
    placeholderData: (prev) => prev,
  });
