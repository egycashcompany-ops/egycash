// The template command against a fake Telnyx.
//
// Its job is to decide — which account to write to, whether the template is already there, whether
// the one already there points at this deployment — and a wrong decision is either a duplicate Meta
// refuses or, worse, a quiet «already registered» over a template whose button sends every new
// employee's token to an address this company no longer holds.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../infrastructure/config/env', () => ({
  env: {
    LOG_LEVEL: 'info',
    WEB_PUBLIC_URL: 'https://ecms.egycash.com.eg',
    WHATSAPP_API_TOKEN: 'KEY_test',
    WHATSAPP_ACTIVATION_TEMPLATE: '',
    WHATSAPP_TEMPLATE_LANGUAGE: 'ar',
  },
  isTest: true,
  isProduction: false,
}));

const { outboundFetch } = vi.hoisted(() => ({ outboundFetch: vi.fn() }));
vi.mock('../infrastructure/http/outbound', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  outboundFetch,
}));

const { env } = await import('../infrastructure/config/env');
const settings = env as unknown as Record<string, string>;
const { flagValue, registeredButtonUrl, runTemplateCommand } = await import('./run');

const HERE = 'https://ecms.egycash.com.eg/activate?token={{1}}';
const ELSEWHERE = 'https://old-app.up.railway.app/activate?token={{1}}';

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const template = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'tpl-1',
  name: 'ecms_account_activation',
  language: 'ar',
  status: 'APPROVED',
  whatsapp_business_account: { id: 'waba-A' },
  components: [{ type: 'BUTTONS', buttons: [{ type: 'URL', url: HERE }] }],
  ...overrides,
});

/** A fake Telnyx: the accounts and templates it holds, and every POST it was sent. */
const telnyx = (state: { accounts: unknown[]; templates: unknown[] }): { posted: unknown[] } => {
  const posted: unknown[] = [];
  outboundFetch.mockImplementation((url: string, init: RequestInit = {}) => {
    if (url.includes('/whatsapp/business_accounts'))
      return Promise.resolve(json({ data: state.accounts }));
    if (url.includes('/whatsapp/message_templates') && (init.method ?? 'GET') === 'GET') {
      return Promise.resolve(json({ data: state.templates }));
    }
    if (url.endsWith('/whatsapp/message_templates') && init.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posted.push(body);
      return Promise.resolve(json({ data: { id: 'tpl-new', status: 'PENDING', name: body.name } }));
    }
    return Promise.resolve(json({ errors: [{ code: '404', title: 'not here' }] }, 404));
  });
  return { posted };
};

const run = async (argv: string[]): Promise<{ out: string; err: string; failed: boolean }> => {
  const out: string[] = [];
  const err: string[] = [];
  await runTemplateCommand(argv, { out: (l) => out.push(l), fail: (l) => err.push(l) });
  return { out: out.join('\n'), err: err.join('\n'), failed: err.length > 0 };
};

const ACCOUNT_A = { id: 'waba-A', waba_id: '1111', name: 'EGYCASH', status: 'APPROVED' };
const ACCOUNT_B = { id: 'waba-B', waba_id: '2222', name: 'EGYCASH test', status: 'APPROVED' };

beforeEach(() => {
  outboundFetch.mockReset();
  settings.WEB_PUBLIC_URL = 'https://ecms.egycash.com.eg';
  settings.WHATSAPP_API_TOKEN = 'KEY_test';
  settings.WHATSAPP_ACTIVATION_TEMPLATE = '';
});

describe('the dry run', () => {
  it('prints the registration and calls nobody', async () => {
    const result = await run([]);
    expect(outboundFetch).not.toHaveBeenCalled();
    expect(result.failed).toBe(false);
    expect(result.out).toContain('"name": "ecms_account_activation"');
    expect(result.out).toContain(HERE);
  });

  it('works with no key at all, and says when the address is not one Meta can be given', async () => {
    settings.WHATSAPP_API_TOKEN = '';
    settings.WEB_PUBLIC_URL = 'http://localhost:5173';
    const result = await run([]);
    expect(result.failed).toBe(false);
    expect(result.out).toContain('is not https');
  });
});

