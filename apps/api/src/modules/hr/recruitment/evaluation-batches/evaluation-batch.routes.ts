// Router: authenticate → (multer for uploads) → validate → controller. Mounted by the HR manifest
// under /api/v1/hr. Uses the platform web kit so the module never imports infrastructure directly.
//
// There is deliberately no `authorize()` here: a batch's permission resource is a property of its
// PHASE (RW7), which is only known once the request's batch or `phaseId` is resolved. Every
// handler performs that check first — see `evaluation-batch.access.ts`.
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import multer from 'multer';
import { ErrorCodes } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import {
  addEvaluationBatchItems,
  bulkEvaluationBatchItems,
  bulkEvaluationBatches,
  cancelEvaluationBatch,
  closeEvaluationBatch,
  createEvaluationBatch,
  decideEvaluationBatchItem,
  getEvaluationBatch,
  issueEvaluationBatch,
  listBatchCandidates,
  listEvaluationBatches,
  removeEvaluationBatchItem,
  retryEvaluationBatchPackage,
  updateEvaluationBatch,
  uploadEvaluationBatchResult,
  voidEvaluationBatchItem,
} from './evaluation-batch.controller';
import {
  AddBatchItemsSchema,
  BulkBatchItemsSchema,
  BulkEvaluationBatchesSchema,
  CancelEvaluationBatchSchema,
  CloseEvaluationBatchSchema,
  CreateEvaluationBatchSchema,
  DecideBatchItemSchema,
  EvaluationBatchIdParamSchema,
  EvaluationBatchItemParamSchema,
  IssueEvaluationBatchSchema,
  ListBatchCandidatesQuerySchema,
  ListEvaluationBatchesQuerySchema,
  RemoveBatchItemSchema,
  UpdateEvaluationBatchSchema,
  UploadBatchResultSchema,
  VoidBatchItemSchema,
} from './evaluation-batch.validation';

/** Outer multipart cap (first-line defence); the file category's `maxSizeMb` is authoritative. */
const RESULT_MAX_MB = 25;

const multipartSingle = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: RESULT_MAX_MB * 1024 * 1024, files: 1 },
  }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(ErrorCodes.FILE_TOO_LARGE, 422, `File exceeds the ${RESULT_MAX_MB} MB cap`));
        return;
      }
      next(error);
    });
  };
};

export const buildEvaluationBatchesRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    validate({ query: ListEvaluationBatchesQuerySchema }),
    asyncHandler(listEvaluationBatches),
  );
  router.post(
    '/',
    authenticate,
    validate({ body: CreateEvaluationBatchSchema }),
    asyncHandler(createEvaluationBatch),
  );
  // Static paths are declared before `/:id` so they are never swallowed by the id route.
  router.get(
    '/candidates',
    authenticate,
    validate({ query: ListBatchCandidatesQuerySchema }),
    asyncHandler(listBatchCandidates),
  );
  router.post(
    '/bulk',
    authenticate,
    validate({ body: BulkEvaluationBatchesSchema }),
    asyncHandler(bulkEvaluationBatches),
  );

  router.get(
    '/:id',
    authenticate,
    validate({ params: EvaluationBatchIdParamSchema }),
    asyncHandler(getEvaluationBatch),
  );
  router.patch(
    '/:id',
    authenticate,
    validate({ body: UpdateEvaluationBatchSchema, params: EvaluationBatchIdParamSchema }),
    asyncHandler(updateEvaluationBatch),
  );
  router.post(
    '/:id/items',
    authenticate,
    validate({ body: AddBatchItemsSchema, params: EvaluationBatchIdParamSchema }),
    asyncHandler(addEvaluationBatchItems),
  );
  router.post(
    '/:id/items/bulk',
    authenticate,
    validate({ body: BulkBatchItemsSchema, params: EvaluationBatchIdParamSchema }),
    asyncHandler(bulkEvaluationBatchItems),
  );
  router.delete(
    '/:id/items/:applicantId',
    authenticate,
    validate({ body: RemoveBatchItemSchema, params: EvaluationBatchItemParamSchema }),
    asyncHandler(removeEvaluationBatchItem),
  );
  router.post(
    '/:id/issue',
    authenticate,
    validate({ body: IssueEvaluationBatchSchema, params: EvaluationBatchIdParamSchema }),
    asyncHandler(issueEvaluationBatch),
  );
  router.post(
    '/:id/package/retry',
    authenticate,
    validate({ params: EvaluationBatchIdParamSchema }),
    asyncHandler(retryEvaluationBatchPackage),
  );
  router.post(
    '/:id/results',
    authenticate,
    multipartSingle(),
    validate({ body: UploadBatchResultSchema, params: EvaluationBatchIdParamSchema }),
    asyncHandler(uploadEvaluationBatchResult),
  );
  router.patch(
    '/:id/items/:applicantId/decision',
    authenticate,
    validate({ body: DecideBatchItemSchema, params: EvaluationBatchItemParamSchema }),
    asyncHandler(decideEvaluationBatchItem),
  );
  router.post(
    '/:id/items/:applicantId/void',
    authenticate,
    validate({ body: VoidBatchItemSchema, params: EvaluationBatchItemParamSchema }),
    asyncHandler(voidEvaluationBatchItem),
  );
  router.post(
    '/:id/close',
    authenticate,
    validate({ body: CloseEvaluationBatchSchema, params: EvaluationBatchIdParamSchema }),
    asyncHandler(closeEvaluationBatch),
  );
  router.post(
    '/:id/cancel',
    authenticate,
    validate({ body: CancelEvaluationBatchSchema, params: EvaluationBatchIdParamSchema }),
    asyncHandler(cancelEvaluationBatch),
  );

  return router;
};
