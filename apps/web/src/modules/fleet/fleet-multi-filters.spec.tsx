// «اى فلتر ف الحركه زياده عن اتنين اختار ما بينهم اعملى multi selection» — and the print button
// that shares the licence column with the scan it prints.
//
// TWO REQUESTS, one screen, and the registry is where both are easiest to prove: it carries five
// of the converted filters and the licence cell the print button was asked for.
//
// What a multi-select can be asked in a suite with no DOM: its LIST is behind a click, but its
// TRIGGER is rendered, and a trigger that names «ملاكي» can only do so from options that carried
// it. The stronger proof is the REQUEST — the page is rendered at an address with two values
// ticked, and the cache is seeded under the key that carries both; a page that sent one of them,
// or sent them as one string, would paint a skeleton and every row assertion below would fail.
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
  ListFleetVehiclesQuerySchema,
  FleetViolationRollupQuerySchema,
  type FleetVehicleDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { VehiclesListPage } from './pages/VehiclesListPage';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Source with comments stripped: a call named only in prose must not keep a guard green. */
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

const SCANNED = vehicle({
  id: 'v2',
  code: '151',
  licenseImage: {
    fileId: 'f1',
    fileName: 'licence.jpg',
    mime: 'image/jpeg',
    size: 1024,
    uploadedAt: '2026-02-01T00:00:00.000Z',
  },
});

/** Exactly the parameters the registry sends — its list key. */
const vehicleParams = (over: Record<string, unknown> = {}) => ({
  page: 1,
  pageSize: 25,
  sortBy: 'code',
  sortDir: 'asc',
  sort: 'code:asc',
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
  ...over,
});

const TYPES = [
  { id: 'ty1', name: { ar: 'ملاكي', en: 'Saloon' } },
  { id: 'ty2', name: { ar: 'نقل', en: 'Truck' } },
].map((t_) => ({
  ...t_,
  maintenanceIntervalKm: null,
  isActive: true,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}));

const CLASSES = [
  { id: 'lc1', ar: 'أولى' },
  { id: 'lc2', ar: 'تانية' },
].map((item) => ({
  id: item.id,
  kind: 'licenseClass' as const,
  name: { ar: item.ar, en: item.id },
  countsForAlarm: false,
  violationSide: null,
  isActive: true,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}));

const client = (params: Record<string, unknown>, rows: FleetVehicleDto[]): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(listKey('fleet', 'vehicles', vehicleParams(params)), paged(rows));
  qc.setQueryData(listKey('fleet', 'vehicleTypes', { pageSize: 100 }), paged(TYPES));
  qc.setQueryData(listKey('fleet', 'catalogs', { kind: 'licenseClass', violationSide: undefined }), paged(CLASSES));
  qc.setQueryData(listKey('fleet', 'catalogs', { kind: 'operation', violationSide: undefined }), paged([]));
  qc.setQueryData(
    listKey('fleet', 'catalogs', { kind: 'insuranceCompany', violationSide: undefined }),
    paged([]),
  );
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
          permissions: { 'fleetVehicle.view': 'organization', 'fleetVehicle.edit': 'organization' },
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

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

describe('a registry filter takes SEVERAL answers', () => {
  it('asks the server for BOTH makes, not for the first of them', () => {
    // The seeded key IS the assertion: two ids in one `typeId` list. A page that sent one, or
    // that sent «ty1,ty2» as a single string, asks a key nothing was seeded under and paints the
    // skeleton — so an empty tbody here is the old behaviour failing, not a flaky render.
    const qc = client({ typeId: ['ty1', 'ty2'] }, [vehicle(), SCANNED]);
    expect(tbody(at('/fleet/vehicles?type=ty1,ty2', qc))).toContain('150');
    expect(tbody(at('/fleet/vehicles?type=ty1,ty2', qc))).toContain('151');
  });

  it('narrows to the ONE make a saved link names, exactly as it always did', () => {
    const qc = client({ typeId: ['ty1'] }, [vehicle()]);
    expect(tbody(at('/fleet/vehicles?type=ty1', qc))).toContain('150');
  });

  it('carries the statuses as a list too — three answers is more than two', () => {
    const qc = client({ status: ['active', 'outOfService'] }, [vehicle()]);
    expect(tbody(at('/fleet/vehicles?status=active,outOfService', qc))).toContain('150');
  });

  it('sends every reference filter the same way, in one request', () => {
    const qc = client(
      {
        typeId: ['ty1'],
        licenseClassId: ['lc1', 'lc2'],
        operationId: ['op1'],
        insuranceCompanyId: ['in1'],
        status: ['active'],
      },
      [vehicle()],
    );
    const markup = at(
      '/fleet/vehicles?type=ty1&licenseClass=lc1,lc2&operation=op1&insurance=in1&status=active',
      qc,
    );
    expect(tbody(markup)).toContain('150');
  });

  it('NAMES what is ticked on the trigger, from the catalog rather than from the URL', () => {
    // A control handed the wrong list — or no list — prints the raw id instead of the word.
    const markup = at('/fleet/vehicles?type=ty1,ty2', client({ typeId: ['ty1', 'ty2'] }, [vehicle()]));
    const bar = markup.slice(0, markup.indexOf('<table'));
    expect(bar, 'the makes are named').toContain('ملاكي');
    expect(bar, 'and so is the second').toContain('نقل');
    expect(bar, 'never the id').not.toMatch(/>\s*ty1\s*</);
  });

  it('shows the whole registry when nothing is ticked — an empty filter is not «match nothing»', () => {
    expect(tbody(at('/fleet/vehicles', client({}, [vehicle()])))).toContain('150');
  });
});

