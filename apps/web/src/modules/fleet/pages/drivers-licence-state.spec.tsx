// The drivers screens say what the dashboard says about a driver's licence (audit D08, D14, D28,
// D29, D30, D31, D47) — measured at the audit's clock, 2026-10-31T23:30Z = 01:30 on 1 November in
// Cairo, the first two hours of a Cairo month in which the browser's UTC calendar is still on the
// previous day and the previous month.
//
//   D08  the driver file calls a licence expired ON its expiry day (the Cairo day), as the
//        dashboard's «رخص سائقين منتهية» does — not after the stored instant has passed.
//   D28  «رخص تنتهي هذا الشهر» counts the Cairo month: November, not the UTC October.
//   D29  the list's licence colour reads «إعدادات الحركة»'s warning days, not a fixed thirty.
//   D30  the licence-date chip says «رخصة غير مسجّلة», the dashboard line's words; «غير مسجَّل» in
//        the header's note meant «بلا ملف سائق».
//   D31  «الإحصائيات» counts the branches the dashboard's driver figures cover: the top bar's
//        branch, or the reader's own; the table still follows the URL.
//   D14  a closed branch is named, in the column, the picker's chip and the driver file.
//   D47  a suspended file reads «الملف موقوف», as the dashboard and «تعيين السيارات» write it.
//
// The web suite runs with `environment: 'node'` and no jsdom, so nothing clicks: markup is
// rendered with `renderToStaticMarkup` from a pre-seeded query cache, and «الإحصائيات» (drawn only
// once pressed) is proven through the request the page registers and the pure counters it draws.
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type DataScope,
  type FleetDriverProfileDto,
  type FleetDriverRowDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { translate } from '../../../platform/localization/i18n';
import { detailKey, listKey } from '../../../shared/lib/query-keys';
import { setActiveBranch } from '../../../shared/lib/api-client';
import { DriversListPage, driverLicenceFiguresOf } from './DriversListPage';
import { dashboardScopeOf, registryBranchesOf } from '../lib/reader-branches';
import { DriverProfilePage } from './DriverProfilePage';
import type * as FleetApi from '../api/fleet-api';

// Every page in the registry walk goes through here, so the request the header sends is the
// call this records. Nothing else in the file fetches: the render reads a seeded cache.
const listDrivers = vi.hoisted(() => vi.fn());
vi.mock('../api/fleet-api', async (importOriginal) => ({
  ...(await importOriginal<typeof FleetApi>()),
  listDrivers,
}));

/** 01:30 on 1 November in Cairo — still 31 October, and October, by the UTC calendar. */
const NOW = new Date('2026-10-31T23:30:00.000Z');

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(() => {
  setActiveBranch(null);
  listDrivers.mockReset();
});

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────

const ar = (key: string, vars?: Record<string, string>): string => translate('ar', key, vars);

const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
});

