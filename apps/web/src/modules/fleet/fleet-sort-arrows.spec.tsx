// «عاوز هنا يكون فيه سهم عشان ارتب العربيات على حسب النوع تصاعدى وتنازلى وعاوزها فى [نُه شاشة]».
//
// The arrows themselves are `DataTable`'s and were proved when the tables learned to hold two
// columns at once (`fleet-table-sort.spec.tsx`). What is proved HERE is the part that is specific
// to each screen and easy to get subtly wrong:
//
//   • WHICH columns carry one — the owner named them, and a missing arrow is silent.
//   • WHAT the arrow asks for, where the column's name and the server's are different words:
//     «النوع» renders a name and is ordered by `typeName`, «كود السيارة» by `vehicleCode`.
//   • WHERE the ordering happens — the paged registers ask the server, and the three whole boards
//     order what they already hold. Getting that backwards is the defect, not a detail: a page
//     sorted in the browser is twenty-five rows pretending to be the register.
import { readFileSync } from 'node:fs';
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

const t = (key: string): string => translate('ar', key);

/**
 * The column, as its source declares it — from `key:` up to the next column's `key:`.
 *
 * Source rather than markup because a column's SORT KEY never reaches the DOM unless the reader
 * has already clicked it, and the question here is what a first click would ask for.
 */
const column = (source: string, key: string): string => {
  const at = source.indexOf(`key: '${key}',`);
  if (at === -1) throw new Error(`no column ${key}`);
  const next = source.indexOf("key: '", at + 10);
  return source.slice(at, next === -1 ? source.length : next);
};

/** Every column the named screen offers an arrow on. */
const arrowed = (path: string, keys: readonly string[]): void => {
  const source = code(path);
  for (const key of keys) {
    expect(column(source, key), `${path} · ${key}`).toContain('sortable: true');
  }
};

describe('the registry orders by the MAKE — the column the request named', () => {
  const PAGE = code('pages/VehiclesListPage.tsx');

  it('offers the arrow on «النوع»', () => {
    expect(column(PAGE, 'type')).toContain('sortable: true');
  });

  it('asks the server for `typeName`, not for the id the row stores', () => {
    // The row carries a `typeId` — a random ObjectId — so ordering by it would answer in an order
    // nobody can predict. The name lives on the vehicle type and the server joins it in.
    expect(column(PAGE, 'type')).toContain("sortKey: 'typeName'");
  });
});

describe('the drivers registry orders by the five columns the owner named', () => {
  it('offers an arrow on each of them', () => {
    // اسم السائق · كود الموظف · المحافظة · رقم الموبايل · تاريخ التعيين — every one an HR fact,
    // which is why the roster had to start carrying them (see `driver-roster.ts`).
    arrowed('pages/DriversListPage.tsx', [
      'driver',
      'employeeCode',
      'governorate',
      'phone',
      'hiredAt',
    ]);
  });
});

describe('the registers that REFERENCE a car order by its code', () => {
  it('asks for `vehicleCode` on each of them', () => {
    for (const path of [
      'pages/OdometerPage.tsx',
      'pages/MaintenancePage.tsx',
      'pages/AccidentsPage.tsx',
      'components/DriverViolationsPanel.tsx',
    ]) {
      const cell = column(code(path), 'vehicle');
      expect(cell, `${path} offers the arrow`).toContain('sortable: true');
      expect(cell, `${path} asks for the joined code`).toContain("sortKey: 'vehicleCode'");
    }
  });

  it('orders the maintenance register by the reading at service too', () => {
    arrowed('pages/MaintenancePage.tsx', ['odometerAtService']);
  });

  it('orders the accident file by all four money columns', () => {
    // The first three are stored; «إجمالي المتبقي» is the subtraction of them, computed in the
    // query because it is never stored — see `REMAINING_SORT`.
    arrowed('pages/AccidentsPage.tsx', [
      'amountCollected',
      'companyCost',
      'paidAmount',
      'remaining',
    ]);
  });

  it('orders the drivers’ fines by date as well as by car', () => {
    arrowed('components/DriverViolationsPanel.tsx', ['date']);
  });
});

