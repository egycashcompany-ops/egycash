import { Router } from 'express';
import { z } from 'zod';
import {
  ListAutomationVariablesQuerySchema,
  UpsertAutomationVariableSchema,
  objectId,
} from '@ecms/contracts';
import { asyncHandler } from '../../../infrastructure/http/async-handler';
import { validate } from '../../../infrastructure/http/validate';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { deleteVariable, listVariables, upsertVariable } from './variable.controller';

const KeyParamSchema = z
  .object({ key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/) })
  .strict();
const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAutomationVariablesRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('variable.view'),
    validate({ query: ListAutomationVariablesQuerySchema }),
    asyncHandler(listVariables),
  );
  router.put(
    '/:key',
    authenticate,
    authorize('variable.edit'),
    validate({ body: UpsertAutomationVariableSchema, params: KeyParamSchema }),
    asyncHandler(upsertVariable),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('variable.edit'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteVariable),
  );
  return router;
};
