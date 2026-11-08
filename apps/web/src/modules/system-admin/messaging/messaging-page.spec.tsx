// «الرسائل التلقائية» — what the page shows, rendered against a seeded answer, and the save it
// builds.
//
// «عايز أعمل Automation بدل واتساب يبقي SMS». What is pinned here: the token box never carries a
// value — a stored token is said to be set, and when, and nothing more; the three channels are
// offered with the stored one chosen; a test's result reads as a sentence, ours translated and the
// provider's own answer shown as it came; and without `setting.edit` the page is read-only.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type Locale, type MeDto, type MessagingSettingsDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { translate } from '../../../platform/localization/i18n';
import { formatBusinessDateTime } from '../../../shared/lib/format';
import { messagingSettingsKey } from './api/messaging-api';
import { MessagingSettingsPage } from './pages/MessagingSettingsPage';
import {
  messagingDraftOf,
  messagingPatchBody,
  smsDetailKey,
  tokenAfterSave,
} from './lib/messaging-view';

const SETTINGS: MessagingSettingsDto = {
  channel: 'sms',
  sms: {
    enabled: true,
    provider: 'etisalat',
    templateId: '12345',
    tokenSet: true,
    tokenUpdatedAt: '2026-11-08T08:00:00.000Z',
    endpointConfigured: true,
    lastTest: null,
  },
  whatsapp: { configured: false },
};

const EDITOR = { 'setting.view': 'organization', 'setting.edit': 'organization' };
const READER = { 'setting.view': 'organization' };

const render = ({
  locale = 'ar' as Locale,
  settings = SETTINGS,
  permissions = EDITOR as Record<string, string>,
}: {
  locale?: Locale;
  settings?: MessagingSettingsDto;
  permissions?: Record<string, string>;
} = {}): string => {
  const me = { id: 'admin', permissions } as unknown as MeDto;
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me, status: 'signedIn' as const },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(messagingSettingsKey(), settings);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/system/messaging']}>
          <MessagingSettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const ar = (key: string, vars?: Record<string, string | number>): string =>
  translate('ar', key, vars);

/** The `<input>` the token is typed into, as rendered. */
const tokenInput = (html: string): string =>
  /<input[^>]*data-messaging-token="true"[^>]*>/.exec(html)?.[0] ?? '';

describe('the token is write-only on screen', () => {
  it('says a stored token is set, and since when — the box itself stays empty', () => {
    const html = render();
    expect(html).toContain(
      ar('systemAdmin.messaging.sms.tokenSetSince', {
        at: formatBusinessDateTime(SETTINGS.sms.tokenUpdatedAt, 'ar'),
      }),
    );
    const input = tokenInput(html);
    expect(input).not.toBe('');
    expect(input).toContain('type="password"');
    expect(input).toContain('value=""');
    expect(input).toContain('autoComplete="new-password"');
    // «إزالة» is offered for a stored token.
    expect(html).toContain('data-messaging-action="clear-token"');
    expect(html).toContain(ar('systemAdmin.messaging.sms.clearToken'));
  });

  it('says «غير مضبوط» when none is stored, and offers nothing to remove', () => {
    const html = render({
      settings: { ...SETTINGS, sms: { ...SETTINGS.sms, tokenSet: false, tokenUpdatedAt: null } },
    });
    expect(html).toContain(ar('systemAdmin.messaging.sms.tokenNotSet'));
    expect(html).not.toContain('data-messaging-action="clear-token"');
  });
});

describe('the channel', () => {
  const html = render();

  it('offers SMS, WhatsApp and both, with the stored one chosen', () => {
    for (const channel of ['sms', 'whatsapp', 'both'] as const) {
      expect(html).toContain(`data-messaging-channel="${channel}"`);
      expect(html).toContain(ar(`systemAdmin.messaging.channels.${channel}`));
    }
    const chosen = /<input[^>]*value="sms"[^>]*>/.exec(html)?.[0] ?? '';
    expect(chosen).toContain('checked=""');
    expect(/<input[^>]*value="whatsapp"[^>]*>/.exec(html)?.[0]).not.toContain('checked');
  });

  it('says what is sent automatically', () => {
    expect(html).toContain(ar('systemAdmin.messaging.whatIsSent'));
  });

  it('warns when WhatsApp is chosen but not configured on the server', () => {
    const both = render({ settings: { ...SETTINGS, channel: 'both' } });
    expect(both).toContain('data-messaging-warning="whatsapp-off"');
    expect(html).not.toContain('data-messaging-warning="whatsapp-off"');
  });
});

describe('the endpoint', () => {
  it('says so before anybody tries, while the server has no SMS address', () => {
    const html = render({
      settings: { ...SETTINGS, sms: { ...SETTINGS.sms, endpointConfigured: false } },
    });
    expect(html).toContain('data-messaging-endpoint="missing"');
    expect(html).toContain(ar('systemAdmin.messaging.sms.endpointMissing'));
    expect(render()).not.toContain('data-messaging-endpoint="missing"');
  });
});

