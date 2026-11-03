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
  // The Branch Code, corrected by a holder of its own key, `branch.changeCode` (ADR-017, amended
  // 2026-11-03). It used to be super-admin only; the owner asked to be allowed to fix it.
  router.patch(
    '/:id/code',
    authenticate,
    authorize('branch.changeCode'),
    validate({ body: ChangeBranchCodeSchema, params: IdParamSchema }),
    asyncHandler(changeBranchCodeHandler),
  );
  return router;
};
