// The maintenance screen takes the period and the vehicle type a fleet-dashboard figure carries
// (P1-05, plan D8, D10, §5.7): «زيارات الفترة» links to `/fleet/maintenance?from&to[&type…]`, and
// the screen must show exactly the visits the figure counted — so it READS `to`, `outTo` and
// `type`, SENDS them to the server (which already applies `to`/`outTo` and resolves `typeIds` like
// `operationIds`), SHOWS each on the bar while it narrows, and REMEMBERS them with its other filters.
//
// The web suite runs in `node` with no DOM: markup through `renderToStaticMarkup` over seeded
// caches. A row in the table proves the page asked under the exact key the seed was written for.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ListFleetMaintenanceQuerySchema,
  type FleetMaintenanceVisitDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { MaintenancePage } from './pages/MaintenancePage';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'pages/MaintenancePage.tsx'), 'utf8');

const TYPE_A = '64b1f0aaaaaaaaaaaaaaaa01';
const TYPE_B = '64b1f0aaaaaaaaaaaaaaaa02';

const pageOf = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
});

const visit = (o: Partial<FleetMaintenanceVisitDto> = {}): FleetMaintenanceVisitDto => ({
  id: 'm1',
  vehicleId: 'v1',
  vehicleCode: '150',
  operationId: null,
  branchId: null,
  driverInEmployeeId: null,
  driverOutEmployeeId: null,
  driverInName: null,
  driverOutName: null,
  inDate: '2026-10-05T00:00:00.000Z',
  outDate: null,
  workshopId: 'ws1',
  workTypeId: 'wt1',
  spareParts: [],
  sparePartIds: [],
  odometerAtService: 98765,
  exitOdometer: null,
  takenInByEmployeeId: null,
  takenOutByEmployeeId: null,
  notes: null,
  version: 0,
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
  ...o,
});

/** Exactly the parameters the page sends when nothing is filtered. */
const BASE_PARAMS = {
  page: 1,
  pageSize: 25,
  sortBy: 'inDate',
  sortDir: 'desc',
  sort: 'inDate:desc',
};
const KEY = (over: Record<string, unknown> = {}) =>
  listKey('fleet', 'maintenance', { ...BASE_PARAMS, ...over });

const client = (keyOver: Record<string, unknown>): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(KEY(keyOver), pageOf([visit()]));
  qc.setQueryData(
    listKey('fleet', 'vehicleTypes', { pageSize: 100 }),
    pageOf([
      { id: TYPE_A, name: { ar: 'مصفحة', en: 'Armoured' } },
      { id: TYPE_B, name: { ar: 'ميكروباص', en: 'Minibus' } },
    ]),
  );
  return qc;
};

/**
 * The page key and, by default, `fleetVehicle.view` — a reader who may read the vehicle types list
 * the «النوع» control names its options from (the list's own guard, not this screen's).
 */
