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
import {
  DeletePushSubscriptionSchema,
  PushSubscriptionInputSchema,
} from '@ecms/contracts';
import {
  getPushConfig,
  listMyPushSubscriptions,
  registerPushSubscription,
  removeMyPushSubscription,
} from './push-subscription.controller';

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

/**
 * Web Push registration — mounted at `/platform/push`.
 *
 * Self-scoped like the two routers above: a caller registers and removes their own browsers and
 * can reach nobody else's, so there is no `authorize()` step here either. `/config` is
 * authenticated for the same reason the rest is — the public key is not a secret, but there is no
 * reason for a signed-out visitor to be told whether push exists here.
 */
export const buildPushRouter = (): Router => {
  const router = Router();

  router.get('/config', authenticate, getPushConfig);
  router.get('/subscriptions', authenticate, asyncHandler(listMyPushSubscriptions));
  router.post(
    '/subscriptions',
    authenticate,
    validate({ body: PushSubscriptionInputSchema }),
    asyncHandler(registerPushSubscription),
  );
  router.delete(
    '/subscriptions',
    authenticate,
    validate({ body: DeletePushSubscriptionSchema }),
    asyncHandler(removeMyPushSubscription),
  );

  return router;
};
