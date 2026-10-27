// «مطابقة أرصدة الكروت» — the two writes, as hooks. Both sit under the fuel cards' subtree
// (`featureKey('fleet', 'fuelCards')`): a decision moves card balances and writes log lines, so it
// throws that whole subtree away — the cards, the charging boxes and every open «سجل الكارت».
// Somebody else's decision reaches an open screen the same way, through the `fleet.fuelCard` audit
// entity the realtime registry already maps there.
//
// Declaring `onError` opts each hook out of the global error toast (query-client.ts). The screen
// words its own refusals (`fuel-reconcile-words.ts`); the global toast is raised only for the rest.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type DecideFleetFuelReconcile, type FleetFuelCardCompany } from '@ecms/contracts';
import { featureKey } from '../../../shared/lib/query-keys';
import { isDecideRefusal, isSheetRefusal } from '../lib/fuel-reconcile-words';
import { toastUnlessSaid } from './fleet-queries';
import * as api from './fuel-reconcile-api';

/** The fuel cards' subtree — what a decision invalidates. */
export const fuelCardsSubtreeKey = featureKey('fleet', 'fuelCards');

/** Read the company's sheet and compare it. Writes no balance, so it invalidates nothing. */
export const useUploadFuelSheet = () =>
  useMutation({
    mutationFn: ({ company, file }: { company: FleetFuelCardCompany; file: File }) =>
      api.uploadFuelSheet(company, file),
    onError: toastUnlessSaid(isSheetRefusal),
  });

/** ✓ / ✗ on chosen cards of one session — all or nothing. */
export const useDecideFuelReconcile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: DecideFleetFuelReconcile }) =>
      api.decideFuelReconcile(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: fuelCardsSubtreeKey }),
    onError: toastUnlessSaid(isDecideRefusal),
  });
};
