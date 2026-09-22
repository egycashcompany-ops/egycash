import { Router } from 'express';
import { SetFleetLicensingMarkSchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { getLicensingBoard, setLicensingMark } from './licensing.controller';

export const buildFleetLicensingRouter = (): Router => {
  const router = Router();
  router.get('/', authenticate, authorize('fleetLicensing.view'), asyncHandler(getLicensingBoard));
  // Ticking a square is its own grant, as collecting a violation is: whoever hands the papers in
  // is not necessarily whoever may read the board.
  router.post(
    '/mark',
    authenticate,
    authorize('fleetLicensing.mark'),
    validate({ body: SetFleetLicensingMarkSchema }),
    asyncHandler(setLicensingMark),
  );
  return router;
};
