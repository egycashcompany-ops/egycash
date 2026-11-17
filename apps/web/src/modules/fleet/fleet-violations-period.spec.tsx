// The violations register reads the PERIOD a dashboard figure counted — «مخالفات السائقين في
// الفترة» of «المخالفات المرورية والتسويات» (build-vf plan D9): `dfrom` / `dto`, the fine's first
// and last day, on the drivers' half only (the company's statements carry a year, not a day).
//
// As in `fleet-dashboard-target-params.spec.tsx`, each case renders the screen at an address and
// seeds the cache ONLY under the key carrying the API fields the link must become (`from` / `to`
// beside `kind=driver`): a screen that dropped them, renamed them or sent them to the other half
// looks up another key, paints no row, and the case fails. Also pinned: the period is SHOWN as one
// chip beside the year's and comes off with a press (and with the half's «مسح»), it is remembered
// with the screen's other filters, and it is read in the page's OWN source, where the censuses look.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MAX_PAGE_SIZE,
  type FleetViolationDto,
  type FleetViolationRollupDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { ViolationsPage } from './pages/ViolationsPage';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (file: string): string => readFileSync(join(HERE, file), 'utf8');
const PAGE = source('pages/ViolationsPage.tsx');
const PANEL = source('components/DriverViolationsPanel.tsx');
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

/** What the screen declared, read out of its own `REMEMBERED_FILTERS` — the census's reading. */
const remembered = (): string[] => {
  const block = /const REMEMBERED_FILTERS = \[([^\]]*)\] as const;/u.exec(PAGE);
  return block === null ? [] : [...(block[1] ?? '').matchAll(/'([^']+)'/gu)].map((m) => m[1] ?? '');
};

const me = (permissions: readonly string[]): MeDto =>
  ({
    id: 'u-1',
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  }) as unknown as MeDto;

const client = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });

const paged = <T,>(items: T[], pageSize: number) => ({
  items,
  meta: { page: 1, pageSize, totalItems: items.length, totalPages: 1 },
});

const rollupRow = (): FleetViolationRollupDto => ({
  vehicleId: 'v1',
  code: '168',
  year: 2026,
  vehicleCount: 4,
  vehicleAmount: 2040.15,
  driverCount: 0,
  driverAmount: 0,
  totalCount: 4,
  totalAmount: 2040.15,
  outstandingVehicleAmount: 2040.15,
  outstandingDriverAmount: 0,
  outstandingTotalAmount: 2040.15,
  outstandingVehicleCount: 4,
  outstandingDriverCount: 0,
  outstandingTotalCount: 4,
  rowCount: 4,
  collectedCount: 0,
  totalBeforeGrievance: 0,
});

/** A driver's fine of the period, on a car the register knows by its code. */
const fine = (): FleetViolationDto => ({
  id: 'vio-1',
  kind: 'driver',
  vehicleId: null,
  vehicleCode: '733',
  violationTypeId: 'dt-1',
  amount: 400,
  year: null,
  count: null,
  unitValue: null,
  date: '2026-11-05T00:00:00.000Z',
  filedYear: null,
  homeVehicleId: null,
  driverEmployeeId: null,
  driverName: null,
  collected: false,
  fromOldBook: false,
  version: 0,
  createdAt: '2026-11-05T00:00:00.000Z',
  updatedAt: '2026-11-05T00:00:00.000Z',
});

/**
 * The screen at `route`, its company rollup seeded under `rollup` (every year by default, as a
 * period link carries no `year`) and its drivers' ledger under the drivers' API fields `drivers`.
 */
