// The WhatsApp template the one-time setup link goes out as.
//
// WhatsApp lets a business open a conversation only with a template Meta approved in advance, so a
// new employee's activation message cannot be free text. That makes the message two things that
// must agree: the template registered with Meta (its wording, its {{1}}…{{3}}, its button's URL),
// and the values each send fills in. Both are written here, once — `whatsapp-template.cli` registers
// `activationTemplateRegistration()`, the credentials delivery sends `activationTemplateFor()` — so
// a variable cannot be added to one and forgotten in the other.
//
// THE WORDING IS FIXED ONCE META APPROVES IT. The admin-editable credentials template (§13 R15)
// still writes the email; on WhatsApp, changing the text below changes nothing until the template
// is registered again, under a new name, and approved.
//
// The setup link is never in the body. It is the template's URL button — `setupLinkUrl('{{1}}')`,
// with the token as the button's variable — so what Meta approves is this deployment's own
// `/activate` address, and what each message carries is only the token at its end.
import { isIP } from 'node:net';
import { env } from '../../infrastructure/config/env';
import { isPrivateAddress } from '../../infrastructure/http/outbound';
import { type WhatsAppTemplate } from '../../infrastructure/messaging/whatsapp';
import { setupLinkUrl } from './setup-link';

/** The name the CLI registers unless told otherwise, and the one the deployment guide sets. */
export const DEFAULT_ACTIVATION_TEMPLATE_NAME = 'ecms_account_activation';

/**
 * UTILITY, not AUTHENTICATION: Meta keeps AUTHENTICATION for one-time CODES with its own fixed
 * wording, and a notice that an account exists, with a link to finish it, is an account update.
 */
const CATEGORY = 'UTILITY';

/**
 * Bilingual, like the email. A variable may not open or close the body (Meta's rule); each appears
 * once, numbered in order, so the values sent line up with it by position alone.
 */
export const ACTIVATION_TEMPLATE_BODY = [
  'EGYCASH — حساب الدخول الخاص بك جاهز',
  'Your EGYCASH login account is ready',
  '',
  'اسم المستخدم / Username: {{1}}',
  'كود الموظف / Employee Code: {{2}}',
  'صلاحية الرابط حتى / Link expires: {{3}}',
  '',
  'اضغط «تفعيل الحساب» لاختيار كلمة المرور. الرابط يُستخدم مرة واحدة.',
  'Tap «Activate» to choose your password. The link works only once.',
].join('\n');

/** Meta's limits: a footer of at most 60 characters, a button label of at most 25. */
export const ACTIVATION_TEMPLATE_FOOTER = 'لا تشارك هذا الرابط · Do not share this link';
export const ACTIVATION_TEMPLATE_BUTTON = 'تفعيل الحساب · Activate';

/** Sample values Meta's reviewers read the template with. Nothing real. */
const EXAMPLE = {
  username: 'e1024',
  employeeCode: 'E1024',
  expiresAt: '2026-11-03 08:00 UTC',
  setupToken: 'Xk3v9Qm2Lp7RtY5wZb8NcD4fGh6JsA1e',
};

export interface ActivationMessageValues {
  username: string;
  employeeCode: string | null;
  /** The one-time token — transit-only (§14). */
  setupToken: string;
  expiresAt: Date;
}

/** How the link's expiry reads in every activation message: the email's and the template's {{3}}. */
export const formatActivationExpiry = (expiresAt: Date): string =>
  `${expiresAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`;

/**
 * A value Meta will accept as a template parameter. It refuses one that is empty, or that holds a
 * newline, a tab, or more than four spaces in a row — and refusing it means the employee gets
 * nothing, so the value is made acceptable rather than sent as it came.
 */
const templateParam = (value: string | null): string => {
  const clean = (value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim();
  return clean === '' ? '—' : clean;
};

/**
 * The template, filled in for one employee — or `undefined` when this deployment has not configured
 * one, and the link goes as plain text (which WhatsApp delivers only inside a 24-hour window).
 */
export const activationTemplateFor = (
  values: ActivationMessageValues,
): WhatsAppTemplate | undefined => {
  if (env.WHATSAPP_ACTIVATION_TEMPLATE === '') return undefined;
  return {
    name: env.WHATSAPP_ACTIVATION_TEMPLATE,
    language: env.WHATSAPP_TEMPLATE_LANGUAGE,
    bodyParams: [
      templateParam(values.username),
      templateParam(values.employeeCode),
      formatActivationExpiry(values.expiresAt),
    ],
    urlButtonParam: values.setupToken,
  };
};

/**
 * Why Meta should not be given this address for the button — or null when it can be. A template
 * approved against `http://localhost:5173` (the default) would send every employee a link to their
 * own machine, and Meta's review would not catch it.
 */
export const buttonAddressProblem = (publicUrl: string): string | null => {
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    return 'is not a URL';
  }
  if (url.protocol !== 'https:') return 'is not https';
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return 'is a local address';
  }
  if (isIP(host) !== 0 && isPrivateAddress(host)) return 'is a private address';
  return null;
};

/**
 * The request that registers the template with Meta, through Telnyx
 * (`POST /v2/whatsapp/message_templates`). Meta reviews it, usually within a day, and only an
 * APPROVED template can be sent.
 *
 * The button's URL is built from `WEB_PUBLIC_URL`, so it is this deployment's address that Meta
 * approves. A deployment whose public address changes registers a NEW template, under a new name —
 * the old one goes on sending every token to the old address, and the command refuses to call it
 * "already registered" when its button no longer matches.
 */
export const activationTemplateRegistration = (input: {
  wabaId: string;
  name: string;
  language: string;
}): Record<string, unknown> => ({
  waba_id: input.wabaId,
  name: input.name,
  category: CATEGORY,
  language: input.language,
  components: [
    {
      type: 'BODY',
      text: ACTIVATION_TEMPLATE_BODY,
      example: { body_text: [[EXAMPLE.username, EXAMPLE.employeeCode, EXAMPLE.expiresAt]] },
    },
    { type: 'FOOTER', text: ACTIVATION_TEMPLATE_FOOTER },
    {
      type: 'BUTTONS',
      buttons: [
        {
          type: 'URL',
          text: ACTIVATION_TEMPLATE_BUTTON,
          url: setupLinkUrl('{{1}}'),
          example: [setupLinkUrl(EXAMPLE.setupToken)],
        },
      ],
    },
  ],
});
