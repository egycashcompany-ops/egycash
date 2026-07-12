// Router: authenticate → authorize → (multer for uploads) → validate → controller. Mounted by
// the HR manifest under /api/v1/hr. Uses the platform web kit for validate/asyncHandler so the
// module never imports infrastructure directly (Module Structure §1).
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
  completeHiringDocuments,
  createHiringDocumentType,
  createHiringDocuments,
  getHiringDocuments,
  listHiringDocumentTypes,
  listHiringDocumentVersions,
  listHiringDocuments,
  replaceHiringDocument,
  updateHiringDocumentType,
  uploadHiringDocument,
} from './hiring-documents.controller';
import {
  CompleteHiringDocumentsSchema,
  CreateHiringDocumentTypeSchema,
  CreateHiringDocumentsSchema,
  HiringDocumentTypeParamSchema,
  HiringDocumentsIdParamSchema,
  ListHiringDocumentTypesQuerySchema,
  ListHiringDocumentsQuerySchema,
  ReplaceHiringDocumentSchema,
  UpdateHiringDocumentTypeSchema,
  UploadHiringDocumentSchema,
} from './hiring-documents.validation';

/** Outer multipart cap (first-line defence); the file category's `maxSizeMb` is authoritative. */
const DOCUMENT_MAX_MB = 25;

const multipartSingle = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: DOCUMENT_MAX_MB * 1024 * 1024, files: 1 },
  }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(ErrorCodes.FILE_TOO_LARGE, 422, `File exceeds the ${DOCUMENT_MAX_MB} MB cap`));
        return;
      }
      next(error);
    });
  };
};

export const buildHiringDocumentsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('hiringDocuments.view'),
    validate({ query: ListHiringDocumentsQuerySchema }),
    asyncHandler(listHiringDocuments),
  );
  router.post(
    '/',
    authenticate,
    authorize('hiringDocuments.create'),
    validate({ body: CreateHiringDocumentsSchema }),
    asyncHandler(createHiringDocuments),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('hiringDocuments.view'),
    validate({ params: HiringDocumentsIdParamSchema }),
    asyncHandler(getHiringDocuments),
  );
  router.post(
    '/:id/documents',
    authenticate,
    authorize('hiringDocuments.upload'),
    multipartSingle(),
    validate({ body: UploadHiringDocumentSchema, params: HiringDocumentsIdParamSchema }),
    asyncHandler(uploadHiringDocument),
  );
  router.post(
    '/:id/documents/:typeId/replace',
    authenticate,
    authorize('hiringDocuments.upload'),
    multipartSingle(),
    validate({ body: ReplaceHiringDocumentSchema, params: HiringDocumentTypeParamSchema }),
    asyncHandler(replaceHiringDocument),
  );
  router.get(
    '/:id/documents/:typeId/versions',
    authenticate,
    authorize('hiringDocuments.view'),
    validate({ params: HiringDocumentTypeParamSchema }),
    asyncHandler(listHiringDocumentVersions),
  );
  router.post(
    '/:id/complete',
    authenticate,
    authorize('hiringDocuments.complete'),
    validate({ body: CompleteHiringDocumentsSchema, params: HiringDocumentsIdParamSchema }),
    asyncHandler(completeHiringDocuments),
  );

  return router;
};

export const buildHiringDocumentTypesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('hiringDocuments.view'),
    validate({ query: ListHiringDocumentTypesQuerySchema }),
    asyncHandler(listHiringDocumentTypes),
  );
  router.post(
    '/',
    authenticate,
    authorize('hiringDocumentType.manage'),
    validate({ body: CreateHiringDocumentTypeSchema }),
    asyncHandler(createHiringDocumentType),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('hiringDocumentType.manage'),
    validate({ body: UpdateHiringDocumentTypeSchema, params: HiringDocumentsIdParamSchema }),
    asyncHandler(updateHiringDocumentType),
  );
  return router;
};
