// The people the module names (see people.service.ts). Read-only by construction: the module
// writes nothing about a person, so there is no POST and no PATCH here at all.
import { Router } from 'express';
import {
  AdministrationPersonIdParamSchema,
  ListAdministrationPeopleQuerySchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  ADMINISTRATION_PEOPLE_GRANTS,
  getAdministrationPerson,
  listAdministrationPeople,
} from './people.controller';

/**
 * `/administration/people` — the keeper picker (§7.8, §19.3), opened by whoever may name a keeper:
 * `administrationWarehouse.create` or `.edit`. A warehouse reader alone has no use for it and does
 * not get it — the warehouse already carries its keeper's summary.
 */
export const buildAdministrationPeopleRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny(...ADMINISTRATION_PEOPLE_GRANTS),
    validate({ query: ListAdministrationPeopleQuerySchema }),
    asyncHandler(listAdministrationPeople),
  );
  router.get(
    '/:employeeId',
    authenticate,
    authorizeAny(...ADMINISTRATION_PEOPLE_GRANTS),
    validate({ params: AdministrationPersonIdParamSchema }),
    asyncHandler(getAdministrationPerson),
  );
  return router;
};
