// /atm/display — how the ATM pages read (display.service.ts).
//
// The GET is read by every ATM page, whatever the reader's ATM key: it says how to draw the page,
// nothing about the data, so any signed-in user may read it. The PUT is the /atm/settings card's —
// `atmSettings.manage`, checked at organization scope in the service.
import { Router, type Request, type Response } from 'express';
import { AtmDisplaySettingSchema, type AtmDisplaySetting } from '@ecms/contracts';
import { authenticate, authContext } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, ok, validate, validated } from '../../../platform/web';
import { ATM_SETTINGS_KEY } from '../shared/settings-authority';
import { atmDisplayService } from './display.service';

const getDisplay = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await atmDisplayService.get());
};

const saveDisplay = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<AtmDisplaySetting>(req);
  ok(res, await atmDisplayService.save(body, authContext(req)));
};

export const buildAtmDisplayRouter = (): Router => {
  const router = Router();
  router.get('/', authenticate, asyncHandler(getDisplay));
  router.put(
    '/',
    authenticate,
    authorize(ATM_SETTINGS_KEY),
    validate({ body: AtmDisplaySettingSchema }),
    asyncHandler(saveDisplay),
  );
  return router;
};
