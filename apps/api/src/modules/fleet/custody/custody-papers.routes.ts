// «إعداد المذكرات» — `/fleet/custody/paper-settings`: the names his seven papers print with. Read by
// whoever sees the custody screen (every memo and letter prints with them); saved by whoever may
// also edit custody receipts — both `authorize` calls must pass.
import { Router } from 'express';
import { SaveFleetCustodyPaperSettingsSchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { getCustodyPaperSettings, saveCustodyPaperSettings } from './custody-papers.controller';

export const buildFleetCustodyPaperSettingsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('fleetCustody.view'),
    asyncHandler(getCustodyPaperSettings),
  );
  router.put(
    '/',
    authenticate,
    authorize('fleetCustody.view'),
    authorize('fleetReceipt.edit'),
    validate({ body: SaveFleetCustodyPaperSettingsSchema }),
    asyncHandler(saveCustodyPaperSettings),
  );
  return router;
};
