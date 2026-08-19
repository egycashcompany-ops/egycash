// Reads ride `operationsShipment.view`; mutations are `operationsCatalog.manage` (fleet-catalog
// precedent — see banks/bank.routes.ts).
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateOperationsBankBranchSchema,
  ListOperationsBankBranchesQuerySchema,
  UpdateOperationsBankBranchSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { createBankBranch, listBankBranches, updateBankBranch } from './bank-branch.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildOperationsBankBranchesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ query: ListOperationsBankBranchesQuerySchema }),
    asyncHandler(listBankBranches),
  );
  router.post(
    '/',
    authenticate,
    authorize('operationsCatalog.manage'),
    validate({ body: CreateOperationsBankBranchSchema }),
    asyncHandler(createBankBranch),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('operationsCatalog.manage'),
    validate({ body: UpdateOperationsBankBranchSchema, params: IdParamSchema }),
    asyncHandler(updateBankBranch),
  );
  return router;
};
