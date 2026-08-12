// Router: authenticate → authorize → validate → controller.
//
// NO PERMISSION OF ITS OWN (PY-2). These rows are compensation, so they are gated by the keys
// that already govern compensation: `employee.viewCompensation` to read and
// `employee.manageCompensation` to write — the same split the Personnel Actions engine uses for
// a salary change. Nothing was added to the registry for this feature.
import { Router } from 'express';
import { z } from 'zod';
import {
  objectId,
  CreateEmployeePayItemSchema,
  ListEmployeePayItemsQuerySchema,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  createEmployeePayItem,
  listEmployeePayItems,
  removeEmployeePayItem,
} from './employee-pay-item.controller';

const EmployeeParamSchema = z.object({ employeeId: objectId() }).strict();
const ItemParamSchema = z.object({ employeeId: objectId(), id: objectId() }).strict();

export const buildEmployeePayItemsRouter = (): Router => {
  const router = Router();

  router.get(
    '/:employeeId/pay-items',
    authenticate,
    authorize('employee.viewCompensation'),
    validate({ query: ListEmployeePayItemsQuerySchema, params: EmployeeParamSchema }),
    asyncHandler(listEmployeePayItems),
  );
  router.post(
    '/:employeeId/pay-items',
    authenticate,
    authorize('employee.manageCompensation'),
    validate({ body: CreateEmployeePayItemSchema, params: EmployeeParamSchema }),
    asyncHandler(createEmployeePayItem),
  );
  router.delete(
    '/:employeeId/pay-items/:id',
    authenticate,
    authorize('employee.manageCompensation'),
    validate({ params: ItemParamSchema }),
    asyncHandler(removeEmployeePayItem),
  );
  return router;
};
