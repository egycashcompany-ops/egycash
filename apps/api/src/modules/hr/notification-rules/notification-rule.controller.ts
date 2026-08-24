// Thin HTTP mapping only (ADR-003).
//
// No data scope is derived here, and that is the deliberate difference from announcements. An
// announcement is bounded by what its SENDER may see; a rule fires later, with no caller present,
// so there is no scope to apply at the moment it resolves its audience. The bound has to move to
// authoring time instead — see the routes, where writing a rule requires an organization-wide
// grant.
import { type Request, type Response } from 'express';
import {
  eventCatalogDocument,
  eventCatalogEntry,
  eventCatalogNames,
  isRuleTriggerable,
  type CreateNotificationRule,
  type EventCatalogEntry,
  type ListNotificationRulesQuery,
  type PreviewNotificationRule,
  type UpdateNotificationRule,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { announcementService } from '../announcements';
import { notificationRuleService } from './notification-rule.service';

export const createNotificationRule = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateNotificationRule>(req);
  const dto = await notificationRuleService.create(body, authContext(req).userId);
  created(res, dto, `/api/v1/hr/notification-rules/${dto.id}`);
};

export const updateNotificationRule = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<UpdateNotificationRule>(req);
  ok(res, await notificationRuleService.update(String(req.params.id), body));
};

export const deleteNotificationRule = async (req: Request, res: Response): Promise<void> => {
  await notificationRuleService.remove(String(req.params.id));
  noContent(res);
};

export const getNotificationRule = async (req: Request, res: Response): Promise<void> => {
  ok(res, await notificationRuleService.get(String(req.params.id)));
};

export const listNotificationRules = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<unknown, ListNotificationRulesQuery>(req);
  okPage(res, await notificationRuleService.list(query), (dto) => dto);
};

/** What is wrong with a rule, and who it reaches, without saving it. Same check the save runs. */
export const checkNotificationRule = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<PreviewNotificationRule>(req);
  ok(res, await notificationRuleService.check(body));
};

/**
 * The events a rule may trigger on — the picker's whole content.
 *
 * Served from HERE rather than reusing `GET /automation/events`, for two reasons that both matter.
 * That route is gated on `workflow.view` and mounted only when the automation feature flag is on,
 * so a rules author would get a 403 or a 404 depending on a flag that has nothing to do with them.
 * And it offers the WHOLE catalogue, including the notification events a rule may never use — a
 * picker that lists a choice the save will refuse is a trap with a label on it.
 *
 * A build-time constant: same code, same bytes, so the digest is an honest ETag and computing it
 * once costs nothing.
 */
const RULE_EVENTS: EventCatalogEntry[] = eventCatalogNames()
  .filter(isRuleTriggerable)
  .map((name) => eventCatalogEntry(name))
  .filter((entry): entry is EventCatalogEntry => entry !== undefined);
const RULE_EVENT_DOCUMENT = eventCatalogDocument(RULE_EVENTS);
const ETAG = `"${RULE_EVENT_DOCUMENT.digest}"`;

/**
 * The values the two free-text audience criteria actually hold — religion and nationality.
 *
 * Read at ORGANIZATION scope, unlike the announcement route's version of the same call, because a
 * rule has no sender to be bounded by: it resolves its audience later, from an event handler with
 * nobody present. Offering the author a narrower list than the rule will actually match on would
 * be the picker lying about the feature. The organization-wide grant this route requires is what
 * makes that safe (see the routes).
 */
export const getRuleAudienceOptions = async (_req: Request, res: Response): Promise<void> => {
  ok(
    res,
    await announcementService.audienceOptions({
      scope: 'organization',
      userId: '',
      branchId: null,
      departmentId: null,
      sectionId: null,
    }),
  );
};

/** The permissions a `permission` audience may name — see `RulePermissionOptionDto`. */
export const listRulePermissions = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await notificationRuleService.permissionOptions());
};

export const listRuleEvents = async (req: Request, res: Response): Promise<void> => {
  res.setHeader('ETag', ETAG);
  // It cannot change without a deploy, so a client that already has it should not be re-sent it.
  res.setHeader('Cache-Control', 'private, max-age=60');
  if (req.headers['if-none-match'] === ETAG) {
    res.status(304).end();
    return;
  }
  ok(res, RULE_EVENT_DOCUMENT);
};