describe('the three WHOLE boards order what they already hold', () => {
  it('offers the alarms board an arrow on each of its five columns', () => {
    arrowed('pages/MaintenanceAlarmsPage.tsx', [
      'code',
      'level',
      'sinceServiceKm',
      'remainingKm',
      'lastServiceAt',
    ]);
  });

  it('ranks «المستوى» by TRIAGE rather than by the word', () => {
    // Red is more urgent than yellow whatever the two words do in an alphabet, and the reader
    // clicking this column is triaging, not reading a dictionary.
    const source = code('pages/MaintenanceAlarmsPage.tsx');
    expect(source).toContain("if (key === 'level') return LEVEL_ORDER[alarm.level];");
    expect(source).toContain('const LEVEL_ORDER = { red: 0, yellow: 1, none: 2 }');
  });

  it('offers both rosters the code and the state', () => {
    for (const path of ['pages/RosterPage.tsx', 'pages/FixedRosterPage.tsx']) {
      const cell = column(code(path), 'vehicle');
      expect(cell, `${path} offers the arrow`).toContain('sortable: true');
      expect(cell, `${path} orders by the code`).toContain("sortKey: 'code'");
      expect(column(code(path), 'state'), `${path} · الحالة`).toContain('sortable: true');
    }
  });

  it('ranks «الحالة» by what the badges SAY — workshop, then crewed, then untouched', () => {
    for (const path of ['pages/RosterPage.tsx', 'pages/FixedRosterPage.tsx']) {
      expect(code(path), path).toContain(
        "if (key === 'state') return row.inMaintenance ? 0 : hasDriver(row) ? 1 : 2;",
      );
    }
  });

  it('keeps each board’s own default order for a reader who has clicked nothing', () => {
    // The alarms board opened on «reddest first, then nearest due» before it had arrows, and it
    // still does: the level is the default order and the remaining distance is the tiebreak.
    const alarms = code('pages/MaintenanceAlarmsPage.tsx');
    expect(alarms).toContain("readSorts(sortParam, 'level:asc')");
    expect(alarms).toContain('(a.remainingKm ?? Number.POSITIVE_INFINITY)');
    for (const path of ['pages/RosterPage.tsx', 'pages/FixedRosterPage.tsx']) {
      expect(code(path), path).toContain("readSorts(sortParam, 'code:asc')");
    }
  });
});

// ── what the screen actually sends ─────────────────────────────────────────

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

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: { id: 'u1', permissions: { 'fleetVehicle.view': 'organization' } } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

describe('a click on «النوع» reaches the server', () => {
  it('asks for the order the address bar carries, joined column and all', () => {
    // The seeded key IS the assertion: the page is rendered at the address a click on «النوع»
    // leads to, and the cache holds an answer only under `typeName:asc`. A page that asked for
    // `type:asc` — the column's own key — would paint the skeleton instead of these rows.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(
      listKey(
        'fleet',
        'vehicles',
        vehicleParams({ sortBy: 'typeName', sortDir: 'asc', sort: 'typeName:asc' }),
      ),
      paged([vehicle()]),
    );
    qc.setQueryData(listKey('fleet', 'vehicleTypes', { pageSize: 100 }), paged([]));
    qc.setQueryData(
      listKey('fleet', 'catalogs', { kind: 'licenseClass', violationSide: undefined }),
      paged([]),
    );
    qc.setQueryData(
      listKey('fleet', 'catalogs', { kind: 'operation', violationSide: undefined }),
      paged([]),
    );
    qc.setQueryData(
      listKey('fleet', 'catalogs', { kind: 'insuranceCompany', violationSide: undefined }),
      paged([]),
    );
    qc.setQueryData(['hr', 'branches', 'active'], paged([]));
    const markup = renderToStaticMarkup(
      <Provider store={store()}>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/fleet/vehicles?sort=typeName:asc']}>
            <VehiclesListPage />
          </MemoryRouter>
        </QueryClientProvider>
      </Provider>,
    );
    expect(markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tbody>'))).toContain('150');
    // And the header says which column decides — the arrow is drawn on «النوع», nowhere else.
    const head = markup.slice(markup.indexOf('<thead'), markup.indexOf('</thead>'));
    const at = head.indexOf(t('fleet.vehicles.columns.type'));
    expect(head.slice(head.lastIndexOf('<th', at), head.indexOf('</th>', at))).toContain(
      'rotate-180',
    );
  });
});
