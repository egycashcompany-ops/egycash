// TanStack Query hooks for the pay-item catalog (ADR-013).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CreatePayItem, type UpdatePayItem } from '@ecms/contracts';
import { featureKey, listKey } from '../../../../shared/lib/query-keys';
import * as api from './payroll-api';

const MODULE = 'hr';
const FEATURE = 'payItems';

export const usePayItems = (params: Record<string, string | number>) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listPayItems(params),
    placeholderData: (prev) => prev,
  });

const useCatalogMutation = <TVars>(fn: (vars: TVars) => Promise<unknown>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void client.invalidateQueries({ queryKey: featureKey(MODULE, FEATURE) }),
  });
};

export const useCreatePayItem = () =>
  useCatalogMutation((body: CreatePayItem) => api.createPayItem(body));

export const useUpdatePayItem = () =>
  useCatalogMutation(({ id, body }: { id: string; body: UpdatePayItem }) =>
    api.updatePayItem(id, body),
  );

export const useDeletePayItem = () => useCatalogMutation((id: string) => api.deletePayItem(id));