const violationsAt = (
  route: string,
  {
    rollup = { year: '', vehicleCodes: '' },
    drivers = {},
  }: { rollup?: Record<string, string>; drivers?: Record<string, unknown> },
): string => {
  const qc = client();
  qc.setQueryData(['fleet', 'violations', 'rollup', rollup], [rollupRow()]);
  qc.setQueryData(
    listKey('fleet', 'violations', {
      kind: 'driver',
      pageSize: MAX_PAGE_SIZE,
      sortBy: 'date',
      sortDir: 'desc',
      sort: 'date:desc',
      ...drivers,
      paged: 'infinite',
    }),
    { pages: [paged([fine()], MAX_PAGE_SIZE)], pageParams: [1] },
  );
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(['fleetViolation.view']), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/fleet/violations" element={<ViolationsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The two halves, by the order they are drawn in: the company first, the drivers second. */
const halves = (html: string): { company: string; drivers: string } => {
  const split = html.indexOf('data-violations-split="true"');
  const body = html.slice(split);
  const second = body.indexOf('<section', body.indexOf('<section') + 1);
  return { company: body.slice(0, second), drivers: body.slice(second) };
};

const FROM = '2026-11-01';
const TO = '2026-11-12';
const PERIOD = `dfrom=${FROM}&dto=${TO}`;

describe('/fleet/violations reads the period of «مخالفات السائقين في الفترة» (dfrom / dto)', () => {
  it('asks the drivers’ ledger for the fines of those days (dfrom → from, dto → to)', () => {
    const html = violationsAt(`/fleet/violations?${PERIOD}`, {
      drivers: { from: FROM, to: TO },
    });
    expect(halves(html).drivers, 'the seeded fine is on the board').toContain('733');
  });

  it('never answers a narrowed address from the un-narrowed ledger', () => {
    const html = violationsAt(`/fleet/violations?${PERIOD}`, { drivers: {} });
    expect(halves(html).drivers).not.toContain('733');
  });

  it('leaves the company half alone: its statements carry a year, not a day', () => {
    const html = violationsAt(`/fleet/violations?${PERIOD}`, {
      drivers: { from: FROM, to: TO },
    });
    expect(halves(html).company, 'the rollup of every year, as it is').toContain('168');
    expect(halves(html).company).not.toContain('data-driver-period');
  });

  it('carries the period beside the other narrowings a dashboard link sends', () => {
    // «قائمة» of the period (`dset=false`) and a row's «فتح» (its car, its day, its type).
    const owed = violationsAt(`/fleet/violations?${PERIOD}&dset=false`, {
      drivers: { collected: false, from: FROM, to: TO },
    });
    expect(halves(owed).drivers).toContain('733');
    const row = violationsAt(`/fleet/violations?dcodes=733&dfrom=${FROM}&dto=${FROM}&dtype=dt-1`, {
      drivers: { vehicleCodes: '733', violationTypeId: 'dt-1', from: FROM, to: FROM },
    });
    expect(halves(row).drivers).toContain('733');
  });

  it('asks nothing of a day that is not a calendar day', () => {
    const html = violationsAt('/fleet/violations?dfrom=2026-13-40&dto=soon', { drivers: {} });
    const { drivers } = halves(html);
    expect(drivers, 'the un-narrowed ledger answers').toContain('733');
    expect(drivers).not.toContain('data-driver-period');
  });

  it('shows the period as ONE chip beside the year’s, its days as the dashboard writes them', () => {
    const html = violationsAt(`/fleet/violations?${PERIOD}`, {
      drivers: { from: FROM, to: TO },
    });
    const { drivers } = halves(html);
    expect(drivers.match(/data-driver-period=/gu)).toHaveLength(1);
    expect(drivers).toContain(`data-driver-period="${FROM}..${TO}"`);
    expect(drivers).toContain(
      ar('fleet.violations.periodChip', { from: '2026/11/01', to: '2026/11/12' }),
    );
    // …and the half's «مسح» is offered while it narrows.
    expect(drivers).toContain('data-driver-clear="true"');
  });

  it('shows a one-sided period by its one day', () => {
    const html = violationsAt(`/fleet/violations?dfrom=${FROM}`, { drivers: { from: FROM } });
    const { drivers } = halves(html);
    expect(drivers).toContain('733');
    expect(drivers).toContain(`data-driver-period="${FROM}.."`);
    expect(drivers).toContain(ar('fleet.violations.periodFrom', { from: '2026/11/01' }));
  });

  it('takes the period off with a press, and with the drivers’ «مسح»', () => {
    expect(PAGE).toContain('onPeriodClear={() => patch({ dfrom: null, dto: null })}');
    const clear = PAGE.slice(
      PAGE.indexOf('onClear={() =>\n              patch({\n                dcodes'),
    );
    expect(clear.slice(0, clear.indexOf('})}'))).toMatch(/dfrom: null,\s+dto: null,/u);
    expect(PANEL).toContain('onClick={onPeriodClear}');
  });

  it('remembers `dfrom` and `dto` beside the drivers’ other filters and reads them in its own source', () => {
    expect(remembered()).toEqual(expect.arrayContaining(['dfrom', 'dto', 'dyear', 'dcodes']));
    expect(PAGE).toContain("sp.get('dfrom')");
    expect(PAGE).toContain("sp.get('dto')");
  });

  it('sends the period to the SERVER (whole days there), never filters the rows it holds', () => {
    // The API reads the calendar days (`from` / `to`, the fine's day); the board never narrows the
    // loaded pages itself — a cumulative board would otherwise hide what it has not fetched yet.
    expect(PANEL).toMatch(/\.\.\.\(from === null \? \{\} : \{ from \}\)/u);
    expect(PANEL).toMatch(/\.\.\.\(to === null \? \{\} : \{ to \}\)/u);
    expect(PANEL).not.toMatch(/rows\.filter\([^)]*date/u);
  });
});
