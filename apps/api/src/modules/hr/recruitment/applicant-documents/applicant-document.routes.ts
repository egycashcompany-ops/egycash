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
  BulkDeleteApplicantFoldersSchema,
  ErrorCodes,
  ListApplicantDocumentSetsQuerySchema,
  ListApplicantFoldersQuerySchema,
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
  bulkDeleteApplicantFolders,
  deleteApplicantFolder,
  getApplicantDocuments,
  getMyDocuments,
  getMyStatus,
  listApplicantDocumentSets,
  listApplicantFolders,
  getApplicantFolder,
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
          new AppError(
            ErrorCodes.FILE_TOO_LARGE,
            422,
            `File exceeds the ${DOCUMENT_MAX_MB} MB cap`,
          ),
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

  router.get('/status', authenticate, authorize('applicantPortal.view'), asyncHandler(getMyStatus));
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
  // The folders view: everything kept for each applicant — their National-ID card (front, back,
  // face), HR's attachments and what they handed in. Before `/:applicantId`, which would
  // otherwise read «folders» as an id.
  router.get(
    '/folders',
    authenticate,
    authorize('applicantDocument.view'),
    validate({ query: ListApplicantFoldersQuerySchema }),
    asyncHandler(listApplicantFolders),
  );
  // Emptying folders. `/folders/bulk-delete` is a POST and `/folders/:applicantId` a DELETE, so
  // neither path can read the other's segment as an id — but the bulk route is declared first
  // anyway, because the next person to add a verb here will copy whatever is at the top.
  //
  // `applicantDocument.delete`, not `.review`: ruling on a document and emptying somebody's file
  // are different acts. A folder belonging to a hired applicant — or to one who is about to be —
  // is refused here by the service, whatever key the caller holds.
  router.post(
    '/folders/bulk-delete',
    authenticate,
    authorize('applicantDocument.delete'),
    validate({ body: BulkDeleteApplicantFoldersSchema }),
    asyncHandler(bulkDeleteApplicantFolders),
  );
  router.get(
    '/folders/:applicantId',
    authenticate,
    authorize('applicantDocument.view'),
    validate({ params: ApplicantParamSchema }),
    asyncHandler(getApplicantFolder),
  );
  router.delete(
    '/folders/:applicantId',
    authenticate,
    authorize('applicantDocument.delete'),
    validate({ params: ApplicantParamSchema }),
    asyncHandler(deleteApplicantFolder),
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
