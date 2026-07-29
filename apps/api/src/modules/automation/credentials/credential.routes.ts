import { Router } from 'express';
import { z } from 'zod';
import {
  CreateAutomationCredentialSchema,
  ListAutomationCredentialsQuerySchema,
  ReplaceAutomationCredentialValueSchema,
  UpdateAutomationCredentialSchema,
  objectId,
} from '@ecms/contracts';
import { asyncHandler } from '../../../infrastructure/http/async-handler';
import { validate } from '../../../infrastructure/http/validate';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import {
  createCredential,
  deleteCredential,
  getCredential,
  listCredentials,
  replaceCredentialValue,
  updateCredential,
} from './credential.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

/**
 * Six routes, and none of them returns a secret. The absence is the feature (§7.3): there is no
 * `GET /:id/value`, no `?reveal=true`, and no permission that would unlock one. Adding a read path
 * here would need an ADR, not a route.
 */
export const buildAutomationCredentialsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('credential.view'),
    validate({ query: ListAutomationCredentialsQuerySchema }),
    asyncHandler(listCredentials),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('credential.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getCredential),
  );
  router.post(
    '/',
    authenticate,
    authorize('credential.create'),
    validate({ body: CreateAutomationCredentialSchema }),
    asyncHandler(createCredential),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('credential.edit'),
    validate({ body: UpdateAutomationCredentialSchema, params: IdParamSchema }),
    asyncHandler(updateCredential),
  );
  // Replace, not edit: the value goes in, nothing comes back out.
  router.put(
    '/:id/value',
    authenticate,
    authorize('credential.edit'),
    validate({ body: ReplaceAutomationCredentialValueSchema, params: IdParamSchema }),
    asyncHandler(replaceCredentialValue),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('credential.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteCredential),
  );
  return router;
};
