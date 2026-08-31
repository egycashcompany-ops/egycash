// The odometer log, proven against what the screen actually produces.
//
// Four claims, each a rule that a typecheck cannot see:
//   • the ten columns render in the required order, with the two driver slots as separate
//     columns and every derived number shown as the server gave it — including the open period,
//     which is a state and not a zero;
//   • the maintenance column reports the DERIVED distance since service with the design system's
//     own alarm badge, and says nothing when the projection refused to compute one;
//   • the filter bar takes several vehicles and several alert levels at once, syncs with the URL,
//     and sends every filter to the server;
//   • a driver NAME is HR's fact, so it is filtered through HR and never applied to a fetched page.
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
  ListFleetOdometerQuerySchema,
  MAX_PAGE_SIZE,
  type FleetMaintenanceAlarmDto,
  type FleetOdometerLogDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { formatNumber } from '../../shared/lib/format';
import { OdometerPage } from './pages/OdometerPage';
import { currentMonthRange } from './lib/odometer-range';
import { RecordOdometerDialog } from './components/RecordOdometerDialog';

// `Dialog` portals into `document.body`; the suite runs without a DOM. Rendering the portal's
// tree in place is enough to read what the dialog produces.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));

const pageOf = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
});

const VEHICLE_ID = 'v1';
/** The registry SEARCH the filter and the dialog now make — a shortlist for a query, not a page. */
const VEHICLE_SEARCH_KEY = (search?: string) =>
  listKey('fleet', 'vehicles', {
    search,
    pageSize: 20,
    sortBy: 'code',
    sortDir: 'asc',
  });
const log = (o: Partial<FleetOdometerLogDto> = {}): FleetOdometerLogDto => ({
  id: 'o1',
  vehicleId: VEHICLE_ID,
  // A SERVER fact on the row now, not a client join against a page of the registry.
  vehicleCode: '150',
  date: '2026-08-18T00:00:00.000Z',
  outReading: 150000,
  inReading: 150250,
  km: 250,
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  notes: 'رحلة الصباح',
  version: 0,
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
  ...o,
});

const alarm = (o: Partial<FleetMaintenanceAlarmDto> = {}): FleetMaintenanceAlarmDto => ({
  vehicleId: VEHICLE_ID,
  code: '150',
  level: 'none',
  remainingKm: 3000,
  sinceServiceKm: 2000,
  lastServiceAt: '2026-06-01T00:00:00.000Z',
  lastServiceVisitId: 'visit-1',
  ...o,
});

const ALL = [
  'fleetOdometer.view',
  'fleetOdometer.record',
  'fleetOdometer.correct',
  'employee.view',
];

/**
 * The month the page asks for when the URL names no bound. Taken from the same helper the page
 * uses, so these fixtures follow the calendar instead of pinning a month that goes stale — what
 * the month IS is proven against fixed dates in `lib/odometer-range.spec.ts`.
 */
const MONTH = currentMonthRange(new Date());

const ODOMETER_KEY = (over: Record<string, unknown> = {}) =>
  listKey('fleet', 'odometer', {
    page: 1,
    pageSize: 25,
    sortBy: 'date',
    sortDir: 'desc',
    vehicleCodes: undefined,
    from: MONTH.from,
    to: MONTH.to,
    alerts: undefined,
    driverEmployeeIds: undefined,
    ...over,
  });

const client = (
  logs: FleetOdometerLogDto[] = [log()],
  alarms: FleetMaintenanceAlarmDto[] = [alarm()],
  keyOver: Record<string, unknown> = {},
): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ODOMETER_KEY(keyOver), pageOf(logs));
  qc.setQueryData(
    VEHICLE_SEARCH_KEY(),
    pageOf([
      { id: VEHICLE_ID, code: '150', plateNumber: 'س ص 150' },
      { id: 'v2', code: '151', plateNumber: 'س ص 151' },
    ]),
  );
  qc.setQueryData(['fleet', 'odometer', 'alarms'], alarms);
  return qc;
};

