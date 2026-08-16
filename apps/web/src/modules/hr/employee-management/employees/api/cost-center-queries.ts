import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './cost-center-api';

const KEY = (employeeId: string): unknown[] => ['hr', 'employeeCostCenters', employeeId];

export const useEmployeeCostCenters = (employeeId: string) =>
  useQuery({
    queryKey: KEY(employeeId),
    queryFn: () => api.listEmployeeCostCenters(employeeId),
    enabled: employeeId !== '',
  });

export const useAssignableCostCenters = () =>
  useQuery({
    queryKey: ['hr', 'assignableCostCenters'],
    queryFn: () => api.listAssignableCostCenters(),
  });

export const useAssignCostCenter = (employeeId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { costCenterId: string; effectiveFrom: string; note?: string }) =>
      api.assignEmployeeCostCenter(employeeId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY(employeeId) }),
  });
};

export const useEndCostCenter = (employeeId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { assignmentId: string; on: string }) =>
      api.endEmployeeCostCenter(employeeId, v.assignmentId, v.on),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY(employeeId) }),
  });
};
