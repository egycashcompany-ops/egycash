// Mounted under the employee, because that is what a membership is about — but gated by
// `costCenter.*`, because placing a person in a centre is the cost-centre authority rather than a
// compensation one. The employee is still resolved with the caller's scope inside the service.
import { Router } from 'express';
import { z } from 'zod';
import { CreateCostCenterAssignmentSchema, objectId } from '@ecms/contracts';
import { asyncHandler } from '../../../../infrastructure/http/async-handler';
import { validate } from '../../../../infrastructure/http/validate';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  assignEmployeeCostCenter,
  endEmployeeCostCenter,
  listEmployeeCostCenters,
} from './cost-center-assignment.controller';

const EmployeeParamSchema = z.object({ employeeId: objectId() }).strict();
const AssignmentParamSchema = z
  .object({ employeeId: objectId(), assignmentId: objectId() })
  .strict();
const EndBodySchema = z.object({ on: z.coerce.date() }).strict();

export const buildEmployeeCostCentersRouter = (): Router => {
  const router = Router();

  router.get(
    '/:employeeId/cost-centers',
    authenticate,
    authorize('costCenter.view'),
    validate({ params: EmployeeParamSchema }),
    asyncHandler(listEmployeeCostCenters),
  );
  router.post(
    '/:employeeId/cost-centers',
    authenticate,
    authorize('costCenter.assign'),
    validate({ params: EmployeeParamSchema, body: CreateCostCenterAssignmentSchema }),
    asyncHandler(assignEmployeeCostCenter),
  );
  router.post(
    '/:employeeId/cost-centers/:assignmentId/end',
    authenticate,
    authorize('costCenter.assign'),
    validate({ params: AssignmentParamSchema, body: EndBodySchema }),
    asyncHandler(endEmployeeCostCenter),
  );

  return router;
};