const render = ({ permissions = ALL, route = '/fleet/odometer', qc = client() } = {}): string => {
  const store = configureStore({
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

const t = (key: string, locale: Locale = 'ar'): string => translate(locale, key);
const thead = (markup: string): string =>
  markup.slice(markup.indexOf('<thead'), markup.indexOf('</thead>'));
const tbody = (markup: string): string =>
  markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tbody>'));
/** Just the filter bar: everything the `FilterBar` container opens, up to the table. */
const filterBar = (markup: string): string =>
  markup.slice(
    markup.indexOf('<div class="flex flex-wrap items-center gap-2'),
    markup.indexOf('<table'),
  );

/**
 * The header cells in document order, as TEXT — sortable headers wrap their label in a button and
 * carry a chevron, so tags and svg are stripped rather than matched around.
 *
 * Position is read from this list, never from `indexOf(label)`: the serial header is the single
 * letter «م», which occurs inside half the other Arabic headers too, and a substring search would
 * happily "find" it in the wrong column.
 */
const headers = (markup: string): string[] =>
  [...thead(markup).matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
    (m[1] as string).replace(/<[^>]*>/g, '').trim(),
  );

/** The first cell of every body row, as text — the serial column, once it is in place. */
const firstCells = (markup: string): string[] =>
  tbody(markup)
    .split('<tr')
    .slice(1)
    .map((row) => {
      const first = /<td\b[^>]*>([\s\S]*?)<\/td>/.exec(row);
      return first === null ? '' : (first[1] as string).replace(/<[^>]*>/g, '').trim();
    });

const REQUIRED_COLUMNS = [
  'fleet.odometer.columns.no',
  'fleet.odometer.fields.date',
  'fleet.odometer.columns.vehicle',
  'fleet.odometer.columns.driver1',
  'fleet.odometer.columns.driver2',
  'fleet.odometer.columns.outReading',
  'fleet.odometer.columns.inReading',
  'fleet.odometer.columns.km',
  'fleet.odometer.columns.notes',
  'fleet.odometer.columns.sinceService',
  'fleet.vehicles.columns.actions',
];

// ── 1. The table ────────────────────────────────────────────────────────────

describe('the odometer table', () => {
  it('renders the eleven columns in the required order, and nothing else', () => {
    // Exact equality, not "each one appears after the last": that is what makes this catch a
    // column silently added, dropped or moved, rather than only a reordering.
    expect(headers(render())).toEqual(REQUIRED_COLUMNS.map((key) => t(key)));
  });

  it('numbers rows THROUGH the pagination — page 2 does not restart at 1', () => {
    // Three rows of a 25-per-page list, sitting on page 2: they are numbers 26, 27 and 28 of the
    // filtered list, not 1, 2 and 3 of the page. The numbering is Arabic-Indic like every other
    // figure in this table.
    const logs = [log({ id: 'a' }), log({ id: 'b' }), log({ id: 'c' })];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ODOMETER_KEY({ page: 2 }), {
      items: logs,
      meta: { page: 2, pageSize: 25, totalItems: 28, totalPages: 2 },
    });
    qc.setQueryData(
      VEHICLE_SEARCH_KEY(),
      pageOf([{ id: VEHICLE_ID, code: '150', plateNumber: 'س ص 150' }]),
    );
    qc.setQueryData(['fleet', 'odometer', 'alarms'], [alarm()]);

    const serials = firstCells(render({ route: '/fleet/odometer?page=2', qc }));
    expect(serials, 'page 2 of 25 starts at 26').toEqual(['٢٦', '٢٧', '٢٨']);
  });

  it('numbers from the SERVER’s page size, not the one the URL asked for', () => {
    // The server may clamp a page size it was handed. Numbering off the unclamped request would
    // put the wrong serial beside every row, so the offset follows what actually came back.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ODOMETER_KEY({ page: 3, pageSize: 500 }), {
      items: [log({ id: 'a' }), log({ id: 'b' })],
      // Asked for 500 a page; the server paginated by 200.
      meta: { page: 3, pageSize: 200, totalItems: 402, totalPages: 3 },
    });
    qc.setQueryData(
      VEHICLE_SEARCH_KEY(),
      pageOf([{ id: VEHICLE_ID, code: '150', plateNumber: 'س ص 150' }]),
    );
    qc.setQueryData(['fleet', 'odometer', 'alarms'], [alarm()]);

    // 2 × 200 + 1 = 401, not 2 × 500 + 1 = 1001.
    expect(firstCells(render({ route: '/fleet/odometer?page=3&size=500', qc }))).toEqual([
      '٤٠١',
      '٤٠٢',
    ]);
  });

  it('opens the table with the serial column «م»', () => {
    const head = headers(render());
    expect(head[0], 'the first header is the serial').toBe(t('fleet.odometer.columns.no'));
    expect(t('fleet.odometer.columns.no')).toBe('م');
    // …and it is the first CELL of every row, not merely the first header.
    expect(firstCells(render()), 'the first cell of page 1 is row 1').toEqual(['١']);
  });

  it('labels every column in BOTH locales — no header renders as a raw key', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of REQUIRED_COLUMNS) {
        expect(translate(locale, key), `${key} in ${locale}`).not.toBe(key);
      }
    }
  });

  it('names the two driver slots by their shift, as separate columns', () => {
    expect(t('fleet.odometer.columns.driver1')).toBe('اسم السائق الأول (صباحي)');
    expect(t('fleet.odometer.columns.driver2')).toBe('اسم السائق الثاني (مسائي)');
    const head = thead(render());
    expect(head).toContain(t('fleet.odometer.columns.driver1'));
    expect(head).toContain(t('fleet.odometer.columns.driver2'));
    // The old single "Drivers" column is gone — the two slots are distinct facts.
    expect(head).not.toContain(`>${t('fleet.odometer.columns.drivers')}<`);
  });

  it('keeps an unbreakable note inside its column instead of widening the table', () => {
    // A table column is sized by its content, and a note carrying an unbroken run of characters
    // (a pasted reference, a URL) has no break point to wrap at — so the column grew to fit it and
    // pushed the maintenance figure and the row's actions off the screen. Measured in a browser
    // before the fix: the table went from 1134px to 2943px inside a 1134px wrapper.
    const run = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.repeat(4);
    const body = tbody(render({ qc: client([log({ notes: run })]) }));
    const cell = body.slice(body.indexOf(run) - 200, body.indexOf(run));
    // Bounded, and allowed to break inside the run — either alone is not enough: without a width
    // there is no line box to break against, and without breaking the box just overflows.
    expect(cell, 'the note is bounded').toContain('max-w-');
    expect(cell, 'the note may break inside a word').toContain('break-words');
    // It is still a block, or `max-width` has nothing to apply to.
    expect(cell).toContain('block');
  });

  it('shows the code of a vehicle the registry answers for only on a LATER page', () => {
    // The blocker this replaces: the code was joined in the browser from ONE page of the
    // registry, capped at `MAX_PAGE_SIZE`, so every car past that page printed a dash. Here the
    // registry search answers with a DIFFERENT car entirely — the way it would for a car the
    // shortlist does not carry — and the row still names its own.
    const qc = client([log({ vehicleId: 'v101', vehicleCode: '101' })]);
    qc.setQueryData(
      VEHICLE_SEARCH_KEY(),
      pageOf([{ id: VEHICLE_ID, code: '150', plateNumber: 'س ص 150' }]),
    );
    // The third cell is the code column (after the serial and the date).
    const cells = [...tbody(render({ qc })).matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      (m[1] as string).replace(/<[^>]*>/g, '').trim(),
    );
    expect(cells[2], 'the row carries its own code, not a dash').toBe('101');
  });

  it('never joins the code against a page of the registry', () => {
    const source = readFileSync(join(HERE, 'pages/OdometerPage.tsx'), 'utf8');
    // The code is a server fact on the row. A client-side map keyed by vehicle id is exactly the
    // bounded join that made car 101 nameless.
    expect(source).toContain('log.vehicleCode');
    expect(source).not.toMatch(/vehicleCode\.get\(/);
    expect(source).not.toContain('pageSize: MAX_PAGE_SIZE');
  });

  it('shows the vehicle CODE, never the vehicle id', () => {
    const body = tbody(render());
    expect(body).toContain('150');
    // Matched as a whole word: 'v1' as a bare substring also hits Tailwind and SVG attributes,
    // which would make this assert nothing about what the user reads.
    expect(new RegExp(`\\b${VEHICLE_ID}\\b`).test(body), 'the raw id is not printed').toBe(false);
  });

  it('renders the readings and the derived km as the server gave them', () => {
    const body = tbody(render());
    for (const value of ['١٥٠٬٠٠٠', '١٥٠٬٢٥٠', '٢٥٠']) {
      expect(body, `${value} rendered`).toContain(value);
    }
  });

  it('shows the OPEN period as a state, never as a zero', () => {
    // A day with no next reading has no closing reading and no distance. Printing 0 would be a
    // number the server never produced.
    const body = tbody(render({ qc: client([log({ inReading: null, km: null })]) }));
    expect(body).toContain(t('fleet.odometer.openPeriod'));
    expect(body).not.toContain('>٠<');
  });

  it('dashes an absent note rather than leaving the cell blank', () => {
    expect(tbody(render({ qc: client([log({ notes: null })]) }))).toContain('—');
  });
});

