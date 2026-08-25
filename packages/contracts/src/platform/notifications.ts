import { z } from 'zod';
import { PaginationQuerySchema } from '../common/index.js';

// Notification Service contracts (Sprint 3.3 plan: docs/12-planning/sprint-3.3-plan.md).
// In-app inbox is the source of truth; email is the second required channel;
// SMS/push/WhatsApp are declared, not implemented (§1/§2 of the plan).

export const NOTIFICATION_CATEGORIES = [
  'security',
  'hr',
  'workflow',
  'approval',
  'system',
  'contracts',
  'fleet',
  'vault',
  'atm',
  'finance',
] as const;
export const NotificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;

export const NOTIFICATION_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export const NotificationPrioritySchema = z.enum(NOTIFICATION_PRIORITIES);
export type NotificationPriority = z.infer<typeof NotificationPrioritySchema>;

/**
 * Channels a template/notification may declare — one entry per built adapter.
 *
 * `push` is Web Push (VAPID): the browser's own notification, delivered to a device that is not
 * looking at ECMS. It is the same pipeline as the other two — a template names it, a recipient's
 * preference can refuse it, quiet hours defer it — and it differs from them in one way worth
 * knowing here: it can only reach a device that has REGISTERED, so a recipient with no
 * registration has no push channel at all rather than a failed one.
 */
export const NOTIFICATION_CHANNELS = ['inApp', 'email', 'push'] as const;
export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NOTIFICATION_STATUSES = [
  'queued',
  'processing',
  'sent',
  'delivered',
  'read',
  'failed',
  'cancelled',
] as const;
export const NotificationStatusSchema = z.enum(NOTIFICATION_STATUSES);
export type NotificationStatus = z.infer<typeof NotificationStatusSchema>;

export const TEMPLATE_STATUSES = ['active', 'inactive'] as const;
export const TemplateStatusSchema = z.enum(TEMPLATE_STATUSES);
export type TemplateStatus = z.infer<typeof TemplateStatusSchema>;

// ── Templates (versioned) ────────────────────────────────────────────────

const localizedBody = z.object({ ar: z.string().min(1), en: z.string().min(1) });

/** The engine's placeholder syntax, in one place — `{{name}}` and nothing else (§2b). */
const PLACEHOLDER = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
const placeholdersIn = (text: string): Set<string> =>
  new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] as string));

interface TemplateContent {
  subject?: { ar: string; en: string } | null | undefined;
  body?: { ar: string; en: string } | undefined;
  variables?: string[] | undefined;
}

/**
 * `variables` and the text have to agree, in both directions — G-2.
 *
 * The renderer is find-and-replace and nothing more, so both kinds of disagreement fail SILENTLY,
 * which is what makes this a schema rule rather than a lint:
 *
 *   • **A declared variable missing from the text** is data the message will never carry.
 *     `validateVariables` still demands it from the caller, so nothing complains — the message is
 *     simply sent without it. On `platform.credentialsDelivery` that is an activation email with no
 *     activation link: the send succeeds, and the account is stranded.
 *   • **A placeholder that is not declared** is never required of the caller, and `interpolate`
 *     leaves an unmatched placeholder as literal text — so `{{setuplink}}`, mis-cased, ships to the
 *     recipient exactly like that.
 *
 * The first check is per LANGUAGE: a variable present in `ar` but not `en` is the same silent loss
 * for every English reader. The second is over all four texts at once, since any of them can carry
 * a typo.
 *
 * The first check counts the SUBJECT as well as the body, and that is the point of it. What makes
 * a declared variable a defect is being carried by NEITHER text — not being absent from one of
 * them. A variable used only in the subject is not lost; it is the title. Requiring the body to
 * repeat it forces exactly one shape of template: `body: '{{title}}\n\n{{body}}'`, which renders
 * the title twice everywhere a notification shows a title and a body — which is what
 * `hr.announcement` shipped, and what it looked like to every recipient.
 */
