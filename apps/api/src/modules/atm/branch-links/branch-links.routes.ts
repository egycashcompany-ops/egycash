// /atm/branch-links — «فروع تعمل معاً» on /atm/settings, and «نقل البيانات» of a link's source
// (branch-move.service.ts). `atmSettings.manage` at the route, and at ORGANIZATION scope in the
// services (shared/settings-authority.ts).
import { Router, type Request, type Response } from 'express';
import {
  AtmBranchMoveParamsSchema,
  SaveAtmBranchLinksSchema,
  type AtmBranchMoveParams,
  type SaveAtmBranchLinks,
} from '@ecms/contracts';
import { authenticate, authContext } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, ok, validate, validated } from '../../../platform/web';
import { ATM_SETTINGS_KEY } from '../shared/settings-authority';
import { atmBranchLinksService } from './branch-links.service';
import { atmBranchMoveService } from './branch-move.service';

const getLinks = async (req: Request, res: Response): Promise<void> => {
  ok(res, await atmBranchLinksService.get(authContext(req)));
};

const saveLinks = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SaveAtmBranchLinks>(req);
  ok(res, await atmBranchLinksService.save(body, authContext(req)));
};

const previewMove = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, AtmBranchMoveParams>(req);
  ok(res, await atmBranchMoveService.preview(params.sourceBranchId, authContext(req)));
};

const runMove = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, AtmBranchMoveParams>(req);
  ok(res, await atmBranchMoveService.move(params.sourceBranchId, authContext(req)));
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
  // The source is the path's; the target is the STORED link's, never the request's. No body.
  router.get(
    '/:sourceBranchId/move',
    authenticate,
    authorize(ATM_SETTINGS_KEY),
    validate({ params: AtmBranchMoveParamsSchema }),
    asyncHandler(previewMove),
  );
  router.post(
    '/:sourceBranchId/move',
    authenticate,
    authorize(ATM_SETTINGS_KEY),
    validate({ params: AtmBranchMoveParamsSchema }),
    asyncHandler(runMove),
  );
  return router;
};