const store = (keys: readonly string[] = ['fleetMaintenance.view', 'fleetVehicle.view']) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(keys.map((key) => [key, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const render = (route: string, qc: QueryClient, keys?: readonly string[]): string =>
  renderToStaticMarkup(
    <Provider store={store(keys)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <MaintenancePage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);
const tbody = (markup: string): string =>
  markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tbody>'));
const filterBar = (markup: string): string =>
  markup.slice(
    markup.indexOf('<div class="flex flex-wrap items-center gap-2'),
    markup.indexOf('<table'),
  );
/** The visit's counter, as the row prints it — present only when the page asked the seeded key. */
const listed = (markup: string): boolean => tbody(markup).includes('98,765');

describe('the dashboard’s period reaches the maintenance list', () => {
  it('sends `to` with `from` — «زيارات الفترة» is the visits CHECKED IN from … to …', () => {
    const qc = client({ from: '2026-10-01', to: '2026-10-31' });
    const markup = render('/fleet/maintenance?from=2026-10-01&to=2026-10-31', qc);
    expect(listed(markup), 'the page asked with both bounds').toBe(true);
    // The last day is on the bar, in its own box, while it narrows.
    const bar = filterBar(markup);
    expect(bar).toContain('value="2026-10-31"');
    expect(bar).toContain(t('fleet.maintenance.inTo'));
  });

  it('sends `outTo` with `outFrom` — a check-out day', () => {
    const qc = client({ outFrom: '2026-10-04', outTo: '2026-10-04' });
    const markup = render('/fleet/maintenance?outFrom=2026-10-04&outTo=2026-10-04', qc);
    expect(listed(markup)).toBe(true);
    expect(filterBar(markup)).toContain(t('fleet.maintenance.outTo'));
  });

  it('a `to` alone narrows too — never dropped for want of a `from`', () => {
    const markup = render('/fleet/maintenance?to=2026-10-31', client({ to: '2026-10-31' }));
    expect(listed(markup)).toBe(true);
  });

  it('shows no «حتى» box while no link set one — the bar is the screen’s own', () => {
    const bar = filterBar(render('/fleet/maintenance', client({})));
    expect(bar).not.toContain(t('fleet.maintenance.inTo'));
    expect(bar).not.toContain(t('fleet.maintenance.outTo'));
    expect(bar).toContain(t('fleet.maintenance.inRange'));
    expect(bar).toContain(t('fleet.maintenance.outRange'));
  });
});

describe('«النوع» — the vehicle type, beside «التشغيل»', () => {
  it('reads `type` and sends it as `typeIds`', () => {
    const qc = client({ typeIds: [TYPE_A, TYPE_B] });
    const markup = render(`/fleet/maintenance?type=${TYPE_A},${TYPE_B}`, qc);
    expect(listed(markup), 'the page asked with the two types').toBe(true);
    // The control names what it holds, from the same type list the registry's «الماركة» reads.
    const bar = filterBar(markup);
    expect(bar).toContain('مصفحة');
    expect(bar).toContain('ميكروباص');
  });

  it('is not drawn — nor its type list asked — for a reader the types list refuses', () => {
    // fleetMaintenance.view alone does not open GET /fleet/vehicle-types (TYPE_READERS).
    const qc = client({ typeIds: [TYPE_A] });
    const plain = filterBar(render('/fleet/maintenance', client({}), ['fleetMaintenance.view']));
    expect(plain).not.toContain(t('fleet.vehicles.filters.make'));
    const narrowed = filterBar(
      render(`/fleet/maintenance?type=${TYPE_A}`, qc, ['fleetMaintenance.view']),
    );
    expect(narrowed).toContain('data-vehicle-set-chip="type"');
    // Even with the type names in the cache, none is drawn: the control (and its read) is not there.
    expect(narrowed).not.toContain('مصفحة');
    expect(SOURCE).toContain('useVehicleTypeOptions(sets.types)');
  });

  it('is on the bar always, like the operation, and comes with the dashboard’s whole set', () => {
    expect(filterBar(render('/fleet/maintenance', client({})))).toContain(
      t('fleet.vehicles.filters.make'),
    );
    const OP = '64b1f0bbbbbbbbbbbbbbbb01';
    const BR = '64b1f0cccccccccccccccc01';
    const qc = client({
      from: '2026-10-01',
      to: '2026-10-31',
      typeIds: [TYPE_A],
      operationIds: [OP],
      branchIds: [BR],
    });
    const markup = render(
      `/fleet/maintenance?from=2026-10-01&to=2026-10-31&type=${TYPE_A}&operation=${OP}&branch=${BR}`,
      qc,
    );
    expect(listed(markup)).toBe(true);
  });

  it('the query the page builds is one the contract accepts', () => {
    const parsed = ListFleetMaintenanceQuerySchema.safeParse({
      ...BASE_PARAMS,
      from: '2026-10-01',
      to: '2026-10-31',
      outFrom: '2026-10-02',
      outTo: '2026-10-31',
      typeIds: [TYPE_A, TYPE_B],
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});

describe('remembered and cleared with the other filters', () => {
  const remembered = (): string[] => {
    const block = SOURCE.slice(
      SOURCE.indexOf('const REMEMBERED_FILTERS = ['),
      SOURCE.indexOf('] as const;'),
    );
    return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
  };

  it('`to`, `outTo` and `type` are remembered', () => {
    expect(remembered()).toEqual(expect.arrayContaining(['to', 'outTo', 'type']));
  });

  it('the page reads each from its own address bar', () => {
    expect(SOURCE).toContain("sp.get('to')");
    expect(SOURCE).toContain("sp.get('outTo')");
    expect(SOURCE).toContain("csv(sp.get('type'))");
  });

  it('«مسح» drops all three', () => {
    const clear = SOURCE.slice(
      SOURCE.indexOf('onClear={() =>'),
      SOURCE.indexOf('>', SOURCE.indexOf('state: null,')),
    );
    expect(clear).toContain('to: null,');
    expect(clear).toContain('outTo: null,');
    expect(clear).toContain('type: null,');
  });
});