// ── 2. The maintenance column ───────────────────────────────────────────────

describe('the distance since the last service', () => {
  const withAlarm = (level: FleetMaintenanceAlarmDto['level'], sinceServiceKm: number | null) =>
    render({ qc: client([log()], [alarm({ level, sinceServiceKm })]) });

  it('reports the DERIVED distance, with the units', () => {
    expect(tbody(withAlarm('none', 2000))).toContain('٢٬٠٠٠');
  });

  it('carries the design system’s own alarm badge for each level', () => {
    expect(tbody(withAlarm('none', 2000))).toContain(t('fleet.vehicle.alarmNone'));
    expect(tbody(withAlarm('yellow', 4200))).toContain(t('fleet.dashboard.level.yellow'));
    expect(tbody(withAlarm('red', 5300))).toContain(t('fleet.dashboard.level.red'));
  });

  it('colours the badge by severity, not by text alone', () => {
    // `Badge` maps the tone to its own palette; the claim is that red and yellow do not share one.
    const red = tbody(withAlarm('red', 5300));
    const yellow = tbody(withAlarm('yellow', 4200));
    expect(red).toContain('red-');
    expect(yellow).toContain('amber-');
    expect(red).not.toBe(yellow);
  });

  it('says NOTHING when the projection refused to compute a distance', () => {
    // No maintenance rule, no service on file, or a reading older than the last service: the
    // backend deliberately returns null rather than a false alarm, and so does the cell.
    const body = tbody(withAlarm('none', null));
    expect(body).toContain('—');
    expect(body).not.toContain(t('fleet.vehicle.alarmNone'));
  });

  it('says nothing for a vehicle the projection does not cover at all', () => {
    // Alarms are computed for ACTIVE vehicles; a history row for a disposed car has no entry.
    const body = tbody(render({ qc: client([log()], []) }));
    expect(body).toContain('—');
  });

  it('reads the thresholds from the SERVER’s projection, never from the page', () => {
    const source = readFileSync(join(HERE, 'pages/OdometerPage.tsx'), 'utf8');
    // No threshold arithmetic here: the level arrives already decided by settings.
    expect(source).not.toMatch(/remainingKm\s*[<>]/);
    expect(source).not.toContain('yellowKm');
    expect(source).not.toContain('redKm');
    expect(source).toContain('useMaintenanceAlarms');
  });
});

// ── 2b. Server-side paging and the default window ───────────────────────────

