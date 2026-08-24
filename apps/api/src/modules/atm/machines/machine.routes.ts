// /all_atm (read) rides `atmMachine.view`; every master mutation is the /data_edit_atm surface,
// `atmMachine.manage` — the legacy gave that page to a smaller privilege set than the read
// (contad_app.js:2363 vs :2559), and unlike every legacy POST these are actually guarded
// (port doc conflict T1-auth).
import { Router } from 'express';
import {
  BulkCreateAtmMachinesSchema,
  BulkDeleteAtmMachinesSchema,
  ListAtmMachinesQuerySchema,
  ReassignAtmMachineAreaSchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  bulkCreateMachines,
  bulkDeleteMachines,
  listMachines,
  reassignMachineArea,
} from './machine.controller';

export const buildAtmMachinesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('atmMachine.view'),
    validate({ query: ListAtmMachinesQuerySchema }),
    asyncHandler(listMachines),
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
  return router;
};
