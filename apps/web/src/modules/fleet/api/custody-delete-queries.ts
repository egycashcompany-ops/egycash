// «حذف العملية» and «العمليات المحذوفة» as hooks. The reads sit under the ledger's key
// (`custodyLedgerKey`, inside the custody subtree), so whatever throws the custody subtree away — a
// delete here, an operation recorded elsewhere, the `fleet.custodyOperation` signal of somebody
// else's delete — reads them again too.
//
// A delete moves the fund, its log and its tabs (custody), the receipts screen (a replenishment's
// receipts unlock with its memos) and «مصروفات التراخيص» (a settlement's parts are «لم تُسوَّ بعد»
// again). They are read again whatever the answer: a refusal (409 / 404) means the operation
// changed or went elsewhere, and the log must say so. The dialog words every failure itself, so
// `onError` keeps the global toast out of it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DeleteFleetCustodyOperation } from '@ecms/contracts';
import { type QueryParams } from '../../../shared/lib/api-client';
import { featureKey } from '../../../shared/lib/query-keys';
import { custodyLedgerKey, toastUnlessSaid } from './fleet-queries';
import * as api from './custody-delete-api';

/** The deleted operations' reads — under the ledger, so the custody subtree carries them. */
export const custodyDeletedKey = [...custodyLedgerKey, 'deleted'] as const;

/** The pieces of each key below, so a spec seeds the very key a hook reads. */
export const custodyDeletedKeys = {
  list: (params: QueryParams): readonly unknown[] => [...custodyDeletedKey, 'list', params],
  one: (id: string): readonly unknown[] => [...custodyDeletedKey, 'one', id],
} as const;

/** «العمليات المحذوفة», a page at a time; the previous page stays while the next one loads. */
export const useCustodyDeleted = (params: QueryParams, enabled = true) =>
  useQuery({
    queryKey: custodyDeletedKeys.list(params),
    queryFn: () => api.listCustodyDeleted(params),
    placeholderData: (prev) => prev,
    enabled,
  });

/** One deleted operation, for its drawer; nothing asked for `''`. */
export const useCustodyDeletedOperation = (id: string) =>
  useQuery({
    queryKey: custodyDeletedKeys.one(id),
    queryFn: () => api.custodyDeletedOperation(id),
    enabled: id !== '',
  });

/** «حذف العملية» — the dialog says done, «taken» and every other failure in its own words. */
export const useDeleteCustodyOperation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: DeleteFleetCustodyOperation }) =>
      api.deleteCustodyOperation(id, body),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: featureKey('fleet', 'custody') });
      void qc.invalidateQueries({ queryKey: featureKey('fleet', 'receipts') });
      void qc.invalidateQueries({ queryKey: featureKey('fleet', 'licenseExpenses') });
    },
    onError: toastUnlessSaid(() => true),
  });
};
