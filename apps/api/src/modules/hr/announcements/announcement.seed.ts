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
    subject: { ar: '{{titleAr}}', en: '{{titleEn}}' },
    body: { ar: '{{bodyAr}}', en: '{{bodyEn}}' },
    // Every channel the platform has. What a given recipient actually receives on is still their
    // own preference — this only says an announcement is allowed to travel by any of them.
    channels: ['inApp', 'email', 'push'],
    variables: ['titleAr', 'titleEn', 'bodyAr', 'bodyEn'],
    defaultExpiryHours: null,
  });
};
