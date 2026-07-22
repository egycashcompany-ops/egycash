// TanStack Query hooks for the Applications catalog (ADR-013). Reads cached by the shared key
// factory; every write seeds the detail cache from the response and invalidates the feature subtree.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CreateApplication, type UpdateApplication } from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import { ORG_MODULE } from '../shared/org-unit-resource';
import * as api from './application-api';
import { type ApplicationListParams } from './application-api';

const FEATURE = 'applications';

export const useApplications = (params: ApplicationListParams) =>
  useQuery({
    queryKey: listKey(ORG_MODULE, FEATURE, params),
    queryFn: () => api.listApplications(params),
    placeholderData: (prev) => prev,
  });

export const useApplication = (id: string) =>
  useQuery({
    queryKey: detailKey(ORG_MODULE, FEATURE, id),
    queryFn: () => api.getApplication(id),
    enabled: id !== '',
  });

export const useCreateApplication = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateApplication) => api.createApplication(body),
    onSuccess: (doc) => {
      qc.setQueryData(detailKey(ORG_MODULE, FEATURE, doc.id), doc);
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
    },
  });
};

export const useUpdateApplication = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateApplication) => api.updateApplication(id, body),
    onSuccess: (doc) => {
      qc.setQueryData(detailKey(ORG_MODULE, FEATURE, doc.id), doc);
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
    },
  });
};

export const useDeleteApplication = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteApplication(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
    },
  });
};