const profile = (
  id: string,
  overrides: Partial<FleetDriverProfileDto> = {},
): FleetDriverProfileDto => ({
  id,
  employeeId: `e-${id}`,
  licenseNumber: `DL-${id}`,
  licenseExpiresAt: '2027-05-01T00:00:00.000Z',
  jobId: null,
  specializationId: null,
  licenseTypeId: null,
  specialization: null,
  area: null,
  isActive: true,
  licenseImage: null,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const row = (p: FleetDriverProfileDto | null, employeeId = p?.employeeId ?? 'e-none') =>
  ({ employeeId, profile: p }) as FleetDriverRowDto;

/**
 * The audit's registry (licences.md L3, L5): two licences in November, three in October, one in
 * December, a file with no date and a driver with no file at all.
 */
const REGISTRY: FleetDriverRowDto[] = [
  // Runs out TODAY in Cairo, stamped at the UTC midnight that is still tomorrow by the UTC clock.
  row(profile('today', { licenseExpiresAt: '2026-11-01T00:00:00.000Z', isActive: false })),
  row(profile('nov20', { licenseExpiresAt: '2026-11-20T00:00:00.000Z' })),
  row(profile('oct05', { licenseExpiresAt: '2026-10-05T00:00:00.000Z' })),
  row(profile('oct15', { licenseExpiresAt: '2026-10-15T00:00:00.000Z' })),
  row(profile('oct31', { licenseExpiresAt: '2026-10-31T00:00:00.000Z' })),
  // 39 days ahead: «ينتهي قريبًا» under 45 warning days, «ساري» under 30.
  row(profile('dec10', { licenseExpiresAt: '2026-12-10T00:00:00.000Z' })),
  row(profile('nodate', { licenseExpiresAt: null })),
  row(null, 'e-nofile'),
];

/** The parameters the page hands `useDrivers` on an unfiltered first load, plus `overrides`. */
const driverParams = (overrides: Record<string, unknown> = {}) => ({
  page: 1,
  pageSize: 25,
  sortBy: 'employeeCode',
  sortDir: 'asc',
  sort: 'employeeCode:asc',
  ...overrides,
});

const B1 = { id: 'b1', name: 'المهندسين' };
const CLOSED = { id: 'b-closed', name: 'فرع العتبة المغلق' };
const option = (b: { id: string; name: string }) => ({
  id: b.id,
  code: b.id,
  name: { ar: b.name, en: b.name },
  parentId: null,
  catalogId: null,
});

const person = (employeeId: string, branchId: string | null) => ({
  employeeId,
  code: `0010${employeeId}`,
  fullNameAr: `سائق ${employeeId}`,
  status: 'active' as const,
  branchId,
  address: null,
  governorate: null,
  phone: null,
  hiredAt: null,
});

/** A client seeded with the branches (active and every one), the people, and `rows` under `params`. */
const client = (
  rows: FleetDriverRowDto[],
  params: Record<string, unknown> = {},
  { warnDays, people }: { warnDays?: number; people?: ReturnType<typeof person>[] } = {},
): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(listKey('fleet', 'drivers', driverParams(params)), page(rows));
  // The picker's list: the ACTIVE branches only. The names: every branch, the closed one too.
  qc.setQueryData(['organization', 'branches', 'options'], [option(B1)]);
  qc.setQueryData(
    ['organization', 'branches', 'options', 'withInactive'],
    [option(B1), option(CLOSED)],
  );
  qc.setQueryData(['fleet', 'people'], people ?? rows.map((r) => person(r.employeeId, B1.id)));
  if (warnDays !== undefined) {
    qc.setQueryData(
      ['platform', 'settings', 'me'],
      [{ key: 'fleet.license.driverWarnDays', value: warnDays }],
    );
  }
  return qc;
};

const me = (
  scope: DataScope,
  { branchId = null, branchIds = [] }: { branchId?: string | null; branchIds?: string[] } = {},
): MeDto =>
  ({
    id: 'u1',
    branchId,
    branchIds,
    permissions: { 'fleetDriver.view': scope, 'fleetDriver.manage': scope },
  }) as unknown as MeDto;

const render = (
  node: JSX.Element,
  qc: QueryClient,
  {
    route = '/fleet/drivers',
    reader = me('organization'),
  }: { route?: string; reader?: MeDto } = {},
  path = '/fleet/drivers',
): string => {
  const locale: Locale = 'ar';
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: 'rtl' as const },
      auth: { me: reader, status: 'signedIn' as const },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The licence-date cell of the row whose expiry prints as `day` (`2026/12/10`). */
const licenceCell = (html: string, day: string): string => {
  const at = html.indexOf(`>${day}</span>`);
  expect(at, `the row expiring ${day} is drawn`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<span', at), at);
};

const barOf = (html: string): string => html.slice(0, html.indexOf('<table'));
const tbodyOf = (html: string): string =>
  html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));

// ── D28 · «هذا الشهر» and «منتهية» by the Cairo calendar ───────────────────────────────────────────

