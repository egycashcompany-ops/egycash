// `/compliance/people` — the sharing picker (design §4.3), the responsible person's alone: a reader
// never chooses who sees a folder. Read-only by construction: the module writes nothing about a
// person.
import { Router } from 'express';
import { ListCompliancePeopleQuerySchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { COMPLIANCE_MANAGE_KEY } from '../shared/authority';
import { listCompliancePeople } from './people.controller';

export const buildCompliancePeopleRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize(COMPLIANCE_MANAGE_KEY),
    validate({ query: ListCompliancePeopleQuerySchema }),
    asyncHandler(listCompliancePeople),
  );
  return router;
};
