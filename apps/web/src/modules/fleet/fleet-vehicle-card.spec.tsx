// «عاوز لما اماوس يقف على كود عربيه يجيب بيانات زى اما اقف على اسم السواق نفس الموضوع كدا» —
// fields «تمام وزود اخر عداد».
//
// What a typecheck cannot see:
//   • the trigger hangs on a code only when there is a car to show, only for a reader who may see
//     the registry, and asks for NOTHING before a card first opens;
//   • the card says its facts from the shared lists — the car's own branch named even when that
//     branch is closed — and says a missing one as missing: no drivers line for a reader who may
//     not read the roster, no reading line for one who may not read the alarms; the reading comes
//     from every car's last reading (any status), so a car out of service is not shown a false «—»;
//   • the card's mechanics are the driver card's own (one shared layer, one card open at a time),
//     placed by the page's direction, not by a `dir="ltr"` code's.
//
// The suite runs in node with no DOM, so nothing hovers: the trigger is read from static markup,
// and the body is rendered on its own over seeded caches.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cairoYmd,
  type FleetCatalogItemDto,
  type FleetPersonDto,
  type FleetRosterDayDto,
  type FleetVehicleDto,
  type FleetVehicleLatestReadingDto,
  type FleetVehicleTypeDto,
  type Locale,
  type MeDto,
  type OrgUnitOptionDto,
  type Paginated,
} from '@ecms/contracts';
import type { ReactNode } from 'react';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import {
  VehicleCardBody,
  VehicleHoverCode,
  useVehicleHoverCard,
} from './components/VehicleHoverCard';
import * as Layer from './components/HoverCardLayer';
import * as Driver from './components/DriverHoverCard';
import { LicenceTag } from './components/VehicleStatusBadge';

const HERE = dirname(fileURLToPath(import.meta.url));
const TODAY = cairoYmd(new Date());

const V120 = '64b1f0cccccccccccccccc20';
const V214 = '64b1f0cccccccccccccccc14';
const D1 = '64b1f0dddddddddddddddd01';
const D2 = '64b1f0dddddddddddddddd02';
const CAIRO_CLOSED = '64b1f0bbbbbbbbbbbbbbbb01';

const car = (over: Partial<FleetVehicleDto> & { id: string; code: string }): FleetVehicleDto =>
  ({
    typeId: 't1',
    plateNumber: 'ن ق ص 4821',
    chassisNumber: 'CH',
    motorNumber: 'MO',
    joinedAt: '2020-01-01T00:00:00.000Z',
    licenseExpiresAt: '2099-03-15T00:00:00.000Z',
    licenseClassId: null,
    operationId: 'op1',
    insuranceCompanyId: null,
    branchId: CAIRO_CLOSED,
    departmentId: null,
    radio: { issi: null, motorolaSn: null },
    status: 'active',
    statusReason: null,
    licenseImage: null,
    inWorkshop: false,
    version: 0,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...over,
  }) as FleetVehicleDto;

const CARS = [
  car({ id: V120, code: '120' }),
  car({ id: V214, code: 'MG 5', inWorkshop: true, licenseExpiresAt: '2001-01-01T00:00:00.000Z' }),
];

const page = <T,>(items: T[]): Paginated<T> =>
  ({
    items,
    meta: { page: 1, pageSize: items.length, totalItems: items.length, totalPages: 1 },
  }) as Paginated<T>;

const person = (employeeId: string, fullNameAr: string): FleetPersonDto => ({
  employeeId,
  code: employeeId.slice(-4),
  fullNameAr,
  status: 'active',
  branchId: null,
  address: null,
  governorate: null,
  phone: null,
  hiredAt: null,
});

const BOARD: FleetRosterDayDto = {
  date: TODAY,
  rows: [
    {
      vehicleId: V120,
      code: '120',
      plateNumber: 'ن ق ص 4821',
      typeId: 't1',
      inMaintenance: false,
      planned: true,
      missionTypeId: null,
      driver1EmployeeId: D1,
      driver2EmployeeId: D2,
      notes: null,
    },
  ],
  availableDrivers: [],
  unavailableDrivers: [],
};

const KEYS = {
  registry: ['fleet', 'vehicles', 'list', { whole: true, anyStatus: true }],
  types: ['fleet', 'vehicleTypes', 'list', { pageSize: 100 }],
  operations: ['fleet', 'catalogs', 'list', { kind: 'operation' }],
  branchNames: ['organization', 'branches', 'options', 'withInactive'],
  roster: ['fleet', 'roster', 'day', TODAY],
  people: ['fleet', 'people'],
  // Every car's last reading, any status — under the odometer subtree, not the alarms' key.
  readings: ['fleet', 'odometer', 'latestReadings'],
} as const;

