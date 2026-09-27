// The people IT names (see people.service.ts). Read-only by construction: IT writes nothing about
// a person, so there is no POST and no PATCH here at all.
import { Router } from 'express';
import {
  ItPersonIdParamSchema,
  ListItPeopleQuerySchema,
  ListItTechniciansQuerySchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { getItPerson, listItPeople, listItTechnicians } from './people.controller';

/**
 * `/it/people` — the CUSTODY grant, not a new one and not HR's. Whoever may read the custody
 * register already reads a holder's name and code on every row of it; this is those same people,
 * findable before they hold anything. It is the reach the holder boxes, the employees register and
 * a person's history all need, and nothing wider.
 */
export const buildItPeopleRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('itAsset.view'),
    validate({ query: ListItPeopleQuerySchema }),
    asyncHandler(listItPeople),
  );
  router.get(
    '/:employeeId',
    authenticate,
    authorize('itAsset.view'),
    validate({ params: ItPersonIdParamSchema }),
    asyncHandler(getItPerson),
  );
  return router;
};

/**
 * `/it/technicians` — whoever hands tickets out (`itTicket.assign`) or works them (`itTicket.edit`):
 * the dispatcher choosing a technician, and the queue filtered by one. A requester, who holds
 * `itTicket.view` alone, has no use for the list and does not get it.
 */
export const buildItTechniciansRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny('itTicket.assign', 'itTicket.edit'),
    validate({ query: ListItTechniciansQuerySchema }),
    asyncHandler(listItTechnicians),
  );
  return router;
};
