// «مطابقة أرصدة الكروت» — the writes, as hooks. Every one sits under the fuel cards' subtree
// (`featureKey('fleet', 'fuelCards')`): a decision moves card balances and writes log lines, a link
// moves a card between cars, «إضافة» creates a card — so each throws that whole subtree away (the
// cards, the charging boxes and every open «سجل الكارت»). Somebody else's write reaches an open
// screen the same way, through the `fleet.fuelCard` audit entity the realtime registry maps there.
//
// Declaring `onError` opts each hook out of the global error toast (query-client.ts). The screen
// words its own refusals (`fuel-reconcile-words.ts`); the global toast is raised only for the rest.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type AddFleetFuelSheetCard,
  type DecideFleetFuelLinks,
  type DecideFleetFuelReconcile,
  type FleetFuelCardCompany,
} from '@ecms/contracts';
import { featureKey } from '../../../shared/lib/query-keys';
import { isAddCardRefusal, isLinkRefusal } from '../lib/fuel-reconcile-links';
import { isDecideRefusal, isSheetRefusal } from '../lib/fuel-reconcile-words';
import { toastUnlessSaid } from './fleet-queries';
import * as api from './fuel-reconcile-api';

/** The fuel cards' subtree — what a decision invalidates. */
export const fuelCardsSubtreeKey = featureKey('fleet', 'fuelCards');

/**
 * Read the company's sheet and compare it. Writes no balance, so it invalidates nothing.
 * `sheetDate` («تاريخ الشيت», YYYY-MM-DD) rides along only when given.
 */
export const useUploadFuelSheet = () =>
  useMutation({
    mutationFn: ({
      company,
      file,
      sheetDate,
    }: {
      company: FleetFuelCardCompany;
      file: File;
      sheetDate?: string;
    }) =>
      sheetDate === undefined || sheetDate === ''
        ? api.uploadFuelSheet(company, file)
        : api.uploadFuelSheet(company, file, sheetDate),
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

/** ✓ «تحديث» / ✗ «إبقاء» on one unit of «ربط الكروت بالسيارات» — a swap's two cards together. */
export const useDecideFuelLinks = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: DecideFleetFuelLinks }) =>
      api.decideFuelLinks(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: fuelCardsSubtreeKey }),
    onError: toastUnlessSaid(isLinkRefusal),
  });
};

/** «إضافة» a sheet-only card: created with the sheet's balance as its opening line. */
export const useAddSheetCard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AddFleetFuelSheetCard }) =>
      api.addSheetCard(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: fuelCardsSubtreeKey }),
    onError: toastUnlessSaid(isAddCardRefusal),
  });
};
