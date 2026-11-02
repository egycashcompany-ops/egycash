// The odometer register's total (fleet dashboard P1-04, R-14) and its vehicle-set parameters (D10).
//
//   • «إجمالي الكيلومترات» and «قراءات تحتاج مراجعة: N» are the SERVER's figures over the page's own
//     filters — the same object the list is asked with, less paging and order — printed as given;
//   • the review count shows only when there is something to review, and nothing is printed while
//     the answer is in flight;
//   • `type`, `operation` and `branch` (the dashboard's links) are read from the address bar, reach
//     both requests as `typeIds` / `operationIds` / `branchIds`, show their controls while they
//     narrow, and are remembered with the other filters.
//
// Node environment, no DOM: markup is rendered with `renderToStaticMarkup` over seeded caches.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  FleetOdometerSummaryQuerySchema,
  type FleetOdometerLogDto,
  type FleetOdometerSummaryDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { buildQuery } from '../../shared/lib/api-client';
import { listKey } from '../../shared/lib/query-keys';
import { rememberedOnly } from '../../shared/lib/useRememberedFilters';
import { OdometerPage } from './pages/OdometerPage';
import { currentMonthRange } from './lib/odometer-range';
import { odometerSummaryKey, type OdometerSummaryParams } from './api/odometer-summary-queries';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'pages/OdometerPage.tsx'), 'utf8');
const MONTH = currentMonthRange(new Date());

const T1 = '64b1f0aaaaaaaaaaaaaaaa01';
const O1 = '64b1f0bbbbbbbbbbbbbbbb01';
const B1 = '64b1f0cccccccccccccccc01';
const B2 = '64b1f0cccccccccccccccc02';

const log = (o: Partial<FleetOdometerLogDto> = {}): FleetOdometerLogDto => ({
  id: 'o1',
  vehicleId: 'v1',
  vehicleCode: '150',
  date: `${MONTH.from}T00:00:00.000Z`,
  outReading: 150_000,
  inReading: 150_250,
  km: 250,
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  driver1Name: null,
  driver2Name: null,
  notes: null,
  version: 0,
  createdAt: `${MONTH.from}T00:00:00.000Z`,
  updatedAt: `${MONTH.from}T00:00:00.000Z`,
  ...o,
});

const pageOf = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
});

/** The filters the page sends on arrival — the current month, nothing else narrowing. */
const FILTERS: OdometerSummaryParams = { from: MONTH.from, to: MONTH.to };
const LIST_KEY = (filters: OdometerSummaryParams) =>
  listKey('fleet', 'odometer', {
    ...filters,
    page: 1,
    pageSize: 25,
    sortBy: 'date',
    sortDir: 'desc',
    sort: 'date:desc',
  });

const summary = (o: Partial<FleetOdometerSummaryDto> = {}): FleetOdometerSummaryDto => ({
  km: 12_345,
  validRows: 40,
  invalidRows: 2,
  openRows: 3,
  ...o,
});

const client = (
  filters: OdometerSummaryParams,
  total: FleetOdometerSummaryDto | null = summary(),
): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(LIST_KEY(filters), pageOf([log()]));
  qc.setQueryData(['fleet', 'alarms'], []);
  if (total !== null) qc.setQueryData(odometerSummaryKey(filters), total);
  return qc;
};

