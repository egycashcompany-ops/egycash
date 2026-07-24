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
  addEmployeeFileNote,
  createEmployeeFile,
  getEmployeeFile,
  listEmployeeFiles,
  removeEmployeeFileDocument,
  uploadEmployeeFileDocument,
} from './employee-file.controller';
import {
  AddEmployeeFileNoteSchema,
  CreateEmployeeFileSchema,
  EmployeeFileDocumentParamSchema,
  EmployeeFileIdParamSchema,
  ListEmployeeFilesQuerySchema,
  RemoveEmployeeFileDocumentSchema,
  UploadEmployeeFileDocumentSchema,
} from './employee-file.validation';

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

export const buildEmployeeFilesRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('employeeFile.view'),
    validate({ query: ListEmployeeFilesQuerySchema }),
    asyncHandler(listEmployeeFiles),
  );
  router.post(
    '/',
    authenticate,
    authorize('employeeFile.create'),
    validate({ body: CreateEmployeeFileSchema }),
    asyncHandler(createEmployeeFile),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('employeeFile.view'),
    validate({ params: EmployeeFileIdParamSchema }),
    asyncHandler(getEmployeeFile),
  );
  router.post(
    '/:id/notes',
    authenticate,
    authorize('employeeFile.edit'),
    validate({ body: AddEmployeeFileNoteSchema, params: EmployeeFileIdParamSchema }),
    asyncHandler(addEmployeeFileNote),
  );
  router.post(
    '/:id/documents',
    authenticate,
    authorize('employeeFile.upload'),
    multipartSingle(),
    validate({ body: UploadEmployeeFileDocumentSchema, params: EmployeeFileIdParamSchema }),
    asyncHandler(uploadEmployeeFileDocument),
  );
  router.delete(
    '/:id/documents/:documentId',
    authenticate,
    authorize('employeeFile.upload'),
    validate({ body: RemoveEmployeeFileDocumentSchema, params: EmployeeFileDocumentParamSchema }),
    asyncHandler(removeEmployeeFileDocument),
  );

  return router;
};
