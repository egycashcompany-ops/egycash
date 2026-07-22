import { type Router } from 'express';
import { z } from 'zod';
import { ChangeBranchCodeSchema, objectId } from '@ecms/contracts';
import { asyncHandler } from '../../../infrastructure/http/async-handler';
import { validate } from '../../../infrastructure/http/validate';
import { authenticate } from '../../auth';
import { authorize } from '../../rbac';
import { makeOrgUnitRouter } from '../shared/org-unit.http';
import { branchHandlers, branchHttpConfig, changeBranchCodeHandler } from './branch.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildBranchesRouter = (): Router => {
  const router = makeOrgUnitRouter(branchHttpConfig, branchHandlers);
  // Immutable Branch Code — correctable only by a super-admin (ADR-017). The handler enforces the
  // privilege; `branch.edit` gates the route so ordinary editors get a 403, not a 404.
  router.patch(
    '/:id/code',
    authenticate,
    authorize('branch.edit'),
    validate({ body: ChangeBranchCodeSchema, params: IdParamSchema }),
    asyncHandler(changeBranchCodeHandler),
  );
  return router;
};
