// The one place the setup link's shape is written.
//
// Three readers need it: the credentials message, the endpoint that hands the link to an
// administrator to deliver by hand (P9-A), and the WhatsApp template, whose URL button is this link
// with the token left as the template's variable. Two copies of this string would be two links that
// can drift apart, one of which the `/activate` page would silently fail to understand.
//
// It lives on its own, importing nothing but the environment, because the template CLI reads it
// too — and a CLI that entered the graph through `credentials-delivery` would load the audit
// service, the notification models and everything they reach, to build one URL.
import { env } from '../../infrastructure/config/env';

export const setupLinkUrl = (setupToken: string): string =>
  `${env.WEB_PUBLIC_URL}/activate?token=${setupToken}`;
