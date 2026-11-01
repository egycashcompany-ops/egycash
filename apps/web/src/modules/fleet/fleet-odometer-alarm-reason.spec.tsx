// «اعدّل شاشة العدادات بحيث بدل «—» يظهر السبب في سطر آخر قراءة لكل عربية» — the odometer
// register says WHY a car has no «فارق عداد الصيانة», once per car, and what the projection
// measured from. Proven on the real page and the real card, rendered to markup (no DOM here: the
// card's opening rules are `lib/alarm-reason-card.spec.ts`'s, under fake timers).
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
  type FleetAlarmBaselineDto,
  type FleetMaintenanceAlarmDto,
  type FleetOdometerLogDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { OdometerPage } from './pages/OdometerPage';
import { AlarmReasonCard, NotActiveReasonCard } from './components/AlarmReasonCell';
import { currentMonthRange } from './lib/odometer-range';

// The record dialog portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');
const t = (key: string, params?: Record<string, string>): string => translate('ar', key, params);
const MONTH = currentMonthRange(new Date());
const day = (ymd: string): string => `${ymd}T00:00:00.000Z`;

const CAR = 'v295';
const OTHER = 'v274';

const log = (
  id: string,
  ymd: string,
  o: Partial<FleetOdometerLogDto> = {},
): FleetOdometerLogDto => ({
  id,
  vehicleId: CAR,
  vehicleCode: '295',
  date: day(ymd),
  outReading: 25_581,
  inReading: 25_631,
  km: 50,
  serviceGapKm: null,
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  driver1Name: null,
  driver2Name: null,
  notes: null,
  version: 0,
  createdAt: `${ymd}T08:00:00.000Z`,
  updatedAt: `${ymd}T08:00:00.000Z`,
  ...o,
});

const baseline = (o: Partial<FleetAlarmBaselineDto> = {}): FleetAlarmBaselineDto => ({
  visitId: 'visit-295',
  inDate: day('2026-10-06'),
  outDate: day('2026-10-06'),
  entryCounter: 22_790,
  exitCounter: null,
  source: 'entry',
  counter: 22_790,
  counterDate: day('2026-10-06'),
  judgedAgainst: { reading: 22_830, date: day('2026-10-06') },
  exitSetAside: null,
  workType: null,
  ...o,
});

/** Car 295 as the owner saw it: refused, its entry counter judged against a same-day reading. */
const alarm = (o: Partial<FleetMaintenanceAlarmDto> = {}): FleetMaintenanceAlarmDto => ({
  vehicleId: CAR,
  code: '295',
  level: 'none',
  remainingKm: null,
  sinceServiceKm: null,
  lastServiceAt: day('2026-10-06'),
  lastServiceVisitId: 'visit-295',
  noAlarmReason: 'baselineBelowChain',
  daysWithoutReading: 0,
  latestReading: 25_631,
  latestReadingAt: day('2026-10-26'),
  latestReadingLogId: 'r26',
  baseline: baseline(),
  newerUncountedVisit: null,
  rule: { vehicleType: null, intervalKm: 0, yellowKm: 1000, redKm: 300 },
  newestReading: null,
  ...o,
});

const ALL = [
  'fleetOdometer.view',
  'fleetOdometer.record',
  'fleetMaintenance.view',
  'fleetVehicle.view',
  'fleetCatalog.manage',
  'fleetMaintenanceRule.manage',
];

const REGISTRY = [
  { id: CAR, code: '295', status: 'active', statusReason: null },
  { id: OTHER, code: '274', status: 'outOfService', statusReason: 'حادث تصادم — في ورشة التوكيل' },
];

const client = (
  logs: FleetOdometerLogDto[],
  alarms: FleetMaintenanceAlarmDto[] | null,
  registry: unknown[] = REGISTRY,
): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(
    listKey('fleet', 'odometer', {
      page: 1,
      pageSize: 25,
      sortBy: 'date',
      sortDir: 'desc',
      sort: 'date:desc',
      vehicleCodes: undefined,
      from: MONTH.from,
      to: MONTH.to,
      alerts: undefined,
      driverEmployeeIds: undefined,
    }),
    { items: logs, meta: { page: 1, pageSize: 25, totalItems: logs.length, totalPages: 1 } },
  );
  qc.setQueryData(listKey('fleet', 'vehicles', { whole: true, anyStatus: true }), {
    items: registry,
    meta: { page: 1, pageSize: 100, totalItems: registry.length, totalPages: 1 },
  });
  if (alarms !== null) qc.setQueryData(['fleet', 'alarms'], alarms);
  return qc;
};

