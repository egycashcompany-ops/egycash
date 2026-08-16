// TanStack Query hooks for the Cost Centre catalog (ADR-013), shaped like every other org catalog.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CreateCostCenter, type UpdateCostCenter } from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import { ORG_MODULE } from '../shared/org-unit-resource';
import * as api from './cost-center-api';
import { type CostCenterListParams } from './cost-center-api';

const FEATURE = 'costCenters';

export const useCostCenters = (params: CostCenterListParams) =>
  useQuery({
    queryKey: listKey(ORG_MODULE, FEATURE, params),
    queryFn: () => api.listCostCenters(params),
    placeholderData: (prev) => prev,
  });

export const useCostCenter = (id: string) =>
  useQuery({
    queryKey: detailKey(ORG_MODULE, FEATURE, id),
    queryFn: () => api.getCostCenter(id),
    enabled: id !== '',
  });

export const useCreateCostCenter = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCostCenter) => api.createCostCenter(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) }),
  });
};

export const useUpdateCostCenter = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateCostCenter) => api.updateCostCenter(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) }),
  });
};

export const useDeleteCostCenter = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCostCenter(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) }),
  });
};
