// FIX-2 — the reveal control on every password field, and the live requirement checklist.
//
// Rendered, not grepped. A source scan for `<PasswordInput` would pass on a screen where the field
// was imported and never used, and it would say nothing about the button's `type`, its accessible
// name, or whether the checklist lists the rules the SERVER asked for rather than a set typed into
// the client. Those are markup facts, so they are asserted against markup.
//
// **Two limits, stated rather than worked around:**
//
//   • The toggle's effect on `type` needs a click, and this suite has no DOM. What is proven here
//     is the closed state — `type="password"`, `aria-pressed="false"` — plus the fact that the
//     control is a `type="button"` bound to the field by `aria-controls`, which is what stops it
//     submitting the form. `PasswordRequirements` and `evaluatePasswordPolicy` carry the rest of
//     the behaviour and are pure, so the revealed state is proven by rendering the component with
//     it rather than by clicking into it.
//   • That the SERVER refuses a bad password regardless of what this screen did lives in
//     `apps/api/tests/integration/password-policy.spec.ts`.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  PASSWORD_RULES,
  type Locale,
  type MeDto,
  type PasswordPolicyDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../localization/i18n';
import { PasswordInput } from '../../shared/ui';
import { PasswordRequirements } from './PasswordRequirements';
import { passwordPolicyKey } from './password-policy';
import { LoginPage } from './LoginPage';
import { ActivationPage } from './ActivationPage';
import { ForcePasswordChangePage } from './ForcePasswordChangePage';
import SecurityPage from '../account/SecurityPage';

const STRICT: PasswordPolicyDto = { minLength: 10, requireComplexity: true };
const LENGTH_ONLY: PasswordPolicyDto = { minLength: 12, requireComplexity: false };

const me = (): MeDto => ({
  id: 'u-1',
  email: 'me@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'en',
  navLayout: 'rail',
  theme: 'system',
  branchId: null,
  employeeId: null,
  permissions: {},
  isPrivileged: false,
  flags: {},
  totpEnabled: false,
  external: null,
});

