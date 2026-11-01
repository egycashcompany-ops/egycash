// The activation template: what is registered with Meta and what each send fills in.
//
// Meta checks neither against the other. A template registered with three variables and sent with
// two is not an error at registration or at send time on our side — it is a refusal, per message,
// that reaches nobody but the Telnyx delivery report. These pin the two halves to each other.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/config/env', () => ({
  env: {
    LOG_LEVEL: 'info',
    WEB_PUBLIC_URL: 'https://ecms.egycash.com.eg',
    WHATSAPP_ACTIVATION_TEMPLATE: 'ecms_account_activation',
    WHATSAPP_TEMPLATE_LANGUAGE: 'ar',
  },
  isTest: true,
  isProduction: false,
}));

const { env } = await import('../../infrastructure/config/env');
const settings = env as unknown as Record<string, string>;
const {
  ACTIVATION_TEMPLATE_BODY,
  ACTIVATION_TEMPLATE_BUTTON,
  ACTIVATION_TEMPLATE_FOOTER,
  DEFAULT_ACTIVATION_TEMPLATE_NAME,
  activationTemplateFor,
  activationTemplateRegistration,
  buttonAddressProblem,
  formatActivationExpiry,
} = await import('./activation-whatsapp-template');
const { setupLinkUrl } = await import('./setup-link');

const VALUES = {
  username: 'e2001',
  employeeCode: 'E2001',
  setupToken: 'tok_abcdefghijklmnopqrstuvwxyz0123456789',
  expiresAt: new Date('2026-11-03T08:00:00.000Z'),
};

const registered = (): {
  body: { text: string; example: { body_text: string[][] } };
  footer: { text: string };
  button: { type: string; text: string; url: string; example: string[] };
} => {
  const request = activationTemplateRegistration({ wabaId: 'waba-1', name: 'n', language: 'ar' });
  const components = request.components as { type: string }[];
  const byType = (type: string): unknown => components.find((c) => c.type === type);
  const buttons = byType('BUTTONS') as {
    buttons: { type: string; text: string; url: string; example: string[] }[];
  };
  return {
    body: byType('BODY') as { text: string; example: { body_text: string[][] } },
    footer: byType('FOOTER') as { text: string },
    button: buttons.buttons[0] as { type: string; text: string; url: string; example: string[] },
  };
};

const variablesIn = (text: string): string[] =>
  [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1] as string);

afterEach(() => {
  settings.WHATSAPP_ACTIVATION_TEMPLATE = 'ecms_account_activation';
  settings.WHATSAPP_TEMPLATE_LANGUAGE = 'ar';
  settings.WEB_PUBLIC_URL = 'https://ecms.egycash.com.eg';
});

describe('the registered template and the values sent agree', () => {
  it('sends exactly one value for each body variable, numbered 1…n with no gaps', () => {
    const variables = variablesIn(ACTIVATION_TEMPLATE_BODY);
    const sent = activationTemplateFor(VALUES);
    expect(variables).toEqual(variables.map((_, index) => String(index + 1)));
    expect(sent?.bodyParams).toHaveLength(variables.length);
    // Meta reviews the template with these, and requires one per variable.
    expect(registered().body.example.body_text[0]).toHaveLength(variables.length);
  });

  it('puts the values in the order the body reads them', () => {
    const sent = activationTemplateFor(VALUES);
    expect(sent?.bodyParams).toEqual(['e2001', 'E2001', '2026-11-03 08:00 UTC']);
    // {{3}} reads the way the email reads the expiry — one format for both.
    expect(sent?.bodyParams[2]).toBe(formatActivationExpiry(VALUES.expiresAt));
  });

  it('makes the button the setup link, with the token as its only variable', () => {
    const { button } = registered();
    expect(button.type).toBe('URL');
    expect(button.url).toBe(setupLinkUrl('{{1}}'));
    expect(button.url).toBe('https://ecms.egycash.com.eg/activate?token={{1}}');
    // Meta allows a URL variable only at the end.
    expect(button.url.endsWith('{{1}}')).toBe(true);
    // Filling the variable with what is sent gives back exactly the link the email carries.
    const sent = activationTemplateFor(VALUES);
    expect(button.url.replace('{{1}}', sent?.urlButtonParam ?? '')).toBe(
      setupLinkUrl(VALUES.setupToken),
    );
  });

  it('never puts the link or the token in the body', () => {
    expect(ACTIVATION_TEMPLATE_BODY).not.toContain('/activate');
    expect(activationTemplateFor(VALUES)?.bodyParams).not.toContain(VALUES.setupToken);
  });
});

describe("the template fits Meta's rules", () => {
  it('stays inside the length limits', () => {
    expect(ACTIVATION_TEMPLATE_BODY.length).toBeLessThanOrEqual(1024);
    expect(ACTIVATION_TEMPLATE_FOOTER.length).toBeLessThanOrEqual(60);
    expect(ACTIVATION_TEMPLATE_BUTTON.length).toBeLessThanOrEqual(25);
  });

  it('does not open or close the body with a variable', () => {
    expect(ACTIVATION_TEMPLATE_BODY.trim().startsWith('{{')).toBe(false);
    expect(ACTIVATION_TEMPLATE_BODY.trim().endsWith('}}')).toBe(false);
  });

  it('has a name the environment check accepts', () => {
    expect(DEFAULT_ACTIVATION_TEMPLATE_NAME).toMatch(/^[a-z0-9_]+$/);
  });

  it('registers as UTILITY, under the given account, name and language', () => {
    expect(
      activationTemplateRegistration({ wabaId: 'waba-9', name: 'ecms_x', language: 'en' }),
    ).toMatchObject({ waba_id: 'waba-9', name: 'ecms_x', category: 'UTILITY', language: 'en' });
  });
});

describe('the template for one send', () => {
  it('is not used when the deployment has not configured one', () => {
    settings.WHATSAPP_ACTIVATION_TEMPLATE = '';
    expect(activationTemplateFor(VALUES)).toBeUndefined();
  });

  it('carries the configured name and language', () => {
    settings.WHATSAPP_TEMPLATE_LANGUAGE = 'en';
    expect(activationTemplateFor(VALUES)).toMatchObject({
      name: 'ecms_account_activation',
      language: 'en',
    });
  });

  it('makes every value one Meta accepts — never empty, no newlines, no long runs of spaces', () => {
    const sent = activationTemplateFor({
      ...VALUES,
      username: ' first\nsecond\tthird      fourth ',
      employeeCode: null,
    });
    expect(sent?.bodyParams[0]).toBe('first second third   fourth');
    expect(sent?.bodyParams[1]).toBe('—');
  });
});

describe('the address the button is approved against', () => {
  it('accepts the public https address', () => {
    expect(buttonAddressProblem('https://ecms.egycash.com.eg')).toBeNull();
  });

  it.each([
    ['http://localhost:5173', 'is not https'],
    ['https://localhost', 'is a local address'],
    ['https://ecms.local', 'is a local address'],
    ['https://10.0.0.5', 'is a private address'],
    ['https://[::1]', 'is a private address'],
    ['not a url', 'is not a URL'],
  ])('refuses %s', (url, problem) => {
    expect(buttonAddressProblem(url)).toBe(problem);
  });
});
