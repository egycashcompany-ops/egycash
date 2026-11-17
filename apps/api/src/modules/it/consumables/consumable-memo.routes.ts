// A memo («مذكرة صرف مستهلكات») — the line acknowledgment's routes for the paper an issue writes.
// Reading it back and printing it again ride `itConsumable.view`, because the paper shows nothing
// the ledger does not; filing or withdrawing its signed copy rides `itConsumable.assign`, the
// custody grant the issue itself took. There is no print-before-recording: the issue records and
// numbers the memo in one step, and the screen prints what it answers.
import { Router } from 'express';
import { ItConsumableIdParamSchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { signedCopyUpload } from '../assets/receipt.controller';
import {
  deleteItConsumableMemoSignedCopy,
  getItConsumableMemo,
  getItConsumableMemoSignedCopy,
  printItConsumableMemo,
  uploadItConsumableMemoSignedCopy,
} from './consumable-memo.controller';

export const buildItConsumableMemosRouter = (): Router => {
  const router = Router();
  router.get(
    '/:id',
    authenticate,
    authorize('itConsumable.view'),
    validate({ params: ItConsumableIdParamSchema }),
    asyncHandler(getItConsumableMemo),
  );
  // A POST, as the other papers' reprint is — the screen calls every paper's print the same way.
  router.post(
    '/:id/print',
    authenticate,
    authorize('itConsumable.view'),
    validate({ params: ItConsumableIdParamSchema }),
    asyncHandler(printItConsumableMemo),
  );
  router.get(
    '/:id/signed-copy',
    authenticate,
    authorize('itConsumable.view'),
    validate({ params: ItConsumableIdParamSchema }),
    asyncHandler(getItConsumableMemoSignedCopy),
  );
  router.post(
    '/:id/signed-copy',
    authenticate,
    authorize('itConsumable.assign'),
    signedCopyUpload(),
    validate({ params: ItConsumableIdParamSchema }),
    asyncHandler(uploadItConsumableMemoSignedCopy),
  );
  router.delete(
    '/:id/signed-copy',
    authenticate,
    authorize('itConsumable.assign'),
    validate({ params: ItConsumableIdParamSchema }),
    asyncHandler(deleteItConsumableMemoSignedCopy),
  );
  return router;
};
