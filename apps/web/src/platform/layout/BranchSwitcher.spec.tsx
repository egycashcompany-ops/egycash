// The branch switcher, rendered for real.
//
// The web suite runs with `environment: 'node'` and carries no jsdom, so nothing here clicks. What
// a render proves is the two rules that decide whether this control is right at all: WHO is offered
// it, and WHAT a selection of several looks like once made.
//
// The first is the one that was wrong. `scopeSelector` narrows an `organization` grant to whatever
// the header names, whatever branch its holder happens to sit in — so deciding org-wideness from
// the PLACEMENT hid the control from exactly the account that sees every branch on every screen.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type DataScope, type Locale, type MeDto, type OrgUnitOptionDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';

const BRANCHES: OrgUnitOptionDto[] = [
  { id: 'b1', name: { ar: 'أكتوبر', en: 'October' } } as OrgUnitOptionDto,
  { id: 'b2', name: { ar: 'طنطا', en: 'Tanta' } } as OrgUnitOptionDto,
  { id: 'b3', name: { ar: 'أسيوط', en: 'Asyut' } } as OrgUnitOptionDto,
];

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: BRANCHES, isPending: false, isError: false }),
}));

// `window`, not bare `localStorage`: the component reads `window.localStorage`, and the suite runs
// with `environment: 'node'` where there is no window at all — without this the component's own
// try/catch swallows the ReferenceError and every stored selection reads back empty, which would
// make the label cases below pass for the wrong reason.
let stored = '';
vi.stubGlobal('window', {
  localStorage: {
    getItem: () => stored,
    setItem: (_k: string, v: string) => {
      stored = v;
    },
    removeItem: () => {
      stored = '';
    },
  },
});

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

const render = (account: MeDto, selection = '', locale: Locale = 'ar'): string => {
  stored = selection;
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

describe('who is offered the control', () => {
  it('offers it to an organization-wide account that sits in a branch', () => {
    // THE BUG THIS EXISTS FOR. Such an account sees every branch on every screen, and deciding
    // from `branchId` left it the one account with no way to narrow.
    const markup = render(
      me({ branchId: 'b1', permissions: { 'employee.view': 'organization' } }),
    );
    expect(markup).toContain('الشركة كلها');
  });

  it('offers it to an account whose grants reach more than one branch', () => {
    const markup = render(me({ branchId: 'b1', branchIds: ['b1', 'b2'] }));
    expect(markup).toContain('كل فروعي');
  });

  it('draws nothing at all for an account confined to one branch', () => {
    // For it the control would do nothing, and a control that does nothing is worse than none.
    expect(render(me({ branchId: 'b1', branchIds: ['b1'] }))).toBe('');
  });
});

describe('what the button says', () => {
  const ORG = me({ permissions: { 'employee.view': 'organization' } });

  it('names the branch when exactly one is ticked', () => {
    expect(render(ORG, 'b1')).toContain('أكتوبر');
  });

  it('counts them when several are — three site names do not fit in a command bar', () => {
    const markup = render(ORG, 'b1,b2,b3');
    expect(markup).toContain('3 فروع');
  });

  it('falls back to the unnarrowed label when nothing is ticked', () => {
    expect(render(ORG, '')).toContain('الشركة كلها');
  });

  it('reads a value stored by a version that only knew one branch', () => {
    // The stored format is the wire format, and one id is a list of one — nobody's remembered
    // choice is lost by the upgrade.
    expect(render(ORG, 'b2')).toContain('طنطا');
  });
});
