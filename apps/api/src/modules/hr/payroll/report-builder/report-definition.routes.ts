// Router: authenticate → authorize → validate → controller.
//
// TWO KEYS ON EVERY EXECUTION, AND THAT IS THE POINT (D-B1-1). `payrollReport.*` says a person may
// use the builder; `employee.viewCompensation` says whose pay they may see. If running a report took
// only the first, the new key would become a way to read payroll without holding the payroll key —
// a permission bypass wearing the costume of a feature. `authorize` is an ordinary middleware, so
// two of them in sequence is an AND.
//
// NOT MOUNTED YET. Stage 2 builds this router; stage 4 declares `payrollReport.view` / `.manage`,
// registers the page and mounts it. Until then these keys resolve to nothing and every request here
// would be refused — which is the correct direction to fail in while a feature is half-built.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreatePayrollReportDefinitionSchema,
  PaginationQuerySchema,
  PreviewPayrollReportSchema,
  RunPayrollReportSchema,
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

  // PATCH /:id waits on D-B1-5 (whether an edit carries a version). Nothing else here depends on it.

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