describe('--write', () => {
  it('registers in the only account, under the default name', async () => {
    const fake = telnyx({ accounts: [ACCOUNT_A], templates: [] });
    const result = await run(['--write']);
    expect(result.failed).toBe(false);
    expect(fake.posted).toHaveLength(1);
    expect(fake.posted[0]).toMatchObject({
      waba_id: '1111',
      name: 'ecms_account_activation',
      language: 'ar',
      category: 'UTILITY',
    });
    expect(result.out).toContain('WHATSAPP_ACTIVATION_TEMPLATE=ecms_account_activation');
  });

  it('submits nothing when the same template, for this address, is already there', async () => {
    const fake = telnyx({ accounts: [ACCOUNT_A], templates: [template()] });
    const result = await run(['--write']);
    expect(result.failed).toBe(false);
    expect(fake.posted).toHaveLength(0);
    expect(result.out).toContain('already registered');
  });

  it('refuses loudly when the one already there was approved for another address', async () => {
    const fake = telnyx({
      accounts: [ACCOUNT_A],
      templates: [
        template({ components: [{ type: 'BUTTONS', buttons: [{ type: 'URL', url: ELSEWHERE }] }] }),
      ],
    });
    const result = await run(['--write']);
    expect(fake.posted).toHaveLength(0);
    expect(result.failed).toBe(true);
    expect(result.err).toContain('approved for a different address');
    expect(result.err).toContain('--name');
  });

  it('registers in the account named with --waba even when another account has the name', async () => {
    // Meta's names are unique within ONE account; the other account's copy is not this one's.
    const fake = telnyx({ accounts: [ACCOUNT_A, ACCOUNT_B], templates: [template()] });
    const result = await run(['--write', '--waba', '2222']);
    expect(result.failed).toBe(false);
    expect(fake.posted).toHaveLength(1);
    expect(fake.posted[0]).toMatchObject({ waba_id: '2222' });
  });

  it('asks which account when there are several and none is named', async () => {
    const fake = telnyx({ accounts: [ACCOUNT_A, ACCOUNT_B], templates: [] });
    const result = await run(['--write']);
    expect(fake.posted).toHaveLength(0);
    expect(result.failed).toBe(true);
    expect(result.err).toContain('--waba 1111');
    expect(result.err).toContain('--waba 2222');
  });

  it('says so when no WhatsApp account is connected yet', async () => {
    telnyx({ accounts: [], templates: [] });
    const result = await run(['--write']);
    expect(result.failed).toBe(true);
    expect(result.err).toContain('No WhatsApp Business Account');
  });

  it('registers a new version under --name, leaving the live one alone', async () => {
    const fake = telnyx({ accounts: [ACCOUNT_A], templates: [template()] });
    const result = await run(['--write', '--name', 'ecms_account_activation_v2']);
    expect(result.failed).toBe(false);
    expect(fake.posted[0]).toMatchObject({ name: 'ecms_account_activation_v2' });
  });

  it('will not register a button that points at a local address', async () => {
    settings.WEB_PUBLIC_URL = 'http://localhost:5173';
    const fake = telnyx({ accounts: [ACCOUNT_A], templates: [] });
    const result = await run(['--write']);
    expect(result.failed).toBe(true);
    expect(fake.posted).toHaveLength(0);
  });

  it('needs the key', async () => {
    settings.WHATSAPP_API_TOKEN = '';
    const result = await run(['--write']);
    expect(result.failed).toBe(true);
    expect(outboundFetch).not.toHaveBeenCalled();
  });

  it('refuses a flag with no value, rather than taking the next flag as one', async () => {
    const result = await run(['--waba', '--write']);
    expect(result.failed).toBe(true);
    expect(result.err).toContain('--waba needs a value');
    expect(outboundFetch).not.toHaveBeenCalled();
  });

  it('refuses a --name Meta would not accept', async () => {
    const result = await run(['--write', '--name', 'Bad-Name']);
    expect(result.failed).toBe(true);
    expect(outboundFetch).not.toHaveBeenCalled();
  });
});

describe('--status', () => {
  it('shows the approval state and the address the button was approved for', async () => {
    telnyx({ accounts: [ACCOUNT_A], templates: [template()] });
    const result = await run(['--status']);
    expect(result.failed).toBe(false);
    expect(result.out).toContain('APPROVED');
    expect(result.out).toContain(`button → ${HERE}`);
  });

  it('does not call an approved template usable when its button points elsewhere', async () => {
    telnyx({
      accounts: [ACCOUNT_A],
      templates: [
        template({ components: [{ type: 'BUTTONS', buttons: [{ type: 'URL', url: ELSEWHERE }] }] }),
      ],
    });
    const result = await run(['--status']);
    expect(result.failed).toBe(true);
    expect(result.err).toContain('Do not send through it');
    expect(result.out).toContain('Not approved');
  });

  it('says when nothing is registered yet', async () => {
    telnyx({ accounts: [ACCOUNT_A], templates: [] });
    expect((await run(['--status'])).out).toContain('not registered yet');
  });
});

describe('the small parts', () => {
  it('reads flag values', () => {
    expect(flagValue(['--waba', '1111'], 'waba')).toBe('1111');
    expect(flagValue(['--write'], 'waba')).toBe('');
    expect(flagValue(['--waba'], 'waba')).toBeNull();
    expect(flagValue(['--waba', '--write'], 'waba')).toBeNull();
  });

  it('finds the URL button whatever case Telnyx returns its types in', () => {
    expect(
      registeredButtonUrl({
        components: [{ type: 'buttons', buttons: [{ type: 'url', url: HERE }] }],
      }),
    ).toBe(HERE);
    expect(registeredButtonUrl({ components: [{ type: 'BODY' }] })).toBeNull();
    expect(registeredButtonUrl({})).toBeNull();
  });
});