describe('what Etisalat’s portal must give', () => {
  it('names the template script exactly, letter case included', () => {
    expect(render()).toContain('{Body}');
    expect(render({ locale: 'en' })).toContain('exactly {Body}');
  });
});

describe('the last test', () => {
  const at = '2026-11-08T09:15:00.000Z';

  it('reads «endpoint not configured» as a sentence, not as the API’s English', () => {
    const html = render({
      settings: {
        ...SETTINGS,
        sms: {
          ...SETTINGS.sms,
          lastTest: { at, ok: false, detail: 'sms endpoint not configured' },
        },
      },
    });
    expect(html).toContain('data-messaging-last-test="failed"');
    expect(html).toContain(
      ar('systemAdmin.messaging.test.failed', {
        reason: ar('systemAdmin.messaging.detail.endpointNotConfigured'),
      }),
    );
    expect(html).not.toContain('sms endpoint not configured');
  });

  it('shows the provider’s own answer as it came', () => {
    const html = render({
      settings: {
        ...SETTINGS,
        sms: { ...SETTINGS.sms, lastTest: { at, ok: false, detail: 'etisalat responded 401' } },
      },
    });
    expect(html).toContain('etisalat responded 401');
  });

  it('says a test that went, went', () => {
    const html = render({
      settings: { ...SETTINGS, sms: { ...SETTINGS.sms, lastTest: { at, ok: true, detail: null } } },
    });
    expect(html).toContain('data-messaging-last-test="ok"');
    expect(html).toContain(ar('systemAdmin.messaging.test.sent'));
  });

  it('says none has been sent yet', () => {
    expect(render()).toContain(ar('systemAdmin.messaging.test.never'));
  });
});

describe('without setting.edit the page is read-only', () => {
  const html = render({ permissions: READER });

  it('offers no save, no test and no token box', () => {
    expect(html).not.toContain('data-messaging-action="save"');
    expect(html).not.toContain('data-messaging-action="test"');
    expect(html).not.toContain('data-messaging-test-phone');
    expect(tokenInput(html)).toBe('');
    expect(html).toContain('data-messaging-token-state="read-only"');
    expect(html).toContain(ar('systemAdmin.messaging.sms.tokenSetShort'));
  });

  it('shows the choice without letting it change', () => {
    for (const channel of ['sms', 'whatsapp', 'both']) {
      const radio = new RegExp(`<input[^>]*value="${channel}"[^>]*>`).exec(html)?.[0] ?? '';
      expect(radio, channel).toContain('disabled=""');
    }
  });

  it('still shows the last test', () => {
    expect(html).toContain(ar('systemAdmin.messaging.test.never'));
  });
});

describe('the English page', () => {
  it('renders every label in English', () => {
    const html = render({ locale: 'en' });
    expect(html).toContain('Automatic messages');
    expect(html).toContain('Text message (SMS)');
    expect(html).toContain('Template ID');
  });
});

describe('the save it builds', () => {
  const draft = messagingDraftOf(SETTINGS);

  it('sends nothing for an untouched form', () => {
    expect(messagingPatchBody(SETTINGS, draft)).toEqual({});
  });

  it('sends only what changed', () => {
    expect(messagingPatchBody(SETTINGS, { ...draft, channel: 'both' })).toEqual({
      channel: 'both',
    });
    expect(
      messagingPatchBody(SETTINGS, { ...draft, smsEnabled: false, templateId: ' 777 ' }),
    ).toEqual({
      sms: { enabled: false, templateId: '777' },
    });
    expect(messagingPatchBody(SETTINGS, { ...draft, templateId: '' })).toEqual({
      sms: { templateId: null },
    });
  });

  it('an empty token box keeps the stored token; a typed one replaces it', () => {
    expect(messagingPatchBody(SETTINGS, { ...draft, token: '   ' })).toEqual({});
    expect(messagingPatchBody(SETTINGS, { ...draft, token: ' eyJ.new.token ' })).toEqual({
      sms: { token: 'eyJ.new.token' },
    });
  });

  it('«إزالة» clears it — unless a new one was typed instead', () => {
    expect(messagingPatchBody(SETTINGS, { ...draft, clearToken: true })).toEqual({
      sms: { token: null },
    });
    expect(tokenAfterSave(SETTINGS, { ...draft, clearToken: true })).toBe(false);
    expect(messagingPatchBody(SETTINGS, { ...draft, clearToken: true, token: 'eyJ.x' })).toEqual({
      sms: { token: 'eyJ.x' },
    });
  });
});

describe('the reasons an SMS did not go', () => {
  it('maps each reason the API words itself to a sentence, and nothing else', () => {
    expect(smsDetailKey('sms endpoint not configured')).toBe(
      'systemAdmin.messaging.detail.endpointNotConfigured',
    );
    expect(smsDetailKey('sms token not set')).toBe('systemAdmin.messaging.detail.tokenMissing');
    expect(smsDetailKey('etisalat responded 500')).toBeNull();
    expect(smsDetailKey(null)).toBeNull();
  });
});
