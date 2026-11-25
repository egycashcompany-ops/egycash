// Purchase requests (P2 plan §4.1): `administrationPurchaseRequest.view` reads the register;
// `.view` or `.approve` reads one request, each with its own scope, so an approver who holds the
// approve key alone opens what they decide (design §5.1.4); `.create` raises a draft and `.edit`
// edits one — the requester's own, checked in the service, since the gate here knows the key and
// not the request. There is no delete of a request: it ends in a terminal status; the one DELETE
// removes a file's link (P2.6). Submission, decisions, returns and cancels join with their slices
// (P2.3 to P2.5).
import { Router } from 'express';
import { z } from 'zod';
import {
  ADMINISTRATION_REQUEST_ATTACHMENT_MAX_MB,
  AddAdministrationPurchaseRequestAttachmentSchema,
  AdministrationPurchaseRequestAttachmentVersionQuerySchema,
  CreateAdministrationPurchaseRequestSchema,
  ListAdministrationPurchaseRequestsQuerySchema,
  UpdateAdministrationPurchaseRequestSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../../platform/auth';
import { authorize, authorizeAny } from '../../../../platform/rbac';
import { asyncHandler, validate } from '../../../../platform/web';
import { multipartUpload } from '../../shared/file-upload';
import {
  addAdministrationPurchaseRequestAttachment,
  createAdministrationPurchaseRequest,
  getAdministrationPurchaseRequestAttachment,
  getAdministrationPurchaseRequest,
  listAdministrationPurchaseRequests,
  removeAdministrationPurchaseRequestAttachment,
  updateAdministrationPurchaseRequest,
} from './purchase-request.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();
const AttachmentParamSchema = z.object({ id: objectId(), attachmentId: objectId() }).strict();

export const buildAdministrationPurchaseRequestsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('administrationPurchaseRequest.view'),
    validate({ query: ListAdministrationPurchaseRequestsQuerySchema }),
    asyncHandler(listAdministrationPurchaseRequests),
  );
  router.get(
    '/:id',
    authenticate,
    authorizeAny('administrationPurchaseRequest.view', 'administrationPurchaseRequest.approve'),
    validate({ params: IdParamSchema }),
    asyncHandler(getAdministrationPurchaseRequest),
  );
  router.post(
    '/',
    authenticate,
    authorize('administrationPurchaseRequest.create'),
    validate({ body: CreateAdministrationPurchaseRequestSchema }),
    asyncHandler(createAdministrationPurchaseRequest),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('administrationPurchaseRequest.edit'),
    validate({ body: UpdateAdministrationPurchaseRequestSchema, params: IdParamSchema }),
    asyncHandler(updateAdministrationPurchaseRequest),
  );
  // A request's files (P2 plan §4.3; P2.6). A write takes either key of the acts that make the
  // draft, and is the requester's own on a draft — checked in the service, which knows the
  // request; a read is the record's, an approver's included. The multipart part comes first, so
  // its text fields are the body the schema reads; the category's own limit, 10 MB, is the one a
  // requester meets.
  router.post(
    '/:id/attachments',
    authenticate,
    authorizeAny('administrationPurchaseRequest.create', 'administrationPurchaseRequest.edit'),
    multipartUpload(ADMINISTRATION_REQUEST_ATTACHMENT_MAX_MB),
    validate({ body: AddAdministrationPurchaseRequestAttachmentSchema, params: IdParamSchema }),
    asyncHandler(addAdministrationPurchaseRequestAttachment),
  );
  router.get(
    '/:id/attachments/:attachmentId',
    authenticate,
    authorizeAny('administrationPurchaseRequest.view', 'administrationPurchaseRequest.approve'),
    validate({ params: AttachmentParamSchema }),
    asyncHandler(getAdministrationPurchaseRequestAttachment),
  );
  // The one DELETE removes a file's link, never a request (P2 plan §4.1).
  router.delete(
    '/:id/attachments/:attachmentId',
    authenticate,
    authorizeAny('administrationPurchaseRequest.create', 'administrationPurchaseRequest.edit'),
    validate({
      query: AdministrationPurchaseRequestAttachmentVersionQuerySchema,
      params: AttachmentParamSchema,
    }),
    asyncHandler(removeAdministrationPurchaseRequestAttachment),
  );
  return router;
};
