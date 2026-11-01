// /atm/leaders — the leader list (leaders.service.ts).
//
// `options` is read by whoever works either board: the maintenance close needs it before any close
// happens (so it rides `view`, as `/atm/maintenances/leader-options` always did), and the
// replenishment edit dialog offers the same names. `departments` is the /atm/settings card —
// `atmSettings.manage`, checked at organization scope in the service.
import { Router, type Request, type Response } from 'express';
import { SaveAtmLeaderDepartmentsSchema, type SaveAtmLeaderDepartments } from '@ecms/contracts';
import { authenticate, authContext } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, ok, validate, validated } from '../../../platform/web';
import { ATM_SETTINGS_KEY } from '../shared/settings-authority';
import { atmLeadersService } from './leaders.service';

const options = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await atmLeadersService.options());
};

const getDepartments = async (req: Request, res: Response): Promise<void> => {
  ok(res, await atmLeadersService.departments(authContext(req)));
};

const saveDepartments = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SaveAtmLeaderDepartments>(req);
  ok(res, await atmLeadersService.saveDepartments(body, authContext(req)));
};

export const buildAtmLeadersRouter = (): Router => {
  const router = Router();
  router.get(
    '/options',
    authenticate,
    authorizeAny('atmReplenishment.view', 'atmMaintenance.view'),
    asyncHandler(options),
  );
  router.get(
    '/departments',
    authenticate,
    authorize(ATM_SETTINGS_KEY),
    asyncHandler(getDepartments),
  );
  router.put(
    '/departments',
    authenticate,
    authorize(ATM_SETTINGS_KEY),
    validate({ body: SaveAtmLeaderDepartmentsSchema }),
    asyncHandler(saveDepartments),
  );
  return router;
};
