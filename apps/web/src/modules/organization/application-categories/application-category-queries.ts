// TanStack Query hooks for the Application Categories catalog (ADR-013). Includes an `options` hook
// used by the Applications form/list to pick and resolve a category.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CreateApplicationCategory, type UpdateApplicationCategory } from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import { ORG_MODULE } from '../shared/org-unit-resource';
import * as api from './application-category-api';
import { type ApplicationCategoryListParams } from './application-category-api';

const FEATURE = 'applicationCategories';

export const useApplicationCategories = (params: ApplicationCategoryListParams) =>
  useQuery({
    queryKey: listKey(ORG_MODULE, FEATURE, params),
    queryFn: () => api.listApplicationCategories(params),
    placeholderData: (prev) => prev,
  });

export const useApplicationCategory = (id: string) =>
  useQuery({
    queryKey: detailKey(ORG_MODULE, FEATURE, id),
    queryFn: () => api.getApplicationCategory(id),
    enabled: id !== '',
  });

/** Active categories for pickers + name resolution (sorted by the server's default). */
export const useApplicationCategoryOptions = (enabled = true) =>
  useQuery({
    queryKey: [ORG_MODULE, FEATURE, 'options'],
    queryFn: () => api.listApplicationCategories({ status: 'active', pageSize: 200, sortBy: 'sortOrder', sortDir: 'asc' }),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    select: (page) => page.items,
  });

export const useCreateApplicationCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateApplicationCategory) => api.createApplicationCategory(body),
    onSuccess: (doc) => {
      qc.setQueryData(detailKey(ORG_MODULE, FEATURE, doc.id), doc);
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
    },
  });
};

export const useUpdateApplicationCategory = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateApplicationCategory) => api.updateApplicationCategory(id, body),
    onSuccess: (doc) => {
      qc.setQueryData(detailKey(ORG_MODULE, FEATURE, doc.id), doc);
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
    },
  });
};

export const useDeleteApplicationCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteApplicationCategory(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
    },
  });
};
