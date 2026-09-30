import { Router } from 'express';
import { z } from 'zod';
import {
  CreateFleetNoticeSchema,
  ListFleetNoticesQuerySchema,
  UpdateFleetNoticeSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createNotice,
  deleteNotice,
  getNotice,
  listNotices,
  updateNotice,
} from './notice.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetNoticesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('fleetNotice.view'),
    validate({ query: ListFleetNoticesQuerySchema }),
    asyncHandler(listNotices),
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
  return router;
};