describe('the server answers the whole question — the page never slices', () => {
  /** A page of `n` rows with the meta the SERVER would return for that slice. */
  const serverPage = (n: number, meta: { page: number; pageSize: number; totalItems: number }) => ({
    items: Array.from({ length: n }, (_, i) => log({ id: `o${meta.page}-${i}` })),
    meta: { ...meta, totalPages: Math.ceil(meta.totalItems / meta.pageSize) },
  });

  const seeded = (key: ReturnType<typeof ODOMETER_KEY>, page: unknown): QueryClient => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(key, page);
    qc.setQueryData(
      VEHICLE_SEARCH_KEY(),
      pageOf([{ id: VEHICLE_ID, code: '150', plateNumber: 'س ص 150' }]),
    );
    qc.setQueryData(['fleet', 'odometer', 'alarms'], [alarm()]);
    return qc;
  };

  it('asks for the CURRENT MONTH when the URL names no bound', () => {
    // The log grows a row per vehicle per running day, so "no filter" would mean the whole
    // history. The default is a window, and it is the server that applies it: the rows below can
    // only appear if the request carried this month's bounds, because that is the key they sit on.
    const qc = seeded(ODOMETER_KEY({ from: MONTH.from, to: MONTH.to }), pageOf([log()]));
    expect(tbody(render({ qc }))).toContain('١٥٠٬٠٠٠');
    // …and the two date boxes show the window, so the reader can see which days these are.
    const bar = filterBar(render({ qc }));
    expect(bar, 'the start bound is shown').toContain(`value="${MONTH.from}"`);
    expect(bar, 'the end bound is shown').toContain(`value="${MONTH.to}"`);
  });

  it('does not treat its own default as a filter the reader has set', () => {
    // The reset affordance is "undo what I narrowed", and on arrival nothing is narrowed.
    const qc = seeded(ODOMETER_KEY(), pageOf([log()]));
    expect(filterBar(render({ qc })), 'no reset on arrival').not.toContain(
      `aria-label="${t('common.filters.clear')}"`,
    );
    // An explicit bound IS a filter, so the reset appears.
    const explicit = seeded(ODOMETER_KEY({ from: '2026-01-01', to: undefined }), pageOf([log()]));
    expect(filterBar(render({ route: '/fleet/odometer?from=2026-01-01', qc: explicit }))).toContain(
      `aria-label="${t('common.filters.clear')}"`,
    );
  });

  it('sends the chosen pageSize, and asks the SERVER for that many', () => {
    // Seeded ONLY under pageSize=10: rows appear iff the request carried it.
    const qc = seeded(
      ODOMETER_KEY({ pageSize: 10 }),
      serverPage(10, { page: 1, pageSize: 10, totalItems: 2438 }),
    );
    const body = tbody(render({ route: '/fleet/odometer?size=10', qc }));
    expect(body.match(/<tr/g)?.length ?? 0, 'ten rows, not a sliced larger set').toBe(10);
  });

  it('fetches PAGE 2 from the server rather than holding page 1 and slicing it', () => {
    // Only page 2 is in the cache. If the page asked for page 1 — or asked for everything and
    // sliced — this render would find nothing.
    const qc = seeded(
      ODOMETER_KEY({ page: 2 }),
      serverPage(25, { page: 2, pageSize: 25, totalItems: 73 }),
    );
    const html = render({ route: '/fleet/odometer?page=2', qc });
    expect(tbody(html).match(/<tr/g)?.length ?? 0).toBe(25);
    // The serial column proves it is the SECOND page: it counts from 26.
    expect(firstCells(html)[0]).toBe('٢٦');
  });

  it('takes the totals from the SERVER’s meta, never from the rows in hand', () => {
    // 73 records over 25 a page: page 3 holds 23 of them, and the footer must say 73 and 3 —
    // numbers no arithmetic on the 23 loaded rows could produce.
    const qc = seeded(
      ODOMETER_KEY({ page: 3 }),
      serverPage(23, { page: 3, pageSize: 25, totalItems: 73 }),
    );
    const html = render({ route: '/fleet/odometer?page=3', qc });
    expect(tbody(html).match(/<tr/g)?.length ?? 0, 'the last page is short').toBe(23);
    const footer = html.slice(html.indexOf('</table>'));
    expect(footer, 'the total is the server’s').toContain(formatNumber(73, 'ar'));
    expect(footer, 'showing 51–73').toContain(formatNumber(51, 'ar'));
    expect(footer, 'page 3 of 3').toContain(
      translate('ar', 'common.pagination.page', {
        page: formatNumber(3, 'ar'),
        total: formatNumber(3, 'ar'),
      }),
    );
  });

  it('offers 10 / 25 / 50 / 100 as the page sizes', () => {
    const qc = seeded(ODOMETER_KEY(), pageOf([log()]));
    const footer = render({ qc }).slice(render({ qc }).indexOf('</table>'));
    for (const size of [10, 25, 50, 100]) {
      expect(footer, `${size} offered`).toContain(`value="${size}"`);
    }
  });

  it('holds NO local pagination or filtering — the server decides both', () => {
    const source = readFileSync(join(HERE, 'pages/OdometerPage.tsx'), 'utf8');
    for (const local of ['rows.filter(', 'items.filter(', '.slice(', 'rows.splice(']) {
      expect(source, `${local} would be local work`).not.toContain(local);
    }
    // The rows handed to the table are exactly the page the server returned.
    expect(source).toContain('data?.items ?? []');
    // And the pagination is driven by the server's meta, not by a count of those rows.
    expect(source).toContain('meta={data.meta}');
  });

  it('resets to page 1 when a filter or the page SIZE changes, but not when paging', () => {
    // `patch` drops `page` unless told otherwise; the filter controls take that default, and only
    // the two pagination callbacks opt out. Asserted on the source: changing a filter is a DOM
    // event, and this suite has no DOM to raise one.
    const source = readFileSync(join(HERE, 'pages/OdometerPage.tsx'), 'utf8');
    expect(source, 'the default drops the page').toContain(
      "if (resetPage && !('page' in updates)) next.delete('page');",
    );
    // Paging keeps the page it was given…
    expect(source).toContain('onPageChange={(p) => patch({ page: String(p) }, false)}');
    // …and a page-size change clears it, so the reader lands on page 1 of the new slicing.
    expect(source).toContain(
      'onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}',
    );
    // No filter control opts out of the reset.
    const bar = source.slice(source.indexOf('<FilterBar'), source.indexOf('</FilterBar>'));
    expect(bar, 'no filter keeps the old page').not.toContain(', false)');
  });
});

// ── 3. The filters ──────────────────────────────────────────────────────────

