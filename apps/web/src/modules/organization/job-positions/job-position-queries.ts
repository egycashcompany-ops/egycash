// TanStack Query hooks for the Job Position master entity (ADR-013). Reads cached by the shared key
// factory; every write seeds the detail cache from the response and invalidates the feature subtree.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CreateJobPosition, type UpdateJobPosition } from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import { ORG_MODULE } from '../shared/org-unit-resource';
import * as api from './job-position-api';
import { type JobPositionListParams } from './job-position-api';

const FEATURE = 'jobPositions';

export const useJobPositions = (params: JobPositionListParams) =>
  useQuery({
    queryKey: listKey(ORG_MODULE, FEATURE, params),
    queryFn: () => api.listJobPositions(params),
    placeholderData: (prev) => prev,
  });

export const useJobPosition = (id: string) =>
  useQuery({
    queryKey: detailKey(ORG_MODULE, FEATURE, id),
    queryFn: () => api.getJobPosition(id),
    enabled: id !== '',
  });

export const useCreateJobPosition = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateJobPosition) => api.createJobPosition(body),
    onSuccess: (doc) => {
      qc.setQueryData(detailKey(ORG_MODULE, FEATURE, doc.id), doc);
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
    },
  });
};

export const useUpdateJobPosition = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateJobPosition) => api.updateJobPosition(id, body),
    onSuccess: (doc) => {
      qc.setQueryData(detailKey(ORG_MODULE, FEATURE, doc.id), doc);
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
    },
  });
};

export const useDeleteJobPosition = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteJobPosition(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
    },
  });
};
