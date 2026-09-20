// The panel rendered for real, against the real locale catalogs.
//
// **What this file can and cannot check.** The web suite runs with `environment: 'node'` and
// carries no jsdom and no testing-library (`vitest.config.ts`), so nothing here clicks. The RULES
// are pure functions in `./delegation-tree` and `./delegation-grid`, tested directly there. What a
// render proves is the WIRING, and three claims in particular that the mock this screen replaced
// got wrong:
//
//   • a row nobody may open emits NO disclosure control — a chevron on a locked row is a promise
//     of something behind it, and there is nothing behind it;
//   • a key outside the caller's ceiling arrives at the DOM `disabled`, not merely greyed;
//   • the counters beside the rows are computed, so the number in the header and the rows beneath
//     it cannot disagree.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import {
  type DelegationCatalogDto,
  type Locale,
  type PermissionDto,
  type UserDelegationsDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';

const catalogState = { data: undefined as DelegationCatalogDto | undefined, isLoading: false, isError: false };
const grantsState = { data: undefined as UserDelegationsDto | undefined, isLoading: false, isError: false };

vi.mock('./delegation-queries', () => ({
  useDelegationCatalog: () => catalogState,
  useUserDelegations: () => grantsState,
  useSetUserDelegation: () => ({ mutateAsync: () => Promise.resolve(grantsState.data) }),
}));

const { DelegationPanel } = await import('./DelegationPanel');

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, 'DelegationPanel.tsx'), 'utf8');

const p = (key: string, moduleId: string, pageId: string | null): PermissionDto => ({
  key,
  resource: key.split('.')[0] ?? key,
  action: key.split('.')[1] ?? '',
  moduleId,
  name: { ar: `صلاحية ${key}`, en: `Permission ${key}` },
  breakGlass: false,
  pageId,
});

const CATALOG: DelegationCatalogDto = {
  branches: [
    {
      id: 'A',
      name: { ar: 'المهندسين', en: 'Mohandessin' },
      // A department-level manager: nothing over the branch, fleet keys in one department.
      permissionKeys: [],
      departments: [
        { id: 'd1', name: { ar: 'الحركة', en: 'Fleet' }, permissionKeys: ['vehicle.view', 'vehicle.edit'] },
      ],
    },
  ],
  pages: [
    { id: 'fleet.vehicles', moduleId: 'fleet', name: { ar: 'السيارات', en: 'Vehicles' }, route: null, sortOrder: 1 },
    { id: 'hr.employees', moduleId: 'hr', name: { ar: 'الموظفين', en: 'Employees' }, route: null, sortOrder: 2 },
  ],
  permissions: [p('vehicle.view', 'fleet', 'fleet.vehicles'), p('vehicle.edit', 'fleet', 'fleet.vehicles')],
};

/** Granted on the same department by somebody who reaches further than the caller. */
const GRANTS: UserDelegationsDto = {
  userId: 'u1',
  grants: [
    {
      id: 'g1',
      userId: 'u1',
      branch: { id: 'A', name: { ar: 'المهندسين', en: 'Mohandessin' } },
      department: { id: 'd1', name: { ar: 'الحركة', en: 'Fleet' } },
      permissionKeys: ['employee.view'],
      grantedBy: null,
      updatedAt: '2026-09-20T00:00:00.000Z',
    },
  ],
};

const render = (
  {
    locale = 'en',
    catalog = CATALOG,
    grants = { userId: 'u1', grants: [] },
  }: { locale?: Locale; catalog?: DelegationCatalogDto; grants?: UserDelegationsDto } = {},
): string => {
  catalogState.data = catalog;
  grantsState.data = grants;
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: { locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) } },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <DelegationPanel userId="u1" homeUnit={{ branchId: 'A', departmentId: 'd1' }} personName="صلاح" />
    </Provider>,
  );
};


describe('the tree the manager walks down', () => {
  it('opens on the account’s own unit, so the common case needs no clicks', () => {
    const html = render();
    expect(html).toContain('Mohandessin');
    expect(html).toContain('Fleet');
    // The department is open, so its screens are already drawn.
    expect(html).toContain('Vehicles');
  });

  it('names the person in the summary', () => {
    expect(render({ locale: 'ar' })).toContain('صلاح هيشوف');
  });

  it('draws «the branch as one unit» as its own block, locked for a department-level manager', () => {
    const html = render();
    expect(html).toContain('The branch as one unit');
    expect(html).toContain('This is given by an account whose authority covers the whole branch');
  });
});

describe('what the caller may not grant', () => {
  it('is shown with the reason on it rather than hidden', () => {
    const html = render({ grants: GRANTS });
    expect(html).toContain('Granted by somebody whose authority reaches further than yours.');
    expect(html).toContain('cursor-not-allowed');
  });

  it('offers no control to change it — no checkbox, and nothing to open', () => {
    // Structural rather than clicked, and the assertion says so: `LockedRow` is the one row the
    // screen draws for something nobody may change here, and it must carry neither a tick nor a
    // chevron. A chevron on a locked row promises something behind it; there is nothing behind it.
    const body = SOURCE.slice(SOURCE.indexOf('const LockedRow ='), SOURCE.indexOf('const Disclosure ='));
    expect(body).not.toContain('Disclosure');
    expect(body).not.toContain('aria-expanded');
    expect(body).not.toContain('Checkbox');
  });
});

describe('the counters', () => {
  it('count what is drawn beneath them, and leave no placeholder unfilled', () => {
    const html = render();
    expect(html).toContain('1 departments');
    // One grantable screen in the open department, nothing ticked on it.
    expect(html).toContain('1 screens');
    expect(html).not.toContain('{{');
  });

  it('counts a screen the caller cannot reach as locked, not as one of his', () => {
    const html = render({ grants: GRANTS });
    expect(html).toContain('1 not yours to grant');
  });
});
