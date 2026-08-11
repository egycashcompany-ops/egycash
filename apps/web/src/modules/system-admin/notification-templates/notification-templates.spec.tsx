// P10 — the template catalog screen.
//
// Two halves, deliberately split by what can honestly be proven here.
//
//   • **The editor's rules are pure functions**, and are exercised directly. This suite has no DOM,
//     so nothing can be typed into a field; a test that rendered the dialog and asserted on markup
//     would prove that the current draft renders, not that the rules are right. `template-form.ts`
//     exists so the rules can be checked without a browser.
//   • **What the screen SHOWS is a markup fact**, asserted with `renderToStaticMarkup` — chiefly
//     that a protected template offers no deactivate control, and that every key resolves in both
//     locales.
//
// `Dialog` portals to `document.body`, which does not exist here, so the editor is asserted through
// `TemplateFormPanel` — the same shape P9-A's setup-link panel took, for the same reason.
//
// The rules the SERVER enforces are proven in `apps/api/tests/integration/notifications.spec.ts`.
// Nothing here can stop a request; the screen only avoids provoking one it knows will fail.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  NOTIFICATION_CATEGORIES,
  type Locale,
  type MeDto,
  type NotificationTemplateDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { TEMPLATES_KEY } from './api/template-api';
import { TemplateFormPanel } from './components/TemplateFormDialog';
import { TemplatesListPage } from './pages/TemplatesListPage';
import { TemplateDetailPage } from './pages/TemplateDetailPage';
import {
  derivedVariables,
  draftProblems,
  emptyDraft,
  toCreateBody,
  toUpdateBody,
  unbalancedPlaceholders,
  undeclaredSubjectPlaceholders,
  type TemplateDraft,
} from './lib/template-form';

