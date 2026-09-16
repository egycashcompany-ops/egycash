// «انا عاوز اقدر اعمل الاتنين مع بعض وعادى» — on the screen, not only in the rule module.
//
// The defect the owner described: click «الكود» and the registry sorts by code; click «انتهاء
// الترخيص» and the code order is thrown away. Two questions, one slot. What is proved here is the
// half a function cannot prove — that the registry READS the whole order out of its address bar,
// ASKS the server for all of it, and SHOWS which column decides first — and that the seven Fleet
// tables are wired the same way, because a fix on one screen is the defect on the other six.
//
// The suite has no DOM, so a click cannot be dispatched. A click's DESTINATION can be visited,
// which is the same way the roster's chips are tested: `toggleSort` says where a click lands
// (`lib/table-sort.spec.ts`), and the page is rendered at that address here.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type FleetVehicleDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { VehiclesListPage } from './pages/VehiclesListPage';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = (path: string): string =>
  readFileSync(join(HERE, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const paged = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
});

const vehicle = (over: Partial<FleetVehicleDto> = {}): FleetVehicleDto => ({
  id: 'v1',
  code: '150',
  typeId: 'ty1',
  plateNumber: 'س ص 150',
  chassisNumber: 'CH-150',
  motorNumber: 'MO-150',
  joinedAt: '2024-01-01T00:00:00.000Z',
  licenseExpiresAt: '2027-01-01T00:00:00.000Z',
  licenseClassId: null,
  operationId: null,
  insuranceCompanyId: null,
  branchId: 'b1',
  departmentId: null,
  radio: { issi: null, motorolaSn: null },
  status: 'active',
  statusReason: null,
  licenseImage: null,
  inWorkshop: false,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

/** Exactly the parameters the registry sends for a given order — its list key. */
const vehicleParams = (sort: { sortBy: string; sortDir: string; sort: string }) => ({
  page: 1,
  pageSize: 25,
  ...sort,
  search: undefined,
  status: undefined,
  typeId: undefined,
  vehicleCodes: undefined,
  plateNumber: undefined,
  chassisNumber: undefined,
  motorNumber: undefined,
  licenseClassId: undefined,
  operationId: undefined,
  insuranceCompanyId: undefined,
  branchId: undefined,
});

const ROWS = [vehicle({ id: 'v1', code: '150' }), vehicle({ id: 'v2', code: '151' })];

const client = (sort: { sortBy: string; sortDir: string; sort: string }): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(listKey('fleet', 'vehicles', vehicleParams(sort)), paged(ROWS));
  qc.setQueryData(listKey('fleet', 'vehicleTypes', { pageSize: 100 }), paged([]));
  qc.setQueryData(['hr', 'branches', 'active'], paged([]));
  return qc;
};

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: { 'fleetVehicle.view': 'organization' },
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

/** The registry, at the address a click would take the reader to. */
const at = (route: string, qc: QueryClient): string =>
  renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <VehiclesListPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);
const tbody = (markup: string): string =>
  markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tbody>'));
/** The header cell of one column, by the name it prints. */
const header = (markup: string, label: string): string => {
  const head = markup.slice(markup.indexOf('<thead'), markup.indexOf('</thead>'));
  const at_ = head.indexOf(label);
  if (at_ === -1) throw new Error(`no header ${label}`);
  return head.slice(head.lastIndexOf('<th', at_), head.indexOf('</th>', at_));
};

const CODE = t('fleet.vehicles.columns.code');
const EXPIRY = t('fleet.vehicles.columns.license');

describe('the registry holds TWO columns at once', () => {
  const TWO = { sortBy: 'code', sortDir: 'asc', sort: 'code:asc,licenseExpiresAt:desc' };

  it('asks the server for the whole order the address bar carries', () => {
    // The seeded key IS the assertion: seeded under the two-column order, the page paints rows;
    // if it asked for anything else it would paint the skeleton and this would be empty.
    const markup = at('/fleet/vehicles?sort=code:asc,licenseExpiresAt:desc', client(TWO));
    expect(tbody(markup)).toContain('150');
    expect(tbody(markup)).toContain('151');
  });

  it('marks BOTH columns, and numbers them in the order they were clicked', () => {
    const markup = at('/fleet/vehicles?sort=code:asc,licenseExpiresAt:desc', client(TWO));
    expect(header(markup, CODE), 'the first column decides first').toContain('data-sort-order="1"');
    expect(header(markup, EXPIRY), 'the second breaks its ties').toContain('data-sort-order="2"');
  });

  it('turns the arrow the way each column is going, one column at a time', () => {
    const markup = at('/fleet/vehicles?sort=code:asc,licenseExpiresAt:desc', client(TWO));
    // `rotate-180` is the ascending arrow; descending is the resting one.
    expect(header(markup, CODE), 'code ascending').toContain('rotate-180');
    expect(header(markup, EXPIRY), 'expiry descending').not.toContain('rotate-180');
  });

  it('numbers NOTHING while one column is enough — the badge only appears when it says something', () => {
    const one = { sortBy: 'code', sortDir: 'asc', sort: 'code:asc' };
    const markup = at('/fleet/vehicles?sort=code:asc', client(one));
    expect(tbody(markup), 'the page is loaded, not a skeleton').toContain('150');
    expect(markup, 'no ordinal on a single-column order').not.toContain('data-sort-order');
  });

  it('opens on the screen’s own default when the address bar says nothing', () => {
    const fallback = { sortBy: 'code', sortDir: 'asc', sort: 'code:asc' };
    expect(tbody(at('/fleet/vehicles', client(fallback)))).toContain('150');
  });

  it('survives a hand-edited parameter instead of showing an empty registry', () => {
    const fallback = { sortBy: 'code', sortDir: 'asc', sort: 'code:asc' };
    expect(tbody(at('/fleet/vehicles?sort=%40%40%40', client(fallback)))).toContain('150');
  });
});

