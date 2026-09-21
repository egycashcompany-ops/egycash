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
    expect(render({ locale: 'ar' })).toContain('ما سيراه صلاح');
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

describe('the branch level', () => {
  it('is a heading, not a checkbox — there is no record for it to write', () => {
    // A tri-state box here would read «tick the rest» and could only ever take away. The state is
    // drawn, the count is drawn, and removing is a button that says what it does.
    const body = SOURCE.slice(SOURCE.indexOf('const BranchCard ='), SOURCE.indexOf('const WholeBranchBlock ='));
    expect(body).not.toContain('<Checkbox');
    expect(body).not.toContain('indeterminate');
  });

  it('offers the clear only when something there is the caller’s to remove', () => {
    // The caller delegates in d1 only, and nothing is granted yet: nothing to clear.
    expect(render()).not.toContain('Clear this branch');
    // A grant from somebody with more authority is still not his to remove.
    expect(render({ grants: GRANTS })).not.toContain('Clear this branch');
  });
});

describe('a module the dictionary has no name for', () => {
  it('is headed by its own id, never by the unresolved key', () => {
    // The key is built from data, so no source scan can check it and `translate` answers a missing
    // key with the key itself. A module added to the registry without a label would otherwise put
    // `systemAdmin.roles.module.zzz` on the screen as a heading.
    const catalog: DelegationCatalogDto = {
      ...CATALOG,
      branches: [
        {
          ...(CATALOG.branches[0] as DelegationCatalogDto['branches'][number]),
          departments: [
            {
              id: 'd1',
              name: { ar: 'الحركة', en: 'Fleet' },
              permissionKeys: ['vehicle.view', 'widget.view'],
            },
          ],
        },
      ],
      pages: [
        ...CATALOG.pages,
        { id: 'zzz.widgets', moduleId: 'zzz', name: { ar: 'ودجت', en: 'Widgets' }, route: null, sortOrder: 3 },
      ],
      permissions: [...CATALOG.permissions, p('widget.view', 'zzz', 'zzz.widgets')],
    };
    const html = render({ catalog });
    expect(html).not.toContain('systemAdmin.roles.module.');
    expect(html).toContain('>zzz screens<');
    // The modules that DO have a name still get it.
    expect(html).toContain('>Fleet screens<');
  });

  // A module and a department are named after the same work — «الحركة» is both — and nested one
  // inside the other as plain rows they read as two levels of the same kind of thing. The heading
  // has to say what it groups, or the tree reads as «الحركة، and inside it الحركة».
  it('heads a module with what it groups, so it cannot be read as another department', () => {
    // Two modules, so the heading is drawn at all — with one it is suppressed, since a manager
    // delegating fleet screens should not open a group called «الحركة» to reach his only screen.
    const twoModules: DelegationCatalogDto = {
      ...CATALOG,
      branches: [
        {
          ...(CATALOG.branches[0] as DelegationCatalogDto['branches'][number]),
          departments: [
            {
              id: 'd1',
              name: { ar: 'الحركة', en: 'Fleet' },
              permissionKeys: ['vehicle.view', 'employee.view'],
            },
          ],
        },
      ],
      permissions: [...CATALOG.permissions, p('employee.view', 'hr', 'hr.employees')],
    };
    const html = render({ catalog: twoModules });
    // The department is «Fleet»; the module heading beneath it must not be the same string.
    expect(html).toContain('>Fleet<');
    expect(html).toContain('>Fleet screens<');
    expect(html.indexOf('>Fleet<')).toBeLessThan(html.indexOf('>Fleet screens<'));
  });
});

describe('the counters', () => {
  it('count what is drawn beneath them, and leave no placeholder unfilled', () => {
    const html = render();
    expect(html).toContain('1 departments');
    expect(html).not.toContain('{{');
  });

  // An owner's ceiling is the whole registry in every department, so the old fallback printed the
  // same «93 screens» on eighteen rows — a number that says nothing about the row it is on and
  // buries the two rows that carry a grant. A department with nothing says so in words.
  it('says a department holds nothing rather than repeating the registry total', () => {
    const html = render();
    expect(html).toContain('nothing yet');
  });

  it('counts a screen held from above apart from the ones that are his', () => {
    // The count no longer means «refused to you» — nothing refused is drawn at all now. What is
    // left to count is a grant somebody with wider authority made, which he may see and not touch.
    const html = render({ grants: GRANTS });
    expect(html).toContain('1 granted from above');
    expect(html).not.toContain('not yours to grant');
  });
});
