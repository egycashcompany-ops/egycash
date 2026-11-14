// «إدارات العمليات» on a screen of its own (Round 14), and «كشف الأطقم» without it.
//
// The owner: «انا عاوز افصل ان احدد اداره معايا ولا لا عن تجهيز الطاقم», and asked where: «شاشة
// لوحدها في القائمة». What has to hold, rendered from the pages over a seeded cache and read from
// the router's source:
//
//   · the new page is the card, open, under the page's own title, with the people count beside it
//     for a reader who may read the roster — and no roster read at all for one who may not;
//   · its route is guarded by `setting.edit`, the grant that writes its one setting, and the link
//     the roster's notices draw points at that same route behind that same grant;
//   · «كشف الأطقم» no longer carries the card, and its «not configured» notice ends on the link (for
//     whoever may open the screen) or on the words saying who can (for everybody else).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  OperationsSettingKeys,
  type Locale,
  type MeDto,
  type OperationsCrewDirectoryDto,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { listKey } from '../../../shared/lib/query-keys';
import { MANAGED_ELSEWHERE } from '../../system-admin/settings/lib/settings-catalog';
import { CREW_DEPARTMENTS_PERMISSION, CREW_DEPARTMENTS_ROUTE } from '../lib/crew-departments';
import { CrewDepartmentsPage } from './CrewDepartmentsPage';
import { RequirementsPage } from './RequirementsPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ROUTES = readFileSync(fileURLToPath(new URL('../routes.tsx', import.meta.url)), 'utf8');

const MOH = '507f1f77bcf86cd7994390a1';
const CASH: OrgUnitOptionDto = {
  id: '507f1f77bcf86cd799439011',
  code: 'DEP-0004',
  name: { ar: 'نقل الأموال', en: 'Cash transfer' },
  parentId: MOH,
  catalogId: '6f0000000000000000000001',
};
const BRANCHES: OrgUnitOptionDto[] = [
  {
    id: MOH,
    code: '01',
    name: { ar: 'المهندسين', en: 'Mohandessin' },
    parentId: null,
    catalogId: null,
  },
];

const me = (permissions: string[]): MeDto =>
  ({
    id: 'u-1',
    email: 'user@ecms.local',
    username: null,
    mustChangePassword: false,
    name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
    locale: 'ar',
    theme: 'system',
    navLayout: 'rail',
    branchId: null,
    branchIds: [],
    employeeId: null,
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
    isPrivileged: false,
    external: null,
    flags: {},
    totpEnabled: true,
  }) as unknown as MeDto;

const member = (n: number): OperationsCrewDirectoryDto['members'][number] => ({
  employeeId: `e-${String(n)}`,
  code: `E${String(n)}`,
  fullNameAr: `موظف ${String(n)}`,
  status: 'active',
  requirements: null,
  assignedVehicleId: null,
});

const render = (
  node: JSX.Element,
  {
    permissions,
    locale = 'ar',
    roster = null,
  }: {
    permissions: string[];
    locale?: Locale;
    /** The roster the directory answers with, or null to leave it unasked. */
    roster?: OperationsCrewDirectoryDto | null;
  },
): { html: string; qc: QueryClient } => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'dark' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(
    ['platform', 'settings', 'me'],
    [
      {
        key: OperationsSettingKeys.CrewDepartmentIds,
        value: [CASH.id],
        resolvedFrom: 'organization',
      },
    ],
  );
  qc.setQueryData(['organization', 'departments', 'reference-options'], [CASH]);
  qc.setQueryData(['organization', 'departments', 'reference-options', 'withInactive'], [CASH]);
  qc.setQueryData(['organization', 'branches', 'options', 'withInactive'], BRANCHES);
  if (roster !== null) {
    qc.setQueryData(listKey('operations', 'crewDirectory', { date: 'tomorrow' }), roster);
  }
  const html = renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/operations/crew-departments']}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
  return { html, qc };
};

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const DERIVED: OperationsCrewDirectoryDto = {
  date: '2026-11-15',
  members: [member(1), member(2), member(3)],
  rosterIsDerived: true,
};
const FALLBACK: OperationsCrewDirectoryDto = { ...DERIVED, rosterIsDerived: false };

