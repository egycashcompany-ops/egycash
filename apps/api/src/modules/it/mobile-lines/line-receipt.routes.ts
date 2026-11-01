// A line's acknowledgment (F-14) — the device receipt's routes for the one-line paper. Printing it
// before the hand-over, and filing or withdrawing the signed copy, ride `itAsset.assign`, the one
// custody grant; reading it back and printing it again ride `itAsset.view`, because the paper
// shows nothing the register does not (its national ID aside, which has its own grant).
import { Router } from 'express';
import { ItCustodyReceiptIdParamSchema, PreviewItMobileLineReceiptSchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { signedCopyUpload } from '../assets/receipt.controller';
import {
  deleteItMobileLineReceiptSignedCopy,
  getItMobileLineReceipt,
  getItMobileLineReceiptSignedCopy,
  previewItMobileLineReceipt,
  printItMobileLineReceipt,
  uploadItMobileLineReceiptSignedCopy,
} from './line-receipt.controller';

export const buildItMobileLineReceiptsRouter = (): Router => {
  const router = Router();
  // Before the id routes, so the literal segment is not swallowed by the id matcher.
  router.post(
    '/preview',
    authenticate,
    authorize('itAsset.assign'),
    validate({ body: PreviewItMobileLineReceiptSchema }),
    asyncHandler(previewItMobileLineReceipt),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('itAsset.view'),
    validate({ params: ItCustodyReceiptIdParamSchema }),
    asyncHandler(getItMobileLineReceipt),
  );
  // A POST because the first print of a paper without a number gives it one.
  router.post(
    '/:id/print',
    authenticate,
    authorize('itAsset.view'),
    validate({ params: ItCustodyReceiptIdParamSchema }),
    asyncHandler(printItMobileLineReceipt),
  );
  router.get(
    '/:id/signed-copy',
    authenticate,
    authorize('itAsset.view'),
    validate({ params: ItCustodyReceiptIdParamSchema }),
    asyncHandler(getItMobileLineReceiptSignedCopy),
  );
  router.post(
    '/:id/signed-copy',
    authenticate,
    authorize('itAsset.assign'),
    signedCopyUpload(),
    validate({ params: ItCustodyReceiptIdParamSchema }),
    asyncHandler(uploadItMobileLineReceiptSignedCopy),
  );
  router.delete(
    '/:id/signed-copy',
    authenticate,
    authorize('itAsset.assign'),
    validate({ params: ItCustodyReceiptIdParamSchema }),
    asyncHandler(deleteItMobileLineReceiptSignedCopy),
  );
  return router;
};
