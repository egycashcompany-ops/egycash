// The consumables ledger across items — «حركات المستهلكات», and the cards on an asset's page
// («المستهلكات المركّبة عليه») and an employee's. Movements are written by the store's named actions
// and their quantities never edited; the ONE correction a row takes is the device an issued unit
// sits in («تعديل الجهاز», 2026-11-17 — the movement model's header), which describes the unit and
// moves no counter. Reads ride the store's read grant, wherever the card sits: the asset's page
// shows it to a reader who holds `itConsumable.view` as well. The correction rides
// `itConsumable.assign`, the issue's own grant, scoped by the read grant as the issue is — and a
// device it names needs the caller's own `itAsset.view`, as the issue's does.
import { Router } from 'express';
import {
  ItConsumableIdParamSchema,
  ListItConsumableMovementsQuerySchema,
  SetItConsumableInstalledOnSchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { listItConsumableMovements, setItConsumableInstalledOn } from './consumable.controller';

export const buildItConsumableMovementsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('itConsumable.view'),
    validate({ query: ListItConsumableMovementsQuerySchema }),
    asyncHandler(listItConsumableMovements),
  );
  // «تعديل الجهاز» — the device an issued unit sits in; null clears it («بدون جهاز»).
  router.patch(
    '/:id/installed-on',
    authenticate,
    authorize('itConsumable.assign'),
    validate({ body: SetItConsumableInstalledOnSchema, params: ItConsumableIdParamSchema }),
    asyncHandler(setItConsumableInstalledOn),
  );
  return router;
};