type Seed = Partial<Record<keyof typeof KEYS, boolean>>;

const client = (seed: Seed = {}): QueryClient => {
  const on = (key: keyof typeof KEYS): boolean => seed[key] ?? true;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (on('registry')) qc.setQueryData(KEYS.registry, page(CARS));
  if (on('types')) {
    qc.setQueryData(
      KEYS.types,
      page([
        { id: 't1', name: { ar: 'مصفحة نقل أموال', en: 'Armoured van' } },
      ] as FleetVehicleTypeDto[]),
    );
  }
  if (on('operations')) {
    qc.setQueryData(
      KEYS.operations,
      page([
        { id: 'op1', name: { ar: 'نقل أموال', en: 'Cash transport' } },
      ] as FleetCatalogItemDto[]),
    );
  }
  if (on('branchNames')) {
    // An INACTIVE branch — only the with-inactive list names it.
    qc.setQueryData(KEYS.branchNames, [
      {
        id: CAIRO_CLOSED,
        code: 'CAI',
        name: { ar: 'القاهرة', en: 'Cairo' },
        parentId: null,
        catalogId: null,
      },
    ] satisfies OrgUnitOptionDto[]);
  }
  if (on('roster')) qc.setQueryData(KEYS.roster, BOARD);
  if (on('people')) {
    qc.setQueryData(KEYS.people, [
      person(D1, 'سامر عادل منصور'),
      person(D2, 'محمود سعيد عبد الحميد'),
    ]);
  }
  if (on('readings')) {
    qc.setQueryData(KEYS.readings, [
      { vehicleId: V120, latestReading: 154320, latestReadingAt: '2026-11-07' },
    ] satisfies FleetVehicleLatestReadingDto[]);
  }
  return qc;
};

const ALL = ['fleetVehicle.view', 'fleetRoster.view', 'fleetDriver.view', 'fleetMaintenance.view'];

const store = (permissions: string[], locale: Locale = 'ar') =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((k) => [k, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const render = (
  node: ReactNode,
  {
    permissions = ALL,
    qc = client(),
    locale = 'ar',
  }: { permissions?: string[]; qc?: QueryClient; locale?: Locale } = {},
): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions, locale)}>
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);
const MARK = 'data-vehicle-hover="true"';

/** The opening tag of the element whose text is `text`. */
const tagOf = (markup: string, text: string): string => {
  const at = markup.indexOf(`>${text}`);
  expect(at, `${text} is drawn`).toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf('<', at), at + 1);
};

describe('the trigger — only on a car there is a card for', () => {
  it('a row linked to the registry: the code is the trigger, reachable with Tab, no raw id', () => {
    const markup = render(<VehicleHoverCode vehicleId={V120} code="120" dir="ltr" />);
    expect(tagOf(markup, '120')).toContain(MARK);
    expect(tagOf(markup, '120')).toContain('tabindex="0"');
    expect(tagOf(markup, '120')).toContain('dir="ltr"');
    expect(markup, 'a mark, not the id').not.toContain(V120);
  });

  it('`focusable: false` — a chip that already takes clicks or drags — hover only, no tab stop', () => {
    const markup = render(<VehicleHoverCode vehicleId={V120} code="120" focusable={false} />);
    expect(markup).toContain(MARK);
    expect(markup).not.toContain('tabindex');
  });

  it('not on a row from the old books (`vehicleId: null`) — whatever its code says', () => {
    expect(render(<VehicleHoverCode vehicleId={null} code="120" />)).toBe('<span>120</span>');
  });

  it('not for a reader who may not see the registry', () => {
    const markup = render(<VehicleHoverCode vehicleId={V120} code="120" />, {
      permissions: ['fleetRoster.view'],
    });
    expect(markup).toBe('<span>120</span>');
  });

  it('a code-only chip by its code, spelled as the registry means it', () => {
    expect(render(<VehicleHoverCode code="mg  5">mg 5</VehicleHoverCode>)).toContain(MARK);
    expect(render(<VehicleHoverCode code=" " />)).not.toContain(MARK);
  });

  it('once the registry is in hand, a car it does not carry has nothing to open', () => {
    expect(render(<VehicleHoverCode code="404" />)).not.toContain(MARK);
    expect(
      render(<VehicleHoverCode vehicleId="64b1f0cccccccccccccccc99" code="99" />),
    ).not.toContain(MARK);
    // Before the registry is in hand nothing is known against it — the code keeps its trigger,
    // and the card's first opening fetches the registry (an unknown car then opens nothing).
    const cold = client({ registry: false });
    expect(render(<VehicleHoverCode code="404" />, { qc: cold })).toContain(MARK);
  });

  it('asks for nothing before a card first opens — not even the registry', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <>
        <VehicleHoverCode vehicleId={V120} code="120" />
        <VehicleHoverCode code="MG 5" />
      </>,
      { qc },
    );
    const queries = qc.getQueryCache().getAll();
    // The registry is WATCHED (to drop a trigger once it is known) and never fetched from here.
    expect(queries.map((q) => q.queryKey)).toEqual([KEYS.registry]);
    expect(queries[0]?.state.fetchStatus).toBe('idle');
    expect(queries[0]?.state.data).toBeUndefined();
  });

  it('the hook gives a board’s own element the same props', () => {
    const Cell = (): JSX.Element => {
      const { triggerProps, card } = useVehicleHoverCard({ vehicleId: V120 });
      return (
        <>
          <b {...triggerProps}>120</b>
          {card}
        </>
      );
    };
    expect(tagOf(render(<Cell />), '120')).toContain(MARK);
  });
});

