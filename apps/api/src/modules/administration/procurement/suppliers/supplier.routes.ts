// Suppliers (design §19.3): `administrationSupplier.view` reads the register, one supplier and its
// papers' bytes; `.create` and `.edit` write, and are also held to organization scope in the
// service (OD-04 A) — one supplier register for the whole company. A supplier's papers are an edit
// of it: linking or removing one takes `.edit` at organization scope too. There is no delete of a
// supplier: `isActive: false` is the deactivation (§5.3); the one DELETE removes a paper's link.
import { Router } from 'express';
import { z } from 'zod';
import {
  ADMINISTRATION_SUPPLIER_DOCUMENT_MAX_MB,
  AddAdministrationSupplierAttachmentSchema,
  AdministrationSupplierAttachmentVersionQuerySchema,
  CreateAdministrationSupplierSchema,
  ListAdministrationSuppliersQuerySchema,
  UpdateAdministrationSupplierSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { asyncHandler, validate } from '../../../../platform/web';
import { multipartUpload } from '../../shared/file-upload';
import {
  addAdministrationSupplierPaper,
  createAdministrationSupplier,
  getAdministrationSupplier,
  getAdministrationSupplierPaper,
  listAdministrationSuppliers,
  removeAdministrationSupplierPaper,
  updateAdministrationSupplier,
} from './supplier.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();
const PaperParamSchema = z.object({ id: objectId(), attachmentId: objectId() }).strict();

export const buildAdministrationSuppliersRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('administrationSupplier.view'),
    validate({ query: ListAdministrationSuppliersQuerySchema }),
    asyncHandler(listAdministrationSuppliers),
  );
  // Resolve-by-id, the other half of ADR-019 rule 5: a form holding a stored supplier id shows
  // its name, so a retired supplier answers too. The list's gate — one row of what it returns.
  router.get(
    '/:id',
    authenticate,
    authorize('administrationSupplier.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getAdministrationSupplier),
  );
  router.post(
    '/',
    authenticate,
    authorize('administrationSupplier.create'),
    validate({ body: CreateAdministrationSupplierSchema }),
    asyncHandler(createAdministrationSupplier),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('administrationSupplier.edit'),
    validate({ body: UpdateAdministrationSupplierSchema, params: IdParamSchema }),
    asyncHandler(updateAdministrationSupplier),
  );
  // The papers (OD-11 A, §11.4–§11.5). The multipart part comes first, so its text fields are the
  // body the schema reads; the category's own limit, 10 MB, is the one a user meets.
  router.post(
    '/:id/attachments',
    authenticate,
    authorize('administrationSupplier.edit'),
    multipartUpload(ADMINISTRATION_SUPPLIER_DOCUMENT_MAX_MB),
    validate({ body: AddAdministrationSupplierAttachmentSchema, params: IdParamSchema }),
    asyncHandler(addAdministrationSupplierPaper),
  );
  router.get(
    '/:id/attachments/:attachmentId',
    authenticate,
    authorize('administrationSupplier.view'),
    validate({ params: PaperParamSchema }),
    asyncHandler(getAdministrationSupplierPaper),
  );
  router.delete(
    '/:id/attachments/:attachmentId',
    authenticate,
    authorize('administrationSupplier.edit'),
    validate({
      query: AdministrationSupplierAttachmentVersionQuerySchema,
      params: PaperParamSchema,
    }),
    asyncHandler(removeAdministrationSupplierPaper),
  );
  return router;
};