const template = (over: Partial<NotificationTemplateDto> = {}): NotificationTemplateDto => ({
  id: 't-1',
  key: 'module.somethingHappened',
  version: 2,
  isLatest: true,
  category: 'workflow',
  priority: 'normal',
  subject: { ar: 'موضوع', en: 'Subject' },
  body: { ar: 'مرحبًا {{name}}', en: 'Hello {{name}}' },
  channels: ['inApp', 'email'],
  variables: ['name'],
  defaultExpiryHours: null,
  status: 'active',
  isProtected: false,
  createdBy: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const me = (permissions: string[]): MeDto => ({
  id: 'admin-1',
  email: 'admin@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'en',
  navLayout: 'rail',
  theme: 'system',
  branchId: null,
  employeeId: null,
  permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  isPrivileged: false,
  flags: {},
  totpEnabled: true,
});

const ALL = [
  'notificationTemplate.view',
  'notificationTemplate.create',
  'notificationTemplate.edit',
  'notificationTemplate.delete',
  'notificationTemplate.test',
];

const render = (
  node: JSX.Element,
  {
    locale = 'en',
    permissions = ALL,
    seed = () => undefined,
    path = '/system/notification-templates',
  }: {
    locale?: Locale;
    permissions?: string[];
    seed?: (qc: QueryClient) => void;
    path?: string;
  } = {},
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  seed(qc);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The detail page reads its id from the ROUTE; rendered bare it would paint a loading shell. */
const detail = (
  row: NotificationTemplateDto,
  options: Parameters<typeof render>[1] = {},
): string =>
  render(
    <Routes>
      <Route path="/system/notification-templates/:id" element={<TemplateDetailPage />} />
    </Routes>,
    {
      path: `/system/notification-templates/${row.id}`,
      seed: (qc) => qc.setQueryData([...TEMPLATES_KEY, 'detail', row.id], row),
      ...options,
    },
  );

const draft = (over: Partial<TemplateDraft> = {}): TemplateDraft => ({
  ...emptyDraft(),
  key: 'module.thing',
  bodyAr: 'مرحبًا {{name}}',
  bodyEn: 'Hello {{name}}',
  ...over,
});

describe('the variable list is derived, never typed', () => {
  // G-2 demands the declared variables and the text agree exactly. An editor with a text area and
  // a separate variable field is an editor whose halves drift, and every drift is a 400.
  it('takes the variables from the placeholders both bodies share', () => {
    expect(derivedVariables(draft())).toEqual(['name']);
  });

  it('declares nothing for a placeholder that is in one language only', () => {
    expect(derivedVariables(draft({ bodyEn: 'Hello' }))).toEqual([]);
  });

  it('reports the imbalance, naming the language it is missing from', () => {
    expect(unbalancedPlaceholders(draft({ bodyEn: 'Hello' }))).toEqual([
      { name: 'name', missingFrom: 'en' },
    ]);
    expect(unbalancedPlaceholders(draft({ bodyAr: 'مرحبًا' }))).toEqual([
      { name: 'name', missingFrom: 'ar' },
    ]);
  });

  it('does not repeat a variable used twice', () => {
    expect(
      derivedVariables(draft({ bodyAr: '{{a}} {{a}}', bodyEn: '{{a}} {{a}}' })),
    ).toEqual(['a']);
  });

  // A subject may summarise, but a placeholder it uses has to be declared — and the declaration
  // comes from the bodies.
  it('flags a subject placeholder the bodies never use', () => {
    expect(undeclaredSubjectPlaceholders(draft({ subjectEn: 'About {{topic}}' }))).toEqual([
      'topic',
    ]);
  });

  it('accepts a subject placeholder the bodies do use', () => {
    expect(undeclaredSubjectPlaceholders(draft({ subjectEn: 'About {{name}}' }))).toEqual([]);
  });
});

describe('what the editor refuses to submit', () => {
  it.each([
    ['an imbalanced placeholder', draft({ bodyEn: 'Hello' }), 'unbalanced'],
    ['a subject placeholder nothing declares', draft({ subjectEn: '{{x}}' }), 'subjectUndeclared'],
    ['an empty body', draft({ bodyAr: '', bodyEn: '' }), 'bodyRequired'],
    ['no channel at all', draft({ channels: [] }), 'channelRequired'],
    ['a malformed key', draft({ key: 'Not A Key' }), 'key'],
    ['a non-numeric expiry', draft({ defaultExpiryHours: 'soon' }), 'expiry'],
    ['an expiry out of range', draft({ defaultExpiryHours: '99999' }), 'expiry'],
  ])('refuses %s', (_why, value, problem) => {
    expect(draftProblems(value, true)).toContain(problem);
  });

  // The API's own rule, mirrored so the refusal arrives before the request does.
  it('requires a subject once the email channel is on', () => {
    expect(draftProblems(draft({ channels: ['email'] }), true)).toContain('subjectRequired');
    expect(
      draftProblems(draft({ channels: ['email'], subjectAr: 'م', subjectEn: 'S' }), true),
    ).not.toContain('subjectRequired');
  });

  it('accepts a draft that agrees with itself', () => {
    expect(draftProblems(draft(), true)).toEqual([]);
  });

  // The key is fixed after creation, so an edit is not judged on it.
  it('does not judge the key on an edit', () => {
    expect(draftProblems(draft({ key: '' }), false)).not.toContain('key');
  });
});

describe('what gets sent', () => {
  it('sends the derived variables, not anything the user maintained', () => {
    expect(toCreateBody(draft()).variables).toEqual(['name']);
  });

  // Sent TOGETHER on purpose: a one-sided edit passes the schema and is caught later by the
  // server, with a message that reads as a surprise.
  it('always sends body and variables together on an edit', () => {
    const body = toUpdateBody(draft());
    expect(body.body).toBeDefined();
    expect(body.variables).toBeDefined();
  });

  it('sends a null subject when both subject fields are empty', () => {
    expect(toCreateBody(draft()).subject).toBeNull();
  });

  it('sends a null expiry when the field is left empty', () => {
    expect(toCreateBody(draft()).defaultExpiryHours).toBeNull();
    expect(toCreateBody(draft({ defaultExpiryHours: '24' })).defaultExpiryHours).toBe(24);
  });
});

describe('a template the platform sends by name', () => {
  // The point of `isProtected`: the server refuses the deactivation, and the screen does not offer
  // a button whose only outcome is that refusal.
  it('offers no deactivate control', () => {
    const markup = detail(template({ isProtected: true }));
    expect(markup).not.toContain(translate('en', 'systemAdmin.templates.deactivate'));
  });

  it('says why, rather than leaving the missing button unexplained', () => {
    expect(detail(template({ isProtected: true }))).toContain(
      translate('en', 'systemAdmin.templates.protectedHint'),
    );
  });

  it('still offers the edit control — wording stays editable', () => {
    expect(detail(template({ isProtected: true }))).toContain(
      translate('en', 'systemAdmin.templates.edit'),
    );
  });

  it('offers deactivation for an ordinary template', () => {
    expect(detail(template())).toContain(translate('en', 'systemAdmin.templates.deactivate'));
  });

  it('offers it only while the template is active', () => {
    expect(detail(template({ status: 'inactive' }))).not.toContain(
      translate('en', 'systemAdmin.templates.deactivate'),
    );
  });
});

describe('controls follow the permission the API enforces', () => {
  it('hides edit from a read-only administrator', () => {
    const markup = detail(template(), { permissions: ['notificationTemplate.view'] });
    expect(markup).not.toContain(translate('en', 'systemAdmin.templates.edit'));
    expect(markup).not.toContain(translate('en', 'systemAdmin.templates.deactivate'));
  });

  it('hides the test send without its own key, which is separate from edit', () => {
    const markup = detail(template(), {
      permissions: ['notificationTemplate.view', 'notificationTemplate.edit'],
      path: '/system/notification-templates/t-1?tab=preview',
    });
    expect(markup).not.toContain(translate('en', 'systemAdmin.templates.testSend'));
  });

  it('hides the create control on the list without create', () => {
    const markup = render(<TemplatesListPage />, { permissions: ['notificationTemplate.view'] });
    expect(markup).not.toContain(translate('en', 'systemAdmin.templates.create'));
  });
});

describe('the screen in both languages', () => {
  it.each(['en', 'ar'] as const)('resolves every key the list asks for — %s', (locale) => {
    const markup = render(<TemplatesListPage />, { locale });
    expect(markup, 'an untranslated key reached the list').not.toContain('systemAdmin.templates.');
  });

  it.each(['en', 'ar'] as const)('resolves every key the detail asks for — %s', (locale) => {
    const markup = detail(template({ isProtected: true }), { locale });
    expect(markup, 'an untranslated key reached the detail').not.toContain(
      'systemAdmin.templates.',
    );
  });

  it.each(['en', 'ar'] as const)('resolves every key the editor asks for — %s', (locale) => {
    const markup = render(
      <TemplateFormPanel mode="create" draft={draft()} onChange={() => undefined} />,
      { locale },
    );
    expect(markup, 'an untranslated key reached the editor').not.toContain(
      'systemAdmin.templates.',
    );
  });

  it('names every category the contract declares', () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      for (const locale of ['en', 'ar'] as const) {
        const label = translate(locale, `systemAdmin.templates.category.${category}`);
        expect(label, `${locale}/${category}`).not.toContain('systemAdmin.');
      }
    }
  });
});

describe('the editor, as markup', () => {
  const panel = (over: Partial<TemplateDraft> = {}, locale: Locale = 'ar'): string =>
    render(<TemplateFormPanel mode="create" draft={draft(over)} onChange={() => undefined} />, {
      locale,
    });

  // The RTL point specific to this screen: an English message typed into an RTL field reads with
  // its punctuation in the wrong place, so the direction is stated per field rather than inherited.
  it('states the direction of each language field rather than inheriting the page’s', () => {
    const markup = panel();
    expect(markup).toContain('id="template-body-en"');
    const english = /<textarea[^>]*id="template-body-en"[^>]*>/.exec(markup)?.[0] ?? '';
    const arabic = /<textarea[^>]*id="template-body-ar"[^>]*>/.exec(markup)?.[0] ?? '';
    expect(english).toContain('dir="ltr"');
    expect(arabic).toContain('dir="rtl"');
  });

  // A key is an identifier, never prose.
  it('keeps the key field left-to-right in Arabic', () => {
    const tag = /<input[^>]*id="template-key"[^>]*>/.exec(panel())?.[0] ?? '';
    expect(tag).toContain('dir="ltr"');
  });

  it('shows the detected variables, and nothing to edit them with', () => {
    expect(panel()).toContain('data-variables="name"');
  });

  it('shows the imbalance where the reader can act on it', () => {
    expect(panel({ bodyEn: 'Hello' })).toContain('role="alert"');
  });
});