describe('«الإحصائيات» count by the Cairo day and month (D28)', () => {
  it('the trap: at 01:30 Cairo on the 1st, the browser’s UTC month is still October', () => {
    expect(new Date().toISOString().slice(0, 7)).toBe('2026-10');
  });

  it('«رخص تنتهي هذا الشهر» = November’s 2, as the dashboard — not October’s 3', () => {
    const figures = driverLicenceFiguresOf(REGISTRY);
    expect(figures.thisMonth).toBe(2);
    // What the header used to count: the UTC month's licences.
    const utcMonth = REGISTRY.filter(
      (r) => r.profile?.licenseExpiresAt?.slice(0, 7) === new Date().toISOString().slice(0, 7),
    ).length;
    expect(utcMonth, 'the old answer').toBe(3);
  });

  it('«رخص منتهية» = 4: expired ON its expiry day — today’s licence counts from the first hour', () => {
    const figures = driverLicenceFiguresOf(REGISTRY);
    expect(figures.expired).toBe(4);
    // A licence stamped later in the day (an import) is expired all day, too.
    expect(
      driverLicenceFiguresOf([
        row(profile('late', { licenseExpiresAt: '2026-11-01T10:00:00.000Z' })),
      ]).expired,
    ).toBe(1);
  });

  it('«مسجَّل» and «بلا ملف سائق» split the registry by the Fleet file', () => {
    const figures = driverLicenceFiguresOf(REGISTRY);
    expect(figures.total).toBe(8);
    expect(figures.recorded).toBe(7);
    expect(figures.total - figures.recorded, '«بلا ملف سائق»').toBe(1);
  });
});

// ── D31 · the branches «الإحصائيات» count ─────────────────────────────────────────────────────────

