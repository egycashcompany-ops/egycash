// TanStack Query hooks for the Leave app (ADR-013). Every request mutation invalidates the
// whole leave subtree — balances, queues and lists all shift together on lifecycle changes.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AdjustLeaveBalance,
  type CancelLeaveRequest,
  type CreateHoliday,
  type CreateLeaveRequest,
  type CreateLeaveType,
  type DecideLeaveRequest,
  type ReturnLeaveRequest,
  type UpdateLeaveType,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../shared/lib/query-keys';
import * as api from './leave-api';
import { type LeaveListParams } from './leave-api';

const MODULE = 'hr';
const FEATURE = 'leave';
const ROOT = [MODULE, FEATURE] as const;

export const useLeaveTypes = () =>
  useQuery({ queryKey: listKey(MODULE, `${FEATURE}Types`, {}), queryFn: api.listLeaveTypes, staleTime: 60_000 });

export const useLeaveRequests = (params: LeaveListParams) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listLeaveRequests(params),
    placeholderData: (prev) => prev,
  });

export const useLeaveRequest = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, id),
    queryFn: () => api.getLeaveRequest(id),
    enabled: id !== '',
  });

export const usePendingApprovals = () =>
  useQuery({ queryKey: [...ROOT, 'pendingApprovals'], queryFn: api.pendingLeaveApprovals });

export const useLeaveCalendar = (from: string, to: string) =>
  useQuery({
    queryKey: [...ROOT, 'calendar', from, to],
    queryFn: () => api.leaveCalendar(from, to),
    placeholderData: (prev) => prev,
  });

export const useUnreconciledLeave = (enabled: boolean) =>
  useQuery({
    queryKey: [...ROOT, 'unreconciled'],
    queryFn: api.unreconciledLeave,
    enabled,
  });

export const useWorkCalendar = (from: string, to: string) =>
  useQuery({
    queryKey: [...ROOT, 'workCalendar', from, to],
    queryFn: () => api.getWorkCalendar(from, to),
    staleTime: 5 * 60_000,
  });

export const useEmployeeLeaveBalances = (employeeId: string, year?: number) =>
  useQuery({
    queryKey: [...ROOT, 'balances', employeeId, year ?? 'current'],
    queryFn: () => api.employeeLeaveBalances(employeeId, year),
    enabled: employeeId !== '',
  });

export const useEmployeeLeaveLedger = (employeeId: string, params: LeaveListParams) =>
  useQuery({
    queryKey: [...ROOT, 'ledger', employeeId, params],
    queryFn: () => api.employeeLeaveLedger(employeeId, params),
    enabled: employeeId !== '',
    placeholderData: (prev) => prev,
  });

export const useLeaveEligibility = (employeeId: string, params: LeaveListParams, enabled: boolean) =>
  useQuery({
    queryKey: [...ROOT, 'eligibility', employeeId, params],
    queryFn: () => api.leaveEligibility(employeeId, params),
    enabled: enabled && employeeId !== '',
    staleTime: 10_000,
    retry: false,
  });

const useLeaveInvalidation = () => {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: [MODULE] });
  };
};

export const useSubmitLeaveRequest = () => {
  const invalidate = useLeaveInvalidation();
  return useMutation({
    mutationFn: (body: CreateLeaveRequest) => api.submitLeaveRequest(body),
    onSuccess: invalidate,
  });
};

export const useDecideLeaveRequest = () => {
  const invalidate = useLeaveInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; verdict: 'approve' | 'reject'; body: DecideLeaveRequest }) =>
      vars.verdict === 'approve'
        ? api.approveLeaveRequest(vars.id, vars.body)
        : api.rejectLeaveRequest(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

export const useCancelLeaveRequest = () => {
  const invalidate = useLeaveInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; body: CancelLeaveRequest }) =>
      api.cancelLeaveRequest(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

export const useReturnLeaveRequest = () => {
  const invalidate = useLeaveInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; body: ReturnLeaveRequest }) =>
      api.returnLeaveRequest(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

export const useAttachToLeaveRequest = () => {
  const invalidate = useLeaveInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; file: File }) => api.attachToLeaveRequest(vars.id, vars.file),
    onSuccess: invalidate,
  });
};

export const useAdjustLeaveBalance = () => {
  const invalidate = useLeaveInvalidation();
  return useMutation({
    mutationFn: (vars: { employeeId: string; body: AdjustLeaveBalance }) =>
      api.adjustLeaveBalance(vars.employeeId, vars.body),
    onSuccess: invalidate,
  });
};

export const useCreateLeaveType = () => {
  const invalidate = useLeaveInvalidation();
  return useMutation({ mutationFn: (body: CreateLeaveType) => api.createLeaveType(body), onSuccess: invalidate });
};

export const useUpdateLeaveType = () => {
  const invalidate = useLeaveInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateLeaveType }) => api.updateLeaveType(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

export const useCreateHoliday = () => {
  const invalidate = useLeaveInvalidation();
  return useMutation({ mutationFn: (body: CreateHoliday) => api.createHoliday(body), onSuccess: invalidate });
};

export const useDeleteHoliday = () => {
  const invalidate = useLeaveInvalidation();
  return useMutation({ mutationFn: (id: string) => api.deleteHoliday(id), onSuccess: invalidate });
};
