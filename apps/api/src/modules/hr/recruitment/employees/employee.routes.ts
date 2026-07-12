// Router: authenticate → authorize → validate → controller. Mounted by the HR manifest
// under /api/v1/hr. Uses the platform web kit for validate/asyncHandler so the module
// never imports infrastructure directly (Module Structure §1).
import { Router } from 'express';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { createEmployee, getEmployee, listEmployees } from './employee.controller';
import {
  CreateEmployeeSchema,
  EmployeeIdParamSchema,
  ListEmployeesQuerySchema,
} from './employee.validation';

export const buildEmployeesRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('employee.view'),
    validate({ query: ListEmployeesQuerySchema }),
    asyncHandler(listEmployees),
  );
  router.post(
    '/',
    authenticate,
    authorize('employee.create'),
    validate({ body: CreateEmployeeSchema }),
    asyncHandler(createEmployee),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('employee.view'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(getEmployee),
  );

  return router;
};
