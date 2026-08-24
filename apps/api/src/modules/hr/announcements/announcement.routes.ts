// Router: authenticate → authorize → validate → controller.
//
// `announcement.send` is its own permission rather than a reuse of an employee one. Reading the
// registry and MESSAGING everybody in it are different powers: plenty of people may legitimately
// list employees, and very few should be able to put a notification on all their screens at once.
// The audience is still bounded by `employee.view`'s scope (see the controller) — this key decides
// whether you may announce at all, that scope decides how far.
import { Router } from 'express';
import {
  CreateAnnouncementSchema,
  ListAnnouncementsQuerySchema,
  PreviewAnnouncementAudienceSchema,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../platform/web';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import {
  getAudienceOptions,
  listAnnouncements,
  previewAnnouncementAudience,
  sendAnnouncement,
} from './announcement.controller';

export const buildAnnouncementsRouter = (): Router => {
  const router = Router();

  /**
   * Preview is a POST because it carries an audience, and it needs the SEND permission rather
   * than the view one: resolving an audience is a query over the employee registry that returns
   * counts and names, so anyone who can run it can enumerate the company a filter at a time.
   */
  /** Declared before `/` so the static segment is not read as a list query. */
  router.get('/audience-options', authenticate, authorize('announcement.send'), asyncHandler(getAudienceOptions));
  router.post(
    '/preview',
    authenticate,
    authorize('announcement.send'),
    validate({ body: PreviewAnnouncementAudienceSchema }),
    asyncHandler(previewAnnouncementAudience),
  );
  router.post(
    '/',
    authenticate,
    authorize('announcement.send'),
    validate({ body: CreateAnnouncementSchema }),
    asyncHandler(sendAnnouncement),
  );
  router.get(
    '/',
    authenticate,
    authorize('announcement.view'),
    validate({ query: ListAnnouncementsQuerySchema }),
    asyncHandler(listAnnouncements),
  );

  return router;
};
