// /atm/branch-links — «فروع تعمل معاً» on /atm/settings. `atmSettings.manage` at the route, and at
// ORGANIZATION scope in the service (shared/settings-authority.ts).
import { Router, type Request, type Response } from 'express';
import { SaveAtmBranchLinksSchema, type SaveAtmBranchLinks } from '@ecms/contracts';
import { authenticate, authContext } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, ok, validate, validated } from '../../../platform/web';
import { ATM_SETTINGS_KEY } from '../shared/settings-authority';
import { atmBranchLinksService } from './branch-links.service';

const getLinks = async (req: Request, res: Response): Promise<void> => {
  ok(res, await atmBranchLinksService.get(authContext(req)));
};

const saveLinks = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SaveAtmBranchLinks>(req);
  ok(res, await atmBranchLinksService.save(body, authContext(req)));
};

export const buildAtmBranchLinksRouter = (): Router => {
  const router = Router();
  router.get('/', authenticate, authorize(ATM_SETTINGS_KEY), asyncHandler(getLinks));
  router.put(
    '/',
    authenticate,
    authorize(ATM_SETTINGS_KEY),
    validate({ body: SaveAtmBranchLinksSchema }),
    asyncHandler(saveLinks),
  );
  return router;
};
