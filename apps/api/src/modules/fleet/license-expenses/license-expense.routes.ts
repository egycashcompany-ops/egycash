import { Router } from 'express';
import { z } from 'zod';
import {
  CreateFleetLicenseExpenseSchema,
  FleetLicenseExpenseSummaryQuerySchema,
  ListFleetLicenseExpensesQuerySchema,
  SaveFleetLicenseExpenseSettingsSchema,
  UpdateFleetLicenseExpenseSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createLicenseExpense,
  deleteLicenseExpense,
  getLicenseExpense,
  getLicenseExpenseSettings,
  licenseExpenseSummary,
  listLicenseExpenses,
  saveLicenseExpenseSettings,
  updateLicenseExpense,
} from './license-expense.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetLicenseExpensesRouter = (): Router => {
  const router = Router();
  // The signatures every new memo starts with — read by whoever writes memos, written by whoever
  // may edit. Before `/:id`, which would otherwise read `settings` as an id.
  router.get(
    '/settings',
    authenticate,
    authorize('fleetLicenseExpense.view'),
    asyncHandler(getLicenseExpenseSettings),
  );
  router.put(
    '/settings',
    authenticate,
    authorize('fleetLicenseExpense.edit'),
    validate({ body: SaveFleetLicenseExpenseSettingsSchema }),
    asyncHandler(saveLicenseExpenseSettings),
  );
  // «الإحصائيات» — over the whole filtered set, never a page. Before `/:id` too.
  router.get(
    '/summary',
    authenticate,
    authorize('fleetLicenseExpense.view'),
    validate({ query: FleetLicenseExpenseSummaryQuerySchema }),
    asyncHandler(licenseExpenseSummary),
  );
  router.get(
    '/',
    authenticate,
    authorize('fleetLicenseExpense.view'),
    validate({ query: ListFleetLicenseExpensesQuerySchema }),
    asyncHandler(listLicenseExpenses),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('fleetLicenseExpense.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getLicenseExpense),
  );
  router.post(
    '/',
    authenticate,
    authorize('fleetLicenseExpense.create'),
    validate({ body: CreateFleetLicenseExpenseSchema }),
    asyncHandler(createLicenseExpense),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetLicenseExpense.edit'),
    validate({ body: UpdateFleetLicenseExpenseSchema, params: IdParamSchema }),
    asyncHandler(updateLicenseExpense),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('fleetLicenseExpense.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteLicenseExpense),
  );
  return router;
};
