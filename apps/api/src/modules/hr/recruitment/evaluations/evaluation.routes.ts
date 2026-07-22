// Routers: authenticate → authorize → (multer for uploads) → validate → controller. Mounted by
// the HR manifest under /api/v1/hr. Uses the platform web kit so the module never imports
// infrastructure directly (Module Structure §1).
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
import { authorize } from '../../../../platform/rbac';
import {
  createEvaluationPhase,
  decideEvaluation,
  getEvaluation,
  listEvaluationPhases,
  listEvaluations,
  openEvaluation,
  removeEvaluationFile,
  updateEvaluationPhase,
  uploadEvaluationFile,
} from './evaluation.controller';
import {
  CreateEvaluationPhaseSchema,
  DecideEvaluationSchema,
  EvaluationFileParamSchema,
  EvaluationIdParamSchema,
  EvaluationPhaseIdParamSchema,
  ListEvaluationPhasesQuerySchema,
  ListEvaluationsQuerySchema,
  OpenEvaluationSchema,
  RemoveEvaluationFileSchema,
  UpdateEvaluationPhaseSchema,
  UploadEvaluationFileSchema,
} from './evaluation.validation';

/** Outer multipart cap (first-line defence); the file category's `maxSizeMb` is authoritative. */
const ATTACHMENT_MAX_MB = 25;

const multipartSingle = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ATTACHMENT_MAX_MB * 1024 * 1024, files: 1 },
  }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(ErrorCodes.FILE_TOO_LARGE, 422, `File exceeds the ${ATTACHMENT_MAX_MB} MB cap`));
        return;
      }
      next(error);
    });
  };
};

export const buildEvaluationsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('evaluation.view'),
    validate({ query: ListEvaluationsQuerySchema }),
    asyncHandler(listEvaluations),
  );
  router.post(
    '/',
    authenticate,
    authorize('evaluation.manage'),
    validate({ body: OpenEvaluationSchema }),
    asyncHandler(openEvaluation),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('evaluation.view'),
    validate({ params: EvaluationIdParamSchema }),
    asyncHandler(getEvaluation),
  );
  router.post(
    '/:id/files',
    authenticate,
    authorize('evaluation.manage'),
    multipartSingle(),
    validate({ body: UploadEvaluationFileSchema, params: EvaluationIdParamSchema }),
    asyncHandler(uploadEvaluationFile),
  );
  router.delete(
    '/:id/files/:fileId',
    authenticate,
    authorize('evaluation.manage'),
    validate({ body: RemoveEvaluationFileSchema, params: EvaluationFileParamSchema }),
    asyncHandler(removeEvaluationFile),
  );
  router.patch(
    '/:id/decision',
    authenticate,
    authorize('evaluation.manage'),
    validate({ body: DecideEvaluationSchema, params: EvaluationIdParamSchema }),
    asyncHandler(decideEvaluation),
  );

  return router;
};

export const buildEvaluationPhasesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('evaluation.view'),
    validate({ query: ListEvaluationPhasesQuerySchema }),
    asyncHandler(listEvaluationPhases),
  );
  router.post(
    '/',
    authenticate,
    authorize('evaluationPhase.manage'),
    validate({ body: CreateEvaluationPhaseSchema }),
    asyncHandler(createEvaluationPhase),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('evaluationPhase.manage'),
    validate({ body: UpdateEvaluationPhaseSchema, params: EvaluationPhaseIdParamSchema }),
    asyncHandler(updateEvaluationPhase),
  );
  return router;
};
