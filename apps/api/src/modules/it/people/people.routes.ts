// The people IT names (see people.service.ts). Read-only by construction: IT writes nothing about
// a person, so there is no POST and no PATCH here at all.
import { Router } from 'express';
import {
  ItPersonIdParamSchema,
  ListItPeopleQuerySchema,
  ListItTechniciansQuerySchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  IT_PEOPLE_GRANTS,
  getItPerson,
  listItPeople,
  listItTechnicians,
} from './people.controller';

/**
 * `/it/people` — the CUSTODY registers' read grants, not a new one and not HR's. Whoever may read
 * a register of what people hold already reads a holder's name and code on every row of it; this
 * is those same people, findable before they hold anything. It is the reach the holder boxes, the
 * employees register and a person's history all need, and nothing wider.
 *
 * Three registers name holders — the assets, the mobile lines and the consumables — and since
 * 2026-11-17 each has its own read grant, so ANY of the three opens the list: a lines keeper hands
 * a line to somebody they must be able to find, without being given the assets. A person is found
 * when ANY of the three the caller holds reaches them, each in its own scope
 * (`people.controller.ts`); what a person holds of the ASSETS is still counted only within
 * `itAsset.view`.
 */
export const buildItPeopleRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny(...IT_PEOPLE_GRANTS),
    validate({ query: ListItPeopleQuerySchema }),
    asyncHandler(listItPeople),
  );
  router.get(
    '/:employeeId',
    authenticate,
    authorizeAny(...IT_PEOPLE_GRANTS),
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
