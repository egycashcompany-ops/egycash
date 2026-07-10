// Router: authenticate → authorize → (multer) → validate → controller. Mounted by the
// HR manifest under /api/v1/hr. Uses the platform web kit for validate/asyncHandler so
// the module never imports infrastructure directly (Module Structure §1).
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
  addApplicantAttachment,
  bulkApplicants,
  confirmApplicantIdentity,
  createApplicantSource,
  exportApplicants,
  getApplicant,
  listApplicantAttachments,
  listApplicantSources,
  listApplicants,
  ocrExtractNationalId,
  registerApplicant,
  removeApplicantAttachment,
  updateApplicant,
  updateApplicantSource,
  withdrawApplicant,
} from './applicant.controller';
import {
  AddApplicantAttachmentSchema,
  ApplicantAttachmentParamSchema,
  ApplicantIdParamSchema,
  ApplicantSourceIdParamSchema,
  BulkApplicantsSchema,
  ConfirmApplicantIdentitySchema,
  CreateApplicantSourceSchema,
  ExportApplicantsQuerySchema,
  ListApplicantSourcesQuerySchema,
  ListApplicantsQuerySchema,
  OcrExtractNationalIdSchema,
  RegisterApplicantSchema,
  UpdateApplicantSchema,
  UpdateApplicantSourceSchema,
  WithdrawApplicantSchema,
} from './applicant.validation';

/** Outer multipart cap (first-line defence); the file category's `maxSizeMb` is authoritative. */
const ATTACHMENT_MAX_MB = 50;

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

export const buildApplicantsRouter = (): Router => {
  const router = Router();

  // Static segments before '/:id'.
  router.post(
    '/ocr/national-id',
    authenticate,
    authorize('applicant.create'),
    validate({ body: OcrExtractNationalIdSchema }),
    asyncHandler(ocrExtractNationalId),
  );
  router.get(
    '/export',
    authenticate,
    authorize('applicant.export'),
    validate({ query: ExportApplicantsQuerySchema }),
    asyncHandler(exportApplicants),
  );
  router.post(
    '/bulk',
    authenticate,
    authorize('applicant.edit'),
    validate({ body: BulkApplicantsSchema }),
    asyncHandler(bulkApplicants),
  );

  router.get(
    '/',
    authenticate,
    authorize('applicant.view'),
    validate({ query: ListApplicantsQuerySchema }),
    asyncHandler(listApplicants),
  );
  router.post(
    '/',
    authenticate,
    authorize('applicant.create'),
    validate({ body: RegisterApplicantSchema }),
    asyncHandler(registerApplicant),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('applicant.view'),
    validate({ params: ApplicantIdParamSchema }),
    asyncHandler(getApplicant),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('applicant.edit'),
    validate({ body: UpdateApplicantSchema, params: ApplicantIdParamSchema }),
    asyncHandler(updateApplicant),
  );
  router.post(
    '/:id/verify-identity',
    authenticate,
    authorize('applicant.verifyIdentity'),
    validate({ body: ConfirmApplicantIdentitySchema, params: ApplicantIdParamSchema }),
    asyncHandler(confirmApplicantIdentity),
  );
  router.post(
    '/:id/withdraw',
    authenticate,
    authorize('applicant.edit'),
    validate({ body: WithdrawApplicantSchema, params: ApplicantIdParamSchema }),
    asyncHandler(withdrawApplicant),
  );

  // Attachments (bytes via the platform Files service).
  router.get(
    '/:id/attachments',
    authenticate,
    authorize('applicant.view'),
    validate({ params: ApplicantIdParamSchema }),
    asyncHandler(listApplicantAttachments),
  );
  router.post(
    '/:id/attachments',
    authenticate,
    authorize('applicant.edit'),
    multipartSingle(),
    validate({ body: AddApplicantAttachmentSchema, params: ApplicantIdParamSchema }),
    asyncHandler(addApplicantAttachment),
  );
  router.delete(
    '/:id/attachments/:fileId',
    authenticate,
    authorize('applicant.edit'),
    validate({ params: ApplicantAttachmentParamSchema }),
    asyncHandler(removeApplicantAttachment),
  );

  return router;
};

export const buildApplicantSourcesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('applicant.view'),
    validate({ query: ListApplicantSourcesQuerySchema }),
    asyncHandler(listApplicantSources),
  );
  router.post(
    '/',
    authenticate,
    authorize('applicantSource.manage'),
    validate({ body: CreateApplicantSourceSchema }),
    asyncHandler(createApplicantSource),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('applicantSource.manage'),
    validate({ body: UpdateApplicantSourceSchema, params: ApplicantSourceIdParamSchema }),
    asyncHandler(updateApplicantSource),
  );
  return router;
};
