import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { detailKey, featureKey } from '../../../shared/lib/query-keys';
import * as api from './delegation-api';

const MODULE = 'platform';
const FEATURE = 'delegations';

/** The caller's ceiling changes only when their own grants do — the same moment `me` refreshes. */
export const useDelegationCatalog = (enabled = true) =>
  useQuery({
    queryKey: [...featureKey(MODULE, FEATURE), 'me'],
    queryFn: api.getMyDelegationCatalog,
    enabled,
    staleTime: 5 * 60 * 1000,
  });

export const useUserDelegations = (userId: string, enabled = true) =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, userId),
    queryFn: () => api.getUserDelegations(userId),
    enabled,
  });

/**
 * One site's table for one account. The result is the account's whole set, so the detail query is
 * replaced rather than refetched; the account's effective permissions are invalidated because the
 * System Administration screen shows them beside this panel.
 */
export const useSetUserDelegation = (userId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, permissionKeys }: { branchId: string; permissionKeys: string[] }) =>
      api.setUserDelegation(userId, branchId, { permissionKeys }),
    onSuccess: (dto) => {
      client.setQueryData(detailKey(MODULE, FEATURE, userId), dto);
      void client.invalidateQueries({ queryKey: ['system-admin', 'effective'] });
      void client.invalidateQueries({ queryKey: ['system-admin', 'users'] });
    },
  });
};
