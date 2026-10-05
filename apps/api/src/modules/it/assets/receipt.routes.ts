// Custody receipt routes (FR-18, design §12). Writing — printing the paper before a hand-over,
// the hand-over itself, and filing or withdrawing the signed copy — rides `itAsset.assign`, the
// one custody grant; reading a receipt back to print it again rides `itAsset.view`, because the
// paper shows nothing the custody register does not.
import { Router } from 'express';
import {
  HandOverItAssetsSchema,
  ItCustodyReceiptIdParamSchema,
  PreviewItCustodyReceiptSchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  deleteItCustodyReceiptSignedCopy,
  getItCustodyReceipt,
  getItCustodyReceiptSignedCopy,
  handOverItAssets,
  previewItCustodyReceipt,
  printItCustodyReceipt,
  signedCopyUpload,
  uploadItCustodyReceiptSignedCopy,
} from './receipt.controller';

export const buildItCustodyReceiptsRouter = (): Router => {
  const router = Router();
  // Before '/:id' so the literal segment is not swallowed by the id matcher.
  router.post(
    '/preview',
    authenticate,
    authorize('itAsset.assign'),
    validate({ body: PreviewItCustodyReceiptSchema }),
    asyncHandler(previewItCustodyReceipt),
  );
  router.post(
    '/',
    authenticate,
    authorize('itAsset.assign'),
    validate({ body: HandOverItAssetsSchema }),
    asyncHandler(handOverItAssets),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('itAsset.view'),
    validate({ params: ItCustodyReceiptIdParamSchema }),
    asyncHandler(getItCustodyReceipt),
  );
  // Printing again rides the READ grant like the receipt itself: the paper shows nothing the
  // register does not. A POST because the first print of a receipt from before numbering gives it
  // its number.
  router.post(
    '/:id/print',
    authenticate,
    authorize('itAsset.view'),
    validate({ params: ItCustodyReceiptIdParamSchema }),
    asyncHandler(printItCustodyReceipt),
  );
  router.get(
    '/:id/signed-copy',
    authenticate,
    authorize('itAsset.view'),
    validate({ params: ItCustodyReceiptIdParamSchema }),
    asyncHandler(getItCustodyReceiptSignedCopy),
  );
  router.post(
    '/:id/signed-copy',
    authenticate,
    authorize('itAsset.assign'),
    signedCopyUpload(),
    validate({ params: ItCustodyReceiptIdParamSchema }),
    asyncHandler(uploadItCustodyReceiptSignedCopy),
  );
  router.delete(
    '/:id/signed-copy',
    authenticate,
    authorize('itAsset.assign'),
    validate({ params: ItCustodyReceiptIdParamSchema }),
    asyncHandler(deleteItCustodyReceiptSignedCopy),
  );
  return router;
};
