// Router: authenticate → authorize → validate → controller.
//
// TWO PERMISSIONS, AND THE SPLIT IS THE POINT. `notificationRule.view` is an ordinary read.
// `notificationRule.manage` is the power to make the system message people on its own, repeatedly,
// with nobody present at the moment it happens — closer to granting a permission than to sending
// an announcement, and it must not be reachable by anyone who merely got the send key.
//
// AND IT IS ORGANIZATION-SCOPED, deliberately. An announcement is bounded by what its sender may
// see, because it resolves its audience while they are standing there. A rule resolves its audience
// LATER, from a background event handler with no caller, so there is nothing to bound it by at that
// moment — the entire bound has to be applied here, at authoring time. Handing this key to a branch
// manager would give them a way to reach the whole company, so the check refuses anything narrower.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  CreateNotificationRuleSchema,
  ListNotificationRulesQuerySchema,
  PreviewNotificationRuleSchema,
  UpdateNotificationRuleSchema,
  objectId,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../platform/web';
import { authContext, authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { ForbiddenError } from '../../../shared/errors';
import { scopeOf } from '../../../shared/types';
import {
  checkNotificationRule,
  createNotificationRule,
  deleteNotificationRule,
  getNotificationRule,
  getRuleAudienceOptions,
  listNotificationRules,
  listRuleEvents,
  listRulePermissions,
  updateNotificationRule,
} from './notification-rule.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

/**
 * Refuse a manage grant that is narrower than the organization.
 *
 * `authorize` says WHETHER you hold the key; this says AT WHAT REACH — and a rule has no reach
 * smaller than the whole platform, because the audience it names is resolved with no caller to
 * narrow it. A branch-scoped holder would be able to write a rule that tells everybody, which is
 * not the grant anybody thought they were making.
 *
 * Read from the GRANT (`scopeOf`) rather than through `scopeSelector`, which folds in the command
 * bar's active-branch narrowing. That narrowing is about which records a screen shows; using it
 * here would lock an organization-wide administrator out of their own rules for as long as they
 * happened to be looking at one branch.
 */
const requireOrganizationScope = (req: Request, _res: Response, next: NextFunction): void => {
  if (scopeOf(authContext(req), 'notificationRule.manage') !== 'organization') {
    next(
      new ForbiddenError(
        'Notification rules fire with no caller, so authoring one requires an organization-wide grant',
      ),
    );
    return;
  }
  next();
};

const manage = [authenticate, authorize('notificationRule.manage'), requireOrganizationScope];

export const buildNotificationRulesRouter = (): Router => {
  const router = Router();

  /**
   * Declared before `/:id` so the static segments are not read as ids.
   *
   * The catalogue is a `view` read rather than a `manage` one: the rules LIST renders event names,
   * and without their labels it would show raw dotted strings to somebody who can already see
   * which events the rules are attached to.
   */
  router.get('/events', authenticate, authorize('notificationRule.view'), asyncHandler(listRuleEvents));
  /** Only an AUTHOR needs these two; a viewer reads the stored values off the rule itself. */
  router.get('/permissions', ...manage, asyncHandler(listRulePermissions));
  router.get('/audience-options', ...manage, asyncHandler(getRuleAudienceOptions));
  router.post(
    '/check',
    ...manage,
    validate({ body: PreviewNotificationRuleSchema }),
    asyncHandler(checkNotificationRule),
  );
  router.get(
    '/',
    authenticate,
    authorize('notificationRule.view'),
    validate({ query: ListNotificationRulesQuerySchema }),
    asyncHandler(listNotificationRules),
  );
  router.post(
    '/',
    ...manage,
    validate({ body: CreateNotificationRuleSchema }),
    asyncHandler(createNotificationRule),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('notificationRule.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getNotificationRule),
  );
  router.patch(
    '/:id',
    ...manage,
    validate({ params: IdParamSchema, body: UpdateNotificationRuleSchema }),
    asyncHandler(updateNotificationRule),
  );
  router.delete(
    '/:id',
    ...manage,
    validate({ params: IdParamSchema }),
    asyncHandler(deleteNotificationRule),
  );

  return router;
};