const contentAgreesWithVariables = (
  content: TemplateContent,
): { ok: true } | { ok: false; message: string; path: (string | number)[] } => {
  const { body, subject, variables } = content;
  // A partial update that names neither side cannot disagree with itself; the service carries the
  // absent half forward from the previous version, and that half was checked when it was written.
  if (variables === undefined || body === undefined) return { ok: true };

  for (const language of ['ar', 'en'] as const) {
    // Either text carries it. The failure being guarded is a variable the message never says at
    // all, and a subject says it just as loudly as a body does.
    const used = new Set([
      ...placeholdersIn(body[language]),
      ...(subject === null || subject === undefined ? [] : placeholdersIn(subject[language])),
    ]);
    const absent = variables.filter((name) => !used.has(name));
    if (absent.length > 0) {
      return {
        ok: false,
        message: `neither subject.${language} nor body.${language} uses the declared variable${absent.length > 1 ? 's' : ''} ${absent.map((n) => `"${n}"`).join(', ')} — the message would be sent without it`,
        path: ['body', language],
      };
    }
  }

  const declared = new Set(variables);
  const texts: [string, string][] = [
    ['body.ar', body.ar],
    ['body.en', body.en],
    ...(subject === null || subject === undefined
      ? []
      : ([
          ['subject.ar', subject.ar],
          ['subject.en', subject.en],
        ] as [string, string][])),
  ];
  for (const [where, text] of texts) {
    const undeclared = [...placeholdersIn(text)].filter((name) => !declared.has(name));
    if (undeclared.length > 0) {
      return {
        ok: false,
        message: `${where} uses undeclared placeholder${undeclared.length > 1 ? 's' : ''} ${undeclared.map((n) => `"${n}"`).join(', ')} — it would be delivered as literal text`,
        path: where.split('.'),
      };
    }
  }
  return { ok: true };
};

/** Shared by create and update, so one rule cannot drift into two. */
const withVariableAgreement = <T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> =>
  schema.superRefine((value, ctx) => {
    const verdict = contentAgreesWithVariables(value as TemplateContent);
    if (verdict.ok) return;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: verdict.message, path: verdict.path });
  });

export const CreateNotificationTemplateSchema = withVariableAgreement(
  z
    .object({
      key: z.string().regex(/^[a-z][a-zA-Z0-9.]{1,99}$/),
      category: NotificationCategorySchema,
      priority: NotificationPrioritySchema.default('normal'),
      subject: localizedBody.nullable().default(null),
      body: localizedBody,
      channels: z.array(NotificationChannelSchema).min(1),
      variables: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)).default([]),
      defaultExpiryHours: z.number().int().min(1).max(8760).nullable().default(null),
    })
    .strict()
    .refine((v) => !v.channels.includes('email') || v.subject !== null, {
      message: 'subject is required when the email channel is declared',
      path: ['subject'],
    }),
);
export type CreateNotificationTemplate = z.infer<typeof CreateNotificationTemplateSchema>;

/**
 * Every edit creates a new version — this is the shape of that new version's content.
 *
 * The variable agreement is checked only when the request names BOTH `body` and `variables`: a
 * request that changes one of them alone is completed by the service from the previous version,
 * and the schema cannot see that half. The screen therefore submits both together, and the
 * remaining gap is closed on the server (`assertContentAgreesWithVariables`) where the merged
 * version is known.
 */
export const UpdateNotificationTemplateSchema = withVariableAgreement(
  z
    .object({
      category: NotificationCategorySchema.optional(),
      priority: NotificationPrioritySchema.optional(),
      subject: localizedBody.nullable().optional(),
      body: localizedBody.optional(),
      channels: z.array(NotificationChannelSchema).min(1).optional(),
      variables: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)).optional(),
      defaultExpiryHours: z.number().int().min(1).max(8760).nullable().optional(),
      status: TemplateStatusSchema.optional(),
    })
    .strict(),
);
export type UpdateNotificationTemplate = z.infer<typeof UpdateNotificationTemplateSchema>;

/**
 * The same rule, callable on a MERGED version — the shape the service holds after folding a partial
 * update onto the previous version. Exported so the server can apply it to what it is about to
 * store rather than to what it was sent, which is the only place the whole template is known.
 */
export const templateContentDisagreement = (content: {
  subject: { ar: string; en: string } | null;
  body: { ar: string; en: string };
  variables: string[];
}): string | null => {
  const verdict = contentAgreesWithVariables(content);
  return verdict.ok ? null : verdict.message;
};

export const ListNotificationTemplatesQuerySchema = PaginationQuerySchema.extend({
  status: TemplateStatusSchema.optional(),
  category: NotificationCategorySchema.optional(),
}).strict();
export type ListNotificationTemplatesQuery = z.infer<typeof ListNotificationTemplatesQuerySchema>;

export const PreviewNotificationTemplateSchema = z
  .object({ data: z.record(z.string(), z.string()).default({}) })
  .strict();
export type PreviewNotificationTemplate = z.infer<typeof PreviewNotificationTemplateSchema>;

