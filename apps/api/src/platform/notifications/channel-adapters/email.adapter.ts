// Email channel: nodemailer over SMTP, multipart HTML+plain-text from one authored
// plain-text template body (Sprint 3.3 plan §2b). Delivery is queued — this adapter's
// `send` runs in the worker's `notifications.deliver` job handler, never inline.
import { sendMail } from '../../../infrastructure/email/mailer';
import { userService } from '../../users';
import { type ChannelAdapter } from './channel-adapter';
import { wrapEmailHtml } from '../notification.rendering';

export const emailChannelAdapter: ChannelAdapter = {
  id: 'email',
  send: async (notification, rendered) => {
    let user;
    try {
      user = await userService.getById(String(notification.recipientUserId));
    } catch {
      return { ok: false, error: 'recipient not found' };
    }
    const locale = user.locale === 'ar' ? 'ar' : 'en';
    const subject = rendered.subject?.[locale] ?? rendered.body[locale];
    const bodyText = rendered.body[locale];
    try {
      await sendMail({
        to: user.email,
        subject,
        text: bodyText,
        html: wrapEmailHtml(bodyText),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
