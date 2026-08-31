// The two surfaces that turn an invisible setting into a visible one, rendered for real.
//
// `crew-departments.spec.ts` proves the rules; `operations-i18n.spec.ts` proves the catalogs hold
// the keys. Neither proves the components ASK for the keys that exist, or that the picker is
// withheld from a caller who cannot write the setting — and both of those failures are silent: a
// mistyped key renders as `operations.crew.departments.title` on an Arabic screen, and a picker
// shown to a planner offers a Save that the server answers with 403.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  OperationsSettingKeys,
  type Locale,
  type MeDto,
  type OrgUnitOptionDto,
  type ResolvedSettingDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { CrewDepartmentsCard } from './CrewDepartmentsCard';
import { CrewRosterNotice } from './CrewRosterNotice';

const CASH: OrgUnitOptionDto = {
  id: '507f1f77bcf86cd799439011',
  code: 'DEP-01',
  name: { ar: 'نقل الأموال', en: 'Cash transfer' },
};
const HR: OrgUnitOptionDto = {
  id: '507f1f77bcf86cd799439012',
  code: 'DEP-02',
  name: { ar: 'الموارد البشرية', en: 'Human resources' },
};

const me = (permissions: string[]): MeDto => ({
  id: 'u-1',
  email: 'user@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'en',
  theme: 'system',
  navLayout: 'rail',
  branchId: null,
  employeeId: null,
  permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  isPrivileged: false,
  external: null,
  flags: {},
  totpEnabled: true,
});

const setting = (value: unknown): ResolvedSettingDto => ({
  key: OperationsSettingKeys.CrewDepartmentIds,
  value,
  resolvedFrom: value === undefined ? 'default' : 'organization',
});

const render = (
  node: JSX.Element,
  {
    locale = 'en',
    permissions = ['setting.edit'],
    options = [CASH, HR],
    configured = [] as string[],
  }: {
    locale?: Locale;
    permissions?: string[];
    options?: OrgUnitOptionDto[] | null;
    configured?: string[];
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
  qc.setQueryData(['platform', 'settings', 'me'], [setting(configured)]);
  if (options !== null) {
    qc.setQueryData(['organization', 'departments', 'reference-options'], options);
  }
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/operations/crew-board']}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const card = (over: Parameters<typeof render>[1] = {}): string =>
  render(<CrewDepartmentsCard />, over);

describe('CrewDepartmentsCard — the setting, as department names', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    it(`titles itself in ${locale} and lists the departments by their ${locale} name`, () => {
      const title = translate(locale, 'operations.crew.departments.title');
      // Guard the guard: a key falling back to itself would make the assertion vacuous.
      expect(title).not.toBe('operations.crew.departments.title');
      const html = card({ locale });
      expect(html).toContain(title);
      expect(html).toContain(locale === 'ar' ? CASH.name.ar : CASH.name.en);
      expect(html).toContain(locale === 'ar' ? HR.name.ar : HR.name.en);
    });
  }

  it('ticks the configured department and only that one', () => {
    const html = card({ configured: [CASH.id] });
    const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toContain('checked');
    expect(boxes[1]).not.toContain('checked');
  });

  // The whole reason this card exists: an unset setting is a working screen showing a stale list.
  it('warns when nothing is chosen', () => {
    expect(card()).toContain(translate('en', 'operations.crew.departments.emptyWarning'));
  });

  it('says nothing about an empty selection once a department is chosen', () => {
    expect(card({ configured: [CASH.id] })).not.toContain(
      translate('en', 'operations.crew.departments.emptyWarning'),
    );
  });

  // A configured id that no ACTIVE department answers to is still configured. Dropping it from the
  // list would hide a live part of the configuration — the exact failure this card ends.
  it('shows a configured id that is not in the options, marked as missing', () => {
    const html = card({ configured: [CASH.id, '507f1f77bcf86cd7994390ff'] });
    expect(html).toContain(translate('en', 'operations.crew.departments.stale'));
    expect(html).toContain(translate('en', 'operations.crew.departments.unknownDepartment'));
  });

  // `setting.edit` is what the server demands of the write. Offering the control to anyone else
  // would be an invitation to a 403.
  it('renders nothing at all without setting.edit', () => {
    expect(card({ permissions: ['operationsCrew.plan'] })).toBe('');
  });

  it('says so when there is genuinely nothing to choose, rather than showing an empty grid', () => {
    const html = card({ options: [] });
    expect(html).toContain(translate('en', 'operations.crew.departments.none'));
  });

  it('says it is still loading rather than claiming there are no departments', () => {
    const html = card({ options: null });
    expect(html).toContain(translate('en', 'common.loading'));
    expect(html).not.toContain(translate('en', 'operations.crew.departments.none'));
  });
});

describe('CrewRosterNotice — the pool explains its own short list', () => {
  it('is silent while the roster is still loading', () => {
    expect(render(<CrewRosterNotice rosterIsDerived={undefined} />)).toBe('');
  });

  it('is silent when the roster comes from the org chart', () => {
    expect(render(<CrewRosterNotice rosterIsDerived />)).toBe('');
  });

  for (const locale of ['en', 'ar'] as Locale[]) {
    it(`explains the fallback in ${locale} and links to the screen that fixes it`, () => {
      const html = render(<CrewRosterNotice rosterIsDerived={false} />, { locale });
      const body = translate(locale, 'operations.crew.rosterFallback');
      expect(body).not.toBe('operations.crew.rosterFallback');
      expect(html).toContain(body);
      expect(html).toContain(translate(locale, 'operations.crew.rosterFallbackLink'));
      expect(html).toContain('/operations/requirements');
    });
  }
});
