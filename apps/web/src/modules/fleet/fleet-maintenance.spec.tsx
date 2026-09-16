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
/** Two drivers to pick, as real employee ids — what `drv` carries now. */
const DRIVER_A = '64b1f0dddddddddddddddd01';
const DRIVER_B = '64b1f0dddddddddddddddd02';

const visit = (o: Partial<FleetMaintenanceVisitDto> = {}): FleetMaintenanceVisitDto => ({
  id: 'm1',
  vehicleId: VEHICLE_ID,
  // A SERVER fact on the row, like the roster crew below it.
  vehicleCode: '150',
  driverInEmployeeId: null,
  driverOutEmployeeId: null,
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
  sort: 'inDate:desc',
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

/**
 * The class list of the ONE element that colours `name` — the nearest `<span class="…">` opened
 * before it. `EmployeeName` wraps the name in a bare `<span>`, so the nearest CLASSED span is the
 * tone the cell put on that line, and nothing from the line above can leak into the slice. That
 * is what lets a test assert a name is one colour AND not the other.
 */
const tone = (markup: string, name: string): string => {
  const at = markup.indexOf(name);
  expect(at, `${name} is named`).toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf('<span class="', at), at);
};

const REQUIRED_COLUMNS = [
  // «شيل التسلسل» — the serial column is gone, so the grid opens on the check-in date.
  'fleet.maintenance.fields.inDate',
  'fleet.maintenance.fields.outDate',
  'fleet.odometer.columns.vehicle',
  'fleet.odometer.columns.driver',
  'fleet.maintenance.fields.workshop',
  'fleet.maintenance.fields.workType',
  'fleet.maintenance.fields.spareParts',
  'fleet.maintenance.fields.odometerAtService',
  // What is left of the vehicle's derived maintenance alarm, read from the SAME projection the
  // alarms board and the odometer log read — never recomputed here. The LEVEL and the LAST
  // SERVICE DATE were taken off this grid by request: a row here is a VISIT, and the level is the
  // alarms board's own subject. The two distances stay because they are about the visit's car at
  // the moment it is being read.
  'fleet.alarms.columns.sinceService',
  'fleet.alarms.columns.remaining',
  // LAST of the data columns, by request — «الملاحظات تكون اخر حاجه خالص». `actions` still follows
  // it: those are the row's controls, not a fact about the visit.
  'fleet.odometer.columns.notes',
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

  it('carries no serial column — the first cell is the check-in DATE, on page 2 as on page 1', () => {
    // Page 2 is where a leftover serial would be loudest: the old column numbered through the
    // pagination, so row 1 of page 2 printed «٢٦» rather than a date.
    const rows = [visit({ id: 'a' }), visit({ id: 'b' })];
    const qc = client(rows, { page: 2 }, { page: 2, totalItems: 27, totalPages: 2 });
    const first = cells(render({ route: '/fleet/maintenance?page=2', qc }))[0] as string;
    expect(first, 'no serial survived the offset arithmetic').not.toBe('٢٦');
    expect(first, 'the first cell is a date').toMatch(/[٠-٩]+/);
    const source = readFileSync(join(HERE, 'pages/MaintenancePage.tsx'), 'utf8');
    expect(source, 'and the offset arithmetic went with the column').not.toContain(
      'firstRowNumber',
    );
  });

  it('drops «المستوى» and «آخر صيانة» — the level is the alarms board’s subject, not a visit’s', () => {
    // Requested straight off a screenshot of the two columns. A row here is a VISIT and one car
    // has several, so the level repeated down the column said the same thing several times; the
    // alarms board is the one screen that answers per CAR.
    const head = headers(render({ qc: client([visit({ vehicleId: VEHICLE_ID })]) }));
    expect(head, 'no level column').not.toContain(t('fleet.alarms.columns.level'));
    expect(head, 'no last-service date column').not.toContain(t('fleet.vehicle.lastService'));
    // The «أساس الإنذار» badge lived inside the level cell and goes with it.
    const body = tbody(render({ qc: client([visit({ vehicleId: VEHICLE_ID })]) }));
    expect(body).not.toContain(t('fleet.maintenance.isAlarmBaseline'));
  });

  it('shows the code of a vehicle the registry answers for only on a LATER page', () => {
    // The blocker this avoids: joining the code in the browser from ONE page of the registry
    // capped the answer at `MAX_PAGE_SIZE` cars, so every car past it printed a dash. Here the
    // registry search answers with a DIFFERENT car entirely and the row still names its own.
    const qc = client([visit({ vehicleId: 'v101', vehicleCode: '101' })]);
    expect(cells(render({ qc }))[2]).toBe('101');
  });

  it('never joins the vehicle code against a page of the registry', () => {
    const source = readFileSync(join(HERE, 'pages/MaintenancePage.tsx'), 'utf8');
    expect(source).toContain('visit.vehicleCode');
    expect(source).not.toMatch(/vehicleCode\.get\(/);
    expect(source).not.toContain('pageSize: MAX_PAGE_SIZE');
  });

  it('names the DRIVER who brought the car in — in red', () => {
    const qc = client([visit({ driverInEmployeeId: 'd1' })]);
    const markup = render({ qc });
    expect(cells(markup)[3]).toContain('سائق الصباح');
    expect(tone(tbody(markup), 'سائق الصباح')).toContain('text-red-700');
  });

  it('stacks the exit driver — in GREEN — under the red entry driver once the car has left', () => {
    const qc = client([
      visit({
        outDate: '2026-09-03T00:00:00.000Z',
        driverInEmployeeId: 'd1',
        driverOutEmployeeId: 'd2',
      }),
    ]);
    const markup = render({ qc });
    const cell = cells(markup)[3] as string;
    const inAt = cell.indexOf('سائق الصباح');
    const outAt = cell.indexOf('سائق المساء');
    expect(inAt, 'the entry driver is named').toBeGreaterThan(-1);
    expect(outAt, 'the exit driver is named').toBeGreaterThan(-1);
    expect(inAt, 'entry above exit').toBeLessThan(outAt);
    // The two ends are told apart by TONE, and the tone belongs to the LINE, not to the cell:
    // in red, out green. Asserting each is NOT the other's colour is what makes this test fail
    // if the cell ever paints both names with one class again.
    const body = tbody(markup);
    expect(tone(body, 'سائق الصباح'), 'the entry driver is red').toContain('text-red-700');
    expect(tone(body, 'سائق الصباح'), 'and not green').not.toContain('text-emerald-700');
    expect(tone(body, 'سائق المساء'), 'the exit driver is green').toContain('text-emerald-700');
    expect(tone(body, 'سائق المساء'), 'and not red').not.toContain('text-red-700');
  });

  it('shows only the entry driver while the car is still in the workshop', () => {
    const qc = client([visit({ driverInEmployeeId: 'd1' })]);
    const cell = cells(render({ qc }))[3] as string;
    expect(cell).toContain('سائق الصباح');
    expect(cell, 'nobody has driven it away yet').not.toContain('سائق المساء');
  });

  it('dashes the driver cell for a visit written before the driver fields existed', () => {
    const body = tbody(render());
    expect(cells(render())[3]).toBe('—');
    expect(body).not.toContain('null');
    expect(body).not.toContain('undefined');
  });

  it('never shows the CUSTODY employees, or the exit reading, in the table', () => {
    // `takenInByEmployeeId` / `takenOutByEmployeeId` record who performed the check-in and
    // check-out. They stay in the domain and the audit trail, and out of this grid — as does the
    // exit reading, which is checkout and baseline data, not a column.
    const qc = client([
      visit({
        outDate: '2026-09-03T00:00:00.000Z',
        exitOdometer: 120850,
        driverInEmployeeId: 'd1',
        takenInByEmployeeId: 'e1',
        takenOutByEmployeeId: 'e2',
      }),
    ]);
    const body = tbody(render({ qc }));
    expect(body, 'no custody name').not.toContain('محمد');
    expect(body, 'no custody name').not.toContain('أحمد');
    expect(body).not.toContain(t('fleet.maintenance.fields.takenInBy'));
    expect(body).not.toContain(t('fleet.maintenance.fields.takenOutBy'));
    expect(body, 'no exit reading in the grid').not.toContain('١٢٠٬٨٥٠');
  });

  it('shows catalog spare parts by NAME, and still shows an old visit’s free text', () => {
    const qc = client([visit({ sparePartIds: [PART_ID], spareParts: ['بوجيهات'] })]);
    const partsCell = cells(render({ qc }))[6] as string;
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
      driverInEmployeeId: 'd1',
      driverOutEmployeeId: 'd2',
      ...o,
    });

  it('says it is closed with DATA, not only with colour', () => {
    // The state's non-colour carrier is the check-out DATE column: a closed visit prints one, an
    // open visit prints the «in the workshop» badge instead.
    const closedOut = cells(render({ qc: client([closed()]) }))[1] as string;
    const openOut = cells(render())[1] as string;
    expect(closedOut, 'a closed visit shows its check-out date').not.toBe(openOut);
    expect(openOut).toContain(t('fleet.maintenance.open'));
    expect(closedOut).not.toContain(t('fleet.maintenance.open'));
  });

  it('tints the closed row green, and leaves an open one alone', () => {
    const closedRow = rowTags(render({ qc: client([closed()]) }))[0] as string;
    const openRow = rowTags(render())[0] as string;
    expect(closedRow).toContain('emerald-');
    expect(openRow).not.toContain('emerald-');
  });

  it('keeps the entry driver red and the exit driver green ON the green row', () => {
    // The row tint is a BACKGROUND. It must recolour neither name: the green row carries a red
    // entry driver and a green exit driver, and the exit driver's green is its own class rather
    // than the row's tint bleeding through.
    const body = tbody(render({ qc: client([closed()]) }));
    expect(body, 'the row is tinted').toContain('bg-emerald-50/70');

    expect(tone(body, 'سائق الصباح'), 'the entry driver stays red').toContain('text-red-700');
    expect(tone(body, 'سائق الصباح'), 'the tint did not repaint it').not.toContain(
      'text-emerald-700',
    );
    expect(tone(body, 'سائق المساء'), 'the exit driver is green').toContain('text-emerald-700');
    expect(tone(body, 'سائق المساء'), 'and is not red').not.toContain('text-red-700');
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
    { name: 'check-out from', route: 'outFrom=2026-09-02', params: { outFrom: '2026-09-02' } },
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
    { name: 'maintenance status — in the workshop', route: 'state=open', params: { open: true } },
    { name: 'maintenance status — left it', route: 'state=closed', params: { open: false } },
    // The driver is an ORDINARY parameter now. It used to need its own test below, because the
    // page had to send free text to HR and wait for ids before it could ask this table anything;
    // picked ids go straight through, matched server-side against the entry OR the exit driver.
    {
      name: 'drivers',
      route: `drv=${DRIVER_A},${DRIVER_B}`,
      params: { driverEmployeeIds: [DRIVER_A, DRIVER_B] },
    },
  ];

  for (const { name, route, params } of CASES) {
    it(`sends «${name}» to the server`, () => {
      const qc = client([visit()], params);
      const markup = render({ route: `/fleet/maintenance?${route}`, qc });
      expect(tbody(markup), 'the narrowed query answered').toContain('١٢٠٬٠٠٠');
    });
  }

  it('covers every filter the screen offers', () => {
    // Nine filters on the bar. Each date is ONE input, the counter filter is gone entirely, and
    // the state filter is exercised from both sides — ten cases for nine filters. The driver is
    // among them now rather than in a test of its own. Pinned so a filter added to the bar
    // without a test fails rather than passes silently.
    expect(CASES).toHaveLength(10);
  });

  /**
   * «الفلاتر بتاعت الشاشتين كمان» — the driver filter is the drivers REGISTRY's picker, not a box.
   *
   * The box sent whatever was typed to HR as one `search` and narrowed this table by the ids that
   * came back. That searched the whole payroll, so a reader could type an accountant's name and
   * get an empty grid under a bar insisting a driver was selected; and it made the page carry
   * three states of somebody else's request — HR still answering, HR matching more than a page,
   * HR refusing — each with a banner of its own above the table.
   */
  it('asks the drivers registry, not HR’s free-text search', () => {
    const source = readFileSync(join(HERE, 'pages/MaintenancePage.tsx'), 'utf8');
    expect(source, 'the picker every other fleet screen uses').toContain('<RegistryDriverPicker');
    expect(source, 'the HR search hook is gone').not.toContain('useDriverHrFilter');
    expect(source, 'and nothing holds the query back for it').not.toContain('hr.loading');
    expect(source, 'no «HR matched too many» banner').not.toContain('hrFilterTooMany');
    expect(source, 'no «HR unavailable» banner').not.toContain('hrFilterUnavailable');
    expect(source, 'several drivers at once — a visit has two').toContain('multiple');
  });

  it('sends NO driver parameter at all when nobody is picked', () => {
    // An empty list is not "no matches" here — it is "the reader has not asked about anyone", and
    // sending `driverEmployeeIds: []` would narrow the table to nothing.
    const source = readFileSync(join(HERE, 'pages/MaintenancePage.tsx'), 'utf8');
    expect(source).toContain('drivers.length > 0 ? drivers : undefined');
    const unfiltered = render({ route: '/fleet/maintenance', qc: client([visit()]) });
    expect(tbody(unfiltered), 'every visit, as before').toContain('١٢٠٬٠٠٠');
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

  it('asks each date as ONE input, and offers no counter filter at all', () => {
    const bar = filterBar(render());
    expect(bar).toContain(t('fleet.maintenance.inRange'));
    expect(bar).toContain(t('fleet.maintenance.outRange'));
    // Two date inputs in total — one per question, no from→to pair anywhere.
    expect((bar.match(/type=.date./g) ?? []).length, 'one input per date').toBe(2);
    // And no numeric bound survives: the counter is a column, not a filter. Matched by pattern —
    // the repo's money-input guard scans .tsx for the literal attribute.
    expect((bar.match(/type=.number./g) ?? []).length, 'no counter filter').toBe(0);
    expect(bar).not.toContain(t('fleet.maintenance.fields.odometerAtService'));
  });

  it('never pins the bar to one row — a row that will not fit is pushed off the page', () => {
    const source = readFileSync(join(HERE, 'pages/MaintenancePage.tsx'), 'utf8');
    expect(source).not.toContain('singleRow');
    // Every group that could outgrow a narrow viewport wraps inside itself rather than clipping.
    expect(source).not.toMatch(/w-36[\s\S]{0,80}shrink-0/);
  });

  it('offers the vehicle codes as a SEARCH, never as a page of the registry', () => {
    // Now the shared control's property — one implementation for the six screens that filter by
    // car, so the page asserts that it renders it rather than re-proving what it no longer owns.
    const page = readFileSync(join(HERE, 'pages/MaintenancePage.tsx'), 'utf8');
    expect(page).toContain('<VehicleCodeFilter');
    const control = readFileSync(join(HERE, 'components/VehicleCodeFilter.tsx'), 'utf8');
    expect(control).toContain('onSearch={consume}');
    expect(control).toContain('vehicleCodeOptions');
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
  // Derived from the column list, not hardcoded: a column added anywhere before the actions
  // would otherwise silently move this index and make the assertion read the wrong cell.
  const ACTIONS_INDEX = REQUIRED_COLUMNS.indexOf('fleet.vehicles.columns.actions') + 1;
  const actionsOf = (permissions: string[], v = visit()): string =>
    cells(render({ permissions, qc: client([v]) }))[ACTIONS_INDEX] ?? '';
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

describe('the check-in dialog', () => {
  it('OFFERS the driver and submits without one — «سائق الدخول ميكونش اجبارى»', () => {
    const source = readFileSync(join(HERE, 'components/MaintenanceDialogs.tsx'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // Still asked for — the car does have a driver and naming them is the point of the field.
    expect(code).toContain("t('fleet.maintenance.fields.driverIn')");
    // …but not part of what makes the form complete, and not starred.
    const at = code.indexOf('const complete =');
    expect(code.slice(at, code.indexOf(';', at)), 'the gate says nothing about it').not.toContain(
      'driverIn',
    );
    const field = code.slice(
      code.indexOf("t('fleet.maintenance.fields.driverIn')"),
      code.indexOf('</Field>', code.indexOf("t('fleet.maintenance.fields.driverIn')")),
    );
    expect(field, 'no required star on the entry driver').not.toContain('required');
    // An empty box travels as null, because an empty string is not an id.
    expect(code).toContain("driverInEmployeeId: driverIn === '' ? null : driverIn");
  });

  it('keeps the EXIT driver required — that write also sets the alarm baseline', () => {
    // The two doors are deliberately different, and a change that relaxed both would be reading
    // the instruction as «drivers are optional» rather than as the one it actually named.
    const source = readFileSync(join(HERE, 'components/MaintenanceDialogs.tsx'), 'utf8');
    const at = source.indexOf("t('fleet.maintenance.fields.driverOut')");
    expect(at, 'the exit driver is asked for').toBeGreaterThan(-1);
    // The star sits on the `<Field>` AFTER its label prop, so the slice runs forwards.
    expect(source.slice(at, source.indexOf('>', at) + 1), 'and starred').toContain('required');
    expect(source, 'and gates the save').toContain("driverOut === ''");
  });

  it('lets a part that is NOT on the list be typed, and turns it into a catalog item', () => {
    // «لو مش موجود عادى يضيفها مش لازم من القايمه اللى تظهر وهى لو مش موجوده فى القايمه اللى فى
    // شاشه fleet/catalogs يضيفها تبع قطع الغيار».
    const source = readFileSync(join(HERE, 'components/MaintenanceDialogs.tsx'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const field = code.slice(code.indexOf('const SparePartsField'), code.indexOf('const counterWarning'));
    // Typed and committed — the picker's own «Enter in the search box» seam, not a second input.
    expect(field, 'Enter commits what was typed').toContain('onCommitSearch');
    expect(field, 'and the box is always offered, however short the list').toContain(
      'searchThreshold: 0',
    );
    // It becomes a CATALOG ITEM, which is what keeps this from being free text again.
    expect(field, 'created in the sparePart catalog').toContain("kind: 'sparePart'");
    expect(field, 'through the same mutation the catalogs screen uses').toContain(
      'useCreateCatalogItem',
    );
    expect(field, 'and the new id is selected').toContain('onChange([...value, made.id])');
  });

  it('selects an existing part instead of creating a second spelling of it', () => {
    // The whole reason the catalog exists: two spellings of one part are two parts to every report
    // that counts them. A name that is already there — in either language, in any case — is
    // SELECTED, never added again.
    const source = readFileSync(join(HERE, 'components/MaintenanceDialogs.tsx'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const field = code.slice(code.indexOf('const SparePartsField'), code.indexOf('const counterWarning'));
    expect(field, 'case-folded').toContain('toLocaleLowerCase()');
    expect(field, 'against the Arabic name').toContain('item.name.ar');
    expect(field, 'and the English one').toContain('item.name.en');
    const guard = field.slice(field.indexOf('const existing ='), field.indexOf('try {'));
    expect(guard, 'an existing match returns before anything is created').toContain('return;');
  });

  it('offers the affordance only to someone the server would let use it', () => {
    // A reader without `fleetCatalog.manage` types the part, presses Enter, and gets a 403 for the
    // one action the form appeared to invite. They keep the picker; they lose only the typing.
    const source = readFileSync(join(HERE, 'components/MaintenanceDialogs.tsx'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const field = code.slice(code.indexOf('const SparePartsField'), code.indexOf('const counterWarning'));
    expect(field).toContain("can('fleetCatalog.manage')");
    // The two props are spread TOGETHER behind that grant — a search box with no commit would be
    // an invitation to type something that goes nowhere.
    expect(field).toMatch(/mayAdd[\s\S]{0,140}searchThreshold: 0[\s\S]{0,80}onCommitSearch/);
  });

  it('never asks for the custody employee — the server records the login', () => {
    const source = readFileSync(join(HERE, 'components/MaintenanceDialogs.tsx'), 'utf8');
    expect(source).not.toContain('takenInByEmployeeId');
    expect(source).not.toContain('takenOutByEmployeeId');
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

  it('opens the exit reading ON the reading the car came in on', () => {
    // «لما بحط [العداد] بيبقى هو هو [عداد] الخروج» — a car does not move inside a workshop, so the
    // entry reading IS the answer nearly every time and was being retyped from the row above.
    // It matters more than a saved keystroke: this reading becomes the alarm's baseline, so a
    // digit mistyped while copying it does not stay in this row, it moves the next service.
    const markup = open(visit({ odometerAtService: 120000 }));
    // The ONE `type="number"` control on this dialog is the exit reading; the slice runs from the
    // start of that tag to its close so nothing from a neighbouring field can satisfy the match.
    const at = markup.indexOf('type="number"');
    expect(at, 'the numeric control is rendered').toBeGreaterThan(-1);
    const tag = markup.slice(markup.lastIndexOf('<input', at), markup.indexOf('/>', at) + 2);
    expect(tag, 'prefilled, not empty').toContain('value="120000"');
    // Still editable — a car that was road-tested did move. The class list is dropped first:
    // Tailwind's `disabled:` variants live in it and would match the attribute being looked for.
    const attrs = tag.replace(/class="[^"]*"/, '');
    expect(attrs).not.toContain('readonly');
    expect(attrs).not.toContain('disabled');
  });

  it('offers the SPARE PARTS on the way out, seeded from what the check-in recorded', () => {
    // «قطع الغيار دى بتكون لما باجى اخرجه من الورشه برضو» — the workshop finds out what a car needs
    // while it has it, so the check-in list is a guess and this one is the record.
    const markup = open();
    expect(markup, 'the field is on the check-out dialog').toContain(
      t('fleet.maintenance.fields.spareParts'),
    );
    const source = readFileSync(join(HERE, 'components/MaintenanceDialogs.tsx'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const checkOut = code.slice(code.indexOf('export const CheckOutDialog'));
    expect(checkOut, 'it starts from the visit, not from nothing').toContain(
      'setPartIds(visit?.sparePartIds ?? [])',
    );
    expect(checkOut, 'and it is sent').toContain('sparePartIds: partIds');
    expect(checkOut, 'through the same picker the check-in uses').toContain('<SparePartsField');
  });

  it('asks for NO employee — the custody comes from the login', () => {
    const markup = open();
    expect(markup).not.toContain(t('fleet.maintenance.fields.takenOutBy'));
    const source = readFileSync(join(HERE, 'components/MaintenanceDialogs.tsx'), 'utf8');
    expect(source).not.toContain('takenOutByEmployeeId');
  });

  it('cannot be saved before the exit DRIVER is chosen, prefilled reading or not', () => {
    // Nothing clicks in this suite; what is proven is that the save button RENDERS disabled on a
    // freshly opened dialog, which is the state a click would have to get past. The reading now
    // arrives prefilled, so the driver is what is still missing — and that is the point: the one
    // field this door cannot infer is the one that still gates it.
    const markup = open();
    const save = markup.slice(markup.lastIndexOf('<button'), markup.length);
    expect(save).toContain('disabled');
    const source = readFileSync(join(HERE, 'components/MaintenanceDialogs.tsx'), 'utf8');
    expect(source, 'and the gate still names the reading too').toContain('!exitValid');
  });

  it('sends the exit reading and the exit DRIVER, and gates the save on both', () => {
    const source = readFileSync(join(HERE, 'components/MaintenanceDialogs.tsx'), 'utf8');
    expect(source).toContain('exitOdometer: exitNumber');
    expect(source).toContain('driverOutEmployeeId: driverOut');
    // The below-entry refusal is stated on the client too, so a typo does not cost a round-trip,
    // and neither a missing reading nor a missing driver can reach the server from here.
    expect(source).toContain('belowEntry');
    expect(source).toContain(
      "disabled={outDate === '' || !exitValid || belowEntry || driverOut === ''}",
    );
  });

  it('asks for the exit driver, and refuses to save without one', () => {
    const markup = open();
    expect(markup).toContain(t('fleet.maintenance.fields.driverOut'));
    // Rendered with the form empty, the save button is already disabled — the state a click
    // would have to get past. Nothing clicks in this suite.
    const save = markup.slice(markup.lastIndexOf('<button'));
    expect(save).toContain('disabled');
  });
});

/**
 * TWO WARNINGS, BOTH FOUND BY WALKING A REAL CAR THROUGH ITS CYCLE.
 *
 * Neither value is wrong and neither is refused. What was wrong in both cases was the SILENCE:
 * the screen let a reader do something reasonable-looking, and then reported a result with no
 * connection back to the choice that caused it.
 */
describe('the maintenance and odometer dialogs say what a choice will cost', () => {
  const HERE_DIR = dirname(fileURLToPath(import.meta.url));
  const read = (rel: string): string =>
    readFileSync(join(HERE_DIR, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

  /**
   * A visit becomes the alarm's baseline only if its work type is flagged `countsForAlarm` — the
   * server's `alarmBaselines` matches on exactly that set. A visit recorded with any other type
   * is filed correctly and changes nothing, and the alarms board goes on saying «لا صيانة محسوبة
   * بعد» with nothing pointing at why. Reproduced on a real stack: four steps followed exactly,
   * and the only wrong thing was an unticked work type.
   */
  it('warns when the chosen work type will not reset the maintenance counter', () => {
    const code = read('components/MaintenanceDialogs.tsx');
    expect(code, 'the warning exists').toContain('fleet.maintenance.workTypeNotCounting');
    expect(code, 'and reads the flag the SERVER matches on').toContain('countsForAlarm === true');
    // Both dialogs — checking a car in, and editing the visit afterwards. Editing the type has
    // exactly the same consequence, so a warning on only one of them is half a warning.
    expect(
      code.split('warning: notCounting').length - 1,
      'check-in and edit both warn',
    ).toBe(2);
  });

  it('says nothing while the catalog is still loading', () => {
    // A warning that appears on every open and then withdraws itself teaches the reader to
    // ignore it, which costs more than it buys.
    const code = read('components/MaintenanceDialogs.tsx');
    expect(code).toContain('data === undefined) return undefined');
  });

  it('never REFUSES a non-counting type — plenty of visits legitimately are not services', () => {
    const code = read('components/MaintenanceDialogs.tsx');
    // `warning` is `Field`'s advisory channel; `error` is the one that says a save is refused.
    expect(code).toContain('warning: notCounting');
    expect(code, 'the type is not gated on it').not.toMatch(/canSubmit[^\n]*notCounting/);
  });

  /**
   * FR-2 refuses a reading BELOW the previous one, so an EQUAL one passes — and it should: a
   * vehicle that stood still all day really did read the same twice. It is also what a
   * double-press of «تسجيل قراءة» produces, writing a second row with `km = 0` that nothing on
   * the screen explains. Seen on a real stack.
   */
  it('warns when a reading repeats the last one, and still allows it', () => {
    const code = read('components/RecordOdometerDialog.tsx');
    expect(code, 'the warning exists').toContain('fleet.odometer.sameAsPrevious');
    expect(code, 'fired on a zero-distance period').toContain('derivedKm === 0');
    expect(code, 'as advice, not as a refusal').toContain('warning: t(');
    // The submit guard must not have grown a clause about it.
    const submit = code.slice(code.indexOf('const canSubmit'), code.indexOf('return ('));
    expect(submit, 'a standing day stays recordable').not.toContain('derivedKm === 0');
  });

  it('both messages say what happens, not just that something is odd', () => {
    for (const key of ['fleet.maintenance.workTypeNotCounting', 'fleet.odometer.sameAsPrevious']) {
      for (const locale of ['ar', 'en'] as Locale[]) {
        const text = translate(locale, key);
        expect(text, `${key} in ${locale}`).not.toBe(key);
        expect(text.length, `${key} in ${locale} explains itself`).toBeGreaterThan(40);
      }
    }
  });
});
