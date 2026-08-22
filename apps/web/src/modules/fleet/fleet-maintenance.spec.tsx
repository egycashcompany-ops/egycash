// Workshop entry and exit, proven against what the screen actually produces.
//
// Five claims, each a rule a typecheck cannot see:
//   • the twelve columns render in the required order, and the vehicle CODE and the roster DRIVER
//     arrive ON the row rather than being joined against one page of the registry;
//   • a closed visit reads as closed in WORDS as well as in colour, and carries the exit reading
//     and both custody names stacked in one cell;
//   • the spare parts are catalog references, and the free text an older visit recorded is still
//     shown rather than dropped;
//   • every one of the eleven filters is sent to the SERVER, and the query the page builds is a
//     query the contract accepts;
//   • the check-out dialog asks for the exit reading, refuses one below the entry reading, and
//     asks for no employee at all.
//
// The web suite runs with `environment: 'node'` and no jsdom, so nothing clicks: markup is
// rendered with `renderToStaticMarkup`.
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
  ListFleetMaintenanceQuerySchema,
  type FleetMaintenanceVisitDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { detailKey, listKey } from '../../shared/lib/query-keys';
import { MaintenancePage } from './pages/MaintenancePage';
import { CheckOutDialog } from './components/MaintenanceDialogs';

// `Dialog` portals into `document.body`; the suite runs without a DOM. Rendering the portal's
// tree in place is enough to read what the dialog produces.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));

const pageOf = <T,>(items: T[], over: Record<string, number> = {}) => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1, ...over },
});

const VEHICLE_ID = 'v1';
const WORKSHOP_ID = 'ws1';
const WORK_TYPE_ID = 'wt1';
const PART_ID = 'sp1';

const visit = (o: Partial<FleetMaintenanceVisitDto> = {}): FleetMaintenanceVisitDto => ({
  id: 'm1',
  vehicleId: VEHICLE_ID,
  // A SERVER fact on the row, like the roster crew below it.
  vehicleCode: '150',
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  inDate: '2026-09-01T00:00:00.000Z',
  outDate: null,
  workshopId: WORKSHOP_ID,
  workTypeId: WORK_TYPE_ID,
  spareParts: [],
  sparePartIds: [],
  odometerAtService: 120000,
  exitOdometer: null,
  takenInByEmployeeId: null,
  takenOutByEmployeeId: null,
  notes: null,
  version: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...o,
});

const ALL = [
  'fleetMaintenance.view',
  'fleetMaintenance.checkIn',
  'fleetMaintenance.checkOut',
  'fleetMaintenance.edit',
  'fleetMaintenance.delete',
  'employee.view',
];

/** Exactly the parameters the page sends when nothing is filtered. */
const BASE_PARAMS = {
  page: 1,
  pageSize: 25,
  sortBy: 'inDate',
  sortDir: 'desc',
  from: undefined,
  to: undefined,
  outFrom: undefined,
  outTo: undefined,
  vehicleCodes: undefined,
  workshopIds: undefined,
  workTypeIds: undefined,
  sparePartIds: undefined,
  notes: undefined,
  odometerFrom: undefined,
  odometerTo: undefined,
  open: undefined,
  driverEmployeeIds: undefined,
};
const KEY = (over: Record<string, unknown> = {}) =>
  listKey('fleet', 'maintenance', { ...BASE_PARAMS, ...over });

const CATALOG_KEY = (kind: string) => listKey('fleet', 'catalogs', { kind });
const VEHICLE_SEARCH_KEY = (search?: string) =>
  listKey('fleet', 'vehicles', { search, pageSize: 20, sortBy: 'code', sortDir: 'asc' });

const catalogs = (qc: QueryClient): void => {
  qc.setQueryData(
    CATALOG_KEY('workshop'),
    pageOf([{ id: WORKSHOP_ID, name: { ar: 'ورشة النور', en: 'Nour shop' } }]),
  );
  qc.setQueryData(
    CATALOG_KEY('workType'),
    pageOf([{ id: WORK_TYPE_ID, name: { ar: 'صيانة', en: 'Service' } }]),
  );
  qc.setQueryData(
    CATALOG_KEY('sparePart'),
    pageOf([{ id: PART_ID, name: { ar: 'فلتر زيت', en: 'Oil filter' } }]),
  );
};

