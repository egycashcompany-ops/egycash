import { Router } from 'express';
import { z } from 'zod';
import {
  CreateFleetNoticeSchema,
  FleetNoticeImageKindSchema,
  FleetNoticeTemplateSchema,
  FleetNoticesSummaryQuerySchema,
  ListFleetNoticesQuerySchema,
  SaveFleetNoticeSettingsSchema,
  SetFleetNoticeDoneSchema,
  UpdateFleetNoticeSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { multipartSingle } from '../license-image-upload';
import {
  createNotice,
  deleteNotice,
  deleteNoticeImage,
  getNotice,
  getNoticeImage,
  getNoticeSettings,
  listNotices,
  noticesSummary,
  saveNoticeSettings,
  setNoticeDone,
  updateNotice,
  uploadNoticeImage,
} from './notice.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();
const ImageParamSchema = z.object({ id: objectId(), kind: FleetNoticeImageKindSchema }).strict();
const TemplateParamSchema = z.object({ template: FleetNoticeTemplateSchema }).strict();

export const buildFleetNoticesRouter = (): Router => {
  const router = Router();
  // A form's set-up («إعداد النماذج») — read by whoever fills notices, written by whoever may edit.
  router.get(
    '/settings/:template',
    authenticate,
    authorize('fleetNotice.view'),
    validate({ params: TemplateParamSchema }),
    asyncHandler(getNoticeSettings),
  );
  router.put(
    '/settings/:template',
    authenticate,
    authorize('fleetNotice.edit'),
    validate({ body: SaveFleetNoticeSettingsSchema, params: TemplateParamSchema }),
    asyncHandler(saveNoticeSettings),
  );
  router.get(
    '/',
    authenticate,
    authorize('fleetNotice.view'),
    validate({ query: ListFleetNoticesQuerySchema }),
    asyncHandler(listNotices),
  );
  // «الإحصائيات» — before `/:id`, which would otherwise read `summary` as an id.
  router.get(
    '/summary',
    authenticate,
    authorize('fleetNotice.view'),
    validate({ query: FleetNoticesSummaryQuerySchema }),
    asyncHandler(noticesSummary),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('fleetNotice.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getNotice),
  );
  router.post(
    '/',
    authenticate,
    authorize('fleetNotice.create'),
    validate({ body: CreateFleetNoticeSchema }),
    asyncHandler(createNotice),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetNotice.edit'),
    validate({ body: UpdateFleetNoticeSchema, params: IdParamSchema }),
    asyncHandler(updateNotice),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('fleetNotice.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteNotice),
  );
  // «✓» — closing needs the cheque scan; the service says so when it is missing.
  router.post(
    '/:id/done',
    authenticate,
    authorize('fleetNotice.edit'),
    validate({ body: SetFleetNoticeDoneSchema, params: IdParamSchema }),
    asyncHandler(setNoticeDone),
  );
  // The two scans — the signed paper (`notice`) and the cheque (`check`).
  router.get(
    '/:id/images/:kind',
    authenticate,
    authorize('fleetNotice.view'),
    validate({ params: ImageParamSchema }),
    asyncHandler(getNoticeImage),
  );
  router.post(
    '/:id/images/:kind',
    authenticate,
    authorize('fleetNotice.edit'),
    multipartSingle(),
    validate({ params: ImageParamSchema }),
    asyncHandler(uploadNoticeImage),
  );
  router.delete(
    '/:id/images/:kind',
    authenticate,
    authorize('fleetNotice.edit'),
    validate({ params: ImageParamSchema }),
    asyncHandler(deleteNoticeImage),
  );
  return router;
};
