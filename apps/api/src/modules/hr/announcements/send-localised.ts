// Sending a HUMAN-WRITTEN bilingual message through the notification pipeline.
//
// Shared by the two things that do it — an announcement somebody sends, and a rule that fires —
// because they must not answer the language question differently. One of them getting it wrong
// means an English reader receiving Arabic, which is exactly the kind of defect that survives
// review: it looks right to whoever wrote it.
//
// WHY IT IS NOT ONE `notify()` CALL. A template renders one `data` map into BOTH languages, and
// the platform requires every declared variable to appear in both language bodies — so the
// carrier template cannot hold a per-language variable, and a single call would give everybody
// whichever half it was passed.
//
// So the split lives here: recipients are grouped by the language they read, and each group is
// addressed its own copy. The cost is worth naming — a person's stored notification carries the
// text they were addressed in on both language fields, so switching languages afterwards does not
// retranslate it. These are a human's words, not a rendered template; there is no other copy.
import { type EntityRef } from '@ecms/contracts';
import { notificationsService } from '../../../platform/notifications';
import { userService } from '../../../platform/users';

export interface LocalisedMessage {
  template: string;
  userIds: readonly string[];
  title: { ar: string; en: string };
  body: { ar: string; en: string };
  entityRef: EntityRef;
  /** Unique per recipient, so the same key across the two language groups cannot collide. */
  idempotencyKey?: string;
}

/**
 * Group recipients by the language they read.
 *
 * An account the read did not return keeps the platform default rather than being dropped: a
 * missing row must never cost somebody the message.
 */
export const groupByLocale = (
  userIds: readonly string[],
  locales: ReadonlyMap<string, 'ar' | 'en'>,
): Record<'ar' | 'en', string[]> => {
  const groups: Record<'ar' | 'en', string[]> = { ar: [], en: [] };
  for (const userId of userIds) groups[locales.get(userId) ?? 'ar'].push(userId);
  return groups;
};

/** Send, once per reading language. Returns how many people were addressed in total. */
export const sendLocalisedMessage = async (message: LocalisedMessage): Promise<number> => {
  const userIds = [...new Set(message.userIds)];
  if (userIds.length === 0) return 0;

  const locales = await userService.localesAmong(userIds);
  const groups = groupByLocale(userIds, locales);

  for (const language of ['ar', 'en'] as const) {
    const group = groups[language];
    if (group.length === 0) continue;
    await notificationsService.notify(
      {
        template: message.template,
        to: { userIds: group },
        data: { title: message.title[language], body: message.body[language] },
        entityRef: message.entityRef,
      },
      message.idempotencyKey === undefined ? {} : { idempotencyKey: message.idempotencyKey },
    );
  }
  return userIds.length;
};
