// The one template every announcement renders through.
//
// WHY A TEMPLATE AT ALL, when the sender writes the whole message. Because a template is what
// `notify()` takes, and going through one buys the entire delivery apparatus for free: the
// channels a recipient accepts, their opt-outs, quiet hours, both languages, the queue, the
// retries, the audit trail, and — as of the push channel — their registered devices. The
// alternative is a second delivery path that has to re-learn all of it and will get one of them
// wrong.
//
// So the template is a CARRIER, not wording: its body is the four variables and nothing else. The
// sender's own text is the message, and an administrator editing this template can change how an
// announcement is framed without touching a line of code — the same latitude every other template
// in the catalogue has.
//
// The `hr` category and a normal priority put an announcement under the preference toggle a person
// would expect, and keep it out of the one that bypasses quiet hours: `critical` is what wakes a
// sleeping phone, and it is deliberately not offered to a sender — a company notice is not a
// security alert, however urgent it feels at 11pm.
import { ANNOUNCEMENT_TEMPLATE_KEY, type CreateNotificationTemplate } from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { notificationTemplateService } from '../../../platform/notifications';

/**
 * The body this template shipped with, which rendered the title a second time.
 *
 * Matched EXACTLY, and only then replaced. `ensure()` deliberately never overwrites — the template
 * is administrator-editable, and a seed that reasserted itself every boot would quietly undo
 * somebody's wording. So the repair is narrow: a deployment still carrying the original text gets
 * the fix, and a deployment whose text somebody has since changed is left alone, duplicate or not.
 * That is their sentence to keep.
 */
const DUPLICATED_TITLE_BODY = '{{title}}\n\n{{body}}';

/**
 * Repair a deployment seeded before the duplicate was fixed.
 *
 * Runs after `ensure`, publishing a NEW VERSION rather than mutating the current one — the
 * template catalogue's own rule, and what keeps the change visible in the version history instead
 * of appearing to have always been that way.
 */
const repair = async (): Promise<void> => {
  // Re-read rather than trusting what `ensure` handed back. `bootPlatform` runs module seeds in
  // BOTH the api and the worker, and they boot at the same time — so by the time this runs, the
  // other process may already have published the repair. Acting on a doc fetched before that would
  // publish a second, identical version and put a phantom edit in a history people actually read.
  const current = await notificationTemplateService.findLatest(ANNOUNCEMENT_TEMPLATE_KEY);
  if (current === null) return;
  if (current.body.ar !== DUPLICATED_TITLE_BODY || current.body.en !== DUPLICATED_TITLE_BODY) {
    return;
  }

  // AND the subject must still be the one that makes the new body legal.
  //
  // Dropping `{{title}}` from the body only works because the SUBJECT says it instead. An
  // administrator who reworded the subject to a fixed line — a supported edit the template screen
  // accepts — leaves `title` declared and carried by neither text, which `update()` refuses. That
  // refusal is correct; making it here, during a boot seed, is not.
  const subject = current.subject;
  if (subject === null || !subject.ar.includes('{{title}}') || !subject.en.includes('{{title}}')) {
    logger.info(
      { template: ANNOUNCEMENT_TEMPLATE_KEY },
      'announcement template: subject was rewritten, leaving the body as its author left it',
    );
    return;
  }

  await notificationTemplateService.update(
    String(current._id),
    { body: { ar: '{{body}}', en: '{{body}}' } },
    null,
  );
  logger.info(
    { template: ANNOUNCEMENT_TEMPLATE_KEY },
    'announcement template: title no longer repeated in the body',
  );
};

/**
 * The repair, which may never take the platform down.
 *
 * It runs inside `bootPlatform`, where a throw travels through the module seed loop to
 * `main().catch` and `process.exit(1)` — in the api AND the worker, on every boot, with the
 * database unchanged so the next boot dies identically. Nothing between here and there catches.
 *
 * The guard above should mean it never throws. This is the second answer to that: a duplicated
 * word in a notification is a cosmetic defect, and no cosmetic defect is worth a chance of a
 * platform that will not start. If it fails, it says so and boot continues.
 */
const repairDuplicatedTitle = async (): Promise<void> => {
  try {
    await repair();
  } catch (error) {
    logger.error(
      { template: ANNOUNCEMENT_TEMPLATE_KEY, error },
      'announcement template repair failed — leaving the template as it is and continuing boot',
    );
  }
};

/**
 * The template, as ONE definition.
 *
 * Exported because `announcement-template.spec` validates it against the very schema that judges
 * it at boot — and it used to do that against its own copy of these fields. The copy went stale
 * the moment this changed, so the spec passed while checking a template nobody sends. One object,
 * imported by both.
 */
export const ANNOUNCEMENT_TEMPLATE: CreateNotificationTemplate = {
  key: ANNOUNCEMENT_TEMPLATE_KEY,
  category: 'hr',
  priority: 'normal',
  // The title belongs to the SUBJECT and the body to the body — each said once.
  //
  // It used to read `body: '{{title}}\n\n{{body}}'`, because `contentAgreesWithVariables`
  // demanded every declared variable appear in the body and `title` had nowhere else to satisfy
  // it. The cost was visible to every recipient: a notification renders its title and its body,
  // so the title appeared twice, in every announcement, on every screen. The rule now counts the
  // subject too — a variable the subject carries is not one the message loses.
  //
  // The four-variable shape this started as still cannot work: `body.ar` would use `{{bodyAr}}`
  // and never `{{bodyEn}}`, which the rule reads — correctly — as the Arabic version dropping a
  // value. So the language split stays OUT of the template and in the send (`send-localised`).
  subject: { ar: '{{title}}', en: '{{title}}' },
  body: { ar: '{{body}}', en: '{{body}}' },
  // Every channel the platform has. What a given recipient actually receives on is still their
  // own preference — this only says an announcement is allowed to travel by any of them.
  channels: ['inApp', 'email', 'push'],
  variables: ['title', 'body'],
  defaultExpiryHours: null,
};

export const ensureAnnouncementTemplate = async (): Promise<void> => {
  // `ensure` hands back what is actually stored — the freshly created template on a new install,
  // or the one already there. Either way it is the version the repair below has to judge.
  await notificationTemplateService.ensure(ANNOUNCEMENT_TEMPLATE);
  await repairDuplicatedTitle();
};
