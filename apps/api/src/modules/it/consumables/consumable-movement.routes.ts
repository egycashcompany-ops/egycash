// The consumables ledger across items — «حركات المستهلكات», and the cards on an asset's page
// («المستهلكات المركّبة عليه») and an employee's — read-only by construction: movements are written
// by the store's named actions and never edited. The store's read grant, wherever the card sits:
// the asset's page shows it to a reader who holds `itConsumable.view` as well.
import { Router } from 'express';
import { ListItConsumableMovementsQuerySchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { listItConsumableMovements } from './consumable.controller';

export const buildItConsumableMovementsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('itConsumable.view'),
    validate({ query: ListItConsumableMovementsQuerySchema }),
    asyncHandler(listItConsumableMovements),
  );
  return router;
};