describe('the filter bar', () => {
  it('offers a control for every filter the brief names', () => {
    const html = render();
    for (const label of [
      t('fleet.odometer.columns.vehicle'),
      t('fleet.odometer.columns.alert'),
      t('fleet.odometer.columns.driver'),
    ]) {
      expect(html, `${label} filter`).toContain(label);
    }
    expect(html).toContain('id="odometer-from"');
    expect(html).toContain('id="odometer-to"');
  });

  it('stacks NO label above any filter — each one is named on its own line', () => {
    const bar = filterBar(render());
    // `Field` is the stacked-label pattern, and its label is the `block` one. That is what this
    // bar refuses: a caption on a line of its own doubles the height of the row and leaves the
    // controls out of step with the multi-selects, which name themselves inside their trigger.
    expect(bar, 'no block-level label above a control').not.toContain('block text-sm font-medium');
    // Every `<label>` in the bar is an INLINE row that contains its own control.
    for (const open of bar.split('<label').slice(1)) {
      const label = open.slice(0, open.indexOf('</label>'));
      expect(label, 'label lays its caption beside the control').toContain('flex');
      expect(label, 'label lays its caption beside the control').toContain('items-center');
      expect(label, 'label owns the control it names').toContain('<input');
    }
  });

  it('tells the two date bounds apart by a caption the eye can read', () => {
    const bar = filterBar(render());
    // The heart of it: a date input paints its own `yyyy/mm/dd` hint and ignores `placeholder`,
    // so with nothing beside them the two bounds are the same control drawn twice. The caption is
    // VISIBLE text — not `sr-only`, not a `title` that needs a pointer resting on it.
    expect(bar, 'the start bound is captioned').toContain(
      `>${t('fleet.odometer.fromDate')}</span>`,
    );
    expect(bar, 'the end bound is captioned').toContain(`>${t('fleet.odometer.toDate')}</span>`);
    expect(t('fleet.odometer.fromDate'), 'the two captions differ').not.toBe(
      t('fleet.odometer.toDate'),
    );
    // And each caption sits in the same `<label>` as the bound it names, so it is not merely
    // near the control — it belongs to it.
    for (const [id, key] of [
      ['odometer-from', 'fleet.odometer.fromDate'],
      ['odometer-to', 'fleet.odometer.toDate'],
    ] as const) {
      const label = bar.split('<label').find((chunk) => chunk.includes(`id="${id}"`));
      expect(label, `${id} lives in a label`).toBeDefined();
      expect(label as string, `${id} is captioned`).toContain(t(key));
    }
  });

  it('still names every filter for a screen reader and a pointer', () => {
    const bar = filterBar(render());
    for (const key of ['fleet.odometer.fromDate', 'fleet.odometer.toDate']) {
      expect(bar, `${key} aria-label`).toContain(`aria-label="${t(key)}"`);
      expect(bar, `${key} title`).toContain(`title="${t(key)}"`);
    }
    // The driver box is named and hinted; the two multi-selects name themselves in their trigger.
    expect(bar).toContain(`aria-label="${t('fleet.odometer.columns.driver')}"`);
    expect(bar).toContain(`placeholder="${t('fleet.odometer.driverPlaceholder')}"`);
    expect(bar).toContain(t('fleet.odometer.columns.vehicle'));
    expect(bar).toContain(t('fleet.odometer.columns.alert'));
  });

  it('lines all five filters up on ONE row, none of them taking the leftover space', () => {
    const html = render();
    const bar = filterBar(html);
    // The container stops wrapping once the viewport is wide enough to hold the whole row, and
    // not one pixel before: `flex-nowrap` does not shorten a row that will not fit, it pushes it
    // off the page. Below that it still wraps — the fallback for a screen too narrow for five.
    const open = html.slice(html.indexOf('<div class="flex flex-wrap items-center gap-2'));
    expect(open.slice(0, open.indexOf('>')), 'one row on a desktop').toContain(
      'min-[1400px]:flex-nowrap',
    );
    expect(open.slice(0, open.indexOf('>')), 'wrap is the narrow-screen fallback').toContain(
      'flex-wrap',
    );
    // Nothing in the bar may grow into the space the others leave. (`w-full` is not the test:
    // `Input` carries it at its base and merely fills the fixed-width wrapper it sits in.)
    expect(bar, 'no filter takes the leftover space').not.toContain('flex-1');
    expect(bar, 'no filter grows').not.toMatch(/\bgrow\b/);
    expect(bar, 'no filter is sized by the row').not.toMatch(/\bbasis-/);
    // Every filter holds its own width instead of being squeezed by its neighbours.
    expect(bar.match(/shrink-0/g)?.length ?? 0, 'each filter is shrink-0').toBeGreaterThanOrEqual(
      5,
    );
    // The date bounds are the narrow ones — a date needs ten characters, not a share of the row.
    expect(bar.match(/class="w-36"/g)?.length ?? 0, 'both dates are narrow').toBe(2);
    // …and the two text-ish filters are the medium ones.
    expect(bar, 'the driver box is medium').toContain('w-44');
  });

  it('asks the REGISTRY for codes matching what was typed, not the first page of it', () => {
    // The property is the same one this page has always had; it moved into the control every
    // screen now shares, so it is asserted where it lives — once, instead of once per page.
    const source = readFileSync(join(HERE, 'components/VehicleCodeFilter.tsx'), 'utf8');
    expect(source).toContain('onSearch: setSearch');
    expect(source).toContain('search: search.trim()');
    expect(source).not.toContain('MAX_PAGE_SIZE');
  });

  it('builds its options from the search, with the selection kept reachable', () => {
    // `MultiSelect` renders its list only once opened, and the node-env suite cannot open it — so
    // the rule itself lives in `vehicleCodeOptions` and is proven in its own spec. What belongs
    // here is that the control feeds it the search's answer and the current selection, and no more.
    const source = readFileSync(join(HERE, 'components/VehicleCodeFilter.tsx'), 'utf8');
    expect(source).toContain('vehicleCodeOptions(vehicles.data?.items ?? [], value)');
  });

  it('renders that one control rather than assembling its own', () => {
    const source = readFileSync(join(HERE, 'pages/OdometerPage.tsx'), 'utf8');
    expect(source).toContain('<VehicleCodeFilter');
    // A page that kept its own options would be a second answer to drift from the first.
    expect(source).not.toContain('vehicleCodeOptions');
  });

  it('NAMES the chosen codes in the trigger rather than counting them', () => {
    // "3" does not tell the reader WHICH three cars they are looking at, and a registry runs to
    // hundreds. Rendered here with two chosen, straight off the real page.
    const qc = client([log()], [alarm()], { vehicleCodes: ['ZZ0104', 'ZZ0105'] });
    qc.setQueryData(
      VEHICLE_SEARCH_KEY(),
      pageOf([
        { id: 'v1', code: 'ZZ0104', plateNumber: 'س ص 104' },
        { id: 'v2', code: 'ZZ0105', plateNumber: 'س ص 105' },
      ]),
    );
    const bar = filterBar(render({ route: '/fleet/odometer?vehicleCodes=ZZ0104,ZZ0105', qc }));
    expect(bar, 'both codes are visible without opening the list').toContain('ZZ0104, ZZ0105');
    // The plate belongs in the list, not on a one-row trigger.
    expect(bar.slice(0, bar.indexOf('odometer-from')), 'no plate on the trigger').not.toContain(
      'س ص 104',
    );
  });

  it('still shows the filter’s NAME while nothing is chosen', () => {
    const bar = filterBar(render());
    expect(bar).toContain(t('fleet.odometer.columns.vehicle'));
    expect(bar).toContain(t('fleet.odometer.columns.alert'));
  });

  it('names the alert LEVELS in words, never their wire values', () => {
    const qc = client([log()], [alarm()], { alerts: ['yellow', 'red'] });
    const bar = filterBar(render({ route: '/fleet/odometer?alerts=yellow,red', qc }));
    expect(bar).toContain(
      `${t('fleet.dashboard.level.yellow')}, ${t('fleet.dashboard.level.red')}`,
    );
    expect(bar, 'the wire value is not user-facing').not.toContain('>yellow<');
  });

  it('sends the SAME parameters as before — this is a display change only', () => {
    // The rows below sit on a key built from the unchanged param names and values. If naming the
    // choices had altered what travels, this would be a cache miss and the table would be empty.
    const qc = client([log()], [alarm()], { vehicleCodes: ['ZZ0104', 'ZZ0105'], alerts: ['red'] });
    qc.setQueryData(
      VEHICLE_SEARCH_KEY(),
      pageOf([{ id: 'v1', code: 'ZZ0104', plateNumber: 'س ص 104' }]),
    );
    const body = tbody(
      render({ route: '/fleet/odometer?vehicleCodes=ZZ0104,ZZ0105&alerts=red', qc }),
    );
    expect(body, 'the request is unchanged').toContain('١٥٠٬٠٠٠');
  });

  it('takes SEVERAL vehicles and SEVERAL alert levels at once', () => {
    const html = render({
      route: '/fleet/odometer?vehicleCodes=150,151&alerts=yellow,red',
      qc: client([log()], [alarm()], { vehicleCodes: ['150', '151'], alerts: ['yellow', 'red'] }),
    });
    // A filtered list must never look unfiltered — and it now says WHICH, not how many.
    const bar = filterBar(html);
    expect(bar, 'both codes named').toContain('150, 151');
    expect(bar, 'both levels named').toContain(
      `${t('fleet.dashboard.level.yellow')}, ${t('fleet.dashboard.level.red')}`,
    );
  });

  it('reads every filter from the URL, so a filtered view is a shareable link', () => {
    const html = render({
      route: '/fleet/odometer?from=2026-08-01&to=2026-08-18&driver=%D9%85%D8%AD%D9%85%D8%AF',
      qc: client([log()], [alarm()], { from: '2026-08-01', to: '2026-08-18' }),
    });
    expect(html).toContain('value="2026-08-01"');
    expect(html).toContain('value="2026-08-18"');
    expect(html).toContain('value="محمد"');
  });

  it('clears every filter at once', () => {
    const source = readFileSync(join(HERE, 'pages/OdometerPage.tsx'), 'utf8');
    const clear = source.slice(
      source.indexOf('onClear={'),
      source.indexOf('>\n          {/* Several'),
    );
    for (const key of ['vehicleCodes', 'from', 'to', 'driver', 'alerts']) {
      expect(clear, `${key} cleared`).toContain(`${key}: null`);
    }
  });

  it('sends every filter to the SERVER — nothing is applied to the fetched page', () => {
    const source = readFileSync(join(HERE, 'pages/OdometerPage.tsx'), 'utf8');
    const params = source.slice(
      source.indexOf('const params = useMemo'),
      source.indexOf('useOdometerLogs('),
    );
    for (const key of ['vehicleCodes:', 'from:', 'to:', 'alerts:', 'driverEmployeeIds:']) {
      expect(params, `${key} reaches the query`).toContain(key);
    }
    expect(source).not.toContain('rows.filter(');
    expect(source).not.toContain('items.filter(');
  });

  it('the backend accepts every one of them', () => {
    // The regression: before this slice the query was `.strict()` with only vehicleId/from/to,
    // so each of these threw and none of the filters could have worked server-side.
    const q = ListFleetOdometerQuerySchema;
    expect(q.parse({ vehicleCodes: '150,151' }).vehicleCodes).toEqual(['150', '151']);
    expect(q.parse({ alerts: 'yellow,red' }).alerts).toEqual(['yellow', 'red']);
    expect(q.parse({ driverEmployeeIds: '64b1f0dddddddddddddddd01' }).driverEmployeeIds).toEqual([
      '64b1f0dddddddddddddddd01',
    ]);
    // …and still refuses a level that is not a level, rather than ignoring it.
    expect(() => q.parse({ alerts: 'purple' })).toThrow();
  });

  it('caps the resolved driver ids at one HR page, refusing more rather than truncating', () => {
    const ids = (n: number): string =>
      Array.from({ length: n }, (_, i) => `64b1f0dddddddddddd${String(i).padStart(6, '0')}`).join(
        ',',
      );
    expect(
      ListFleetOdometerQuerySchema.parse({ driverEmployeeIds: ids(MAX_PAGE_SIZE) })
        .driverEmployeeIds,
    ).toHaveLength(MAX_PAGE_SIZE);
    expect(() =>
      ListFleetOdometerQuerySchema.parse({ driverEmployeeIds: ids(MAX_PAGE_SIZE + 1) }),
    ).toThrow();
  });

  it('offers the driver filter only to someone who can read HR', () => {
    const without = render({ permissions: ['fleetOdometer.view'] });
    expect(without).not.toContain(`aria-label="${t('fleet.odometer.columns.driver')}"`);
    const with_ = render({ permissions: ['fleetOdometer.view', 'employee.view'] });
    expect(with_).toContain(`aria-label="${t('fleet.odometer.columns.driver')}"`);
  });
});

