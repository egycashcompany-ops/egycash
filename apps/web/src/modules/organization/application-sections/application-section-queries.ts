// TanStack Query hooks for sections and for the two reorder writes. Every write invalidates BOTH
// catalogs (sections and applications) and the caller's own navigation, because reordering is
// exactly the operation whose whole point is to change what the sidebar looks like.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateApplicationSection,
  type ReorderApplicationSections,
  type ReorderApplications,
  type UpdateApplicationSection,
} from '@ecms/contracts';
import { featureKey, listKey } from '../../../shared/lib/query-keys';
import { ORG_MODULE } from '../shared/org-unit-resource';
import * as api from './application-section-api';

const FEATURE = 'application-sections';
/** The sidebar's own query key — see `me-applications-queries`. */
const MY_APPLICATIONS = ['me', 'applications'] as const;

export const useApplicationSections = (params: Record<string, string | number>) =>
  useQuery({
    queryKey: listKey(ORG_MODULE, FEATURE, params),
    queryFn: () => api.listApplicationSections(params),
    placeholderData: (prev) => prev,
  });

const useOrganizeMutation = <TVars>(fn: (vars: TVars) => Promise<unknown>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, 'applications') });
      void qc.invalidateQueries({ queryKey: MY_APPLICATIONS });
    },
  });
};

export const useCreateApplicationSection = () =>
  useOrganizeMutation((body: CreateApplicationSection) => api.createApplicationSection(body));

export const useUpdateApplicationSection = () =>
  useOrganizeMutation(({ id, body }: { id: string; body: UpdateApplicationSection }) =>
    api.updateApplicationSection(id, body),
  );

export const useDeleteApplicationSection = () =>
  useOrganizeMutation((id: string) => api.deleteApplicationSection(id));

export const useReorderApplicationSections = () =>
  useOrganizeMutation((body: ReorderApplicationSections) => api.reorderApplicationSections(body));

export const useReorderApplications = () =>
  useOrganizeMutation((body: ReorderApplications) => api.reorderApplications(body));