describe('the card says its facts', () => {
  const body = (opts: Parameters<typeof render>[1] = {}, vehicle = CARS[0]!) =>
    render(<VehicleCardBody vehicle={vehicle} />, opts);

  it('code, make and state; plate, the car’s branch, operation, today’s drivers, licence, last reading', () => {
    const markup = body();
    expect(tagOf(markup, '120'), 'the code reads left to right').toContain('dir="ltr"');
    expect(markup).toContain('مصفحة نقل أموال');
    expect(markup).toContain(t('fleet.vehicles.status.active'));
    expect(markup).toContain(t('fleet.vehicles.columns.plate'));
    expect(markup).toContain('ن ق ص 4821');
    expect(markup).toContain(t('fleet.vehicles.columns.branch'));
    expect(markup, 'an inactive branch is still named').toContain('القاهرة');
    expect(markup).toContain(t('fleet.maintenance.fields.operation'));
    expect(markup).toContain('نقل أموال');
    expect(markup).toContain(t('fleet.vehicles.card.driversToday'));
    expect(markup).toContain('سامر عادل منصور');
    expect(markup).toContain('محمود سعيد عبد الحميد');
    expect(markup).toContain('data-vehicle-card-drivers="2"');
    expect(markup).toContain(t('fleet.vehicles.columns.license'));
    expect(markup).toContain('2099/03/15');
    expect(markup).toContain(t('fleet.fuelCards.expiry.valid'));
    expect(markup).toContain(t('fleet.vehicle.lastReading'));
    // «154,320 كم · 2026/11/07» — Latin digits, grouped, on one line.
    expect(markup).toContain('>154,320</span> كم');
    expect(markup).toContain('2026/11/07');
    expect(tagOf(markup, '154,320')).toContain('dir="ltr"');
  });

  it('a car in the workshop says so in place of its status; a run-out licence in red', () => {
    const markup = body({}, CARS[1]!);
    expect(markup).toContain('data-vehicle-card-state="inWorkshop"');
    expect(markup).toContain(t('fleet.vehicles.inWorkshop'));
    expect(markup).not.toContain(t('fleet.vehicles.status.active'));
    expect(tagOf(markup, '2001/01/01')).toContain('text-red-600');
    expect(markup).toContain(t('fleet.fuelCards.expiry.expired'));
  });

  it('nobody on today’s board, and no reading on file: dashes', () => {
    const markup = body({}, CARS[1]!);
    expect(markup).toContain(t('fleet.vehicles.card.driversToday'));
    expect(markup).not.toContain('data-vehicle-card-drivers');
    expect(markup).not.toContain('data-vehicle-card-reading');
    expect(markup.match(/>—</gu)).toHaveLength(2);
  });

  it('no drivers line at all for a reader who may not read the roster — or name its drivers', () => {
    for (const missing of ['fleetRoster.view', 'fleetDriver.view']) {
      const markup = body({ permissions: ALL.filter((p) => p !== missing) });
      expect(markup, missing).not.toContain(t('fleet.vehicles.card.driversToday'));
      expect(markup, missing).not.toContain('سامر عادل منصور');
      expect(markup, `${missing}: the rest stay`).toContain('القاهرة');
    }
  });

  it('no reading line at all for a reader who may not read the alarms — through either door', () => {
    const none = body({
      permissions: ['fleetVehicle.view', 'fleetRoster.view', 'fleetDriver.view'],
    });
    expect(none).not.toContain(t('fleet.vehicle.lastReading'));
    expect(none).not.toContain('154,320');
    const viaOdometer = body({
      permissions: ['fleetVehicle.view', 'fleetOdometer.view'],
    });
    expect(viaOdometer).toContain('154,320');
  });

  it('an out-of-service or disposed car’s reading is shown — the alarms’ active-only list is not the source', () => {
    for (const status of ['outOfService', 'disposed'] as const) {
      const markup = body({}, { ...CARS[0]!, status });
      expect(markup, status).toContain('>154,320</span> كم');
      expect(markup, status).toContain('2026/11/07');
    }
    // An alarms list that leaves the car out changes nothing: the card never reads it.
    const qc = client();
    qc.setQueryData(['fleet', 'alarms'], []);
    expect(body({ qc }, { ...CARS[0]!, status: 'outOfService' })).toContain('154,320');
    const SOURCE = readFileSync(join(HERE, 'components/VehicleHoverCard.tsx'), 'utf8');
    expect(SOURCE).toContain('useLatestReadings()');
    expect(SOURCE).not.toMatch(/useMaintenanceAlarms\(/u);
  });

  it('a list still on its way as «…», never a guess', () => {
    const markup = body({
      qc: client({ types: false, branchNames: false, roster: false, readings: false }),
    });
    // The make, the branch, today's drivers and the reading.
    expect(markup.match(/>…</gu)).toHaveLength(4);
  });

  it('in the card’s own words, in both languages', () => {
    expect(translate('ar', 'fleet.vehicles.card.driversToday')).toBe('السائقون اليوم');
    expect(translate('en', 'fleet.vehicles.card.driversToday')).toBe('Drivers today');
    const english = body({ locale: 'en' });
    expect(english).toContain('Armoured van');
    expect(english).toContain('Drivers today');
  });

  it('the licence’s tag is the vehicles board’s own', () => {
    expect(render(<LicenceTag state="soon" />)).toContain(t('fleet.fuelCards.expiry.soon'));
    expect(render(<LicenceTag state="unknown" />)).toBe('');
    const board = readFileSync(join(HERE, 'pages/VehiclesListPage.tsx'), 'utf8');
    expect(board).toMatch(
      /import \{[^}]*\bLicenceTag\b[^}]*\} from '\.\.\/components\/VehicleStatusBadge'/u,
    );
    expect(board).not.toMatch(/const LicenceTag =/u);
  });
});