// ── 4. Actions and permissions ──────────────────────────────────────────────

describe('the actions respect the existing grants', () => {
  it('offers the correction only with fleetOdometer.correct', () => {
    expect(render()).toContain(t('fleet.odometer.correct'));
    expect(render({ permissions: ['fleetOdometer.view'] })).not.toContain(
      `aria-label="${t('fleet.odometer.correct')}"`,
    );
  });

  it('carries a single filtered vehicle into the record dialog, as it always did', () => {
    // The page passes its one filtered vehicle to the dialog. The multi-select must not lose
    // that; with SEVERAL selected there is no single answer, so it passes none.
    //
    // By CODE, not by id: the page no longer holds the whole registry to look an id up in, and
    // resolving one against the current search shortlist would drop the carry-over for exactly
    // the cars that are the point of this — a filtered code the shortlist does not carry.
    const source = readFileSync(join(HERE, 'pages/OdometerPage.tsx'), 'utf8');
    const mount = source.slice(source.indexOf('<RecordOdometerDialog'));
    expect(mount).toContain('vehicleCodes.length === 1');
    expect(mount).toContain('initialVehicleCode=');
    expect(mount, 'no id lookup against a shortlist').not.toContain('v.code === vehicleCodes[0]');
  });

  it('offers recording only with fleetOdometer.record', () => {
    expect(render()).toContain(t('fleet.odometer.record'));
    expect(render({ permissions: ['fleetOdometer.view'] })).not.toContain(
      t('fleet.odometer.record'),
    );
  });

  it('invents no new permission — the three existing odometer grants are the whole surface', () => {
    const source = readFileSync(join(HERE, 'pages/OdometerPage.tsx'), 'utf8');
    for (const grant of [...source.matchAll(/can\('([^']+)'\)|permission="([^"]+)"/g)]) {
      const key = grant[1] ?? grant[2] ?? '';
      expect(
        ['fleetOdometer.view', 'fleetOdometer.record', 'fleetOdometer.correct', 'employee.view'],
        `${key} is an existing grant`,
      ).toContain(key);
    }
  });
});

// ── 5. Recording ────────────────────────────────────────────────────────────

describe('recording a reading', () => {
  const source = readFileSync(join(HERE, 'components/RecordOdometerDialog.tsx'), 'utf8');

  /**
   * The dialog renders through a portal into `document.body`, which the node-env suite has not
   * got. Stubbing the portal renders its own tree in place, which is all these read.
   */
  const renderDialog = ({
    qc,
    initialVehicleCode = '',
  }: {
    qc: QueryClient;
    initialVehicleCode?: string;
  }): string => {
    const store = configureStore({
      reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
      preloadedState: {
        locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
        auth: {
          me: {
            id: 'u1',
            permissions: Object.fromEntries(ALL.map((k) => [k, 'organization'])),
          } as unknown as MeDto,
          status: 'signedIn' as const,
        },
      },
    });
    return renderToStaticMarkup(
      <Provider store={store}>
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <RecordOdometerDialog
              open
              onClose={() => undefined}
              initialVehicleCode={initialVehicleCode}
            />
          </MemoryRouter>
        </QueryClientProvider>
      </Provider>,
    );
  };

  it('lets the operator TYPE a vehicle code instead of scrolling a dropdown', () => {
    expect(source).toContain('Combobox');
    expect(source).not.toContain('VehicleSelect');
  });

  it('searches the REGISTRY for a code, so any car in the fleet can be recorded', () => {
    // The blocker: the options were one page of the registry filtered in the browser, so a car
    // past `MAX_PAGE_SIZE` by code could not be picked — and therefore could not have a reading
    // recorded at all. The typed query now goes to the server.
    expect(source).toContain('onSearch={setCodeQuery}');
    expect(source).toContain('search: codeQuery.trim()');
    expect(source).not.toContain('pageSize: MAX_PAGE_SIZE');
    // A picked code outlives the search that found it, or the box blanks as the operator types on.
    expect(source).toContain('pickedCode');
  });

  it('SHOWS a carried-over code straight away, however far down the registry its car sits', () => {
    // The code is shown from the first paint, before the registry has answered for it — an effect
    // runs after the paint, so seeding only there would flash an empty vehicle box. Rendered here
    // with the registry answering about a DIFFERENT car, the way a shortlist would.
    for (const code of ['150', 'ZZ0104']) {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      qc.setQueryData(
        VEHICLE_SEARCH_KEY(),
        pageOf([{ id: VEHICLE_ID, code: '150', plateNumber: 'س ص 150' }]),
      );
      const html = renderDialog({ qc, initialVehicleCode: code });
      const box = html.slice(html.indexOf('role="combobox"'));
      expect(/value="([^"]*)"/.exec(box)?.[1], `${code} is shown`).toBe(code);
    }
  });

  it('cannot save a code the registry does not carry', () => {
    // `Combobox` only ever commits a value that IS an option, and an unmatched code maps to ''.
    expect(source).toContain("setVehicleId(byCode.get(code)?.id ?? '')");
    expect(source).toContain("vehicleId !== ''");
  });

  it('prefills the two slots from the DUTY ROSTER for that day and vehicle', () => {
    expect(source).toContain('useRosterDay');
    expect(source).toContain('row.vehicleId === vehicleId');
    // Prefill only — a slot the user already chose is never overwritten by a late board.
    expect(source).toContain('prev || rosterRow.driver1EmployeeId');
    expect(source).toContain('prev || rosterRow.driver2EmployeeId');
  });

  it('makes NO roster request without fleetRoster.view', () => {
    expect(source).toContain("can('fleetRoster.view')");
    expect(source).toContain("? date : ''");
    const queries = readFileSync(join(HERE, 'api/fleet-queries.ts'), 'utf8');
    expect(queries.slice(queries.indexOf('export const useRosterDay'))).toContain(
      "enabled: date !== ''",
    );
  });

  it('CLEARS the slots when the vehicle or the date changes', () => {
    // The crew belongs to a (vehicle, date) pair. Filling empty slots only — without clearing —
    // meant switching from car 150 to car 151 kept 150's drivers and recorded them against 151.
    const reset = source.slice(source.indexOf('useEffect(() => {\n    setDriver1'));
    expect(reset).toContain("setDriver1('')");
    expect(reset).toContain("setDriver2('')");
    expect(reset.slice(0, reset.indexOf('});') + 40)).toContain('[vehicleId, date]');
  });

  it('never prefills from the PREVIOUS day’s board while the new one loads', () => {
    // `useRosterDay` keeps the last board as placeholder data, so without this guard a date
    // change briefly exposes yesterday's crew — and the fill would make it permanent.
    expect(source).toContain('roster.isPlaceholderData');
    const fill = source.slice(source.indexOf('if (rosterRow === null'));
    expect(fill.slice(0, 120)).toContain('roster.isPlaceholderData');
  });

  it('SHOWS ك.م without asking for it', () => {
    // The legacy did the same subtraction on submit — `POST /cars_log` set the new row's
    // `out_num`, the previous row's `in_num`, and km = the difference — so a manual field would
    // be a second answer to a question the server already answers. What the operator would lose
    // is the sight of the distance, so it is previewed from the server's own expected reading.
    expect(source).toContain("t('fleet.odometer.columns.km')");
    expect(source).toContain('const derivedKm');
    expect(source).toContain('readingNumber - previousReading');
    // Previewed, never collected: no km state, and no km on the wire.
    expect(source).not.toMatch(/useState[^;]*\bkm\b/i);
    const body = source.slice(
      source.indexOf('await record.mutateAsync'),
      source.indexOf('toast.success'),
    );
    expect(body).not.toContain('km');
    expect(body).not.toContain('inReading');
  });

  it('shows a dash until both numbers are known, rather than a guess', () => {
    expect(source).toContain('previousReading === null');
    expect(source).toContain("reading === ''");
  });

  it('warns when the reading is below the previous one, and leaves the refusal to the server', () => {
    expect(source).toContain('derivedKm < 0');
    expect(source).toContain('fleet.odometer.kmBelowPrevious');
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of ['fleet.odometer.kmBelowPrevious', 'fleet.odometer.kmDerivedHint']) {
        expect(translate(locale, key), `${key} in ${locale}`).not.toBe(key);
      }
    }
  });

  it('names the two driver slots by their SHIFT, as the table does', () => {
    // The slots are not interchangeable — slot 1 is the morning, slot 2 the evening — and the
    // dialog is where that is decided. It used to borrow the roster screens' generic
    // "السائق الأول/الثاني", which named the order and not the shift.
    expect(source).toContain("t('fleet.odometer.columns.driver1')");
    expect(source).toContain("t('fleet.odometer.columns.driver2')");
    expect(source).not.toContain("t('fleet.odometer.fields.driver1')");
    expect(source).not.toContain("t('fleet.odometer.fields.driver2')");
    // The words themselves carry the shift, in both locales.
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of ['fleet.odometer.columns.driver1', 'fleet.odometer.columns.driver2']) {
        expect(translate(locale, key), `${key} in ${locale}`).not.toBe(key);
      }
    }
    expect(t('fleet.odometer.columns.driver1')).toContain('صباحي');
    expect(t('fleet.odometer.columns.driver2')).toContain('مسائي');
  });

  it('asks for nothing the server derives — no km, no closing reading', () => {
    expect(source).not.toContain('inReading');
    // No km INPUT. `km:` does appear as an i18n interpolation for the server's expected-reading
    // hint, which is the opposite of asking the user for it, so the claim is about the form state.
    expect(source).not.toMatch(/useState.*\bkm\b/i);
    expect(source).not.toContain('record.mutateAsync({ km');
  });
});
