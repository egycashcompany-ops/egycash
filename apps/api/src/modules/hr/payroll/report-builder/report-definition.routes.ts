// Router: authenticate → authorize → validate → controller.
//
// TWO KEYS ON EVERY EXECUTION, AND THAT IS THE POINT (D-B1-1). `payrollReport.*` says a person may
// use the builder; `employee.viewCompensation` says whose pay they may see. If running a report took
// only the first, the new key would become a way to read payroll without holding the payroll key —
// a permission bypass wearing the costume of a feature. `authorize` is an ordinary middleware, so
// two of them in sequence is an AND.
//
// Mounted under `/hr/payroll/reports`, with `payrollReport.view` / `.manage` declared in the module
// manifest and the page registered beside them.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreatePayrollReportDefinitionSchema,
  PaginationQuerySchema,
  PreviewPayrollReportSchema,
  RunPayrollReportSchema,
  UpdatePayrollReportDefinitionSchema,
  objectId,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  createReportDefinition,
  deleteReportDefinition,
  getReportDefinition,
  listReportDefinitions,
  previewReport,
  runReportDefinition,
  updateReportDefinition,
} from './report-definition.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

const ListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['active', 'inactive']).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

export const buildReportBuilderRouter = (): Router => {
  const router = Router();
  const read = [authenticate, authorize('payrollReport.view')] as const;
  const manage = [authenticate, authorize('payrollReport.manage')] as const;
  // Running one reads somebody's pay, so it carries the compensation key as well.
  const execute = [
    authenticate,
    authorize('payrollReport.view'),
    authorize('employee.viewCompensation'),
  ] as const;

  router.get('/', ...read, validate({ query: ListQuerySchema }), asyncHandler(listReportDefinitions));

  router.post(
    '/',
    ...manage,
    validate({ body: CreatePayrollReportDefinitionSchema }),
    asyncHandler(createReportDefinition),
  );

  router.post(
    '/preview',
    ...execute,
    validate({ body: PreviewPayrollReportSchema }),
    asyncHandler(previewReport),
  );

  router.get('/:id', ...read, validate({ params: IdParamSchema }), asyncHandler(getReportDefinition));

  router.patch(
    '/:id',
    ...manage,
    validate({ body: UpdatePayrollReportDefinitionSchema, params: IdParamSchema }),
    asyncHandler(updateReportDefinition),
  );

  router.delete(
    '/:id',
    ...manage,
    validate({ params: IdParamSchema }),
    asyncHandler(deleteReportDefinition),
  );

  router.post(
    '/:id/run',
    ...execute,
    validate({ body: RunPayrollReportSchema, params: IdParamSchema }),
    asyncHandler(runReportDefinition),
  );

  return router;
};
