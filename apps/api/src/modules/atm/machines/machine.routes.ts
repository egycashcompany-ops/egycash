// /all_atm (read) rides `atmMachine.view`; the master mutations are the /data_edit_atm surface —
// the legacy gave that page to a smaller privilege set than the read (contad_app.js:2363 vs
// :2559), and unlike every legacy POST these are actually guarded (port doc conflict T1-auth).
//
// Since the Efficiency register controls which machines exist (D2, docs/12-planning/
// atm-efficiency-register.md §7.1), the surface is split: add, bulk add, delete-by-codes,
// reassign-by-code and every `PATCH /:id` (name, bank, area, archive) stay `atmMachine.manage`;
// Operations move ONE machine to another area through `PATCH /:id/area`, which takes
// `atmMachine.moveArea` or `manage` (DEC-3) — the service then asks that the key reach the
// machine's branch (DEC-29). Every area write moves the machine's open register entries with it.
import { Router } from 'express';
import { z } from 'zod';
import {
  BulkCreateAtmMachinesSchema,
  BulkDeleteAtmMachinesSchema,
  CreateAtmMachineSchema,
  ListAtmMachinesQuerySchema,
  ReassignAtmMachineAreaSchema,
  UpdateAtmMachineAreaSchema,
  UpdateAtmMachineSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  bulkCreateMachines,
  bulkDeleteMachines,
  createMachine,
  listMachines,
  moveMachineArea,
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
  // Declared before `/:id`, the literal-before-param rule the other routes follow.
  router.patch(
    '/:id/area',
    authenticate,
    authorizeAny('atmMachine.moveArea', 'atmMachine.manage'),
    validate({ body: UpdateAtmMachineAreaSchema, params: IdParamSchema }),
    asyncHandler(moveMachineArea),
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
