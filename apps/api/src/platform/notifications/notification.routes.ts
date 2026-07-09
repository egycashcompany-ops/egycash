// Router: authenticate → validate → controller. Self-scoped inbox and preferences —
// no `authorize()` step anywhere here (plan §5: identity ownership, not RBAC).
import { Router } from 'express';
import { authenticate } from '../auth';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import {
  archiveNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from './notification.controller';
import {
  getMyNotificationPreferences,
  upsertMyNotificationPreference,
  upsertMyQuietHours,
} from './notification-preference.controller';
import {
  ListNotificationsQuerySchema,
  NotificationIdParamSchema,
  UpsertNotificationPreferenceSchema,
  UpsertQuietHoursSchema,
} from './notification.validation';

export const buildNotificationsRouter = (): Router => {
  const router = Router();

  // Static segments declared before '/:id' so they aren't swallowed as a param.
  router.get(
    '/unread-count',
    authenticate,
    asyncHandler(unreadNotificationCount),
  );
  router.post('/read-all', authenticate, asyncHandler(markAllNotificationsRead));

  router.get(
    '/',
    authenticate,
    validate({ query: ListNotificationsQuerySchema }),
    asyncHandler(listNotifications),
  );
  router.post(
    '/:id/read',
    authenticate,
    validate({ params: NotificationIdParamSchema }),
    asyncHandler(markNotificationRead),
  );
  router.delete(
    '/:id',
    authenticate,
    validate({ params: NotificationIdParamSchema }),
    asyncHandler(archiveNotification),
  );

  return router;
};

export const buildNotificationPreferencesRouter = (): Router => {
  const router = Router();

  router.get('/', authenticate, asyncHandler(getMyNotificationPreferences));
  router.put(
    '/',
    authenticate,
    validate({ body: UpsertNotificationPreferenceSchema }),
    asyncHandler(upsertMyNotificationPreference),
  );
  router.put(
    '/quiet-hours',
    authenticate,
    validate({ body: UpsertQuietHoursSchema }),
    asyncHandler(upsertMyQuietHours),
  );

  return router;
};
