// TanStack Query hooks for a department's application assignments (ADR-013). Reads are keyed per
// department; assign/remove invalidate that department's assignment list.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { detailKey, featureKey } from '../../../shared/lib/query-keys';
import { ORG_MODULE } from '../shared/org-unit-resource';
import * as api from './department-applications-api';

const FEATURE = 'departmentApplications';

export const useDepartmentApplications = (departmentId: string) =>
  useQuery({
    queryKey: detailKey(ORG_MODULE, FEATURE, departmentId),
    queryFn: () => api.listDepartmentApplications(departmentId),
    enabled: departmentId !== '',
  });

export const useAssignDepartmentApplication = (departmentId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (applicationId: string) => api.assignDepartmentApplication(departmentId, applicationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
    },
  });
};

export const useRemoveDepartmentApplication = (departmentId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (applicationId: string) => api.removeDepartmentApplication(departmentId, applicationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
    },
  });
};
