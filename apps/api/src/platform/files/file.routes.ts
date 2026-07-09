// Router: authenticate → authorize → (multer) → validate → controller.
// The signed streaming endpoint is the ONE unauthenticated route: it is a
// short-lived HMAC capability URL issued by the authorized download endpoint.
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import multer from 'multer';
import { ErrorCodes } from '@ecms/contracts';
import { env } from '../../infrastructure/config/env';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { AppError } from '../../shared/errors';
import { authenticate } from '../auth';
import { authorize } from '../rbac';
import {
  CreateFileCategorySchema,
  FileIdParamSchema,
  ListFilesQuerySchema,
  PaginationQuerySchema,
  SignedQuerySchema,
  UpdateFileCategorySchema,
  UpdateFileSchema,
  UploadFileFieldsSchema,
} from './file.validation';
import {
  archiveFile,
  deleteFile,
  downloadFile,
  getFile,
  listFiles,
  listFileVersions,
  purgeFile,
  replaceFile,
  restoreFile,
  streamSignedFile,
  updateFile,
  uploadFile,
} from './file.controller';
import {
  createFileCategory,
  deleteFileCategory,
  listFileCategories,
  updateFileCategory,
} from './file-category.controller';

/** Multer with the platform-wide hard cap; per-category limits apply in the service. */
const multipartSingle = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(
          new AppError(
            ErrorCodes.FILE_TOO_LARGE,
            422,
            `File exceeds the ${env.MAX_UPLOAD_MB} MB upload cap`,
          ),
        );
        return;
      }
      next(error);
    });
  };
};

export const buildFilesRouter = (): Router => {
  const router = Router();

  // Signed capability URL — must be declared before '/:id' routes.
  router.get(
    '/signed/:id',
    validate({ params: FileIdParamSchema, query: SignedQuerySchema }),
    asyncHandler(streamSignedFile),
  );

  router.get(
    '/',
    authenticate,
    authorize('file.view'),
    validate({ query: ListFilesQuerySchema }),
    asyncHandler(listFiles),
  );
  router.post(
    '/',
    authenticate,
    authorize('file.create'),
    multipartSingle(),
    validate({ body: UploadFileFieldsSchema }),
    asyncHandler(uploadFile),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('file.view'),
    validate({ params: FileIdParamSchema }),
    asyncHandler(getFile),
  );
  router.get(
    '/:id/versions',
    authenticate,
    authorize('file.view'),
    validate({ params: FileIdParamSchema }),
    asyncHandler(listFileVersions),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('file.edit'),
    validate({ body: UpdateFileSchema, params: FileIdParamSchema }),
    asyncHandler(updateFile),
  );
  router.post(
    '/:id/replace',
    authenticate,
    authorize('file.edit'),
    multipartSingle(),
    validate({ params: FileIdParamSchema }),
    asyncHandler(replaceFile),
  );
  router.post(
    '/:id/archive',
    authenticate,
    authorize('file.edit'),
    validate({ params: FileIdParamSchema }),
    asyncHandler(archiveFile),
  );
  router.post(
    '/:id/restore',
    authenticate,
    authorize('file.edit'),
    validate({ params: FileIdParamSchema }),
    asyncHandler(restoreFile),
  );
  // Download authorization is visibility-aware (public files need no
  // file.download grant) — enforced in the service, audited either way.
  router.get(
    '/:id/download',
    authenticate,
    validate({ params: FileIdParamSchema }),
    asyncHandler(downloadFile),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('file.delete'),
    validate({ params: FileIdParamSchema }),
    asyncHandler(deleteFile),
  );
  router.delete(
    '/:id/permanent',
    authenticate,
    authorize('file.purge'),
    validate({ params: FileIdParamSchema }),
    asyncHandler(purgeFile),
  );
  return router;
};

export const buildFileCategoriesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('file.view'),
    validate({ query: PaginationQuerySchema }),
    asyncHandler(listFileCategories),
  );
  router.post(
    '/',
    authenticate,
    authorize('fileCategory.manage'),
    validate({ body: CreateFileCategorySchema }),
    asyncHandler(createFileCategory),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fileCategory.manage'),
    validate({ body: UpdateFileCategorySchema, params: FileIdParamSchema }),
    asyncHandler(updateFileCategory),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('fileCategory.manage'),
    validate({ params: FileIdParamSchema }),
    asyncHandler(deleteFileCategory),
  );
  return router;
};