export const TestSendNotificationTemplateSchema = z
  .object({
    data: z.record(z.string(), z.string()).default({}),
    channel: NotificationChannelSchema,
  })
  .strict();
export type TestSendNotificationTemplate = z.infer<typeof TestSendNotificationTemplateSchema>;

export interface NotificationTemplateDto {
  id: string;
  key: string;
  version: number;
  isLatest: boolean;
  category: NotificationCategory;
  priority: NotificationPriority;
  subject: { ar: string; en: string } | null;
  body: { ar: string; en: string };
  channels: NotificationChannel[];
  variables: string[];
  defaultExpiryHours: number | null;
  status: TemplateStatus;
  /**
   * True for a template platform code sends by key. Derived on the server from that code's own
   * constants — never stored, so it cannot drift from the list the guard enforces. The screen uses
   * it to withhold the deactivate control; the server refuses regardless.
   */
  isProtected: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface RenderedTemplateDto {
  subject: { ar: string; en: string } | null;
  body: { ar: string; en: string };
}

// ── Notifications (inbox) ────────────────────────────────────────────────

export const ListNotificationsQuerySchema = PaginationQuerySchema.extend({
  unreadOnly: z.coerce.boolean().default(false),
  entityType: z.string().max(100).optional(),
  entityId: z.string().max(100).optional(),
  category: NotificationCategorySchema.optional(),
}).strict();
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

export interface NotificationChannelStateDto {
  channel: NotificationChannel;
  status: NotificationStatus;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  error: string | null;
}

export interface NotificationDto {
  id: string;
  entityRef: { moduleId: string; entityType: string; entityId: string };
  templateKey: string;
  templateVersion: number;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: { ar: string; en: string };
  body: { ar: string; en: string };
  channels: NotificationChannelStateDto[];
  readAt: string | null;
  archivedAt: string | null;
  expiresAt: string | null;
  attachments: string[];
  createdAt: string;
}

// ── Preferences ───────────────────────────────────────────────────────────

export const UpsertNotificationPreferenceSchema = z
  .object({
    category: NotificationCategorySchema,
    channel: NotificationChannelSchema,
    enabled: z.boolean(),
  })
  .strict();
export type UpsertNotificationPreference = z.infer<typeof UpsertNotificationPreferenceSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm');
export const UpsertQuietHoursSchema = z
  .object({ enabled: z.boolean(), start: hhmm, end: hhmm })
  .strict();
export type UpsertQuietHours = z.infer<typeof UpsertQuietHoursSchema>;

export interface NotificationPreferenceDto {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface QuietHoursDto {
  enabled: boolean;
  start: string;
  end: string;
}

export interface NotificationPreferencesDto {
  preferences: NotificationPreferenceDto[];
  quietHours: QuietHoursDto;
}

// ── Web Push registration ───────────────────────────────────────────────────────────────────
//
// A registration is a BROWSER's, not a person's: one human with a laptop and a phone has two, and
// signing out does not end either — the browser keeps pushing to a subscription until it is
// removed. So the endpoint is the identity (unique across the collection), and the same endpoint
// arriving for a different user re-owns the row rather than duplicating it.

/**
 * What `PushSubscription.toJSON()` produces in the browser, which is exactly what the Web Push
 * protocol needs back: where to send, and the two keys the payload is encrypted to. The server
 * cannot read a payload it has encrypted, and neither can the push service — only the browser.
 */
export const PushSubscriptionInputSchema = z
  .object({
    endpoint: z.string().url().max(2048),
    keys: z
      .object({
        p256dh: z.string().min(1).max(255),
        auth: z.string().min(1).max(255),
      })
      .strict(),
  })
  .strict();
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInputSchema>;

export const DeletePushSubscriptionSchema = z
  .object({ endpoint: z.string().url().max(2048) })
  .strict();
export type DeletePushSubscription = z.infer<typeof DeletePushSubscriptionSchema>;

/**
 * What the browser needs before it can subscribe at all, plus whether asking is worth it.
 *
 * `enabled: false` means this deployment has no VAPID key pair configured, and the UI must say so
 * rather than offer a switch that cannot work — a browser permission prompt the user grants and
 * that then delivers nothing is worse than no switch.
 */
export interface PushConfigDto {
  enabled: boolean;
  publicKey: string | null;
}

/** One registered browser, as its owner sees it — enough to recognise and remove a device. */
export interface PushSubscriptionDto {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
}
