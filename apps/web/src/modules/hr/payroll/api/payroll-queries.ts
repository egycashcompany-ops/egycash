// TanStack Query hooks for the pay-item catalog, the employee assignments, and the compensation
// each employee's assignments come to over a period (ADR-013).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CancelPayrollAdjustment,
  type CreatePayrollAdjustment,
  type DecidePayrollAdjustment,
  type CreateEmployeePayItem,
  type CreatePayItem,
  type CreatePayrollRun,
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
    onSuccess: () => void client.invalidateQueries({ queryKey: featureKey(MODULE, PAYSLIPS_FEATURE) }),
  });
};

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