describe('every Fleet table is wired the same way', () => {
  /** The pages that sort — each reads the order, toggles it, and sends it or applies it. */
  const PAGES = readdirSync(join(HERE, 'pages'))
    .filter((name) => name.endsWith('.tsx'))
    .filter((name) => code(join('pages', name)).includes('onSortChange={changeSort}'));

  /**
   * The boards that hold EVERY row they report on, so they order them in hand.
   *
   * Not a shortcut and not an exception to the rule above — the rule is «the order the reader
   * asked for is the order of the whole answer», and on these three the whole answer is already
   * on the screen: the daily roster and the standing roster are a day's entire fleet, and the
   * alarms board derives one row per vehicle with no paging at all. Sending `?sort=` to a server
   * that pages none of them would be asking a question nobody is answering.
   *
   * Named rather than detected, because this is a CLAIM about each screen — «this board is
   * whole» — and a new screen must be looked at rather than inherit the answer by accident.
   */
  const CLIENT_BOARDS = ['RosterPage.tsx', 'FixedRosterPage.tsx', 'MaintenanceAlarmsPage.tsx'];
  const SERVER_PAGES = PAGES.filter((name) => !CLIENT_BOARDS.includes(name));

  it('finds every sorting page — the census is not empty', () => {
    // Ten today: seven server-paged registers and the three whole boards.
    expect(PAGES.length).toBeGreaterThanOrEqual(10);
    expect(SERVER_PAGES.length).toBeGreaterThanOrEqual(7);
    for (const board of CLIENT_BOARDS) expect(PAGES, board).toContain(board);
  });

  it.each(PAGES)('%s reads the whole order out of the URL', (name) => {
    const source = code(join('pages', name));
    expect(source).toContain("const sortParam = sp.get('sort');");
    expect(source).toMatch(/const sorts = useMemo\(\(\) => readSorts\(sortParam, '[^']+'\), \[sortParam\]\);/);
  });

  it.each(PAGES)('%s ADDS a column on a click instead of replacing what is there', (name) => {
    const source = code(join('pages', name));
    // The paged registers keep their page number («, false»); the whole boards have no page to
    // keep. Both call the same toggle, which is the part that must not be written twice.
    expect(source).toContain('patch({ sort: writeSorts(toggleSort(sorts, by)) }');
    // The rule it replaced, spelled out so it cannot come back by hand: one column, flipped.
    expect(source, 'no second copy of the old single-column toggle').not.toContain(
      "const dir = sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';",
    );
  });

  it.each(SERVER_PAGES)('%s sends the order to the server, both shapes', (name) => {
    const source = code(join('pages', name));
    expect(source).toContain('...sortQuery(sorts)');
    expect(source, 'nothing still sends a single column by hand').not.toMatch(
      /sortBy: sort\.by/,
    );
  });

  it.each(CLIENT_BOARDS)('%s orders the WHOLE board in hand, through the shared rule', (name) => {
    const source = code(join('pages', name));
    // One rule module, as on the server side: three copies of a comparator is three behaviours,
    // and the one that matters most — a missing value sorts LAST either way round — is the one
    // that would quietly differ.
    expect(source).toContain("from '../lib/sort-rows'");
    expect(source).toContain('sortRows(');
    // And it does NOT ask the server for an order it does not page.
    expect(source, 'nothing is sent to a server that pages none of it').not.toContain(
      'sortQuery(sorts)',
    );
  });

  it.each(PAGES)('%s hands the table the list, so the badges can be drawn', (name) => {
    expect(code(join('pages', name))).toContain('sort={sorts}');
  });

  it('keeps ONE rule module — seven copies of a toggle is seven behaviours', () => {
    for (const name of PAGES) {
      expect(code(join('pages', name)), name).toContain("from '../lib/table-sort'");
    }
  });
});

describe('what the shared table does with an order it is handed', () => {
  const TABLE = code('../../shared/ui/DataTable.tsx');

  it('takes one column or several, so no other module had to change', () => {
    expect(TABLE).toContain('sort?: SortState | readonly SortState[];');
    expect(TABLE, 'normalized once, read once').toContain(
      'const sorts: readonly SortState[] = sort === undefined ? [] : Array.isArray(sort) ? sort : [sort];',
    );
  });

  it('leaves what a CLICK means to the caller — the table reports, it does not decide', () => {
    // Fleet's click adds a column; another module's replaces one. Both call the same callback.
    expect(TABLE).toContain('onSortChange?: (key: string) => void;');
    expect(TABLE, 'no sorting rule lives in the table').not.toContain('toggleSort');
  });
});
