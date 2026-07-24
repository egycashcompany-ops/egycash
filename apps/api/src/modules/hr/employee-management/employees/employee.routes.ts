// Router: authenticate → authorize → validate → controller. Mounted by the HR manifest
// under /api/v1/hr. Uses the platform web kit for validate/asyncHandler so the module
// never imports infrastructure directly (Module Structure §1). Literal paths (`/direct`,
// `/rehire-check`) are declared before `/:id`. The status endpoint moved to the
// employee-actions feature (deprecated alias over the engine).
import { Router } from 'express';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  createEmployee,
  createEmployeeLogin,
  getEmployee,
  getEmployeeTimeline,
  listEmployees,
  listSubordinates,
  registerEmployeeDirect,
  rehireCheck,
  updateEmployeePersonal,
} from './employee.controller';
import {
  CreateEmployeeLoginSchema,
  CreateEmployeeSchema,
  DirectRegisterEmployeeSchema,
  EmployeeIdParamSchema,
  ListEmployeesQuerySchema,
  RehireCheckQuerySchema,
  UpdateEmployeePersonalSchema,
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
  // Direct Registration (D4) — go-live onboarding / walk-in hire (no recruitment pipeline).
  router.post(
    '/direct',
    authenticate,
    authorize('employee.registerDirect'),
    validate({ body: DirectRegisterEmployeeSchema }),
    asyncHandler(registerEmployeeDirect),
  );
  // Exited-employee match by national id — powers the Rehire prompt (declared before /:id).
  router.get(
    '/rehire-check',
    authenticate,
    authorize('employee.view'),
    validate({ query: RehireCheckQuerySchema }),
    asyncHandler(rehireCheck),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('employee.view'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(getEmployee),
  );
  // Post-hire personal-data edits (plain audited updates — frozen design I4).
  router.patch(
    '/:id/personal',
    authenticate,
    authorize('employee.editPersonal'),
    validate({ body: UpdateEmployeePersonalSchema, params: EmployeeIdParamSchema }),
    asyncHandler(updateEmployeePersonal),
  );
  // Employed direct reports (manager tree seed).
  router.get(
    '/:id/subordinates',
    authenticate,
    authorize('employee.view'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(listSubordinates),
  );
  // Composed profile timeline (file milestones + actions + audited personal edits).
  router.get(
    '/:id/timeline',
    authenticate,
    authorize('employee.view'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(getEmployeeTimeline),
  );
  // Create the login account for an employee (Employee ← one User, ADR-017).
  router.post(
    '/:id/login',
    authenticate,
    authorize('user.create'),
    validate({ body: CreateEmployeeLoginSchema, params: EmployeeIdParamSchema }),
    asyncHandler(createEmployeeLogin),
  );

  return router;
};
