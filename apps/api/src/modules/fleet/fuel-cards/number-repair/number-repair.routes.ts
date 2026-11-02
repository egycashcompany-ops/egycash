// «تصحيح أرقام الكروت» (6d) — mounted by the cards router at `/fleet/fuel-cards/number-repair`,
// BEFORE its `/:id` routes, so `number-repair` is never read as a card id.
//
// Reading the dry run shows what the cards screen shows (names, cars, balances, masked numbers,
// thumbnails): the cards' view grant. Executing it moves card numbers, PINs and photos — a card edit
// — and, on the 0849 pair, money: the grant that edits a card AND the one that sets a balance (the
// ✓ of «مطابقة أرصدة الكروت»). Both on one person; no new permission.
import { Router } from 'express';
import { ExecuteFleetFuelNumberRepairSchema } from '@ecms/contracts';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { asyncHandler, validate } from '../../../../platform/web';
import { noStore } from '../reconcile/fuel-sheet-upload';
import { executeFuelNumberRepair, getFuelNumberRepair } from './number-repair.controller';

export const buildFleetFuelNumberRepairRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('fleetFuelCard.view'),
    noStore,
    asyncHandler(getFuelNumberRepair),
  );
  router.post(
    '/execute',
    authenticate,
    authorize('fleetFuelCard.edit'),
    authorize('fleetFuelCharge.approve'),
    noStore,
    validate({ body: ExecuteFleetFuelNumberRepairSchema }),
    asyncHandler(executeFuelNumberRepair),
  );
  return router;
};