const render = (
  route: string,
  qc: QueryClient,
  keys: readonly string[] = ['fleetOdometer.view', 'fleetVehicle.view'],
): string => {
  const store = configureStore({
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
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <OdometerPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

/** The text of the element carrying a data attribute, tags stripped. */
const textOf = (markup: string, attr: string): string | null => {
  const at = markup.indexOf(attr);
  if (at < 0) return null;
  const open = markup.indexOf('>', at) + 1;
  return markup
    .slice(open, markup.indexOf('</span>', open))
    .replace(/<[^>]*>/g, '')
    .trim();
};

describe('«إجمالي الكيلومترات» and «قراءات تحتاج مراجعة» — the server’s figures over the page’s filters', () => {
  it('prints both, as the summary gave them, in the board’s Latin digits', () => {
    const markup = render('/fleet/odometer', client(FILTERS));
    expect(textOf(markup, 'data-odometer-total')).toBe(
      t('fleet.odometer.summary.total', { km: '12,345' }),
    );
    expect(textOf(markup, 'data-odometer-review')).toBe(
      t('fleet.odometer.summary.review', { count: '2' }),
    );
    expect(markup).toContain(`title="${t('fleet.odometer.summary.totalHint')}"`);
  });

  it('says nothing about review when no reading needs it', () => {
    const markup = render('/fleet/odometer', client(FILTERS, summary({ invalidRows: 0 })));
    expect(markup).toContain('data-odometer-total');
    expect(markup).not.toContain('data-odometer-review');
  });

  it('prints nothing while the total is in flight — a 0 there would be a claim', () => {
    const markup = render('/fleet/odometer', client(FILTERS, null));
    expect(markup).not.toContain('data-odometer-total');
    expect(markup).not.toContain('data-odometer-review');
  });

  it('is asked with the list’s FILTERS only — no page, no order — under the register’s own key', () => {
    expect(SOURCE).toContain('const summary = useOdometerSummary(filters);');
    // Every filter the page can send is a field the summary endpoint accepts (it is `.strict()`).
    const sent = {
      vehicleCodes: '150,151',
      from: '2026-10-01',
      to: '2026-10-31',
      alerts: 'red',
      driverEmployeeIds: '64b1f0dddddddddddddddd01',
      notes: 'رحلة',
      typeIds: T1,
      operationIds: O1,
      branchIds: `${B1},${B2}`,
    };
    expect(FleetOdometerSummaryQuerySchema.safeParse(sent).success).toBe(true);
    expect(FleetOdometerSummaryQuerySchema.safeParse({ ...sent, page: '1' }).success).toBe(false);
    // Recording, correcting or deleting a reading invalidates `['fleet', 'odometer']`: the total too.
    expect(odometerSummaryKey(FILTERS).slice(0, 2)).toEqual(['fleet', 'odometer']);
  });

  it('travels as one comma list per filter, as the list does', () => {
    expect(buildQuery({ from: '2026-10-01', typeIds: [T1], branchIds: [B1, B2] })).toBe(
      `?from=2026-10-01&typeIds=${T1}&branchIds=${encodeURIComponent(`${B1},${B2}`)}`,
    );
  });
});

describe('`type`, `operation`, `branch` — the vehicle set a dashboard link carries', () => {
  const NARROWED: OdometerSummaryParams = {
    ...FILTERS,
    typeIds: [T1],
    operationIds: [O1],
    branchIds: [B1, B2],
  };
  const route = `/fleet/odometer?type=${T1}&operation=${O1}&branch=${B1},${B2}`;

  it('reaches both requests as typeIds / operationIds / branchIds', () => {
    // Seeded ONLY under the narrowed keys: the rows and the total render only if the page asks so.
    const markup = render(route, client(NARROWED, summary({ km: 777, invalidRows: 0 })));
    expect(markup).toContain('150,000');
    expect(textOf(markup, 'data-odometer-total')).toBe(
      t('fleet.odometer.summary.total', { km: '777' }),
    );
  });

  it('shows its three controls only while it narrows the screen', () => {
    const make = t('fleet.vehicles.filters.short.make');
    expect(render(route, client(NARROWED))).toContain(make);
    expect(render('/fleet/odometer', client(FILTERS))).not.toContain(make);
  });

  it('names the type and operation only for a reader of their lists; else nameless chips', () => {
    // fleetOdometer.view alone opens neither the types list nor the operations catalog.
    const html = render(route, client(NARROWED), ['fleetOdometer.view']);
    expect(html).not.toContain(t('fleet.vehicles.filters.short.make'));
    expect(html).toContain('data-vehicle-set-chip="type"');
    expect(html).toContain('data-vehicle-set-chip="operation"');
  });

  it('is read from the address bar, cleared with the bar and remembered with the other filters', () => {
    for (const param of ['type', 'operation', 'branch']) {
      expect(SOURCE).toContain(`readList(sp, '${param}')`);
    }
    expect(SOURCE).toContain('...CLEAR_VEHICLE_SET,');
    const declared = [
      ...(/const REMEMBERED_FILTERS = \[([^\]]*)\] as const;/.exec(SOURCE)?.[1] ?? '').matchAll(
        /'([^']+)'/g,
      ),
    ].map((m) => m[1] as string);
    expect(declared).toEqual(expect.arrayContaining(['type', 'operation', 'branch']));
    const kept = new URLSearchParams(
      rememberedOnly(
        new URLSearchParams(`type=${T1}&operation=${O1}&branch=${B1}&page=3`),
        declared,
      ),
    );
    expect([kept.get('type'), kept.get('operation'), kept.get('branch')]).toEqual([T1, O1, B1]);
    expect(kept.has('page')).toBe(false);
  });
});