describe('the backend accepts what the bar sends', () => {
  it('reads one value and several the same way — a list either way', () => {
    const one = ListFleetVehiclesQuerySchema.parse({ typeId: '64b1f0dddddddddddddddd01' });
    expect(one.typeId).toEqual(['64b1f0dddddddddddddddd01']);
    const two = ListFleetVehiclesQuerySchema.parse({
      typeId: '64b1f0dddddddddddddddd01,64b1f0dddddddddddddddd02',
      status: 'active,outOfService',
      licenseClassId: '64b1f0dddddddddddddddd03',
    });
    expect(two.typeId).toHaveLength(2);
    expect(two.status).toEqual(['active', 'outOfService']);
    expect(two.licenseClassId).toEqual(['64b1f0dddddddddddddddd03']);
  });

  it('treats an empty parameter as NO filter rather than as an empty `$in`', () => {
    // The difference matters: an empty `$in` matches no car at all, so «nothing ticked» has to
    // arrive as an absent parameter — which is what the contract's `listQuery` guarantees.
    expect(ListFleetVehiclesQuerySchema.parse({ typeId: '' }).typeId).toBeUndefined();
    expect(ListFleetVehiclesQuerySchema.parse({ status: '' }).status).toBeUndefined();
  });

  it('still refuses a status no car can be in', () => {
    expect(() => ListFleetVehiclesQuerySchema.parse({ status: 'active,levitating' })).toThrow();
  });

  it('takes several YEARS on the violations rollup, and one as one', () => {
    expect(FleetViolationRollupQuerySchema.parse({ year: '2025,2026' }).year).toEqual([2025, 2026]);
    expect(FleetViolationRollupQuerySchema.parse({ year: '2026' }).year).toEqual([2026]);
    expect(FleetViolationRollupQuerySchema.parse({}).year).toBeUndefined();
  });
});

describe('printing a licence from the column the licence is in', () => {
  const scanned = (): string =>
    at('/fleet/vehicles', client({}, [SCANNED]));

  it('offers a print button beside the eye, on the car that HAS a scan', () => {
    const markup = scanned();
    const at_ = markup.indexOf(`data-vehicle-license-print="${SCANNED.id}"`);
    expect(at_, 'the button is rendered').toBeGreaterThan(-1);
    const tag = markup.slice(markup.lastIndexOf('<', at_), markup.indexOf('className=', at_));
    expect(tag, 'a real button').toContain('<button');
    expect(markup.slice(at_, at_ + 400), 'named as printing').toContain(
      `title="${t('fleet.vehicles.print.action')}"`,
    );
  });

  it('offers nothing to print where there is no scan — that cell is an upload', () => {
    const markup = at('/fleet/vehicles', client({}, [vehicle()]));
    expect(markup).not.toContain('data-vehicle-license-print="v1"');
  });

  it('is the PAGE’s print, not a second copy of it', () => {
    // The cell takes a callback and prints nothing itself. A cell that built its own sheet would
    // drift from the page's the first time a row was added to either.
    const cell = code('components/VehicleLicenseImage.tsx');
    expect(cell, 'the cell prints nothing itself').not.toContain('printLicenceRecord');
    expect(cell).toContain('onPrint?: (vehicle: FleetVehicleDto) => void;');
    expect(code('pages/VehiclesListPage.tsx')).toContain(
      'onPrint={(vehicle) => void licenceCard(vehicle)}',
    );
  });

  it('prints the SCAN’s own sheet, not the car’s whole file', () => {
    // «لو هدوس على زرار طباعه الرخصه يبقى الصوره و الكود العربيه والنوع والفرع لكن لو هطبع من زرار
    // الاجراءت يبقى كل تفاصيل العربيه». Two questions, two documents: the sheet that leaves with a
    // licence names the car just well enough to say whose licence it is.
    const page = code('pages/VehiclesListPage.tsx');
    const card = page.slice(
      page.indexOf('const licenceCard = async'),
      page.indexOf('const print = async'),
    );
    expect(card, 'the card is its own function').not.toBe('');
    for (const column of ['code', 'type', 'branch']) {
      expect(card, `names the ${column}`).toContain(`t('fleet.vehicles.columns.${column}')`);
    }
    // …and NOTHING else. These are the record's, and a licence sheet carrying them is the record.
    for (const column of ['plate', 'chassis', 'motor', 'joinedAt', 'license', 'insurance']) {
      expect(card, `leaves the ${column} to the record`).not.toContain(
        `t('fleet.vehicles.columns.${column}')`,
      );
    }
    expect(card, 'and it carries the scan').toContain('fetchVehicleLicenseImage(vehicle.id)');
  });

  it('keeps the ACTIONS column printing the whole record', () => {
    const page = code('pages/VehiclesListPage.tsx');
    const record = page.slice(page.indexOf('const print = async'), page.indexOf('const columns'));
    for (const column of ['type', 'code', 'plate', 'chassis', 'motor', 'branch', 'status']) {
      expect(record, `the record still names the ${column}`).toContain(
        `t('fleet.vehicles.columns.${column}')`,
      );
    }
    expect(page, 'and the actions button calls it').toContain('onClick={() => void print(v)}');
  });
});