describe('one layer for both cards', () => {
  const source = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

  it('the driver card keeps every export, its placing helpers the shared ones', () => {
    expect(Driver.nameInSight).toBe(Layer.nameInSight);
    expect(Driver.clippingBoxes).toBe(Layer.clippingBoxes);
    for (const name of ['useDriverHoverCard', 'DriverHoverText', 'DriverCardBody'] as const) {
      expect(typeof Driver[name], name).toBe('function');
    }
  });

  it('both open through the one control — so one card is open at a time, across both kinds', () => {
    expect(source('components/DriverHoverCard.tsx')).toMatch(/useHoverCard\(/u);
    expect(source('components/VehicleHoverCard.tsx')).toMatch(/useHoverCard\(/u);
    const layer = source('components/HoverCardLayer.tsx');
    expect(layer.match(/^let closeOpenCard\b/gmu)).toHaveLength(1);
    for (const file of ['components/DriverHoverCard.tsx', 'components/VehicleHoverCard.tsx']) {
      expect(source(file), file).not.toMatch(/closeOpenCard|createPortal|setTimeout/u);
    }
  });

  it('placed by the page’s direction — the card’s own — never by a `dir="ltr"` code’s', () => {
    const layer = source('components/HoverCardLayer.tsx');
    expect(layer).toContain("getComputedStyle(box).direction === 'rtl'");
    expect(layer).not.toContain('getComputedStyle(target).direction');
  });

  it('the same frame for both, in both themes', () => {
    expect(Layer.HOVER_CARD_FRAME).toContain('dark:bg-[#131d35]');
    expect(Layer.HOVER_CARD_FRAME).toContain('w-72');
    expect(source('components/HoverCardLayer.tsx')).toContain(
      "className={cn('pointer-events-none fixed z-[110] animate-menu-in', HOVER_CARD_FRAME)}",
    );
  });
});

describe('never inside a picker, a filter or a form dialog', () => {
  it('no picker, filter or form dialog of Fleet’s draws the car card', () => {
    const dir = join(HERE, 'components');
    const offenders = readdirSync(dir)
      .filter((name) => /(?:Picker|Filter|Combobox|Select|FormDialog)\w*\.tsx$/u.test(name))
      .filter((name) =>
        /VehicleHoverCode|useVehicleHoverCard/u.test(readFileSync(join(dir, name), 'utf8')),
      );
    expect(offenders).toEqual([]);
  });
});