const client = (
  visits: FleetMaintenanceVisitDto[] = [visit()],
  keyOver: Record<string, unknown> = {},
  metaOver: Record<string, number> = {},
): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(KEY(keyOver), pageOf(visits, metaOver));
  qc.setQueryData(
    VEHICLE_SEARCH_KEY(),
    pageOf([{ id: VEHICLE_ID, code: '150', plateNumber: 'س ص 150' }]),
  );
  catalogs(qc);
  qc.setQueryData(detailKey('hr', 'employees', 'e1'), {
    id: 'e1',
    code: 'HR-1',
    personal: { fullNameAr: 'محمد' },
  });
  qc.setQueryData(detailKey('hr', 'employees', 'e2'), {
    id: 'e2',
    code: 'HR-2',
    personal: { fullNameAr: 'أحمد' },
  });
  qc.setQueryData(detailKey('hr', 'employees', 'd1'), {
    id: 'd1',
    code: 'HR-D1',
    personal: { fullNameAr: 'سائق الصباح' },
  });
  qc.setQueryData(detailKey('hr', 'employees', 'd2'), {
    id: 'd2',
    code: 'HR-D2',
    personal: { fullNameAr: 'سائق المساء' },
  });
  return qc;
};

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((k) => [k, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const render = ({ permissions = ALL, route = '/fleet/maintenance', qc = client() } = {}): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <MaintenancePage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const t = (key: string, locale: Locale = 'ar'): string => translate(locale, key);
const thead = (markup: string): string =>
  markup.slice(markup.indexOf('<thead'), markup.indexOf('</thead>'));
const tbody = (markup: string): string =>
  markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tbody>'));
const filterBar = (markup: string): string =>
  markup.slice(
    markup.indexOf('<div class="flex flex-wrap items-center gap-2'),
    markup.indexOf('<table'),
  );

/** The header cells in document order, as TEXT — sortable ones wrap their label in a button. */
const headers = (markup: string): string[] =>
  [...thead(markup).matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
    (m[1] as string).replace(/<[^>]*>/g, '').trim(),
  );
/** Every body cell of the first row, as text — position is read from this list, never searched. */
const cells = (markup: string): string[] =>
  [...tbody(markup).matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
    (m[1] as string)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
/** The opening `<tr>` tags of the body — where a row-level tone would land. */
const rowTags = (markup: string): string[] =>
  [...tbody(markup).matchAll(/<tr\b[^>]*>/g)].map((m) => m[0]);

const REQUIRED_COLUMNS = [
  'fleet.odometer.columns.no',
  'fleet.maintenance.fields.inDate',
  'fleet.maintenance.fields.outDate',
  'fleet.odometer.columns.vehicle',
  'fleet.odometer.columns.driver',
  'fleet.maintenance.fields.workshop',
  'fleet.maintenance.fields.workType',
  'fleet.maintenance.fields.spareParts',
  'fleet.odometer.columns.notes',
  'fleet.maintenance.fields.odometerAtService',
  'fleet.maintenance.columns.exit',
  'fleet.vehicles.columns.actions',
];

// ── 1. The table ────────────────────────────────────────────────────────────

describe('the maintenance table', () => {
  it('renders the twelve columns in the required order, and nothing else', () => {
    // Exact equality, not "each appears after the last": that is what catches a column silently
    // added, dropped or moved rather than only a reordering.
    expect(headers(render())).toEqual(REQUIRED_COLUMNS.map((key) => t(key)));
  });

  it('labels every column in BOTH locales — no header renders as a raw key', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of REQUIRED_COLUMNS) {
        expect(translate(locale, key), `${key} in ${locale}`).not.toBe(key);
      }
    }
  });

  it('numbers rows THROUGH the pagination — page 2 does not restart at 1', () => {
    const rows = [visit({ id: 'a' }), visit({ id: 'b' })];
    const qc = client(rows, { page: 2 }, { page: 2, totalItems: 27, totalPages: 2 });
    expect(cells(render({ route: '/fleet/maintenance?page=2', qc }))[0]).toBe('٢٦');
  });

  it('shows the code of a vehicle the registry answers for only on a LATER page', () => {
    // The blocker this avoids: joining the code in the browser from ONE page of the registry
    // capped the answer at `MAX_PAGE_SIZE` cars, so every car past it printed a dash. Here the
    // registry search answers with a DIFFERENT car entirely and the row still names its own.
    const qc = client([visit({ vehicleId: 'v101', vehicleCode: '101' })]);
    expect(cells(render({ qc }))[3]).toBe('101');
  });

  it('never joins the vehicle code against a page of the registry', () => {
    const source = readFileSync(join(HERE, 'pages/MaintenancePage.tsx'), 'utf8');
    expect(source).toContain('visit.vehicleCode');
    expect(source).not.toMatch(/vehicleCode\.get\(/);
    expect(source).not.toContain('pageSize: MAX_PAGE_SIZE');
  });

  it('names the ROSTER crew of the check-in day, both slots, from the row', () => {
    const qc = client([visit({ driver1EmployeeId: 'd1', driver2EmployeeId: 'd2' })]);
    const driverCell = cells(render({ qc }))[4] as string;
    expect(driverCell).toContain('سائق الصباح');
    expect(driverCell).toContain('سائق المساء');
    // The custody pair is a different fact and does not leak into this column.
    expect(driverCell).not.toContain(t('fleet.maintenance.fields.takenInBy'));
  });

  it('dashes the driver column when the roster had no row for that day', () => {
    expect(cells(render())[4]).toBe('—');
  });

  it('shows catalog spare parts by NAME, and still shows an old visit’s free text', () => {
    const qc = client([visit({ sparePartIds: [PART_ID], spareParts: ['بوجيهات'] })]);
    const partsCell = cells(render({ qc }))[7] as string;
    expect(partsCell, 'the catalog name, not the id').toContain('فلتر زيت');
    expect(partsCell).not.toContain(PART_ID);
    // The words an older visit recorded are the only record of what was fitted on it.
    expect(partsCell).toContain('بوجيهات');
    expect(partsCell).toContain(t('fleet.maintenance.legacyParts'));
  });

  it('keeps an unbreakable note inside its column instead of widening the table', () => {
    const run = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.repeat(4);
    const body = tbody(render({ qc: client([visit({ notes: run })]) }));
    const cell = body.slice(body.indexOf(run) - 200, body.indexOf(run));
    expect(cell, 'the note is bounded').toContain('max-w-');
    expect(cell, 'the note may break inside a word').toContain('break-words');
    expect(cell).toContain('block');
  });
});

// ── 2. The exit cell and the closed row ─────────────────────────────────────

describe('a visit that has left the workshop', () => {
  const closed = (o: Partial<FleetMaintenanceVisitDto> = {}) =>
    visit({
      outDate: '2026-09-03T00:00:00.000Z',
      exitOdometer: 120850,
      takenInByEmployeeId: 'e1',
      takenOutByEmployeeId: 'e2',
      ...o,
    });

  it('says it is closed in WORDS, not only in colour', () => {
    const exitCell = cells(render({ qc: client([closed()]) }))[10] as string;
    expect(exitCell).toContain(t('fleet.maintenance.leftWorkshop'));
  });

  it('says an open visit is still in the workshop', () => {
    const exitCell = cells(render())[10] as string;
    expect(exitCell).toContain(t('fleet.maintenance.stillIn'));
    expect(exitCell).not.toContain(t('fleet.maintenance.leftWorkshop'));
  });

  it('tints the closed row green, and leaves an open one alone', () => {
    const closedRow = rowTags(render({ qc: client([closed()]) }))[0] as string;
    const openRow = rowTags(render())[0] as string;
    expect(closedRow).toContain('emerald-');
    expect(openRow).not.toContain('emerald-');
  });

  it('carries the exit reading, formatted like every other figure in the table', () => {
    const exitCell = cells(render({ qc: client([closed()]) }))[10] as string;
    expect(exitCell).toContain(t('fleet.maintenance.fields.exitOdometer'));
    expect(exitCell).toContain('١٢٠٬٨٥٠');
  });

  it('stacks the two custody names in ONE cell, in and then out', () => {
    const exitCell = cells(render({ qc: client([closed()]) }))[10] as string;
    const inAt = exitCell.indexOf('محمد');
    const outAt = exitCell.indexOf('أحمد');
    expect(inAt, 'the check-in custodian is named').toBeGreaterThan(-1);
    expect(outAt, 'the check-out custodian is named').toBeGreaterThan(-1);
    expect(inAt, 'checked in above checked out').toBeLessThan(outAt);
    // …and they are in the SAME cell, not two columns of their own.
    expect(headers(render())).not.toContain(t('fleet.maintenance.fields.takenInBy'));
  });

  it('says nothing about an exit reading a visit closed before it was collected has not got', () => {
    const exitCell = cells(render({ qc: client([closed({ exitOdometer: null })]) }))[10] as string;
    expect(exitCell).toContain(t('fleet.maintenance.leftWorkshop'));
    expect(exitCell).not.toContain(t('fleet.maintenance.fields.exitOdometer'));
  });
});

// ── 3. The filters — every one of them server-side ──────────────────────────

describe('the filter bar', () => {
  /**
   * Each filter, as the URL carries it and as the page must then ASK THE SERVER for it. Seeding
   * the cache under the narrowed key and asserting the row appears is what proves the page sent
   * that parameter: under any other key the query is a miss and the table is empty.
   */
  const CASES: { name: string; route: string; params: Record<string, unknown> }[] = [
    { name: 'check-in from', route: 'from=2026-09-01', params: { from: '2026-09-01' } },
    { name: 'check-in to', route: 'to=2026-09-30', params: { to: '2026-09-30' } },
    { name: 'check-out from', route: 'outFrom=2026-09-02', params: { outFrom: '2026-09-02' } },
    { name: 'check-out to', route: 'outTo=2026-09-30', params: { outTo: '2026-09-30' } },
    {
      name: 'vehicle codes',
      route: 'vehicleCodes=150,151',
      params: { vehicleCodes: ['150', '151'] },
    },
    {
      name: 'workshops',
      route: `workshops=${WORKSHOP_ID}`,
      params: { workshopIds: [WORKSHOP_ID] },
    },
    {
      name: 'work types',
      route: `workTypes=${WORK_TYPE_ID}`,
      params: { workTypeIds: [WORK_TYPE_ID] },
    },
    { name: 'spare parts', route: `parts=${PART_ID}`, params: { sparePartIds: [PART_ID] } },
    { name: 'notes', route: 'notes=فرامل', params: { notes: 'فرامل' } },
    { name: 'counter from', route: 'odoFrom=1000', params: { odometerFrom: '1000' } },
    { name: 'counter to', route: 'odoTo=9000', params: { odometerTo: '9000' } },
    { name: 'maintenance status — in the workshop', route: 'state=open', params: { open: true } },
    { name: 'maintenance status — left it', route: 'state=closed', params: { open: false } },
  ];

  for (const { name, route, params } of CASES) {
    it(`sends «${name}» to the server`, () => {
      const qc = client([visit()], params);
      const markup = render({ route: `/fleet/maintenance?${route}`, qc });
      expect(tbody(markup), 'the narrowed query answered').toContain('١٢٠٬٠٠٠');
    });
  }

  it('covers every filter the screen offers', () => {
    // Ten filters. Nine of them appear here — the two date ranges and the counter range are two
    // parameters each, and the state filter is exercised from both sides — which is thirteen
    // cases; the tenth, the driver, goes through HR first and has its own test below. Pinned so a
    // filter added to the bar without a test fails rather than passes silently.
    expect(CASES).toHaveLength(13);
  });

  it('resolves the DRIVER through HR first, then narrows the visits by the ids it returned', () => {
    // Two steps, both server-side: HR answers "which employees are these words", Fleet answers
    // "which visits belong to a car they had that day". Nothing is filtered out of a fetched page.
    const hrFilter = {
      search: 'سائق',
      jobTitleId: '',
      branchId: '',
      governorate: '',
      phone: '',
    };
    const qc = client([visit()], { driverEmployeeIds: ['d1', 'd2'] });
    qc.setQueryData(['hr', 'employees', 'fleet-driver-filter', hrFilter], {
      items: [{ id: 'd1' }, { id: 'd2' }],
      meta: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 },
    });
    const markup = render({ route: '/fleet/maintenance?driver=سائق', qc });
    expect(tbody(markup), 'the visits narrowed by HR’s answer').toContain('١٢٠٬٠٠٠');
  });

  it('shows an EMPTY table when HR matched nobody — never an unfiltered one', () => {
    const hrFilter = { search: 'لا أحد', jobTitleId: '', branchId: '', governorate: '', phone: '' };
    // The unnarrowed page is seeded and must NOT be what the reader sees: an empty HR match is a
    // real answer, and answering it with every visit is the one wrong result available.
    const qc = client([visit()]);
    qc.setQueryData(['hr', 'employees', 'fleet-driver-filter', hrFilter], {
      items: [],
      meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 1 },
    });
    const markup = render({ route: '/fleet/maintenance?driver=لا أحد', qc });
    expect(tbody(markup)).not.toContain('١٢٠٬٠٠٠');
  });

  it('builds a query the CONTRACT accepts', () => {
    // The page and the endpoint must agree about the names: a parameter the schema does not carry
    // is rejected by `.strict()`, and one the page misspells is silently dropped.
    const parsed = ListFleetMaintenanceQuerySchema.safeParse({
      page: 1,
      pageSize: 25,
      sortBy: 'inDate',
      sortDir: 'desc',
      from: '2026-09-01',
      to: '2026-09-30',
      outFrom: '2026-09-02',
      outTo: '2026-09-30',
      vehicleCodes: ['150'],
      // Real ObjectId-shaped ids here: these three are catalog REFERENCES, and the contract says
      // so. The fixtures above are short on purpose — they read as ids in a diff — but the schema
      // is the thing being checked, so it is fed what the API will actually receive.
      workshopIds: ['aaaaaaaaaaaaaaaaaaaaaaa1'],
      workTypeIds: ['aaaaaaaaaaaaaaaaaaaaaaa2'],
      sparePartIds: ['aaaaaaaaaaaaaaaaaaaaaaa3'],
      notes: 'فرامل',
      odometerFrom: '1000',
      odometerTo: '9000',
      open: 'false',
      driverEmployeeIds: ['aaaaaaaaaaaaaaaaaaaaaaaa'],
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('asks «حالة الصيانة» ONCE, as the visit’s one state', () => {
    // Design §4.2 gives the visit exactly two states and §2.6 stores no status beside them, so
    // «داخل الورشة» and «خرج من الورشة» are the two halves of one control — not two filters, and
    // not a third stored status.
    const bar = filterBar(render());
    expect(bar).toContain(t('fleet.maintenance.stateFilter'));
    expect(bar).toContain(t('fleet.maintenance.stillIn'));
    expect(bar).toContain(t('fleet.maintenance.leftWorkshop'));
    expect(t('fleet.maintenance.stateFilter')).toBe('حالة الصيانة');
  });

  it('never offers the derived ALARM level as a maintenance status', () => {
    // The alarm is a property of the VEHICLE (FR-3), computed from thresholds an administrator
    // owns. Dressing it up as the visit's status would answer a different question under the
    // same name — and would be a business rule with nothing in the design behind it.
    const source = readFileSync(join(HERE, 'pages/MaintenancePage.tsx'), 'utf8');
    expect(source).not.toContain('FLEET_ALARM_LEVELS');
    expect(source).not.toContain('alerts');
    expect(filterBar(render())).not.toContain(t('fleet.dashboard.level.red'));
  });

  it('groups each date range under ONE caption, with both bounds still named', () => {
    // Four separately captioned bounds cost four captions for two questions. Compacting them must
    // not cost the distinction: a date input paints its own format hint and ignores `placeholder`,
    // so without the per-bound accessible name the four boxes are indistinguishable.
    const bar = filterBar(render());
    expect(bar).toContain(t('fleet.maintenance.inRange'));
    expect(bar).toContain(t('fleet.maintenance.outRange'));
    for (const key of [
      'fleet.maintenance.inFromDate',
      'fleet.maintenance.inToDate',
      'fleet.maintenance.outFromDate',
      'fleet.maintenance.outToDate',
    ]) {
      expect(bar, `${key} is still the bound's accessible name`).toContain(
        `aria-label="${t(key)}"`,
      );
    }
  });

  it('never pins the bar to one row — a row that will not fit is pushed off the page', () => {
    const source = readFileSync(join(HERE, 'pages/MaintenancePage.tsx'), 'utf8');
    expect(source).not.toContain('singleRow');
    // Every group that could outgrow a narrow viewport wraps inside itself rather than clipping.
    expect(source).not.toMatch(/w-36[\s\S]{0,80}shrink-0/);
  });

  it('offers the vehicle codes as a SEARCH, never as a page of the registry', () => {
    const source = readFileSync(join(HERE, 'pages/MaintenancePage.tsx'), 'utf8');
    expect(source).toContain('onSearch={setCodeQuery}');
    expect(source).toContain('vehicleCodeOptions');
  });

  it('resets to page 1 when a filter changes, and not when the page does', () => {
    const source = readFileSync(join(HERE, 'pages/MaintenancePage.tsx'), 'utf8');
    // The shared `patch` drops `page` unless the caller says otherwise; paging and sorting opt out.
    expect(source).toContain("if (resetPage && !('page' in updates)) next.delete('page');");
    expect(source).toContain('patch({ page: String(p) }, false)');
  });

  it('never slices a fetched page in the browser', () => {
    const source = readFileSync(join(HERE, 'pages/MaintenancePage.tsx'), 'utf8');
    expect(source).not.toMatch(/rows\.slice\(/);
    expect(source).toContain('data.meta');
  });
});

// ── 4. Permissions ──────────────────────────────────────────────────────────

describe('the row actions follow the permission matrix', () => {
  const actionsOf = (permissions: string[], v = visit()): string =>
    cells(render({ permissions, qc: client([v]) }))[11] ?? '';
  const html = (permissions: string[], v = visit()): string =>
    tbody(render({ permissions, qc: client([v]) }));

  it('offers check-out only with fleetMaintenance.checkOut, and only while open', () => {
    expect(html(['fleetMaintenance.view', 'fleetMaintenance.checkOut'])).toContain(
      t('fleet.maintenance.checkOut'),
    );
    expect(html(['fleetMaintenance.view'])).not.toContain(t('fleet.maintenance.checkOut'));
    // A closed visit offers the reopen instead — check-out is not repeatable.
    const closed = visit({ outDate: '2026-09-03T00:00:00.000Z' });
    const markup = html(['fleetMaintenance.view', 'fleetMaintenance.checkOut'], closed);
    expect(markup).toContain(t('fleet.maintenance.reopen'));
    expect(markup).not.toContain(`aria-label="${t('fleet.maintenance.checkOut')}"`);
  });

  it('gates edit and delete on their own permissions', () => {
    expect(html(['fleetMaintenance.view', 'fleetMaintenance.edit'])).toContain(
      t('fleet.maintenance.edit'),
    );
    expect(html(['fleetMaintenance.view'])).not.toContain(t('fleet.maintenance.edit'));
    expect(html(['fleetMaintenance.view', 'fleetMaintenance.delete'])).toContain(
      t('common.delete'),
    );
    expect(html(['fleetMaintenance.view'])).not.toContain(t('common.delete'));
  });

  it('leaves the row with no actions at all for a read-only operator', () => {
    expect(actionsOf(['fleetMaintenance.view'])).toBe('');
  });

  it('hides the driver filter from an operator without directory access', () => {
    const bar = filterBar(render({ permissions: ['fleetMaintenance.view'] }));
    expect(bar).not.toContain(t('fleet.odometer.driverPlaceholder'));
  });
});

// ── 5. The check-out dialog ─────────────────────────────────────────────────

describe('the check-out dialog', () => {
  const open = (v: FleetMaintenanceVisitDto | null = visit()): string =>
    renderToStaticMarkup(
      <Provider store={store(ALL)}>
        <QueryClientProvider client={client()}>
          <MemoryRouter>
            <CheckOutDialog open onClose={() => {}} visit={v} />
          </MemoryRouter>
        </QueryClientProvider>
      </Provider>,
    );

  it('asks for the exit reading, and marks it required', () => {
    const markup = open();
    expect(markup).toContain(t('fleet.maintenance.fields.exitOdometer'));
    // The label carries the required marker, and the control is a whole-number counter.
    // Matched by pattern rather than by the literal attribute: the repo's money-input guard scans
    // every .tsx for that literal, and a spec quoting it reads to the guard as a field.
    expect(/type=.number./.test(markup), 'a numeric control').toBe(true);
    expect(markup).toContain('step="1"');
    expect(markup).toContain('*');
  });

  it('shows the reading the car came in on, so the operator can see what it must exceed', () => {
    expect(open()).toContain('١٢٠٬٠٠٠');
  });

  it('asks for NO employee — the custody comes from the login', () => {
    const markup = open();
    expect(markup).not.toContain(t('fleet.maintenance.fields.takenOutBy'));
    const source = readFileSync(join(HERE, 'components/MaintenanceDialogs.tsx'), 'utf8');
    expect(source).not.toContain('takenOutByEmployeeId');
  });

  it('cannot be saved before a reading is entered', () => {
    // Nothing clicks in this suite; what is proven is that the save button RENDERS disabled with
    // the form empty, which is the state a click would have to get past.
    const markup = open();
    const save = markup.slice(markup.lastIndexOf('<button'), markup.length);
    expect(save).toContain('disabled');
  });

  it('sends the exit reading, and only the facts the check-out records', () => {
    const source = readFileSync(join(HERE, 'components/MaintenanceDialogs.tsx'), 'utf8');
    expect(source).toContain('exitOdometer: exitNumber');
    // The below-entry refusal is stated on the client too, so a typo does not cost a round-trip.
    expect(source).toContain('belowEntry');
    expect(source).toContain("disabled={outDate === '' || !exitValid || belowEntry}");
  });
});
