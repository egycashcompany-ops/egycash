// Transient credentials delivery (auth design §12 R3): composes the bilingual first-login
// message (username, Employee Code, temporary password, login URL, must-change notice) and
// sends it via WhatsApp + email DIRECTLY through the infrastructure transports. It must NOT
// go through the persisted notifications pipeline — notify() stores rendered bodies, which
// would persist the password in plaintext (forbidden by R11). Messages exist only in transit;
// audits record per-channel outcomes, never the password.
import { type CredentialsDeliveryResultDto } from '@ecms/contracts';
import { env } from '../../infrastructure/config/env';
import { sendMail } from '../../infrastructure/email/mailer';
import { sendWhatsApp } from '../../infrastructure/messaging/whatsapp';
import { auditService } from '../audit';

export interface DeliverCredentialsInput {
  userId: string;
  username: string;
  employeeCode: string | null;
  phone: string | null;
  email: string | null;
  /** Transit-only — never persisted, never logged. */
  temporaryPassword: string;
  expiresAt: Date;
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const composeMessage = (input: DeliverCredentialsInput): { subject: string; body: string } => {
  const expiry = input.expiresAt.toISOString().replace('T', ' ').slice(0, 16);
  const codeLineEn = input.employeeCode === null ? '' : `Employee Code: ${input.employeeCode}\n`;
  const codeLineAr = input.employeeCode === null ? '' : `كود الموظف: ${input.employeeCode}\n`;
  const body =
    `EGYCASH — حساب الدخول الخاص بك\n` +
    `اسم المستخدم: ${input.username}\n` +
    codeLineAr +
    `كلمة المرور المؤقتة: ${input.temporaryPassword}\n` +
    `رابط الدخول: ${env.WEB_PUBLIC_URL}\n` +
    `هذه كلمة مرور مؤقتة ويجب تغييرها عند أول تسجيل دخول. صلاحيتها تنتهي في ${expiry} UTC.\n` +
    `\n` +
    `EGYCASH — your login account\n` +
    `Username: ${input.username}\n` +
    codeLineEn +
    `Temporary password: ${input.temporaryPassword}\n` +
    `Login: ${env.WEB_PUBLIC_URL}\n` +
    `This password is TEMPORARY and must be changed at your first sign-in. ` +
    `It expires at ${expiry} UTC.`;
  return { subject: 'EGYCASH — بيانات الدخول / your login credentials', body };
};

/**
 * Deliver freshly issued credentials over every reachable channel. Never throws — issuing
 * an account must not fail because a carrier/SMTP endpoint is down; failures are returned
 * and audited so an admin can re-issue (R10).
 */
export const deliverCredentials = async (
  input: DeliverCredentialsInput,
): Promise<CredentialsDeliveryResultDto[]> => {
  const { subject, body } = composeMessage(input);
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
      changes: results.map((r) => ({
        field: r.channel,
        old: null,
        new: r.ok ? 'sent' : (r.detail ?? 'failed'),
      })),
    })
    .catch(() => undefined);
  return results;
};
