// TanStack Query hooks for employee loans and advances (ADR-013 — P-HR-05, phase A).
//
// One invalidation key for the whole feature: every write on a loan can change its schedule as
// well as its status — a disbursement creates the schedule, a reschedule rewrites its tail, a
// settlement cancels what is left — so refreshing anything less than the loan and its rows would
// leave the screen showing a plan that no longer exists.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AccelerateEmployeeLoan,
  type CancelEmployeeLoan,
  type CreateEmployeeLoan,
  type DecideEmployeeLoan,
  type DisburseEmployeeLoan,
  type RescheduleEmployeeLoan,
  type SettleEmployeeLoanExternally,
} from '@ecms/contracts';
import * as api from './employee-loans-api';

const MODULE = 'hr';
const FEATURE = 'employeeLoans';

export const useEmployeeLoans = (employeeId: string, params: Record<string, string | number>) =>
  useQuery({
    queryKey: [MODULE, FEATURE, employeeId, params],
    queryFn: () => api.listEmployeeLoans(employeeId, params),
    enabled: employeeId !== '',
    placeholderData: (prev) => prev,
  });

const useLoanMutation = <TVars>(employeeId: string, fn: (vars: TVars) => Promise<unknown>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [MODULE, FEATURE, employeeId] });
    },
  });
};

export const useCreateLoan = (employeeId: string) =>
  useLoanMutation(employeeId, (body: CreateEmployeeLoan) => api.createLoan(employeeId, body));

export const useSubmitLoan = (employeeId: string) =>
  useLoanMutation(employeeId, ({ id, version }: { id: string; version: number }) =>
    api.submitLoan(employeeId, id, version),
  );

export const useDecideLoan = (employeeId: string) =>
  useLoanMutation(employeeId, ({ id, body }: { id: string; body: DecideEmployeeLoan }) =>
    api.decideLoan(employeeId, id, body),
  );

export const useDisburseLoan = (employeeId: string) =>
  useLoanMutation(employeeId, ({ id, body }: { id: string; body: DisburseEmployeeLoan }) =>
    api.disburseLoan(employeeId, id, body),
  );

export const useRescheduleLoan = (employeeId: string) =>
  useLoanMutation(employeeId, ({ id, body }: { id: string; body: RescheduleEmployeeLoan }) =>
    api.rescheduleLoan(employeeId, id, body),
  );

export const useAccelerateLoan = (employeeId: string) =>
  useLoanMutation(employeeId, ({ id, body }: { id: string; body: AccelerateEmployeeLoan }) =>
    api.accelerateLoan(employeeId, id, body),
  );

export const useSettleLoanExternally = (employeeId: string) =>
  useLoanMutation(
    employeeId,
    ({ id, body }: { id: string; body: SettleEmployeeLoanExternally }) =>
      api.settleLoanExternally(employeeId, id, body),
  );

export const useCancelLoan = (employeeId: string) =>
  useLoanMutation(employeeId, ({ id, body }: { id: string; body: CancelEmployeeLoan }) =>
    api.cancelLoan(employeeId, id, body),
  );

// ── The organization-wide administration list (P-HR-06-B) ───────────────────
//
// A SECOND cache key, not a reshuffle of the one above. The tab's key is per employee because a
// loan is that person's debt; this list crosses everybody, so filing it under any one employee
// would make a disbursement refresh the wrong page. The two writes below invalidate BOTH — the
// list the administrator is looking at, and the profile tab they are not.
const ALL_LOANS = 'employeeLoansAll';

export const useAllLoans = (params: Record<string, string | number>, enabled = true) =>
  useQuery({
    queryKey: [MODULE, ALL_LOANS, params],
    queryFn: () => api.listAllLoans(params),
    enabled,
    placeholderData: (prev) => prev,
  });

/** The employee comes from the ROW: the acts are nested under them even when the list was not. */
const useAdminLoanMutation = <TVars extends { employeeId: string }>(
  fn: (vars: TVars) => Promise<unknown>,
) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_data, vars) => {
      void client.invalidateQueries({ queryKey: [MODULE, ALL_LOANS] });
      void client.invalidateQueries({ queryKey: [MODULE, FEATURE, vars.employeeId] });
    },
  });
};

export const useDecideLoanFromList = () =>
  useAdminLoanMutation(
    ({ employeeId, id, body }: { employeeId: string; id: string; body: DecideEmployeeLoan }) =>
      api.decideLoan(employeeId, id, body),
  );

export const useDisburseLoanFromList = () =>
  useAdminLoanMutation(
    ({ employeeId, id, body }: { employeeId: string; id: string; body: DisburseEmployeeLoan }) =>
      api.disburseLoan(employeeId, id, body),
  );

/** The caller's own loans (P-HR-18). No mutation hangs off it — an employee reads, and that is all. */
export const useMyLoans = (params: Record<string, string | number>) =>
  useQuery({
    queryKey: [MODULE, FEATURE, 'mine', params],
    queryFn: () => api.listMyLoans(params),
    placeholderData: (prev) => prev,
  });
