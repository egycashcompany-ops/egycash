// TanStack Query hooks for the Job Title catalog (ADR-013). Reads cached by the shared key factory;
// every write seeds the detail cache from the response and invalidates the feature subtree.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CreateJobTitle, type UpdateJobTitle } from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import { ORG_MODULE } from '../shared/org-unit-resource';
import * as api from './job-title-api';
import { type JobTitleListParams } from './job-title-api';

const FEATURE = 'jobTitles';

export const useJobTitles = (params: JobTitleListParams) =>
  useQuery({
    queryKey: listKey(ORG_MODULE, FEATURE, params),
    queryFn: () => api.listJobTitles(params),
    placeholderData: (prev) => prev,
  });

export const useJobTitle = (id: string) =>
  useQuery({
    queryKey: detailKey(ORG_MODULE, FEATURE, id),
    queryFn: () => api.getJobTitle(id),
    enabled: id !== '',
  });

export const useCreateJobTitle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateJobTitle) => api.createJobTitle(body),
    onSuccess: (doc) => {
      qc.setQueryData(detailKey(ORG_MODULE, FEATURE, doc.id), doc);
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
    },
  });
};

export const useUpdateJobTitle = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateJobTitle) => api.updateJobTitle(id, body),
    onSuccess: (doc) => {
      qc.setQueryData(detailKey(ORG_MODULE, FEATURE, doc.id), doc);
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
    },
  });
};

export const useDeleteJobTitle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteJobTitle(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
    },
  });
};
