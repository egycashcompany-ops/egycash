// `/compliance/folders` (design §8). Reads take either page key — the responsible person's or a
// reader's — and the service then shows a reader only the folders whose list names them. Writes
// take `complianceFile.manage`, checked here and again in the service.
import { Router } from 'express';
import { z } from 'zod';
import {
  COMPLIANCE_COVER_MAX_MB,
  ComplianceVersionQuerySchema,
  CreateComplianceFolderSchema,
  ListComplianceFoldersQuerySchema,
  SetComplianceFolderCoverSchema,
  UpdateComplianceFolderSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { COMPLIANCE_MANAGE_KEY, COMPLIANCE_PAGE_KEYS } from '../shared/authority';
import { multipartUpload } from '../shared/file-intake';
import {
  createComplianceFolder,
  deleteComplianceFolder,
  getComplianceFolder,
  getComplianceFolderCover,
  listComplianceFolders,
  removeComplianceFolderCover,
  setComplianceFolderCover,
  updateComplianceFolder,
} from './folder.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();
/** `?v=` on the picture's address only says which picture; the server reads the folder's own. */
const CoverQuerySchema = z.object({ v: z.string().max(64).optional() }).strict();

export const buildComplianceFoldersRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny(...COMPLIANCE_PAGE_KEYS),
    validate({ query: ListComplianceFoldersQuerySchema }),
    asyncHandler(listComplianceFolders),
  );
  router.get(
    '/:id',
    authenticate,
    authorizeAny(...COMPLIANCE_PAGE_KEYS),
    validate({ params: IdParamSchema }),
    asyncHandler(getComplianceFolder),
  );
  router.post(
    '/',
    authenticate,
    authorize(COMPLIANCE_MANAGE_KEY),
    validate({ body: CreateComplianceFolderSchema }),
    asyncHandler(createComplianceFolder),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize(COMPLIANCE_MANAGE_KEY),
    validate({ body: UpdateComplianceFolderSchema, params: IdParamSchema }),
    asyncHandler(updateComplianceFolder),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize(COMPLIANCE_MANAGE_KEY),
    validate({ query: ComplianceVersionQuerySchema, params: IdParamSchema }),
    asyncHandler(deleteComplianceFolder),
  );
  // The picture on the folder's front. The multipart part comes first, so its text field is the
  // body the schema reads.
  router.get(
    '/:id/cover',
    authenticate,
    authorizeAny(...COMPLIANCE_PAGE_KEYS),
    validate({ query: CoverQuerySchema, params: IdParamSchema }),
    asyncHandler(getComplianceFolderCover),
  );
  router.put(
    '/:id/cover',
    authenticate,
    authorize(COMPLIANCE_MANAGE_KEY),
    multipartUpload(COMPLIANCE_COVER_MAX_MB),
    validate({ body: SetComplianceFolderCoverSchema, params: IdParamSchema }),
    asyncHandler(setComplianceFolderCover),
  );
  router.delete(
    '/:id/cover',
    authenticate,
    authorize(COMPLIANCE_MANAGE_KEY),
    validate({ query: ComplianceVersionQuerySchema, params: IdParamSchema }),
    asyncHandler(removeComplianceFolderCover),
  );
  return router;
};