const render = (
  node: JSX.Element,
  {
    locale = 'en',
    policy = STRICT,
    path = '/',
  }: { locale?: Locale; policy?: PasswordPolicyDto | null; path?: string } = {},
): string => {
  const store = configureStore({
    // `ui` is in here because every one of these screens renders the theme toggle, which reads it.
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  if (policy !== null) qc.setQueryData(passwordPolicyKey, policy);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/**
 * Every password field in the markup.
 *
 * Matched on `type="password"` and nothing looser — an earlier version also accepted any input
 * carrying `autoComplete`, which counted the login screen's `autoComplete="username"` identifier as
 * a password field. A static render is always in the closed state, so this is the complete set.
 */
const passwordFields = (markup: string): string[] =>
  [...markup.matchAll(/<input\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes('type="password"'));

/** Every reveal button — identified by the attribute that makes it one. */
const revealButtons = (markup: string): string[] =>
  [...markup.matchAll(/<button\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes('aria-pressed'));

// The four screens and how many password fields each carries — nine in total, which is the
// inventory FIX-2 was scoped against.
const SCREENS: [string, JSX.Element, number, { path?: string }][] = [
  ['login', <LoginPage />, 1, {}],
  ['activation', <ActivationPage />, 2, { path: '/activate?token=abc' }],
  ['forced change', <ForcePasswordChangePage />, 3, {}],
  ['account security', <SecurityPage />, 3, {}],
];

describe('every password field on every screen has a reveal control', () => {
  it.each(SCREENS)('%s', (_name, node, count, options) => {
    const markup = render(node, options);
    expect(passwordFields(markup), 'password fields').toHaveLength(count);
    expect(revealButtons(markup), 'reveal buttons').toHaveLength(count);
  });

  it('covers nine fields in total, which is the whole inventory', () => {
    const total = SCREENS.reduce((sum, [, node, , options]) => {
      return sum + revealButtons(render(node, options)).length;
    }, 0);
    expect(total).toBe(9);
  });

  it('leaves no bare password input behind on any of them', () => {
    for (const [name, node, , options] of SCREENS) {
      const markup = render(node, options);
      const fields = passwordFields(markup);
      expect(fields.length, name).toBeGreaterThan(0);
      expect(revealButtons(markup).length, name).toBe(fields.length);
    }
  });
});

describe('the reveal control itself', () => {
  const markup = render(<PasswordInput id="pw" value="" onChange={() => undefined} />);
  const button = revealButtons(markup)[0] ?? '';
  const field = passwordFields(markup)[0] ?? '';

  it('starts closed', () => {
    expect(field).toContain('type="password"');
    expect(button).toContain('aria-pressed="false"');
  });

  // The one that would break a form: a <button> inside a <form> defaults to submit, so the first
  // click on the login screen would attempt a sign-in with a half-typed password.
  it('is a button that does not submit', () => {
    expect(button).toContain('type="button"');
  });

  it('carries an accessible name and points at the field it controls', () => {
    expect(button).toContain('aria-label="Show password"');
    expect(button).toContain('aria-controls="pw"');
  });

  it('names the action in Arabic too', () => {
    const arabic = render(<PasswordInput id="pw" value="" onChange={() => undefined} />, {
      locale: 'ar',
    });
    expect(revealButtons(arabic)[0] ?? '').toContain('إظهار كلمة المرور');
  });

  // Logical placement, so RTL needs no second rule.
  it('sits at the logical end of the field', () => {
    expect(button).toContain('end-0');
    expect(field).toContain('pe-10');
  });

  it('keeps the field left-to-right, because a password is not prose', () => {
    expect(field).toContain('dir="ltr"');
  });

  it('passes the caller’s attributes through untouched', () => {
    const withProps = render(
      <PasswordInput id="pw" required autoComplete="new-password" value="" onChange={() => undefined} />,
    );
    const tag = passwordFields(withProps)[0] ?? '';
    expect(tag).toContain('required');
    expect(tag).toContain('autoComplete="new-password"');
  });

  it('disables the button with the field', () => {
    const off = render(<PasswordInput id="pw" disabled value="" onChange={() => undefined} />);
    expect(revealButtons(off)[0] ?? '').toContain('disabled');
  });
});

describe('the requirements come from the server’s policy, not from this screen', () => {
  const list = (password: string, policy: PasswordPolicyDto): string =>
    render(<PasswordRequirements password={password} policy={policy} />);

  it('lists all five rules when the policy requires complexity', () => {
    const markup = list('', STRICT);
    for (const rule of PASSWORD_RULES) {
      expect(markup, rule).toContain(`data-met="false"`);
      expect(markup).toContain(translate('en', `common.password.rule.${rule}`, { count: 10 }));
    }
  });

  // The requirement the owner set: complexity off, complexity rules gone.
  it('lists ONLY the length rule when complexity is off', () => {
    const markup = list('', LENGTH_ONLY);
    expect(markup).toContain('At least 12 characters');
    for (const rule of ['lowercase', 'uppercase', 'digit', 'symbol'] as const) {
      expect(markup, rule).not.toContain(translate('en', `common.password.rule.${rule}`));
    }
  });

  it('names the length the policy asks for, not a constant', () => {
    expect(list('', { minLength: 16, requireComplexity: false })).toContain('At least 16 characters');
    expect(list('', { minLength: 8, requireComplexity: false })).toContain('At least 8 characters');
  });

  // Red → green, as markup: `data-met` flips per rule as the password gains each property.
  it('marks a rule met the moment the password satisfies it', () => {
    const empty = list('', STRICT);
    expect(empty.match(/data-met="true"/g) ?? []).toHaveLength(0);

    const partial = list('abcdefghij', STRICT); // length + lowercase
    expect(partial.match(/data-met="true"/g) ?? []).toHaveLength(2);

    const complete = list('Ab1!efghij', STRICT);
    expect(complete.match(/data-met="true"/g) ?? []).toHaveLength(5);
    expect(complete.match(/data-met="false"/g) ?? []).toHaveLength(0);
  });

  it('colours met and unmet rules differently, and says which in words as well', () => {
    const markup = list('abcdefghij', STRICT);
    expect(markup).toContain('text-emerald-600');
    expect(markup).toContain('text-red-600');
    expect(markup).toContain('requirement met');
    expect(markup).toContain('requirement not met');
  });

  it('announces changes to a screen reader rather than requiring a re-read', () => {
    expect(list('', STRICT)).toContain('aria-live="polite"');
  });

  // No policy, no checklist — never an invented one.
  it('renders nothing at all when the policy could not be read', () => {
    expect(render(<PasswordRequirements password="abc" policy={undefined} />)).toBe('');
  });

  it.each(['en', 'ar'] as const)('resolves every rule label — %s', (locale) => {
    const markup = render(<PasswordRequirements password="" policy={STRICT} />, { locale });
    expect(markup, 'an untranslated rule reached the list').not.toContain('common.password.');
  });
});

describe('where the checklist appears, and where it must not', () => {
  it('appears on activation, where a password is chosen for the first time', () => {
    const markup = render(<ActivationPage />, { path: '/activate?token=abc' });
    expect(markup).toContain('At least 10 characters');
  });

  it('appears on the forced change screen', () => {
    expect(render(<ForcePasswordChangePage />)).toContain('At least 10 characters');
  });

  it('appears on the account security screen', () => {
    expect(render(<SecurityPage />)).toContain('At least 10 characters');
  });

  // Sign-in is not a place to choose a password, and listing the rules there would describe the
  // shape of the secret being guessed.
  it('does NOT appear on the login screen', () => {
    expect(render(<LoginPage />)).not.toContain('At least 10 characters');
  });

  it('is absent everywhere when the policy could not be read', () => {
    const markup = render(<ActivationPage />, { path: '/activate?token=abc', policy: null });
    expect(markup).not.toContain('At least');
    // …and the field is still there, so the screen stays usable.
    expect(passwordFields(markup).length).toBeGreaterThan(0);
  });
});