describe('«الإحصائيات» count the dashboard’s branches (D31)', () => {
  it('folds the top bar’s branch into the reader’s grant, as the server does', () => {
    // Organization-wide: the company, or the switcher's branch.
    expect(registryBranchesOf({ scope: 'organization', active: null, home: 'b1', reach: [] })).toBe(
      null,
    );
    expect(
      registryBranchesOf({ scope: 'organization', active: 'b2', home: 'b1', reach: [] }),
    ).toEqual(['b2']);
    // A branch reader: their own branch — the switcher cannot widen it.
    expect(registryBranchesOf({ scope: 'branch', active: null, home: 'b1', reach: [] })).toEqual([
      'b1',
    ]);
    expect(registryBranchesOf({ scope: 'branch', active: 'b2', home: 'b1', reach: [] })).toEqual([
      'b1',
    ]);
    // «كل فروعي»: every branch of the reach, or the one chosen among them.
    expect(
      registryBranchesOf({ scope: 'branch', active: null, home: 'b1', reach: ['b1', 'b2'] }),
    ).toEqual(['b1', 'b2']);
    expect(
      registryBranchesOf({ scope: 'branch', active: 'b2', home: 'b1', reach: ['b1', 'b2'] }),
    ).toEqual(['b2']);
    expect(
      registryBranchesOf({ scope: 'branch', active: 'b3', home: 'b1', reach: ['b1', 'b2'] }),
    ).toEqual(['b1', 'b2']);
    // A reach that holds no branch counts nobody — never the whole company.
    expect(registryBranchesOf({ scope: 'branch', active: null, home: null, reach: [] })).toEqual(
      [],
    );
  });

  /** The whole-registry read the page registered on its first paint (disabled until pressed). */
  const registryQuery = (qc: QueryClient) => {
    const found = qc
      .getQueryCache()
      .findAll({ queryKey: ['fleet', 'drivers', 'list'] })
      .filter((q) => (q.queryKey[3] as { whole?: boolean } | undefined)?.whole === true);
    expect(found, 'one whole-registry read').toHaveLength(1);
    return found[0]!;
  };

  it('under the switcher on «فرع ب» it asks for that branch’s drivers only', async () => {
    setActiveBranch('b2');
    const qc = client(REGISTRY);
    render(<DriversListPage />, qc);
    const query = registryQuery(qc);
    expect(query.queryKey).toEqual(listKey('fleet', 'drivers', { whole: true, branchId: ['b2'] }));
    expect(query.isDisabled(), 'read only when «الإحصائيات» opens').toBe(true);
    // The request itself: the branch travels as `branchId`, on every page of the walk.
    listDrivers.mockResolvedValue(page([]));
    const fn = query.options.queryFn as (ctx: unknown) => Promise<unknown>;
    await fn({ queryKey: query.queryKey, signal: new AbortController().signal, meta: undefined });
    expect(listDrivers).toHaveBeenCalled();
    for (const [params] of listDrivers.mock.calls) {
      expect(params).toMatchObject({ branchId: ['b2'] });
    }
  });

  it('a «كل فروعي» reader with no switcher counts their branches; the company reader all', () => {
    const multi = client(REGISTRY);
    render(<DriversListPage />, multi, {
      reader: me('branch', { branchId: 'b1', branchIds: ['b1', 'b2'] }),
    });
    expect(registryQuery(multi).queryKey).toEqual(
      listKey('fleet', 'drivers', { whole: true, branchId: ['b1', 'b2'] }),
    );
    const company = client(REGISTRY);
    render(<DriversListPage />, company);
    expect(registryQuery(company).queryKey).toEqual(
      listKey('fleet', 'drivers', { whole: true, branchId: null }),
    );
  });

  it('the company reader’s walk sends no branch at all', async () => {
    const qc = client(REGISTRY);
    render(<DriversListPage />, qc);
    listDrivers.mockResolvedValue(page(REGISTRY));
    const query = registryQuery(qc);
    const fn = query.options.queryFn as (ctx: unknown) => Promise<FleetDriverRowDto[]>;
    const rows = await fn({ queryKey: query.queryKey, signal: undefined, meta: undefined });
    expect(rows).toHaveLength(REGISTRY.length);
    expect(listDrivers.mock.calls[0]?.[0]).not.toHaveProperty('branchId', expect.anything());
  });

  it('a reach of no branch asks the server nothing and counts nobody', async () => {
    const qc = client(REGISTRY);
    render(<DriversListPage />, qc, { reader: me('branch') });
    const query = registryQuery(qc);
    const fn = query.options.queryFn as (ctx: unknown) => Promise<FleetDriverRowDto[]>;
    expect(await fn({ queryKey: query.queryKey, signal: undefined, meta: undefined })).toEqual([]);
    expect(listDrivers).not.toHaveBeenCalled();
  });

  it('the grant is the dashboard’s widest, not `fleetDriver.view` alone (a mixed-grant reader)', () => {
    // Drivers branch-wide, cars company-wide: the dashboard's driver figures cover the company.
    expect(
      dashboardScopeOf({ 'fleetDriver.view': 'branch', 'fleetVehicle.view': 'organization' }),
    ).toBe('organization');
    expect(dashboardScopeOf({ 'fleetDriver.view': 'organization' })).toBe('organization');
    expect(dashboardScopeOf({ 'fleetDriver.view': 'branch' })).toBe('branch');
    // The custody fund's and the licence expenses' keys never widen what the figures cover.
    expect(
      dashboardScopeOf({
        'fleetDriver.view': 'branch',
        'fleetCustody.view': 'organization',
        'fleetLicenseExpense.view': 'organization',
      }),
    ).toBe('branch');
    expect(dashboardScopeOf({})).toBeUndefined();
    expect(dashboardScopeOf(undefined)).toBeUndefined();
    const mixed = client(REGISTRY);
    render(<DriversListPage />, mixed, {
      reader: {
        ...me('branch', { branchId: 'b1' }),
        permissions: { 'fleetDriver.view': 'branch', 'fleetVehicle.view': 'organization' },
      } as MeDto,
    });
    expect(registryQuery(mixed).queryKey).toEqual(
      listKey('fleet', 'drivers', { whole: true, branchId: null }),
    );
  });

  it('a narrowed panel names its branches above the figures (the title and the table do not narrow)', () => {
    const code = readFileSync(new URL('./DriversListPage.tsx', import.meta.url), 'utf8');
    expect(code).toContain('data-driver-figures-scope={registryBranches.join');
    expect(code).toContain("t('fleet.drivers.board.scopeOne'");
    expect(translate('ar', 'fleet.drivers.board.scopeOne', { name: 'مدينة نصر' })).toBe(
      'إحصائيات فرع مدينة نصر',
    );
    expect(translate('ar', 'fleet.drivers.board.scopeMany', { names: 'أ، ب' })).toBe(
      'إحصائيات الفروع: أ، ب',
    );
  });

  it('the TABLE still follows the URL’s «الفرع», not the top bar', () => {
    setActiveBranch('b2');
    const qc = client([row(profile('only', { licenseExpiresAt: '2029-05-01T00:00:00.000Z' }))]);
    const html = render(<DriversListPage />, qc);
    // The unfiltered table key answered: no `branchId` was added to it.
    expect(tbodyOf(html)).toContain('2029/05/01');
  });
});

