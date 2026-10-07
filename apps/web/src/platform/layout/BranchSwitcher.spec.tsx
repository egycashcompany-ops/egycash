// Who is offered the branch switcher.
//
// The web suite runs with `environment: 'node'` and carries no jsdom, so nothing here clicks. What
// a render proves is the one rule that decides whether this control is right at all — and it was
// wrong in the one direction that matters.
//
// `scopeSelector` applies NO branch filter to an `organization` grant when no branch is named, and
// narrows it to whatever branch the header does name — whoever holds it, and whatever branch its
// holder happens to sit in. So org-wideness is a fact about the GRANTS. Reading it off the
// PLACEMENT hid the control from the account that reads every branch on every screen: an
// organization-wide holder with a home branch, which is most of them, since a person is posted
// somewhere. «المستخدمين اللى النطاق بتاعهم الشركة كلها ليه مش بيظهرلهم الأفرع فوق؟»
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type DataScope, type Locale, type MeDto, type OrgUnitOptionDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';

const BRANCHES = [
  { id: 'b1', name: { ar: 'أكتوبر', en: 'October' } },
  { id: 'b2', name: { ar: 'طنطا', en: 'Tanta' } },
] as OrgUnitOptionDto[];

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: BRANCHES, isPending: false, isError: false }),
}));

// `window.localStorage`, not the bare global: the component reads the stored choice through
// `window`, and this suite has no window at all — without the stub the component's own try/catch
// swallows the ReferenceError and every case below would pass for the wrong reason.
vi.stubGlobal('window', { localStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} } });

const { BranchSwitcher } = await import('./BranchSwitcher');

const me = (over: Partial<MeDto> = {}): MeDto =>
  ({
    id: 'u1',
    email: 'u@ecms.local',
    username: null,
    mustChangePassword: false,
    name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
    locale: 'ar',
    navLayout: 'launchpad',
    theme: 'dark',
    branchId: null,
    branchIds: [],
    employeeId: null,
    permissions: {} as Record<string, DataScope>,
    isPrivileged: false,
    flags: {},
    totpEnabled: false,
    external: null,
    ...over,
  }) as MeDto;

const render = (account: MeDto, locale: Locale = 'ar'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: account },
    } as Parameters<typeof configureStore>[0]['preloadedState'],
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <BranchSwitcher />
    </Provider>,
  );
};

describe('who is offered the switcher', () => {
  it('offers it to an organization-wide account that sits in a branch', () => {
    // THE BUG. Such an account reads every branch on every screen and had no control to narrow
    // with, nor any way to tell which branch a row came from.
    const markup = render(me({ branchId: 'b1', permissions: { 'employee.view': 'organization' } }));
    expect(markup).toContain('الشركة كلها');
  });

  it('offers it to an organization-wide account with no branch at all', () => {
    expect(render(me({ permissions: { 'employee.view': 'organization' } }))).toContain('الشركة كلها');
  });

  it('offers it to an account whose grants reach more than one branch', () => {
    expect(render(me({ branchId: 'b1', branchIds: ['b1', 'b2'] }))).toContain('كل فروعي');
  });

  it('draws nothing for an account confined to one branch', () => {
    // For it the control would do nothing, and a control that does nothing is worse than none.
    expect(render(me({ branchId: 'b1', branchIds: ['b1'] }))).toBe('');
  });

  it('draws nothing for an account holding everything narrowly', () => {
    // Wide in COUNT is not wide in SCOPE: a hundred `department` grants still reach departments.
    const narrow = { 'employee.view': 'department', 'leave.view': 'branch' } as Record<string, DataScope>;
    expect(render(me({ branchId: 'b1', branchIds: ['b1'], permissions: narrow }))).toBe('');
  });
});
