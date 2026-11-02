// «تصحيح أرقام الكروت» (6d) — the dry run and the execution, as hooks.
//
// The dry run sits under the fuel cards' subtree (`featureKey('fleet', 'fuelCards')`): every card
// write, every reconcile decision and the realtime `fleet.fuelCard` refresh (somebody else's edit,
// or the repair's own audit rows) read it again — a record edited by hand while the owner reviews
// shows «تغيّر — لن يُلمس» without a reload. The execution throws that whole subtree away (numbers,
// PINs, photos and two balances moved), and its answer carries the fresh dry run.
//
// Declaring `onError` opts the execution out of the global error toast (query-client.ts); the
// screen reports every failure itself.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ExecuteFleetFuelNumberRepair } from '@ecms/contracts';
import { listKey } from '../../../shared/lib/query-keys';
import { fuelCardsSubtreeKey } from './fuel-reconcile-queries';
import * as api from './fuel-number-repair-api';

/** The dry run's key — inside the cards' subtree, so their invalidations reach it. */
export const numberRepairKey = listKey('fleet', 'fuelCards', { numberRepair: true });

/** The live dry run; `enabled` false for a reader without `fleetFuelCard.view`. */
export const useNumberRepair = (enabled = true) =>
  useQuery({
    queryKey: numberRepairKey,
    queryFn: api.getNumberRepair,
    enabled,
    retry: false,
  });

/** «تأكيد التنفيذ ✓». */
export const useExecuteNumberRepair = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ExecuteFleetFuelNumberRepair) => api.executeNumberRepair(body),
    onSuccess: (result) => {
      // The answer IS the fresh dry run; the rest of the subtree (cards, logs, photos) refetches.
      qc.setQueryData(numberRepairKey, result.repair);
      void qc.invalidateQueries({ queryKey: fuelCardsSubtreeKey });
    },
    onError: () => undefined,
  });
};