// ── D29 · the list's licence colour reads the warning days ──────────────────────────────────────

describe('the licence colour reads «إعدادات الحركة» (D29)', () => {
  const dec10 = [row(profile('dec10', { licenseExpiresAt: '2026-12-10T00:00:00.000Z' }))];

  it('45 warning days: a licence 39 days away is amber — the dashboard counts it «خلال 45 يومًا»', () => {
    const cell = licenceCell(
      render(<DriversListPage />, client(dec10, {}, { warnDays: 45 })),
      '2026/12/10',
    );
    expect(cell).toContain('text-amber-600');
    expect(cell).toContain('data-licence-expired="false"');
  });

  it('the default thirty while the settings are not read: the same licence is plain', () => {
    const cell = licenceCell(render(<DriversListPage />, client(dec10)), '2026/12/10');
    expect(cell).not.toContain('text-amber-600');
    expect(cell).toContain('text-slate-900');
  });

  it('a licence running out today is red from the first hour of the Cairo day', () => {
    const today = [row(profile('today', { licenseExpiresAt: '2026-11-01T00:00:00.000Z' }))];
    const cell = licenceCell(render(<DriversListPage />, client(today)), '2026/11/01');
    expect(cell).toContain('data-licence-expired="true"');
    expect(cell).toContain('text-red-600');
  });
});

// ── D30 · «رخصة غير مسجّلة» on the chip ─────────────────────────────────────────────────────────

