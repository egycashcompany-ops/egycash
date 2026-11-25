// /atm/legacy-import — «استيراد السجل القديم» on /atm/settings (legacy-history.service.ts).
// `atmSettings.manage` at the route, and at ORGANIZATION scope in the service
// (shared/settings-authority.ts), as every card of the page.
import { Router, type Request, type Response } from 'express';
import {
  AtmLegacyImportBodySchema,
  AtmLegacyImportRunParamsSchema,
  AtmLegacySourceParamsSchema,
  type AtmLegacyImportBody,
  type AtmLegacyImportRunParams,
  type AtmLegacySourceParams,
} from '@ecms/contracts';
import { authenticate, authContext } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, ok, validate, validated } from '../../../platform/web';
import { ATM_SETTINGS_KEY } from '../shared/settings-authority';
import { atmLegacyHistoryService } from './legacy-history.service';

const sources = async (req: Request, res: Response): Promise<void> => {
  ok(res, await atmLegacyHistoryService.sources(authContext(req)));
};

const preview = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<AtmLegacyImportBody>(req);
  ok(res, await atmLegacyHistoryService.preview(body, authContext(req)));
};

const start = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<AtmLegacyImportBody>(req);
  ok(res, await atmLegacyHistoryService.start(body, authContext(req)));
};

const step = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, AtmLegacyImportRunParams>(req);
  ok(res, await atmLegacyHistoryService.step(params.runId, authContext(req)));
};

const cutover = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, AtmLegacySourceParams>(req);
  ok(res, await atmLegacyHistoryService.cutover(params.source, authContext(req)));
};

const undo = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, AtmLegacySourceParams>(req);
  ok(res, await atmLegacyHistoryService.undoSource(params.source, authContext(req)));
};

export const buildAtmLegacyHistoryRouter = (): Router => {
  const router = Router();
  router.get('/', authenticate, authorize(ATM_SETTINGS_KEY), asyncHandler(sources));
  router.post(
    '/preview',
    authenticate,
    authorize(ATM_SETTINGS_KEY),
    validate({ body: AtmLegacyImportBodySchema }),
    asyncHandler(preview),
  );
  router.post(
    '/runs',
    authenticate,
    authorize(ATM_SETTINGS_KEY),
    validate({ body: AtmLegacyImportBodySchema }),
    asyncHandler(start),
  );
  router.post(
    '/runs/:runId/step',
    authenticate,
    authorize(ATM_SETTINGS_KEY),
    validate({ params: AtmLegacyImportRunParamsSchema }),
    asyncHandler(step),
  );
  router.get(
    '/sources/:source/cutover',
    authenticate,
    authorize(ATM_SETTINGS_KEY),
    validate({ params: AtmLegacySourceParamsSchema }),
    asyncHandler(cutover),
  );
  router.post(
    '/sources/:source/undo',
    authenticate,
    authorize(ATM_SETTINGS_KEY),
    validate({ params: AtmLegacySourceParamsSchema }),
    asyncHandler(undo),
  );
  return router;
};
