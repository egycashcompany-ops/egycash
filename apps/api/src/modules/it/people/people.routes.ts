// The people IT names (see people.service.ts). Read-only by construction: IT writes nothing about
// a person, so there is no POST and no PATCH here at all.
import { Router } from 'express';
import {
  ItPersonIdParamSchema,
  ListItPeopleQuerySchema,
  ListItRecipientsQuerySchema,
  ListItTechniciansQuerySchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  IT_PEOPLE_GRANTS,
  IT_RECIPIENT_GRANTS,
  getItPerson,
  listItPeople,
  listItRecipients,
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
 *
 * `/recipients` (2026-11-18) is the one exception, and only inside a hand-over's box: whoever may
 * HAND something over (`itAsset.assign`, `itMobileLine.assign` or `itConsumable.assign`) names
 * anybody who works here today, in any branch — «أسمح إنه يعرف يسلم لحد فى فرع تاني». A name, a
 * code and a branch, a few at a time, for what is typed; the register, the filters and the person
 * pages stay on the rule above. A person page is also the reader's once their registers NAME the
 * person — «المُسلِّم يرى ما سلّمه» (`people.service.get`).
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
  // Before '/:employeeId', so the segment is never read as an id.
  router.get(
    '/recipients',
    authenticate,
    authorizeAny(...IT_RECIPIENT_GRANTS),
    validate({ query: ListItRecipientsQuerySchema }),
    asyncHandler(listItRecipients),
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
