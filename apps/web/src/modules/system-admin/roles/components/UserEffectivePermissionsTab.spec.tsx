// «ما يستطيعه هذا الحساب» — rendered for real, against the real locale catalogs.
//
// The web suite runs with `environment: 'node'` and carries no jsdom, so nothing here clicks. What
// a render proves is the one thing this screen got wrong badly enough to be unusable: it kept
// every fact on the page at once. Three hundred keys drew three hundred two-line rows with four
// badges each, across eight cards all open — «مش شايف ليها لازمة وشكلها كده». Nothing was hidden,
// and nothing could be read.
//
// So each of the three rules that fixed it gets a case, because each one is a line somebody could
// delete in good faith while «making the screen show more».
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import {
  type EffectivePermissionRowDto,
  type EffectivePermissionsDto,
  type Locale,
  type UserDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';

const state = { data: undefined as EffectivePermissionsDto | undefined, isLoading: false, isError: false };

vi.mock('../api/role-queries', () => ({
  useEffectivePermissions: () => state,
}));
// Every permission is held, so the read is never refused and the cases are about the rendering.
vi.mock('../../../../platform/rbac/Can', () => ({
  useCan: () => () => true,
  Can: ({ children }: { children: unknown }) => children,
}));

const { UserEffectivePermissionsTab } = await import('./UserEffectivePermissionsTab');

const row = (
  key: string,
  moduleId: string | null,
  over: Partial<EffectivePermissionRowDto> = {},
): EffectivePermissionRowDto => ({
  key,
  moduleId,
  name: { ar: `صلاحية ${key}`, en: `Permission ${key}` },
  breakGlass: false,
  scope: 'department',
  state: 'active',
  sources: [],
  ...over,
});

const explained = (rows: EffectivePermissionRowDto[]): EffectivePermissionsDto => ({
  userId: 'u1',
  evaluatedAt: '2026-09-21T10:00:00.000Z',
  permissionVersion: 1,
  isPrivileged: false,
  privilegedBecause: { systemRoles: [], breakGlassKeys: [] },
  rows,
});

const USER = { id: 'u1' } as UserDto;

/** `route` carries the filters, which is where this screen keeps them — see `patch()`. */
const render = (
  rows: EffectivePermissionRowDto[],
  { locale = 'ar' as Locale, route = '/x' } = {},
): string => {
  state.data = explained(rows);
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: { locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) } },
  });
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[route]}>
      <Provider store={store}>
        <UserEffectivePermissionsTab user={USER} />
      </Provider>
    </MemoryRouter>,
  );
};

describe('a module opens when asked, not before', () => {
  it('draws the module heading and withholds its rows until it is opened', () => {
    const markup = render([row('leave.view', 'hr'), row('leave.approve', 'hr')]);
    expect(markup).toContain('الموارد البشرية');
    // The rows are real and are not in the DOM: eight headers answer «which area» before three
    // hundred rows answer anything.
    expect(markup).not.toContain('صلاحية leave.view');
  });

  it('opens everything once the reader has filtered — he already asked', () => {
    const markup = render([row('leave.view', 'hr')], { route: '/x?q=leave' });
    expect(markup).toContain('صلاحية leave.view');
  });
});

describe('what a closed module still says', () => {
  it('carries the counts that answer «why can’t he» without being opened', () => {
    const markup = render([
      row('a.view', 'hr'),
      row('b.view', 'hr', { state: 'expired', scope: null }),
      row('c.view', 'hr', { state: 'pending', scope: null }),
    ]);
    expect(markup).toContain('1 انتهت');
    expect(markup).toContain('1 لم تبدأ');
    // And the account's own line says the same thing before any module is reached.
    expect(markup).toContain('1 سارية');
  });
});

describe('a badge that is on every row is not a badge', () => {
  it('draws no state badge on a permission that is simply in force', () => {
    const markup = render([row('a.view', 'hr')], { route: '/x?q=a' });
    // «سارٍ» is the state badge's own wording; the summary above uses «سارية» and is a count.
    expect(markup).not.toContain('>سارٍ<');
  });
});

describe('the raw key', () => {
  it('is not a second line under every name — it lives with the sources', () => {
    // Three hundred keys meant three hundred extra monospace lines. The key is what a support
    // conversation quotes, not what an administrator scans.
    const markup = render([row('leave.view', 'hr')]);
    expect(markup).not.toContain('font-mono');
  });

  it('stays inline for a key the registry no longer names, where it IS the name', () => {
    const markup = render([row('retired.view', null, { name: null })], { route: '/x?q=retired' });
    expect(markup).toContain('retired.view');
  });
});