describe('«إدارات العمليات» — the card is the page', () => {
  it('titles the page «إدارات العمليات» and shows the departments at once, ticked as saved', () => {
    const { html } = render(<CrewDepartmentsPage />, { permissions: ['setting.edit'] });
    expect(ar('operations.crew.departments.title')).toBe('إدارات العمليات');
    expect(html).toMatch(/<h1[^>]*>إدارات العمليات<\/h1>/);
    expect(html).toContain('data-crew-departments="true"');
    expect(html).not.toContain('aria-expanded');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(html).toContain(ar('operations.crew.departments.hint'));
  });

  it('says how many people the saved choice makes, beside the title, for a roster reader', () => {
    const { html } = render(<CrewDepartmentsPage />, {
      permissions: ['setting.edit', 'operationsCrew.view'],
      roster: DERIVED,
    });
    expect(html).toContain('data-crew-departments-people="true"');
    expect(html).toContain(ar('operations.crew.departments.people', { count: 3 }));
  });

  it('counts nobody while the roster is the unconfigured fallback — that is not the choice’s result', () => {
    const { html } = render(<CrewDepartmentsPage />, {
      permissions: ['setting.edit', 'operationsCrew.view'],
      roster: FALLBACK,
    });
    expect(html).not.toContain('data-crew-departments-people');
  });

  it('never asks a settings administrator without the roster grant for the roster', () => {
    const { html, qc } = render(<CrewDepartmentsPage />, { permissions: ['setting.edit'] });
    expect(html).not.toContain('data-crew-departments-people');
    // The query exists (the hook ran) but was never sent: disabled, so no 403 to show.
    const state = qc.getQueryState(listKey('operations', 'crewDirectory', { date: 'tomorrow' }));
    expect(state?.fetchStatus ?? 'idle').toBe('idle');
    expect(state?.data).toBeUndefined();
  });

  it('is guarded by the grant that writes its setting — the one the link checks too', () => {
    const route = ROUTES.slice(ROUTES.indexOf('path="crew-departments"'));
    expect(/<RequirePermission permission="([^"]+)"/.exec(route)?.[1]).toBe('setting.edit');
    expect(route.slice(0, route.indexOf('/>'))).toContain('<CrewDepartmentsPage');
    expect(CREW_DEPARTMENTS_PERMISSION).toBe('setting.edit');
    expect(CREW_DEPARTMENTS_ROUTE).toBe('/operations/crew-departments');
  });

  it('sits right after «كشف الأطقم» in the router, as in the sidebar', () => {
    expect(ROUTES.indexOf('path="crew-departments"')).toBeGreaterThan(
      ROUTES.indexOf('path="requirements"'),
    );
    const between = ROUTES.slice(
      ROUTES.indexOf('path="requirements"'),
      ROUTES.indexOf('path="crew-departments"'),
    );
    expect(between.match(/path="/g)).toHaveLength(1);
  });

  it('is where the system settings screen sends the setting’s row, under this page’s title', () => {
    // The setting `operations.crewDepartmentIds` is a list of ids; System Settings shows how many
    // are set and links to the screen that edits them. That screen is this one now, not the roster.
    expect(MANAGED_ELSEWHERE[OperationsSettingKeys.CrewDepartmentIds]).toEqual({
      route: CREW_DEPARTMENTS_ROUTE,
      screen: 'operations.crew.departments.title',
    });
  });
});

describe('«كشف الأطقم» without the card', () => {
  it('draws no department picker any more — not even for somebody who may change it', () => {
    const { html } = render(<RequirementsPage />, {
      permissions: ['operationsCrew.view', 'setting.edit'],
      roster: DERIVED,
    });
    expect(html).toContain(ar('operations.crew.requirements.title'));
    expect(html).not.toContain('data-crew-departments');
    expect(html).not.toContain(ar('operations.crew.departments.hint'));
    expect(html).not.toContain(ar('operations.crew.departments.search'));
    // A configured roster says nothing about the departments at all.
    expect(html).not.toContain('data-requirements-unconfigured');
  });

  it('ends its «not configured» notice on a link to «إدارات العمليات», for whoever may open it', () => {
    const { html } = render(<RequirementsPage />, {
      permissions: ['operationsCrew.view', 'setting.edit'],
      roster: FALLBACK,
    });
    const notice = html.slice(html.indexOf('data-requirements-unconfigured'));
    expect(notice).toContain(ar('operations.crew.requirements.unconfigured'));
    // «اختر الإدارة بالأعلى» pointed at a card that is no longer above it.
    expect(ar('operations.crew.requirements.unconfigured')).not.toContain('بالأعلى');
    expect(notice).toContain('href="/operations/crew-departments"');
    expect(notice).toContain(ar('operations.crew.rosterFallbackLink'));
  });

  it('says who chooses it instead, with no dead link, to a planner without setting.edit', () => {
    const { html } = render(<RequirementsPage />, {
      permissions: ['operationsCrew.view', 'operationsCrew.plan'],
      roster: FALLBACK,
    });
    const notice = html.slice(html.indexOf('data-requirements-unconfigured'));
    expect(notice).not.toContain('/operations/crew-departments');
    expect(notice).toContain(ar('operations.crew.departmentsElsewhere'));
  });
});
