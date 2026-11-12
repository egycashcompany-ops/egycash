// Reads ride `operationsShipment.view`; mutations are `operationsCatalog.manage` (fleet-catalog
// precedent — see banks/bank.routes.ts).
//
// Round 12 — the reads also answer `operationsVault.view`, as the bank and currency lists already
// do: «وعاوز فى استلام الخزينة انه يقدر يعمل اضافة ل محصنة زى شاشة الشحنات المحصنة بالظبط». The
// vault's receive screen opens the secured screen's very form, whose «من فرع» / «إلى فرع» search
// these, and a treasurer may hold the vault's grant without the shipment one — booking still needs
// `operationsShipment.create`. Names only; every write stays the catalog grant's.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateOperationsBankBranchSchema,
  ListOperationsBankBranchesQuerySchema,
  UpdateOperationsBankBranchSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createBankBranch,
  getBankBranch,
  listBankBranches,
  updateBankBranch,
} from './bank-branch.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildOperationsBankBranchesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny('operationsShipment.view', 'operationsVault.view'),
    validate({ query: ListOperationsBankBranchesQuerySchema }),
    asyncHandler(listBankBranches),
  );
  // One branch — what a shipment's edit form reads to name the branch it holds and its bank. The
  // main bank is the BILLED bank, so the bank a shipment was collected from is known only through
  // its origin branch; listing a whole bank's branches to find one would be capped at a page.
  router.get(
    '/:id',
    authenticate,
    authorizeAny('operationsShipment.view', 'operationsVault.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getBankBranch),
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
