import { Router } from 'express';
import { z } from 'zod';
import { SetApprovalWorkflowSchema, objectId } from '@ecms/contracts';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { authenticate } from '../auth';
import { authorize } from '../rbac/rbac.middleware';
import {
  deleteWorkflow,
  listRequestTypes,
  listWorkflows,
  setWorkflow,
} from './approval.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildApprovalsRouter = (): Router => {
  const router = Router();
  // Reading the chains needs the same key as writing them: a chain is a map of who may decide
  // what, and handing it out is handing out the org's decision structure.
  router.get('/', authenticate, authorize('approval.configure'), asyncHandler(listWorkflows));
  router.get(
    '/request-types',
    authenticate,
    authorize('approval.configure'),
    asyncHandler(listRequestTypes),
  );
  router.put(
    '/',
    authenticate,
    authorize('approval.configure'),
    validate({ body: SetApprovalWorkflowSchema }),
    asyncHandler(setWorkflow),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('approval.configure'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteWorkflow),
  );
  return router;
};
