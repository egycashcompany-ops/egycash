// The notification-rule endpoints, typed from the contracts.
import {
  type AudienceOptionsDto,
  type CreateNotificationRule,
  type EventCatalogDocument,
  type ListNotificationRulesQuery,
  type NotificationRuleCheckDto,
  type NotificationRuleDto,
  type Paginated,
  type PreviewNotificationRule,
  type RulePermissionOptionDto,
  type UpdateNotificationRule,
} from '@ecms/contracts';
import { buildQuery, del, get, getPage, patch, post } from '../../../../shared/lib/api-client';

const BASE = '/hr/notification-rules';

/**
 * The events a rule may trigger on, with their declared fields.
 *
 * Served by HR rather than by automation, so the picker does not depend on the automation feature
 * flag and cannot offer an event the save would refuse.
 */
export const listRuleEvents = (): Promise<EventCatalogDocument> =>
  get<EventCatalogDocument>(`${BASE}/events`);

/**
 * Religion and nationality values, read at organization scope.
 *
 * Its own endpoint rather than the announcements one: that is gated on `announcement.send`, which
 * a rules author has no reason to hold, and it narrows the list to the CALLER's scope — while a
 * rule matches organization-wide whoever wrote it.
 */
export const getRuleAudienceOptions = (): Promise<AudienceOptionsDto> =>
  get<AudienceOptionsDto>(`${BASE}/audience-options`);

/** The permissions a `permission` audience may name. Served by HR so an author can reach it. */
export const listRulePermissions = (): Promise<RulePermissionOptionDto[]> =>
  get<RulePermissionOptionDto[]>(`${BASE}/permissions`);

export const listNotificationRules = (
  query: Pick<ListNotificationRulesQuery, 'page' | 'pageSize'>,
): Promise<Paginated<NotificationRuleDto>> =>
  getPage<NotificationRuleDto>(`${BASE}${buildQuery({ ...query })}`);

/** What is wrong with a rule, without saving it — the same check the save runs. */
export const checkNotificationRule = (
  rule: PreviewNotificationRule,
): Promise<NotificationRuleCheckDto> => post<NotificationRuleCheckDto>(`${BASE}/check`, rule);

export const createNotificationRule = (
  input: CreateNotificationRule,
): Promise<NotificationRuleDto> => post<NotificationRuleDto>(BASE, input);

export const updateNotificationRule = (
  id: string,
  input: UpdateNotificationRule,
): Promise<NotificationRuleDto> => patch<NotificationRuleDto>(`${BASE}/${id}`, input);

export const deleteNotificationRule = (id: string): Promise<void> => del<void>(`${BASE}/${id}`);
