// The files inside a folder (design §8). Two prefixes, one router each: a folder's list and its
// upload live under `/compliance/folders/:id/documents`; one file's own acts under
// `/compliance/documents/:id`. Reads take either page key and then ask the folder's list; writes
// and the seen report take `complianceFile.manage`.
import { Router } from 'express';
import { z } from 'zod';
import {
  AddComplianceDocumentSchema,
  COMPLIANCE_DOCUMENT_MAX_MB,
  ComplianceContentQuerySchema,
  ComplianceVersionQuerySchema,
  ListComplianceDocumentsQuerySchema,
  RenameComplianceDocumentSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { COMPLIANCE_MANAGE_KEY, COMPLIANCE_PAGE_KEYS } from '../shared/authority';
import { multipartUpload } from '../shared/file-intake';
import {
  addComplianceDocument,
  deleteComplianceDocument,
  getComplianceDocumentContent,
  getComplianceDocumentPreview,
  getComplianceSeenReport,
  listComplianceDocuments,
  renameComplianceDocument,
} from './document.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

/** `/compliance/folders/:id/documents` — mounted beside the folders router, under its prefix. */
export const buildComplianceFolderDocumentsRouter = (): Router => {
  const router = Router();
  router.get(
    '/:id/documents',
    authenticate,
    authorizeAny(...COMPLIANCE_PAGE_KEYS),
    validate({ query: ListComplianceDocumentsQuerySchema, params: IdParamSchema }),
    asyncHandler(listComplianceDocuments),
  );
  // The multipart part comes first, so its text field is the body the schema reads; the
  // category's own limit, 20 MB, is the one a person meets.
  router.post(
    '/:id/documents',
    authenticate,
    authorize(COMPLIANCE_MANAGE_KEY),
    multipartUpload(COMPLIANCE_DOCUMENT_MAX_MB),
    validate({ body: AddComplianceDocumentSchema, params: IdParamSchema }),
    asyncHandler(addComplianceDocument),
  );
  return router;
};

/** `/compliance/documents/:id` — one file: its bytes, its preview, its name, its removal, its report. */
export const buildComplianceDocumentsRouter = (): Router => {
  const router = Router();
  router.get(
    '/:id/content',
    authenticate,
    authorizeAny(...COMPLIANCE_PAGE_KEYS),
    validate({ query: ComplianceContentQuerySchema, params: IdParamSchema }),
    asyncHandler(getComplianceDocumentContent),
  );
  router.get(
    '/:id/preview',
    authenticate,
    authorizeAny(...COMPLIANCE_PAGE_KEYS),
    validate({ params: IdParamSchema }),
    asyncHandler(getComplianceDocumentPreview),
  );
  router.get(
    '/:id/views',
    authenticate,
    authorize(COMPLIANCE_MANAGE_KEY),
    validate({ params: IdParamSchema }),
    asyncHandler(getComplianceSeenReport),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize(COMPLIANCE_MANAGE_KEY),
    validate({ body: RenameComplianceDocumentSchema, params: IdParamSchema }),
    asyncHandler(renameComplianceDocument),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize(COMPLIANCE_MANAGE_KEY),
    validate({ query: ComplianceVersionQuerySchema, params: IdParamSchema }),
    asyncHandler(deleteComplianceDocument),
  );
  return router;
};
