// Router: authenticate → authorize → validate → controller. One Personnel Actions engine,
// permission-grouped routes (frozen design F5): employment / compensation / exit / rehire.
// Cancel sits under the employment group's permission; listing follows employee.view.
import { Router } from 'express';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  cancelEmployeeAction,
  changeEmployeeStatusAlias,
  createCompensationAction,
  createEmploymentAction,
  createExitAction,
  createRehireAction,
  listEmployeeActions,
} from './employee-action.controller';
import { ChangeEmployeeStatusSchema } from '@ecms/contracts';
import {
  CancelEmployeeActionSchema,
  CompensationActionSchema,
  EmployeeActionIdParamSchema,
  EmploymentActionSchema,
  ExitActionSchema,
  ListEmployeeActionsQuerySchema,
  RehireActionSchema,
} from './employee-action.validation';
import { EmployeeIdParamSchema } from '../employees/employee.validation';

/** Mounted under `/hr/employees` — paths are relative to `/:id/actions`. */
export const buildEmployeeActionsRouter = (): Router => {
  const router = Router({ mergeParams: true });

  router.get(
    '/:id/actions',
    authenticate,
    authorize('employee.view'),
    validate({ query: ListEmployeeActionsQuerySchema, params: EmployeeIdParamSchema }),
    asyncHandler(listEmployeeActions),
  );
  router.post(
    '/:id/actions/employment',
    authenticate,
    authorize('employee.manageActions'),
    validate({ body: EmploymentActionSchema, params: EmployeeIdParamSchema }),
    asyncHandler(createEmploymentAction),
  );
  router.post(
    '/:id/actions/compensation',
    authenticate,
    authorize('employee.manageCompensation'),
    validate({ body: CompensationActionSchema, params: EmployeeIdParamSchema }),
    asyncHandler(createCompensationAction),
  );
  router.post(
    '/:id/actions/exit',
    authenticate,
    authorize('employee.exit'),
    validate({ body: ExitActionSchema, params: EmployeeIdParamSchema }),
    asyncHandler(createExitAction),
  );
  router.post(
    '/:id/actions/rehire',
    authenticate,
    authorize('employee.rehire'),
    validate({ body: RehireActionSchema, params: EmployeeIdParamSchema }),
    asyncHandler(createRehireAction),
  );
  // DEPRECATED alias (one release): the old status endpoint, translated onto the engine.
  router.patch(
    '/:id/status',
    authenticate,
    authorize('employee.changeStatus'),
    validate({ body: ChangeEmployeeStatusSchema, params: EmployeeIdParamSchema }),
    asyncHandler(changeEmployeeStatusAlias),
  );
  router.post(
    '/:id/actions/:actionId/cancel',
    authenticate,
    authorize('employee.manageActions'),
    validate({ body: CancelEmployeeActionSchema, params: EmployeeActionIdParamSchema }),
    asyncHandler(cancelEmployeeAction),
  );

  return router;
};
