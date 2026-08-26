// Two routers, and they are two on purpose.
//
// The PORTAL router is mounted under the one prefix the applicant's write surface declares
// (`/hr/applicant-portal`), and not one of its paths names a person — see `portal-subject.ts`.
// The STAFF router is an ordinary HR surface behind ordinary permissions, and it is the only one
// that takes an `:applicantId`.
//
// Keeping them apart is what makes the confinement gate meaningful. One router that served both
// audiences would need a branch inside every handler asking "is this caller a candidate?", and
// that branch is exactly the thing that gets forgotten in the eleventh handler.
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import multer from 'multer';
import {
  ErrorCodes,
  ListApplicantDocumentSetsQuerySchema,
  ListApplicantDocumentTypesQuerySchema,
  ReviewApplicantDocumentSchema,
  UpdateApplicantDocumentTypeSchema,
  UploadApplicantDocumentSchema,
} from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  getApplicantDocuments,
  getMyDocuments,
  listApplicantDocumentSets,
  listApplicantDocumentTypes,
  reviewApplicantDocument,
  submitMyDocument,
  updateApplicantDocumentType,
} from './applicant-document.controller';
import {
  ApplicantDocumentParamSchema,
  ApplicantDocumentTypeParamSchema,
  ApplicantParamSchema,
} from './applicant-document.validation';

/** Outer multipart cap (first-line defence); the file category's `maxSizeMb` is authoritative. */
const DOCUMENT_MAX_MB = 15;

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
        next(
          new AppError(ErrorCodes.FILE_TOO_LARGE, 422, `File exceeds the ${DOCUMENT_MAX_MB} MB cap`),
        );
        return;
      }
      next(error);
    });
  };
};

/**
 * The candidate's own surface. Mounted under `/hr/applicant-portal`.
 *
 * `authorize('applicantPortal.view')` and nothing narrower: the portal account carries exactly
 * that one permission, and what a candidate may reach is decided by the confinement surface plus
 * the session subject, not by minting a second key that would grant the same thing twice.
 */
export const buildApplicantPortalDocumentsRouter = (): Router => {
  const router = Router();

  router.get(
    '/documents',
    authenticate,
    authorize('applicantPortal.view'),
    asyncHandler(getMyDocuments),
  );
  // One route for the first upload AND the replacement — from where the candidate stands they are
  // the same act, and which write runs is the slot's business, not the URL's.
  router.post(
    '/documents',
    authenticate,
    authorize('applicantPortal.view'),
    multipartSingle(),
    validate({ body: UploadApplicantDocumentSchema }),
    asyncHandler(submitMyDocument),
  );

  return router;
};

/** HR's surface. Mounted under `/hr/applicant-documents`. */
export const buildApplicantDocumentsRouter = (): Router => {
  const router = Router();

  router.get(
    '/types',
    authenticate,
    authorize('applicantDocument.view'),
    validate({ query: ListApplicantDocumentTypesQuerySchema }),
    asyncHandler(listApplicantDocumentTypes),
  );
  router.patch(
    '/types/:id',
    authenticate,
    authorize('applicantDocumentType.manage'),
    validate({ body: UpdateApplicantDocumentTypeSchema, params: ApplicantDocumentTypeParamSchema }),
    asyncHandler(updateApplicantDocumentType),
  );
  router.get(
    '/',
    authenticate,
    authorize('applicantDocument.view'),
    validate({ query: ListApplicantDocumentSetsQuerySchema }),
    asyncHandler(listApplicantDocumentSets),
  );
  router.get(
    '/:applicantId',
    authenticate,
    authorize('applicantDocument.view'),
    validate({ params: ApplicantParamSchema }),
    asyncHandler(getApplicantDocuments),
  );
  router.post(
    '/:applicantId/documents/:typeId/review',
    authenticate,
    authorize('applicantDocument.review'),
    validate({ body: ReviewApplicantDocumentSchema, params: ApplicantDocumentParamSchema }),
    asyncHandler(reviewApplicantDocument),
  );

  return router;
};
