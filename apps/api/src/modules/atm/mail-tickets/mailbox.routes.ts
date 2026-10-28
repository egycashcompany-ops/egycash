// /atm/mailbox — «بريد الصيانة — بنك مصر» on /atm/settings. `atmSettings.manage` at the route, and
// at ORGANIZATION scope in the service (shared/settings-authority.ts). The two POSTs take no body.
import { Router, type Request, type Response } from 'express';
import { SaveAtmMailboxConfigSchema, type SaveAtmMailboxConfig } from '@ecms/contracts';
import { authenticate, authContext } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, ok, validate, validated } from '../../../platform/web';
import { ATM_SETTINGS_KEY } from '../shared/settings-authority';
import { atmMailboxService } from './mailbox.service';

const getMailbox = async (req: Request, res: Response): Promise<void> => {
  ok(res, await atmMailboxService.get(authContext(req)));
};

const saveMailbox = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SaveAtmMailboxConfig>(req);
  ok(res, await atmMailboxService.save(body, authContext(req)));
};

const testMailbox = async (req: Request, res: Response): Promise<void> => {
  ok(res, await atmMailboxService.test(authContext(req)));
};

const pollMailbox = async (req: Request, res: Response): Promise<void> => {
  ok(res, await atmMailboxService.pollNow(authContext(req)));
};

export const buildAtmMailboxRouter = (): Router => {
  const router = Router();
  router.get('/', authenticate, authorize(ATM_SETTINGS_KEY), asyncHandler(getMailbox));
  router.put(
    '/',
    authenticate,
    authorize(ATM_SETTINGS_KEY),
    validate({ body: SaveAtmMailboxConfigSchema }),
    asyncHandler(saveMailbox),
  );
  router.post('/test', authenticate, authorize(ATM_SETTINGS_KEY), asyncHandler(testMailbox));
  router.post('/poll', authenticate, authorize(ATM_SETTINGS_KEY), asyncHandler(pollMailbox));
  return router;
};
