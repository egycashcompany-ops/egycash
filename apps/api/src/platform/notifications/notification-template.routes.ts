// Router: authenticate → authorize → validate → controller (mirrors file.routes.ts).
import { Router } from 'express';
import { authenticate } from '../auth';
import { authorize } from '../rbac';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import {
  createNotificationTemplate,
  deactivateNotificationTemplate,
  getNotificationTemplate,
  listNotificationTemplateVersions,
  listNotificationTemplates,
  previewNotificationTemplate,
  testSendNotificationTemplate,
  updateNotificationTemplate,
} from './notification-template.controller';
import {
  CreateNotificationTemplateSchema,
  ListNotificationTemplatesQuerySchema,
  PreviewNotificationTemplateSchema,
  TemplateIdParamSchema,
  TestSendNotificationTemplateSchema,
  UpdateNotificationTemplateSchema,
} from './notification.validation';

export const buildNotificationTemplatesRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('notificationTemplate.view'),
    validate({ query: ListNotificationTemplatesQuerySchema }),
    asyncHandler(listNotificationTemplates),
  );
  router.post(
    '/',
    authenticate,
    authorize('notificationTemplate.create'),
    validate({ body: CreateNotificationTemplateSchema }),
    asyncHandler(createNotificationTemplate),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('notificationTemplate.view'),
    validate({ params: TemplateIdParamSchema }),
    asyncHandler(getNotificationTemplate),
  );
  router.get(
    '/:id/versions',
    authenticate,
    authorize('notificationTemplate.view'),
    validate({ params: TemplateIdParamSchema }),
    asyncHandler(listNotificationTemplateVersions),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('notificationTemplate.edit'),
    validate({ body: UpdateNotificationTemplateSchema, params: TemplateIdParamSchema }),
    asyncHandler(updateNotificationTemplate),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('notificationTemplate.delete'),
    validate({ params: TemplateIdParamSchema }),
    asyncHandler(deactivateNotificationTemplate),
  );
  router.post(
    '/:id/preview',
    authenticate,
    authorize('notificationTemplate.view'),
    validate({ body: PreviewNotificationTemplateSchema, params: TemplateIdParamSchema }),
    asyncHandler(previewNotificationTemplate),
  );
  router.post(
    '/:id/test',
    authenticate,
    authorize('notificationTemplate.test'),
    validate({ body: TestSendNotificationTemplateSchema, params: TemplateIdParamSchema }),
    asyncHandler(testSendNotificationTemplate),
  );

  return router;
};
