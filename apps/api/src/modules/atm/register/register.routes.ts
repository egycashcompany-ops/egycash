// The register and the Data Report (spec §5.7), mounted at /atm/register. Every route is
// authenticate → gate → validate; literal paths are declared BEFORE the `/:id` ones.
//
// The gate is the first of three layers: the service then finds the entry through the key's own
// read scope (404 outside it) and requires the key to reach the entry's branch for every write and
// for the reveal (DEC-29). `atmRegisterReport.view` is a key of its own (D7): the report reader
// need not see a single register row, and a register reader need not see the report.
//
// Everything under /entries — list, detail, writes, reveal, export — answers
// `Cache-Control: private, no-store`: those payloads carry key codes and notes for viewSecrets
// holders, and the reveal carries the combination itself (§5.4).
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  AtmRegisterBranchOptionsQuerySchema,
  DeleteAtmRegisterEntrySchema,
  ExportAtmRegisterEntriesQuerySchema,
  HandoverAtmRegisterEntrySchema,
  LinkAtmRegisterEntrySchema,
  ListAtmRegisterEntriesQuerySchema,
  ReceiveAtmRegisterEntrySchema,
  ReceivePendingAtmRegisterEntrySchema,
  UpdateAtmRegisterEntrySchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  deleteRegisterEntry,
  exportRegisterEntries,
  getRegisterBranchOptions,
  getRegisterEntry,
  getRegisterMeta,
  getRegisterReport,
  handoverRegisterEntry,
  linkRegisterEntry,
  listRegisterEntries,
  receivePendingRegisterEntry,
  receiveRegisterEntry,
  revealRegisterCombination,
  updateRegisterEntry,
} from './register.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

const noStore = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
};

export const buildAtmRegisterRouter = (): Router => {
  const router = Router();
  router.use('/entries', noStore);

  router.get(
    '/meta',
    authenticate,
    authorizeAny('atmRegister.view', 'atmRegisterReport.view', 'atmRegister.import'),
    asyncHandler(getRegisterMeta),
  );
  router.get(
    '/branch-options',
    authenticate,
    authorizeAny('atmRegister.view', 'atmRegister.create', 'atmRegister.edit'),
    validate({ query: AtmRegisterBranchOptionsQuerySchema }),
    asyncHandler(getRegisterBranchOptions),
  );
  router.get(
    '/report',
    authenticate,
    authorize('atmRegisterReport.view'),
    asyncHandler(getRegisterReport),
  );
  router.get(
    '/entries/export',
    authenticate,
    authorize('atmRegister.export'),
    validate({ query: ExportAtmRegisterEntriesQuerySchema }),
    asyncHandler(exportRegisterEntries),
  );
  router.get(
    '/entries',
    authenticate,
    authorize('atmRegister.view'),
    validate({ query: ListAtmRegisterEntriesQuerySchema }),
    asyncHandler(listRegisterEntries),
  );
  router.post(
    '/entries',
    authenticate,
    authorize('atmRegister.create'),
    validate({ body: ReceiveAtmRegisterEntrySchema }),
    asyncHandler(receiveRegisterEntry),
  );
  router.get(
    '/entries/:id',
    authenticate,
    authorize('atmRegister.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getRegisterEntry),
  );
  router.patch(
    '/entries/:id',
    authenticate,
    authorize('atmRegister.edit'),
    validate({ body: UpdateAtmRegisterEntrySchema, params: IdParamSchema }),
    asyncHandler(updateRegisterEntry),
  );
  router.post(
    '/entries/:id/receive',
    authenticate,
    authorize('atmRegister.create'),
    validate({ body: ReceivePendingAtmRegisterEntrySchema, params: IdParamSchema }),
    asyncHandler(receivePendingRegisterEntry),
  );
  router.post(
    '/entries/:id/handover',
    authenticate,
    authorize('atmRegister.handover'),
    validate({ body: HandoverAtmRegisterEntrySchema, params: IdParamSchema }),
    asyncHandler(handoverRegisterEntry),
  );
  // POST, not GET: the reveal has a side effect (its audit row) and must never be prefetched.
  router.post(
    '/entries/:id/reveal',
    authenticate,
    authorize('atmRegister.viewSecrets'),
    validate({ params: IdParamSchema }),
    asyncHandler(revealRegisterCombination),
  );
  router.post(
    '/entries/:id/link',
    authenticate,
    authorize('atmRegister.edit'),
    validate({ body: LinkAtmRegisterEntrySchema, params: IdParamSchema }),
    asyncHandler(linkRegisterEntry),
  );
  router.delete(
    '/entries/:id',
    authenticate,
    authorize('atmRegister.delete'),
    validate({ body: DeleteAtmRegisterEntrySchema, params: IdParamSchema }),
    asyncHandler(deleteRegisterEntry),
  );
  return router;
};
