import { Router } from 'express';
import { z } from 'zod';
import {
  CreateAutomationWorkflowSchema,
  ListAutomationWorkflowsQuerySchema,
  SetAutomationWorkflowEnabledSchema,
  TransferAutomationWorkflowSchema,
  UpdateAutomationWorkflowSchema,
  objectId,
} from '@ecms/contracts';
import { asyncHandler } from '../../../infrastructure/http/async-handler';
import { validate } from '../../../infrastructure/http/validate';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import {
  createWorkflow,
  deleteWorkflow,
  diagnoseWorkflow,
  getWorkflow,
  listWorkflows,
  setWorkflowEnabled,
  transferWorkflow,
  updateWorkflow,
} from './workflow.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAutomationWorkflowsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('workflow.view'),
    validate({ query: ListAutomationWorkflowsQuerySchema }),
    asyncHandler(listWorkflows),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('workflow.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getWorkflow),
  );
  router.get(
    '/:id/diagnostics',
    authenticate,
    authorize('workflow.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(diagnoseWorkflow),
  );
  router.post(
    '/',
    authenticate,
    authorize('workflow.create'),
    validate({ body: CreateAutomationWorkflowSchema }),
    asyncHandler(createWorkflow),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('workflow.edit'),
    validate({ body: UpdateAutomationWorkflowSchema, params: IdParamSchema }),
    asyncHandler(updateWorkflow),
  );
  // Enabling is a separate grant from editing: changing what a workflow does and deciding it may
  // start doing it in production are different acts (§7.1).
  router.post(
    '/:id/enabled',
    authenticate,
    authorize('workflow.enable'),
    validate({ body: SetAutomationWorkflowEnabledSchema, params: IdParamSchema }),
    asyncHandler(setWorkflowEnabled),
  );
  router.post(
    '/:id/transfer',
    authenticate,
    authorize('workflow.transfer'),
    validate({ body: TransferAutomationWorkflowSchema, params: IdParamSchema }),
    asyncHandler(transferWorkflow),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('workflow.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteWorkflow),
  );
  return router;
};