const draw = (node: JSX.Element, qc: QueryClient, permissions: string[] = ALL): string => {
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
        <MemoryRouter initialEntries={['/fleet/odometer']}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const page = (qc: QueryClient, permissions?: string[]): string =>
  draw(<OdometerPage />, qc, permissions);

/** The table's rows, in order, as markup. */
const rows = (markup: string): string[] =>
  markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tbody>')).split('<tr').slice(1);

const THREE_DAYS = [log('r26', '2026-10-26'), log('r18', '2026-10-18'), log('r06', '2026-10-06')];

describe('which row says it', () => {
  it('the row of the car’s latest reading, once — its other readings keep the dash', () => {
    const [first, second, third] = rows(page(client(THREE_DAYS, [alarm()])));
    expect(first).toContain('data-odo-reason="baselineBelowChain"');
    expect(first).toContain(
      `>${t('fleet.alarms.noAlarmReason.baselineBelowChain').split(' — ')[0]}<`,
    );
    for (const other of [second, third]) {
      expect(other).not.toContain('data-odo-reason');
      expect(other).toContain('>—<');
    }
  });

  it('the row the SERVER names, even when a later day sits above it', () => {
    const logs = [
      log('r27', '2026-10-27', { outReading: null, inReading: null, km: null }),
      ...THREE_DAYS,
    ];
    const said = rows(page(client(logs, [alarm()]))).map((row) => row.includes('data-odo-reason='));
    expect(said).toEqual([false, true, false, false]);
  });

  it('no row at all when the page does not hold that row — the reason never moves to an older one', () => {
    const markup = page(client(THREE_DAYS.slice(1), [alarm()]));
    expect(markup).not.toContain('data-odo-reason');
  });

  it('a car with no reading at all: its newest row on the page', () => {
    const noReading = alarm({
      noAlarmReason: 'noReading',
      latestReading: null,
      latestReadingAt: null,
      latestReadingLogId: null,
      baseline: null,
      lastServiceAt: null,
      lastServiceVisitId: null,
    });
    const said = rows(page(client(THREE_DAYS, [noReading]))).map((row) =>
      row.includes('data-odo-reason="noReading"'),
    );
    expect(said).toEqual([true, false, false]);
  });

  it('nothing while the projection is on its way, or failed', () => {
    expect(page(client(THREE_DAYS, null))).not.toContain('data-odo-reason');
  });

  it('a car whose figure was computed shows the figure, never a reason', () => {
    const measured = alarm({ noAlarmReason: null, sinceServiceKm: 2_841, remainingKm: 2_159 });
    const markup = page(client(THREE_DAYS, [measured]));
    expect(markup).not.toContain('data-odo-reason');
    expect(markup.split('>2,841<').length - 1).toBe(3);
  });

  it('the words are never hung on a `title` — the card says them', () => {
    const markup = page(client(THREE_DAYS, [alarm()]));
    for (const key of [
      'fleet.alarms.noAlarmReason.baselineBelowChain',
      'fleet.odometer.alarmReason.baselineBelowChain.why',
    ]) {
      expect(markup).not.toContain(`title="${t(key).split(' — ')[0]}`);
    }
  });
});

describe('«السيارة غير نشطة»', () => {
  const inactive = [log('n25', '2026-10-25', { vehicleId: OTHER, vehicleCode: '274' })];

  it('on the newest row of a car the projection leaves out, with the way to its profile', () => {
    const logs = [...inactive, log('n24', '2026-10-24', { vehicleId: OTHER, vehicleCode: '274' })];
    const [first, second] = rows(page(client(logs, [])));
    expect(first).toContain('data-odo-reason="notActive"');
    expect(first).toContain(`>${t('fleet.odometer.alarmReason.notActive.chip')}<`);
    expect(first).toContain(`href="/fleet/vehicles/${OTHER}"`);
    expect(second).not.toContain('data-odo-reason');
  });

  it('no profile link for a reader who may not read the registry, nor for a car gone from it', () => {
    const without = ALL.filter((p) => p !== 'fleetVehicle.view');
    expect(page(client(inactive, []), without)).not.toContain('data-odo-reason-fix');
    expect(page(client(inactive, [], [REGISTRY[0]]))).not.toContain('data-odo-reason-fix');
  });

  it('its card names the status and the reason the registry holds', () => {
    const card = draw(<NotActiveReasonCard vehicleId={OTHER} code="274" />, client([], []));
    const status = t('fleet.vehicles.status.outOfService');
    expect(card).toContain(t('fleet.odometer.alarmReason.notActive.why', { status }));
    expect(card).toContain(`>${status}<`);
    expect(card).toContain('حادث تصادم — في ورشة التوكيل');
    expect(card).toContain(t('fleet.odometer.alarmReason.card.footerInactive'));
  });

  it('a car gone from the registry reads as deleted; a reader without it gets the plain sentence', () => {
    const gone = draw(<NotActiveReasonCard vehicleId="v-gone" code="999" />, client([], []));
    expect(gone).toContain(t('fleet.odometer.alarmReason.notActive.whyDeleted'));
    const blind = draw(
      <NotActiveReasonCard vehicleId={OTHER} code="274" />,
      client([], []),
      ALL.filter((p) => p !== 'fleetVehicle.view'),
    );
    expect(blind).toContain(t('fleet.odometer.alarmReason.notActive.whyUnknown'));
    expect(blind).not.toContain(t('fleet.vehicles.status.outOfService'));
  });
});

describe('the card', () => {
  const card = (a: FleetMaintenanceAlarmDto): string =>
    draw(<AlarmReasonCard alarm={a} reason={a.noAlarmReason ?? 'noService'} />, client([], []));
  const fact = (markup: string, mark: string): string => {
    const at = markup.indexOf(`data-odo-fact="${mark}"`);
    return at === -1 ? '' : markup.slice(at, markup.indexOf('</dd>', at));
  };

  it('car 295: the whole sentence, why, what to do naming the counter used, and the facts', () => {
    const markup = card(alarm());
    expect(markup).toContain(
      t('fleet.alarms.noAlarmReason.baselineBelowChain').replace(' — ', ' — '),
    );
    expect(markup).toContain(t('fleet.odometer.alarmReason.baselineBelowChain.why'));
    expect(markup).toContain(
      t('fleet.odometer.alarmReason.baselineBelowChain.todo', {
        counter: t('fleet.maintenance.fields.odometerAtService'),
      }),
    );
    expect(fact(markup, 'car')).toContain('>295<');
    expect(fact(markup, 'latest')).toContain('>25,631<');
    expect(fact(markup, 'latest')).toContain('>2026/10/26<');
    expect(fact(markup, 'entry')).toContain('>22,790<');
    expect(fact(markup, 'entry')).toContain('data-odo-tag="used"');
    expect(fact(markup, 'judged')).toContain('>22,830<');
    expect(fact(markup, 'judged')).toContain('data-odo-tag="conflict"');
    expect(markup, 'no exit counter was written').not.toContain('data-odo-fact="exit"');
    expect(markup).toContain(t('fleet.odometer.alarmReason.card.footer'));
  });

  it('labels the counters as the maintenance screen does — never as the odometer columns', () => {
    const markup = card(alarm({ baseline: baseline({ exitCounter: 22_900 }) }));
    expect(markup).toContain(t('fleet.maintenance.fields.odometerAtService'));
    expect(markup).toContain(t('fleet.maintenance.fields.exitOdometer'));
    expect(markup).not.toContain(`>${t('fleet.odometer.columns.outReading')}<`);
  });

  it('a late closure: the exit counter struck through, set aside, with the reading against it', () => {
    const markup = card(
      alarm({
        code: '150',
        noAlarmReason: 'readingOlderThanService',
        latestReading: 167_520,
        latestReadingAt: day('2026-10-25'),
        lastServiceAt: day('2026-10-26'),
        baseline: baseline({
          inDate: day('2026-10-12'),
          outDate: day('2026-10-26'),
          entryCounter: 165_880,
          exitCounter: 165_895,
          counter: 165_880,
          judgedAgainst: { reading: 165_862, date: day('2026-10-11') },
          exitSetAside: {
            because: 'belowChain',
            conflict: { reading: 167_520, date: day('2026-10-25') },
          },
        }),
      }),
    );
    const exit = fact(markup, 'exit');
    expect(exit).toContain('line-through');
    expect(exit).toContain('data-odo-tag="setAside"');
    expect(exit).toContain('data-odo-tag="conflict"');
    expect(exit).toContain('>167,520<');
    expect(exit).toContain('>2026/10/25<');
    expect(fact(markup, 'entry')).toContain('data-odo-tag="used"');
    // Waiting for a newer reading: the two days that say so are marked, not the judged reading.
    expect(fact(markup, 'latest')).toContain('bg-amber-100');
    expect(fact(markup, 'service')).toContain('bg-amber-100');
    expect(fact(markup, 'judged')).not.toContain('data-odo-tag="conflict"');
  });

  it('a newer visit still open, and one that does not count, each in its own words', () => {
    const open = card(
      alarm({
        noAlarmReason: 'noService',
        baseline: null,
        lastServiceAt: null,
        lastServiceVisitId: null,
        newerUncountedVisit: {
          visitId: 'n',
          inDate: day('2026-10-24'),
          outDate: null,
          why: 'open',
          workType: null,
          workshop: null,
        },
      }),
    );
    const words = (key: string) => t(key).split('{{date}}');
    for (const piece of words('fleet.odometer.alarmReason.card.newerVisitOpen')) {
      expect(fact(open, 'newer')).toContain(piece);
    }
    expect(fact(open, 'newer')).toContain('>2026/10/24<');
    const notCounting = card(
      alarm({
        newerUncountedVisit: {
          visitId: 'n',
          inDate: day('2026-10-20'),
          outDate: day('2026-10-21'),
          why: 'notCounting',
          workType: null,
          workshop: null,
        },
      }),
    );
    expect(fact(notCounting, 'newer')).toContain(
      words('fleet.odometer.alarmReason.card.newerVisitNotCounting')[0],
    );
  });
});

describe('the way to fix it, by grant', () => {
  const linkOf = (reason: FleetMaintenanceAlarmDto['noAlarmReason'], permissions = ALL): string => {
    const markup = page(client(THREE_DAYS, [alarm({ noAlarmReason: reason })]), permissions);
    const at = markup.indexOf('data-odo-reason-fix=');
    return at === -1 ? '' : markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at) + 1);
  };

  it('each reason to its place', () => {
    expect(linkOf('noInterval')).toContain('href="/fleet/catalogs?kind=make"');
    expect(linkOf('noService')).toContain('href="/fleet/maintenance?vehicleCodes=295"');
    expect(linkOf('baselineBelowChain')).toContain('href="/fleet/maintenance?vehicleCodes=295"');
    expect(linkOf('readingOlderThanService')).toContain(
      'href="/fleet/maintenance-alarms?vehicleCodes=295"',
    );
    // «تسجيل قراءة» is this screen's own dialog, opened on the car.
    expect(linkOf('noReading')).toContain('role="button"');
  });

  it('never a link the reader cannot follow', () => {
    const without = (p: string) => ALL.filter((x) => x !== p);
    expect(linkOf('noInterval', without('fleetMaintenanceRule.manage'))).toBe('');
    expect(linkOf('noService', without('fleetMaintenance.view'))).toBe('');
    expect(linkOf('noReading', without('fleetOdometer.record'))).toBe('');
  });

  it('«تسجيل قراءة» opens the record dialog on THAT car, and lets go when it closes', () => {
    const source = read('pages/OdometerPage.tsx');
    expect(source).toMatch(
      /onRecord=\{\(code\) => \{\s*setRecordCode\(code\);\s*setRecordOpen\(true\);/,
    );
    expect(source).toMatch(/initialVehicleCode=\{\s*recordCode \?\?/);
    expect(source).toMatch(/setRecordOpen\(false\);\s*setRecordCode\(null\);/);
  });
});

describe('the card opens as the driver card does', () => {
  it('wired to its rules: hover, keyboard focus, blur, Escape — one open at a time', () => {
    const cell = read('components/AlarmReasonCell.tsx');
    for (const wire of [
      'onMouseEnter={control.enter}',
      'onMouseLeave={control.leave}',
      'onFocus={(e) => control.focus(keyboardFocus(e.currentTarget))}',
      'onBlur={control.blur}',
      'role="tooltip"',
      'pointer-events-none',
    ]) {
      expect(cell, wire).toContain(wire);
    }
    // Hidden once the chip scrolls out of the table's box, as the driver card is.
    expect(cell).toContain('clippingBoxes(anchor.current)');
    expect(cell).toContain('nameInSight(');
  });
});
