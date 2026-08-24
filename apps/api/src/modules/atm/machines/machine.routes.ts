// /all_atm (read) rides `atmMachine.view`; every master mutation is the /data_edit_atm surface,
// `atmMachine.manage` — the legacy gave that page to a smaller privilege set than the read
// (contad_app.js:2363 vs :2559), and unlike every legacy POST these are actually guarded
// (port doc conflict T1-auth).
import { Router } from 'express';
import { z } from 'zod';
import {
  BulkCreateAtmMachinesSchema,
  BulkDeleteAtmMachinesSchema,
  CreateAtmMachineSchema,
  ListAtmMachinesQuerySchema,
  ReassignAtmMachineAreaSchema,
  UpdateAtmMachineSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  bulkCreateMachines,
  bulkDeleteMachines,
  createMachine,
  listMachines,
  reassignMachineArea,
  updateMachine,
} from './machine.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAtmMachinesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('atmMachine.view'),
    validate({ query: ListAtmMachinesQuerySchema }),
    asyncHandler(listMachines),
  );
  // Per-item add/edit, beside the legacy bulk forms — same grant, since both are the
  // /data_edit_atm surface. `/bulk` is declared first so it is never read as an id.
  router.post(
    '/',
    authenticate,
    authorize('atmMachine.manage'),
    validate({ body: CreateAtmMachineSchema }),
    asyncHandler(createMachine),
  );
  router.post(
    '/bulk',
    authenticate,
    authorize('atmMachine.manage'),
    validate({ body: BulkCreateAtmMachinesSchema }),
    asyncHandler(bulkCreateMachines),
  );
  router.post(
    '/bulk-delete',
    authenticate,
    authorize('atmMachine.manage'),
    validate({ body: BulkDeleteAtmMachinesSchema }),
    asyncHandler(bulkDeleteMachines),
  );
  router.post(
    '/reassign-area',
    authenticate,
    authorize('atmMachine.manage'),
    validate({ body: ReassignAtmMachineAreaSchema }),
    asyncHandler(reassignMachineArea),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('atmMachine.manage'),
    validate({ body: UpdateAtmMachineSchema, params: IdParamSchema }),
    asyncHandler(updateMachine),
  );
  return router;
};
