// TanStack Query hooks for the Attendance admin screens (ADR-013). Assignment mutations
// invalidate the assignment lists only; the shifts catalog is its own small cache.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CreateShift, type CreateShiftAssignment, type UpdateShift } from '@ecms/contracts';
import { listKey } from '../../../../shared/lib/query-keys';
import * as api from './attendance-api';

const MODULE = 'hr';
const SHIFTS = 'attendanceShifts';
const ASSIGNMENTS = 'attendanceAssignments';

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
