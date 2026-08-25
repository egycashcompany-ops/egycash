// Notification rules — "when this happens, tell these people".
//
// Stage 2 gave HR a message it writes and sends. This is the same message, sent by something that
// happened instead of by somebody clicking send: a leave request was decided, a contract expired, a
// probation ended. The parts are deliberately the ones that already exist — the platform's event
// catalogue names the triggers, the automation filter form states the conditions, and the
// announcement audience shapes say who hears about it.
import { z } from 'zod';
import { type LocalizedString } from '../common/localized.js';
import { AutomationFilterSchema } from '../platform/automation.js';
import { AnnouncementAudienceSchema } from './hr-announcement.js';

/**
 * Events a rule may NEVER trigger on.
 *
 * A rule sends a notification, and creating a notification emits `platform.notification.created`.
 * A rule on that event would answer its own notification with another one, for ever — the loop is
 * not hypothetical, it is one dropdown selection away, and it would run at machine speed against
 * every recipient the rule names.
 *
 * Refusing the whole `platform.notification.` family is the version of this guard that cannot be
 * argued with at 2am. A depth counter would also stop it, eventually, after some number of rounds
 * of real notifications on real people's phones.
 */
export const RULE_FORBIDDEN_EVENT_PREFIX = 'platform.notification.';

export const isRuleTriggerable = (eventName: string): boolean =>
  !eventName.startsWith(RULE_FORBIDDEN_EVENT_PREFIX);

/**
 * Who a rule tells.
 *
 * Three of the four shapes are the announcement's, reused whole — a rule that means "everybody in
 * Maadi" should not describe that differently from a person who means the same thing.
 *
 * The two additions are the ones only an EVENT can offer, and they are the reason this feature is
 * worth having:
 *
 *   • `subject` — the person the event is ABOUT, read out of the payload at `path`. "Their leave
 *     was approved, tell them" cannot be written as a static audience: the recipient is different
 *     every time the rule fires.
 *   • `permission` — everyone who holds a permission, at organization scope. "Tell whoever can
 *     approve this" names a responsibility rather than a list, so it stays correct when the people
 *     holding it change.
 */
export const RuleAudienceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('subject'),
      /** Dot path into the payload holding an EMPLOYEE id — from the event's own field list. */
      path: z.string().min(1).max(200),
      /** Also tell their reporting manager, when they have one. */
      includeManager: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal('permission'),
      permission: z.string().regex(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/),
    })
    .strict(),
  z.object({ kind: z.literal('everyone') }).strict(),
  z
    .object({ kind: z.literal('audience'), audience: AnnouncementAudienceSchema })
    .strict(),
]);
export type RuleAudience = z.infer<typeof RuleAudienceSchema>;

/**
 * The message, with the event's own values available as `{{placeholders}}`.
 *
 * Interpolated against the payload before delivery, so "عقد {{employeeName}} انتهى" arrives naming
 * the person. A placeholder the payload has no value for is left as literal text rather than
 * blanked — the same rule the platform's own renderer follows, and the one that makes a typo in a
 * field name visible instead of silent.
 */
const ruleText = z
  .object({ ar: z.string().trim().min(1).max(200), en: z.string().trim().min(1).max(200) })
  .strict();
const ruleBody = z
  .object({ ar: z.string().trim().min(1).max(2000), en: z.string().trim().min(1).max(2000) })
  .strict();

export const CreateNotificationRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** An event name from the platform catalogue — validated against it on the server. */
    event: z.string().min(1).max(200),
    /** Every condition must hold, in the same restricted form automation triggers already use. */
    filters: z.array(AutomationFilterSchema).max(20).default([]),
    audience: RuleAudienceSchema,
    title: ruleText,
    body: ruleBody,
    enabled: z.boolean().default(true),
  })
  .strict();
export type CreateNotificationRule = z.infer<typeof CreateNotificationRuleSchema>;

export const UpdateNotificationRuleSchema = CreateNotificationRuleSchema.partial()
  .extend({ version: z.number().int().min(0) })
  .strict();
export type UpdateNotificationRule = z.infer<typeof UpdateNotificationRuleSchema>;

export interface NotificationRuleDto {
  id: string;
  name: string;
  event: string;
  filters: { field: string; op: string; value?: unknown }[];
  audience: RuleAudience;
  title: { ar: string; en: string };
  body: { ar: string; en: string };
  enabled: boolean;
  /** How many times it has fired, and when it last did — the only way to see a rule is alive. */
  firedCount: number;
  lastFiredAt: string | null;
  createdAt: string;
  version: number;
}

/**
 * A rule checked but not saved, so the form can say what is wrong while it is being written.
 *
 * Only the three parts a check can fail on — the message and the name cannot be wrong in a way
 * this answers, and asking for them would make the form validate later than it needs to.
 */
export const PreviewNotificationRuleSchema = z
  .object({
    event: z.string().min(1).max(200),
    filters: z.array(AutomationFilterSchema).max(20).default([]),
    audience: RuleAudienceSchema,
  })
  .strict();
export type PreviewNotificationRule = z.infer<typeof PreviewNotificationRuleSchema>;

/** One reason a rule could never fire, or could never tell anybody. */
export interface NotificationRuleProblemDto {
  /** `error` blocks the save; `warning` is shown and the save proceeds. */
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

export interface NotificationRuleCheckDto {
  problems: NotificationRuleProblemDto[];
  /**
   * How many people the audience comes to right now.
   *
   * `null` for a `subject` audience, whose recipient is read out of each event's payload — there
   * is no answer until an event arrives, and a number invented here would be a guess dressed as a
   * count. `0` is a real answer, and an important one: a rule addressed to nobody looks installed
   * and does nothing.
   */
  recipients: number | null;
}

export const ListNotificationRulesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListNotificationRulesQuery = z.infer<typeof ListNotificationRulesQuerySchema>;

/**
 * A permission a rule may address, for the picker.
 *
 * Served by HR beside the event catalogue rather than read from `/platform/permissions`, which is
 * gated on `permission.view` — a key a rules author has no other reason to hold. A picker whose
 * contents the picker's user cannot fetch is an empty dropdown with no explanation.
 */
export interface RulePermissionOptionDto {
  key: string;
  name: LocalizedString;
  moduleId: string;
}

/** The template a rule's message renders through — the announcement carrier, reused. */
export { ANNOUNCEMENT_TEMPLATE_KEY as RULE_TEMPLATE_KEY } from './hr-announcement.js';
