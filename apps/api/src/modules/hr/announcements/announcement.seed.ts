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
import { ANNOUNCEMENT_TEMPLATE_KEY } from '@ecms/contracts';
import { notificationTemplateService } from '../../../platform/notifications';

export const ensureAnnouncementTemplate = async (): Promise<void> => {
  await notificationTemplateService.ensure({
    key: ANNOUNCEMENT_TEMPLATE_KEY,
    category: 'hr',
    priority: 'normal',
    // TWO variables, and both appear in BOTH language bodies — the platform requires it
    // (`contentAgreesWithVariables`), and the requirement is right: a declared variable a language
    // body ignores is data that language silently loses.
    //
    // It is also why the four-variable shape this started as cannot work. `body.ar` would use only
    // `{{bodyAr}}` and never `{{bodyEn}}`, which the rule reads — correctly, in general — as the
    // Arabic version dropping a value. So the language split moves OUT of the template and into
    // the send: see `announcement.service`, which addresses each reading language its own copy.
    subject: { ar: '{{title}}', en: '{{title}}' },
    body: { ar: '{{title}}\n\n{{body}}', en: '{{title}}\n\n{{body}}' },
    // Every channel the platform has. What a given recipient actually receives on is still their
    // own preference — this only says an announcement is allowed to travel by any of them.
    channels: ['inApp', 'email', 'push'],
    variables: ['title', 'body'],
    defaultExpiryHours: null,
  });
};
