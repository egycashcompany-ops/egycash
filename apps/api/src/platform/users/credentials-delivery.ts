// Transient credentials delivery (auth design §12 R3 + §14): composes the bilingual
// account-setup message (username, Employee Code, one-time setup LINK, expiry) and sends it
// via WhatsApp + email DIRECTLY through the infrastructure transports. It must NOT go
// through the persisted notifications pipeline — notify() stores rendered bodies, which
// would persist the one-time link (forbidden by R11/R12). Messages exist only in transit;
// audits record per-channel outcomes, never the link.
import { type CredentialsDeliveryResultDto } from '@ecms/contracts';
import { env } from '../../infrastructure/config/env';
import { sendMail } from '../../infrastructure/email/mailer';
import { sendWhatsApp } from '../../infrastructure/messaging/whatsapp';
import { auditService } from '../audit';
import { notificationTemplateRepository } from '../notifications/notification-template.repository';
import { renderTemplate } from '../notifications/notification.rendering';

/** Admin-editable message template (§13 R15) — seeded create-if-missing at boot. */
export const CREDENTIALS_TEMPLATE_KEY = 'platform.credentialsDelivery';

export interface DeliverCredentialsInput {
  userId: string;
  username: string;
  employeeCode: string | null;
  phone: string | null;
  email: string | null;
  /** One-time setup token (§14) — transit-only, never persisted or logged in the clear. */
  setupToken: string;
  expiresAt: Date;
  /** Provenance for the audit trail (§13 R14/§14). */
  mode: 'initial' | 'reset' | 'resend';
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The one place the setup link's shape is written.
 *
 * P9-A added a second caller — the endpoint that hands the link to an administrator to deliver by
 * hand — and two copies of this string would be two links that can drift apart, one of which the
 * `/activate` page would silently fail to understand.
 */
export const setupLinkUrl = (setupToken: string): string =>
  `${env.WEB_PUBLIC_URL}/activate?token=${setupToken}`;

/** Built-in wording — the fallback when the seeded template has been deleted. */
const FALLBACK = {
  subject: {
    ar: 'EGYCASH — تفعيل حساب الدخول',
    en: 'EGYCASH — activate your account',
  },
  body: {
    ar:
      'EGYCASH — حساب الدخول الخاص بك\nاسم المستخدم: {{username}}\nكود الموظف: {{employeeCode}}\n' +
      'لاختيار كلمة المرور وتفعيل حسابك افتح الرابط التالي:\n{{setupLink}}\n' +
      'هذا الرابط يُستخدم مرة واحدة وتنتهي صلاحيته في {{expiresAt}}.',
    en:
      'EGYCASH — your login account\nUsername: {{username}}\nEmployee Code: {{employeeCode}}\n' +
      'Open this one-time link to choose your password and activate your account:\n{{setupLink}}\n' +
      'The link can be used once and expires at {{expiresAt}}.',
  },
};

/**
 * Render the credential message from the ADMIN-EDITABLE template (§13 R15) — in memory only.
 * The persisted notify() pipeline is never used: it would store the password (forbidden, R12).
 */
const composeMessage = async (
  input: DeliverCredentialsInput,
): Promise<{ subject: string; body: string }> => {
  const template = await notificationTemplateRepository
    .findLatestByKey(CREDENTIALS_TEMPLATE_KEY)
    .catch(() => null);
  const source =
    template === null ? FALLBACK : { subject: template.subject ?? FALLBACK.subject, body: template.body };
  const rendered = renderTemplate(source, {
    username: input.username,
    employeeCode: input.employeeCode ?? '—',
    setupLink: setupLinkUrl(input.setupToken),
    expiresAt: `${input.expiresAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`,
  });
  const subject = rendered.subject ?? rendered.body;
  return {
    subject: `${subject.ar} / ${subject.en}`,
    body:
      rendered.body.ar === rendered.body.en
        ? rendered.body.ar
        : `${rendered.body.ar}\n\n${rendered.body.en}`,
  };
};

/**
 * Deliver freshly issued credentials over every reachable channel. Never throws — issuing
 * an account must not fail because a carrier/SMTP endpoint is down; failures are returned
 * and audited so an admin can re-issue (R10).
 */
export const deliverCredentials = async (
  input: DeliverCredentialsInput,
): Promise<CredentialsDeliveryResultDto[]> => {
  const { subject, body } = await composeMessage(input);
  const results: CredentialsDeliveryResultDto[] = [];

  if (input.phone === null || input.phone.trim() === '') {
    results.push({ channel: 'whatsapp', ok: false, detail: 'no phone number on file' });
  } else {
    const sent = await sendWhatsApp(input.phone, body);
    results.push({ channel: 'whatsapp', ok: sent.ok, detail: sent.detail });
  }

  if (input.email === null || input.email.trim() === '') {
    results.push({ channel: 'email', ok: false, detail: 'no email address on file' });
  } else {
    try {
      await sendMail({
        to: input.email,
        subject,
        text: body,
        html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(body)}</pre>`,
      });
      results.push({ channel: 'email', ok: true, detail: null });
    } catch (error) {
      results.push({
        channel: 'email',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await auditService
    .record({
      entityRef: { moduleId: 'platform', entityType: 'user', entityId: input.userId },
      action: 'credentialsDelivered',
      changes: [
        { field: 'mode', old: null, new: input.mode },
        ...results.map((r) => ({
          field: r.channel,
          old: null,
          new: r.ok ? 'sent' : (r.detail ?? 'failed'),
        })),
      ],
    })
    .catch(() => undefined);
  return results;
};