describe('the licence-date chip says «رخصة غير مسجّلة» (D30)', () => {
  it('the dashboard line’s «فتح» lands on a chip with the line’s own words', () => {
    const html = render(
      <DriversListPage />,
      client([row(profile('nodate', { licenseExpiresAt: null }))], { licenseNotRecorded: true }),
      { route: '/fleet/drivers?licExp=none' },
    );
    const bar = barOf(html);
    expect(bar).toContain(ar('fleet.drivers.licenceNotRecorded'));
    expect(bar, 'not the header’s «غير مسجَّل»').not.toContain(
      `>${ar('fleet.drivers.notRecorded')}<`,
    );
  });

  it('the source: the chip reads the new key; the three «غير مسجَّل» cells keep theirs', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(
      fileURLToPath(new URL('./DriversListPage.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).toContain(`{ value: 'none', label: t('fleet.drivers.licenceNotRecorded') }`);
    expect(source.match(/t\('fleet\.drivers\.notRecorded'\)/gu)).toHaveLength(3);
  });
});

// ── D14 · a closed branch is named ───────────────────────────────────────────────────────────────

describe('a closed branch is named, not «—» (D14)', () => {
  const closedDriver = row(profile('c1', { licenseExpiresAt: '2029-05-01T00:00:00.000Z' }));

  it('the «الفرع» column names the branch the driver still belongs to', () => {
    const html = render(
      <DriversListPage />,
      client([closedDriver], {}, { people: [person(closedDriver.employeeId, CLOSED.id)] }),
    );
    expect(tbodyOf(html)).toContain(CLOSED.name);
  });

  it('a closed branch in the URL shows its name on the picker, never its id', () => {
    const html = render(
      <DriversListPage />,
      client(
        [closedDriver],
        { branchId: [CLOSED.id] },
        {
          people: [person(closedDriver.employeeId, CLOSED.id)],
        },
      ),
      { route: `/fleet/drivers?branch=${CLOSED.id}` },
    );
    const bar = barOf(html);
    expect(bar).toContain(CLOSED.name);
    expect(bar, 'the raw id is not the label').not.toContain(`>${CLOSED.id}<`);
    expect(tbodyOf(html), 'the narrowed table answered').toContain('2029/05/01');
  });
});

// ── The driver file: D08, D14, D47 ──────────────────────────────────────────────────────────────

describe('the driver file (D08, D14, D47)', () => {
  const fileOf = (p: FleetDriverProfileDto, branchId: string | null = B1.id): string => {
    const qc = client([]);
    qc.setQueryData(detailKey('fleet', 'drivers', p.id), p);
    qc.setQueryData(['fleet', 'people'], [person(p.employeeId, branchId)]);
    return render(
      <DriverProfilePage />,
      qc,
      { route: `/fleet/drivers/${p.id}`, reader: me('organization') },
      '/fleet/drivers/:id',
    );
  };

  /** The licence tag on the file: its state and its word. */
  const tagOf = (html: string): { state: string | undefined; word: string } => {
    const at = html.indexOf('data-driver-licence-state=');
    if (at < 0) return { state: undefined, word: '' };
    const state = /data-driver-licence-state="([a-z]+)"/u.exec(html.slice(at))?.[1];
    const end = html.indexOf('</span></span>', at);
    return {
      state,
      word: html
        .slice(at, end)
        .replace(/<[^>]+>/gu, '')
        .replace(/^[^>]*>/u, ''),
    };
  };

  it('a licence running out TODAY reads «منتهٍ» from the first hour of the Cairo day (D08)', () => {
    const html = fileOf(profile('today', { licenseExpiresAt: '2026-11-01T00:00:00.000Z' }));
    expect(tagOf(html)).toEqual({ state: 'expired', word: 'منتهٍ' });
  });

  it('a licence of next year is «ساري» — the list’s word, never the two-state «سارية» (D50)', () => {
    const html = fileOf(profile('later', { licenseExpiresAt: '2027-06-30T00:00:00.000Z' }));
    expect(tagOf(html)).toEqual({ state: 'valid', word: 'ساري' });
    expect(html).not.toContain('سارية');
  });

  it('a licence inside the warning days is «ينتهي قريبًا» in amber, as the list paints it (D29, D50)', () => {
    // 25 days away: inside the default 30.
    const soon = fileOf(profile('soon', { licenseExpiresAt: '2026-11-26T00:00:00.000Z' }));
    expect(tagOf(soon)).toEqual({ state: 'soon', word: 'ينتهي قريبًا' });
    expect(soon).toMatch(/font-figures text-amber-600[^"]*">2026\/11\/26</u);
    // Tomorrow is still inside them: never «ساري» the day before it runs out.
    const tomorrow = fileOf(profile('tomorrow', { licenseExpiresAt: '2026-11-02T00:00:00.000Z' }));
    expect(tagOf(tomorrow).state).toBe('soon');
  });

  it('no date on file is not an expired licence', () => {
    const html = fileOf(profile('nodate', { licenseExpiresAt: null }));
    expect(tagOf(html).state).toBeUndefined();
    expect(html).not.toContain('data-driver-licence-state');
  });

  it('a suspended file carries the suspended-file badge (D47)', () => {
    const html = fileOf(profile('susp', { isActive: false }));
    expect(html).toContain(ar('fleet.drivers.inactive'));
    expect(html).not.toContain(`>${ar('fleet.drivers.active')}<`);
  });

  it('names the closed branch the driver belongs to (D14)', () => {
    const html = fileOf(profile('c2'), CLOSED.id);
    expect(html).toContain(CLOSED.name);
  });
});

// ── The words (the HUB merges audit-fix/i18n/W8.json into i18n.ts) ──────────────────────────────

describe('the words the owner was told', () => {
  it('«رخصة غير مسجّلة», «بلا ملف سائق», «الملف موقوف» — Arabic and English', () => {
    expect(ar('fleet.drivers.licenceNotRecorded')).toBe('رخصة غير مسجّلة');
    expect(ar('fleet.drivers.board.totalNote', { recorded: '7', missing: '1' })).toBe(
      'مسجَّل 7 · بلا ملف سائق 1',
    );
    expect(ar('fleet.drivers.inactive')).toBe('الملف موقوف');
    expect(translate('en', 'fleet.drivers.licenceNotRecorded')).toBe('Licence not recorded');
    expect(translate('en', 'fleet.drivers.inactive')).toBe('Profile inactive');
    // The same words the dashboard draws, so the two cannot drift apart again.
    expect(ar('fleet.drivers.licenceNotRecorded')).toBe(ar('fleet.dash.now.licenceNotRecorded'));
    expect(ar('fleet.drivers.inactive')).toBe(ar('fleet.roster.reason.profileInactive'));
  });
});
