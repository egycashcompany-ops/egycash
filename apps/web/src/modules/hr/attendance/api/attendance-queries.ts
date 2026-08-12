// TanStack Query hooks for the Attendance screens (ADR-013). Assignment mutations invalidate the
// assignment lists only; the shifts catalog is its own small cache. A decision or an overtime
// approval invalidates BOTH the regularization caches and the day caches, because approving is
// what rewrites the day (ADR-027) — the screen must not keep showing the pre-approval numbers.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ApproveOvertime,
  type CreateAttendanceRegularization,
  type CreateShift,
  type CreateShiftAssignment,
  type DecideAttendanceRegularization,
  type UpdateShift,
} from '@ecms/contracts';
import { listKey } from '../../../../shared/lib/query-keys';
import * as api from './attendance-api';

const MODULE = 'hr';
const SHIFTS = 'attendanceShifts';
const ASSIGNMENTS = 'attendanceAssignments';
const DAYS = 'attendanceDays';
const MY_DAYS = 'attendanceMyDays';
const REGULARIZATIONS = 'attendanceRegularizations';
const MY_REGULARIZATIONS = 'attendanceMyRegularizations';
const PENDING = 'attendancePendingRegularizations';

export const useShifts = () =>
  useQuery({
    queryKey: listKey(MODULE, SHIFTS, {}),
    queryFn: api.listShifts,
    staleTime: 60_000,
  });

export const useCreateShift = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateShift) => api.createShift(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: [MODULE, SHIFTS] }),
  });
};

export const useUpdateShift = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateShift }) => api.updateShift(id, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: [MODULE, SHIFTS] }),
  });
};

export const useShiftAssignments = (params: Record<string, string | number>) =>
  useQuery({
    queryKey: listKey(MODULE, ASSIGNMENTS, params),
    queryFn: () => api.listShiftAssignments(params),
    placeholderData: (prev) => prev,
  });

export const useCreateShiftAssignment = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateShiftAssignment) => api.createShiftAssignment(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: [MODULE, ASSIGNMENTS] }),
  });
};

export const useRemoveShiftAssignment = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.removeShiftAssignment(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: [MODULE, ASSIGNMENTS] }),
  });
};

// ── AT-6 ────────────────────────────────────────────────────────────────────

type Params = Record<string, string | number>;

/** The daily sheet and the employee month read the same scoped endpoint, different filters. */
export const useAttendanceDays = (params: Params, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, DAYS, params),
    queryFn: () => api.listAttendanceDays(params),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useMyAttendanceDays = (params: Params) =>
  useQuery({
    queryKey: listKey(MODULE, MY_DAYS, params),
    queryFn: () => api.listMyAttendanceDays(params),
    placeholderData: (prev) => prev,
  });

export const useRegularizations = (params: Params, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, REGULARIZATIONS, params),
    queryFn: () => api.listRegularizations(params),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useMyRegularizations = (params: Params) =>
  useQuery({
    queryKey: listKey(MODULE, MY_REGULARIZATIONS, params),
    queryFn: () => api.listMyRegularizations(params),
    placeholderData: (prev) => prev,
  });

export const usePendingRegularizations = () =>
  useQuery({
    queryKey: listKey(MODULE, PENDING, {}),
    queryFn: api.listPendingRegularizations,
  });

/** Everything a regularization write can move: the queues, my list, and the day rows. */
const invalidateAttendance = (client: ReturnType<typeof useQueryClient>): void => {
  for (const key of [REGULARIZATIONS, MY_REGULARIZATIONS, PENDING, DAYS, MY_DAYS]) {
    void client.invalidateQueries({ queryKey: [MODULE, key] });
  }
};

export const useCreateRegularization = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAttendanceRegularization) => api.createRegularization(body),
    onSuccess: () => invalidateAttendance(client),
  });
};

export const useDecideRegularization = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: DecideAttendanceRegularization }) =>
      api.decideRegularization(id, body),
    onSuccess: () => invalidateAttendance(client),
  });
};

export const useCancelRegularization = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.cancelRegularization(id, version),
    onSuccess: () => invalidateAttendance(client),
  });
};

export const useApproveOvertime = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ApproveOvertime }) =>
      api.approveOvertime(id, body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [MODULE, DAYS] });
      void client.invalidateQueries({ queryKey: [MODULE, MY_DAYS] });
    },
  });
};
