// «مفيش إنذار والمسافة كبيرة، ومش بيخصم الكيلومترات اللى بتخش كل يوم … مش بيزود على فارق الصيانه».
//
// Batch 3, item 1, as the owner approved it (samples A-odometer 02–08):
//   · every reading row of the odometer register shows the gap AT THAT READING (`serviceGapKm`),
//     so the column grows day by day; «—» before any service and on a day without a reading;
//   · the car's NEWEST row on the page carries the car NOW: its figure and the ⓘ that opens
//     «كيف حُسب الفارق», and nothing else (the owner, after batch 3: «I want the rest of it
//     removed, leaving only the exclamation mark next to the reading») — the level, «المتبقي»,
//     the reading the figure stands on and the amber mark of a newer visit are in the card;
//   · «إنذارات الصيانة»: «منذ الخدمة» opens the same card; «المتبقي» says «من Y كم».
// Proven on the real pages and the real card, rendered to markup (no DOM: the card's opening
// rules are `lib/alarm-reason-card.spec.ts`'s, under fake timers).
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
  type FleetAlarmUncountedVisitDto,
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
import { MaintenanceAlarmsPage } from './pages/MaintenanceAlarmsPage';
import { AlarmReasonCard } from './components/AlarmReasonCell';
import { HowComputedCard } from './components/alarm-figure-card';
import { currentMonthRange } from './lib/odometer-range';

// The card portals into `document.body`; the suite runs without a DOM.
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
const F = 'fleet.odometer.alarmReason.figure.';

/** The fixed words of a template — everything but its `{{placeholders}}`. */
const pieces = (key: string, locale: Locale = 'ar'): string[] =>
  translate(locale, key)
    .split(/\{\{\w+\}\}/u)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '');

const SERVICE = { id: 'wt-service', name: { ar: 'صيانة', en: 'Service' } };
const REPAIR = { id: 'wt-repair', name: { ar: 'إصلاح', en: 'Repair' } };
const DEALER = { id: 'ws-dealer', name: { ar: 'التوكيل', en: 'Dealership' } };
const SPRINTER = { id: 'make-516', name: { ar: 'مرسيدس اسبرانتر 516', en: 'Sprinter 516' } };
const SPRINTER_515 = { id: 'make-515', name: { ar: 'مرسيدس اسبرانتر 515', en: 'Sprinter 515' } };

const baseline = (o: Partial<FleetAlarmBaselineDto> = {}): FleetAlarmBaselineDto => ({
  visitId: 'visit-295',
  inDate: day('2026-10-06'),
  outDate: day('2026-10-06'),
  entryCounter: 22_790,
  exitCounter: null,
  source: 'entry',
  counter: 22_790,
  counterDate: day('2026-10-06'),
  judgedAgainst: null,
  exitSetAside: null,
  workType: SERVICE,
  ...o,
});

/** Car 295 as the owner sent it: 28,297 − 22,790 = 5,507 km; its make's interval 7,500. */
const car295 = (o: Partial<FleetMaintenanceAlarmDto> = {}): FleetMaintenanceAlarmDto => ({
  vehicleId: 'v295',
  code: '295',
  level: 'none',
  remainingKm: 1_993,
  sinceServiceKm: 5_507,
  lastServiceAt: day('2026-10-06'),
  lastServiceVisitId: 'visit-295',
  noAlarmReason: null,
  daysWithoutReading: 0,
  latestReading: 28_297,
  latestReadingAt: day('2026-11-01'),
  latestReadingLogId: 'r1101',
  baseline: baseline(),
  newerUncountedVisit: null,
  rule: { vehicleType: SPRINTER, intervalKm: 7_500, yellowKm: 1_000, redKm: 300 },
  newestReading: { reading: 28_297, date: day('2026-11-01') },
  ...o,
});

const openRepair: FleetAlarmUncountedVisitDto = {
  visitId: 'visit-157-repair',
  inDate: day('2026-09-10'),
  outDate: null,
  why: 'open',
  workType: REPAIR,
  workshop: DEALER,
  // «إصلاح» is not on the counting list: it does not count even once closed.
  counts: false,
};

/** Car 157 at the dealer since 09/10: 173,634 − 173,344 = 290 km, no reading since 09/23. */
const car157 = (o: Partial<FleetMaintenanceAlarmDto> = {}): FleetMaintenanceAlarmDto =>
  car295({
    vehicleId: 'v157',
    code: '157',
    remainingKm: 4_710,
    sinceServiceKm: 290,
    lastServiceAt: day('2026-09-05'),
    lastServiceVisitId: 'visit-157',
    daysWithoutReading: 44,
    latestReading: 173_634,
    latestReadingAt: day('2026-09-23'),
    latestReadingLogId: 'r0923',
    baseline: baseline({
      visitId: 'visit-157',
      inDate: day('2026-09-05'),
      outDate: day('2026-09-05'),
      entryCounter: 173_344,
      counter: 173_344,
      counterDate: day('2026-09-05'),
    }),
    newerUncountedVisit: openRepair,
    rule: { vehicleType: SPRINTER_515, intervalKm: 5_000, yellowKm: 1_000, redKm: 300 },
    newestReading: { reading: 173_634, date: day('2026-09-23') },
    ...o,
  });

const log = (
  id: string,
  ymd: string,
  o: Partial<FleetOdometerLogDto> = {},
): FleetOdometerLogDto => ({
  id,
  vehicleId: 'v295',
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

/** 295's rows as in sample A/02: each day's reading less 22,790. */
const ROWS_295 = [
  log('r1101', '2026-11-01', {
    outReading: 28_297,
    inReading: null,
    km: null,
    serviceGapKm: 5_507,
  }),
  log('r1029', '2026-10-29', { outReading: 28_170, inReading: 28_297, serviceGapKm: 5_507 }),
  log('r1028', '2026-10-28', { outReading: 26_300, inReading: 28_170, serviceGapKm: 5_380 }),
  log('r1027', '2026-10-27', { outReading: 26_126, inReading: 26_300, serviceGapKm: 3_510 }),
  log('r1019', '2026-10-19', { outReading: 25_581, inReading: 25_631, serviceGapKm: 2_841 }),
];

/** 157's rows: «بدون قراءة» at the dealer. */
const noReading = (id: string, ymd: string): FleetOdometerLogDto =>
  log(id, ymd, {
    vehicleId: 'v157',
    vehicleCode: '157',
    outReading: null,
    inReading: null,
    km: null,
    notes: 'التوكيل',
  });
const ROWS_157 = [noReading('r1024', '2026-10-24'), noReading('r1023', '2026-10-23')];

const ALL = [
  'fleetOdometer.view',
  'fleetOdometer.record',
  'fleetMaintenance.view',
  'fleetVehicle.view',
];

const client = (logs: FleetOdometerLogDto[], alarms: FleetMaintenanceAlarmDto[]): QueryClient => {
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
  qc.setQueryData(['fleet', 'alarms'], alarms);
  return qc;
};

const draw = (
  node: JSX.Element,
  qc: QueryClient,
  { locale = 'ar' as Locale, route = '/fleet/odometer' } = {},
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
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
        <MemoryRouter initialEntries={[route]}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The table's rows, in order, as markup. */
const rows = (markup: string): string[] =>
  markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tbody>')).split('<tr').slice(1);
/** The «فارق عداد الصيانة» cell of a row (the one before the actions). */
const gapCell = (row: string): string => {
  const cells = row.split('<td').slice(1);
  return cells.find((cell) => cell.includes('data-odo-gap=')) ?? '';
};

describe('the odometer register — each row its own gap, the newest row the car now', () => {
  const markup = draw(<OdometerPage />, client(ROWS_295, [car295()]));
  const [newest, ...older] = rows(markup).map(gapCell) as [string, ...string[]];

  it('295: the figure grows day by day — 2,841 … 5,380 … 5,507 — each row from its own reading', () => {
    expect(older.map((cell) => /data-odo-gap="(\w+)"/u.exec(cell)?.[1])).toEqual([
      'row',
      'row',
      'row',
      'row',
    ]);
    for (const [cell, km] of older.map((c, i) => [c, ['5,507', '5,380', '3,510', '2,841'][i]])) {
      expect(cell).toContain(`>${km}<`);
      expect(cell, 'with the unit').toContain(t('fleet.odometer.kmValue', { km: '' }).trim());
    }
    // No level and no card down the older readings: they are not about the car now.
    for (const cell of older) {
      expect(cell).not.toContain(t('fleet.vehicle.alarmNone'));
      expect(cell).not.toContain('data-odo-figure-trigger');
    }
  });

  // REWRITTEN ON PURPOSE (the owner, after batch 3: «I want the rest of it removed, leaving only
  // the exclamation mark next to the reading»): the level badge and «المتبقي 1,993 من 7,500 كم»
  // used to sit under the figure. They are the card's now.
  it('the newest row: today’s figure and its ⓘ — the card’s trigger — and nothing else', () => {
    expect(newest).toContain('data-odo-gap="newest"');
    expect(newest).toContain('data-odo-figure-trigger="true"');
    expect(newest).toContain('>5,507<');
    expect(newest, 'the ⓘ beside it').toContain('<svg');
    expect(newest, 'no level badge').not.toContain(t('fleet.vehicle.alarmNone'));
    expect(newest, 'no «المتبقي … من … كم»').not.toContain('data-odo-remaining');
    expect(newest).not.toContain('>1,993<');
    expect(newest).not.toContain('>7,500<');
    expect(newest, 'no «آخر قراءة» line').not.toContain('data-odo-latest-on');
    expect(newest, 'no amber mark').not.toContain('data-odo-newer-mark');
  });

  it('«—» before any service and on a day without a reading — the server’s null, never a guess', () => {
    const markup2 = draw(
      <OdometerPage />,
      client(
        [
          log('r1101', '2026-11-01', { serviceGapKm: 5_507 }),
          log('r1002', '2026-10-02', { serviceGapKm: null }),
          log('r1001', '2026-10-01', { outReading: null, inReading: null, km: null }),
        ],
        [car295()],
      ),
    );
    const [, before, without] = rows(markup2).map(gapCell);
    for (const cell of [before, without]) {
      expect(cell).toContain('data-odo-gap="none"');
      expect(cell).toContain('>—<');
    }
  });

  it('one line, in the row’s own type — no second line under the figure, no pinned size', () => {
    // «عاوز الخط … زى شاشة انذار الصيانه فى كل العواميد»: every column wears the alarms board's
    // type, and the figure is the only thing in the cell.
    expect(newest).not.toContain('flex-col');
    expect(newest).not.toMatch(/text-\[1[1-4](?:\.5)?px\]/u);
    expect(newest).not.toContain('text-xs');
  });

  it('157: the newest row is a day without a reading — it shows 290 and its ⓘ, nothing more', () => {
    const cells = rows(draw(<OdometerPage />, client(ROWS_157, [car157()]))).map(gapCell);
    const [first, second] = cells as [string, string];
    expect(first).toContain('data-odo-gap="newest"');
    expect(first).toContain('data-odo-figure-trigger="true"');
    expect(first).toContain('>290<');
    // What used to sit under it — what is left, «آخر قراءة 2026/09/23», the amber mark — is not
    // in the cell; the card below says all of it.
    expect(first).not.toContain('>4,710<');
    expect(first).not.toContain('>5,000<');
    expect(first).not.toContain('data-odo-latest-on');
    expect(first).not.toContain(t('fleet.odometer.alarmReason.card.latestReading'));
    expect(first).not.toContain('>2026/09/23<');
    expect(first).not.toContain('data-odo-newer-mark');
    expect(first).not.toContain(t(`${F}mark.open`));
    // The day before carries no reading, so no gap — and nothing about the car.
    expect(second).toContain('data-odo-gap="none"');
    expect(second).not.toContain('data-odo-newer-mark');
  });

  it('…and every piece the cell let go of is in its card: the level, what is left, the reading’s day, the newer visit', () => {
    const markup = draw(<HowComputedCard alarm={car157()} footer="FOOTER" />, client([], []));
    const fact = (mark: string): string => {
      const at = markup.indexOf(`data-odo-fact="${mark}"`);
      return at === -1 ? '' : markup.slice(at, markup.indexOf('</dd>', at));
    };
    expect(fact('thresholds')).toContain('data-odo-level-words="none"');
    expect(fact('thresholds')).toContain(t(`${F}level.none`));
    for (const figure of ['5,000', '290', '4,710'])
      expect(fact('remaining')).toContain(`>${figure}<`);
    expect(fact('latest')).toContain('>173,634<');
    expect(fact('latest')).toContain('>2026/09/23<');
    expect(markup).toContain('data-odo-newer="open"');
    expect(markup).toContain(t(`${F}mark.open`));
  });

  it('past the interval: the figure alone, in the red tint — «متأخر» is the card’s', () => {
    const late = car295({ level: 'red', sinceServiceKm: 8_000, remainingKm: -500 });
    const [cell] = rows(draw(<OdometerPage />, client(ROWS_295.slice(0, 1), [late]))).map(
      gapCell,
    ) as [string];
    expect(cell).toContain('>8,000<');
    expect(cell).toContain('data-odo-figure-trigger="true"');
    expect(cell, 'the level’s tint on the figure').toContain('bg-red-100/80');
    expect(cell).not.toContain('data-odo-remaining');
    expect(cell).not.toContain('>500<');
    expect(cell).not.toContain(t('fleet.dashboard.level.red'));
  });

  it('a make with no interval: the figure and its ⓘ, as for any car', () => {
    const noRule = car295({
      rule: { vehicleType: null, intervalKm: 0, yellowKm: 1_000, redKm: 300 },
    });
    const [cell] = rows(draw(<OdometerPage />, client(ROWS_295.slice(0, 1), [noRule]))).map(
      gapCell,
    ) as [string];
    expect(cell).toContain('>5,507<');
    expect(cell).toContain('data-odo-figure-trigger="true"');
    expect(cell).not.toContain('data-odo-remaining');
  });

  it('the figure opens its card as the reason chip does — hover, keyboard focus, blur, Escape', () => {
    const cell = read('components/AlarmFigureCell.tsx');
    for (const wire of [
      'onMouseEnter={control.enter}',
      'onMouseLeave={control.leave}',
      'onFocus={(e) => control.focus(keyboardFocus(e.currentTarget))}',
      'onBlur={control.blur}',
      'useReasonCard()',
      '<ReasonCardLayer id={id} anchor={anchor} figure>',
    ]) {
      expect(cell, wire).toContain(wire);
    }
    // The card itself is the one frame: a tooltip that takes no pointer, hidden off the table.
    const frame = read('components/AlarmReasonCell.tsx');
    expect(frame).toContain('role="tooltip"');
    expect(frame).toContain('pointer-events-none');
    expect(frame).toContain("data-odo-figure-card={figure ? 'true' : undefined}");
  });

  it('the page decides nothing: the newest row is picked by `newestRows`, the gap is the server’s', () => {
    const page = read('pages/OdometerPage.tsx');
    expect(page).toContain('newestRows(rows)');
    expect(page).toContain('<RowGapCell km={log.serviceGapKm} />');
    expect(page).not.toMatch(/sinceServiceKm\s*[-+]|[-+]\s*\w*\.?sinceServiceKm/u);
  });
});

describe('«كيف حُسب الفارق» — the card of a computed figure', () => {
  const card = (a: FleetMaintenanceAlarmDto, locale: Locale = 'ar'): string =>
    draw(<HowComputedCard alarm={a} footer="FOOTER" />, client([], []), { locale });
  const fact = (markup: string, mark: string): string => {
    const at = markup.indexOf(`data-odo-fact="${mark}"`);
    return at === -1 ? '' : markup.slice(at, markup.indexOf('</dd>', at));
  };

  it('car 295: the make, the reading, the visit with its work type, the counter used, the arithmetic', () => {
    const markup = card(car295());
    expect(markup).toContain(t(`${F}howComputed`));
    expect(fact(markup, 'car')).toContain('>295<');
    expect(fact(markup, 'car')).toContain('مرسيدس اسبرانتر 516');
    expect(fact(markup, 'latest')).toContain('>28,297<');
    expect(fact(markup, 'latest')).toContain('>2026/11/01<');
    expect(markup).toContain(t('fleet.odometer.alarmReason.card.latestReading'));
    expect(fact(markup, 'service')).toContain('صيانة');
    expect(fact(markup, 'service').split('>2026/10/06<').length - 1, 'in and out').toBe(2);
    expect(fact(markup, 'entry')).toContain('>22,790<');
    expect(fact(markup, 'entry')).toContain('data-odo-tag="used"');
    const sum = fact(markup, 'subtraction');
    for (const figure of ['28,297', '22,790', '5,507']) expect(sum).toContain(`>${figure}<`);
    expect(fact(markup, 'interval')).toContain('>7,500<');
    const left = fact(markup, 'remaining');
    for (const figure of ['7,500', '5,507', '1,993']) expect(left).toContain(`>${figure}<`);
  });

  it('the thresholds, the level they give, and where each number is set', () => {
    const markup = card(car295());
    const line = fact(markup, 'thresholds');
    expect(line).toContain('>1,000<');
    expect(line).toContain('>300<');
    expect(line).toContain('data-odo-level-words="none"');
    expect(line).toContain(t(`${F}level.none`));
    expect(fact(markup, 'where')).toContain(t(`${F}whereInterval`));
    expect(fact(markup, 'where')).toContain(t(`${F}whereThresholds`));
    expect(markup).toContain('>FOOTER<');
    expect(card(car295({ level: 'red', remainingKm: 200 }))).toContain(t(`${F}level.red`));
    expect(card(car295({ level: 'yellow', remainingKm: 800 }))).toContain(t(`${F}level.yellow`));
  });

  it('C6: «أعلى قراءة ليست أحدث قراءة» — both points, when the highest is not the newest', () => {
    const typo = card(
      car295({
        latestReading: 31_297,
        latestReadingAt: day('2026-10-12'),
        sinceServiceKm: 8_507,
        remainingKm: -1_007,
      }),
    );
    expect(typo).toContain(t(`${F}highestReading`));
    expect(fact(typo, 'latest')).toContain('>31,297<');
    expect(fact(typo, 'newest')).toContain('>28,297<');
    expect(fact(typo, 'newest')).toContain('>2026/11/01<');
    expect(fact(typo, 'newest')).toContain(t(`${F}highestNotNewest`));
    // A healthy chain says none of it.
    const healthy = card(car295());
    expect(healthy).not.toContain('data-odo-fact="newest"');
    expect(healthy).not.toContain(t(`${F}highestReading`));
  });

  // Rewritten on purpose (HUB, W-ODO hand-off): the server now says whether the open visit's work
  // type counts, so 157's card says «إصلاح» does not count even once closed — sample A/04's words —
  // instead of the cautious note it showed while that was unknown.
  it('157: the open «إصلاح» at «التوكيل», which does not count even once closed — and what to do', () => {
    const markup = card(car157());
    const box = markup.slice(markup.indexOf('data-odo-newer='));
    expect(box).toContain('data-odo-newer="open"');
    expect(box).toContain(t(`${F}mark.open`));
    expect(box).toContain('إصلاح');
    expect(box).toContain('التوكيل');
    expect(box).toContain('>2026/09/10<');
    for (const piece of pieces(`${F}newer.openUnknown`)) expect(box).toContain(piece);
    // «ونوع عملها «إصلاح» لا يُحتسب للإنذار حتى بعد إغلاقها؛ …», the work type named.
    for (const piece of pieces(`${F}newer.openNotCountingNote`)) expect(box).toContain(piece);
    expect(box).toContain('ونوع عملها «</span><span><span>إصلاح</span></span>');
    expect(box).not.toContain(t(`${F}newer.openUnknownNote`));
    // «لا تُحتسب حتى تُغلق» would promise it counts once closed: it does not, so not said.
    expect(box).not.toContain(pieces(`${F}newer.open`).at(-1) as string);
    // The days nobody wrote the counter.
    expect(fact(markup, 'days')).toContain('>44<');
  });

  it('the days nobody wrote the counter, in Arabic’s five forms — never «1 يومًا»', () => {
    const days = (n: number, locale: Locale = 'ar'): string =>
      fact(card(car157({ daysWithoutReading: n }), locale), 'days')
        .replace(/<[^>]*>/gu, '')
        .split(t('fleet.alarms.daysWithoutReadingHint'))[0] as string;
    expect(days(1)).toContain('يوم واحد');
    expect(days(2)).toContain('يومان');
    expect(days(5)).toContain('5 أيام');
    expect(days(44)).toContain('44 يومًا');
    expect(days(100)).toContain('100 يوم');
    for (const n of [1, 2, 5]) expect(days(n)).not.toContain('يومًا');
    expect(days(1, 'en')).toContain('1 day');
    expect(days(1, 'en')).not.toContain('1 days');
    expect(days(3, 'en')).toContain('3 days');
    // Nothing on a car that has a reading every day.
    expect(fact(card(car157({ daysWithoutReading: 0 })), 'days')).toBe('');
  });

  it('an open visit of a work type that counts: it counts once closed', () => {
    const markup = card(
      car157({ newerUncountedVisit: { ...openRepair, workType: SERVICE, counts: true } }),
    );
    for (const piece of pieces(`${F}newer.open`)) expect(markup).toContain(piece);
    expect(markup).not.toContain(t(`${F}newer.openUnknownNote`));
    expect(markup).not.toContain(pieces(`${F}newer.openNotCountingNote`)[0] as string);
  });

  it('an open visit with no work type to name: only what holds for any open visit', () => {
    const markup = card(car157({ newerUncountedVisit: { ...openRepair, workType: null } }));
    for (const piece of pieces(`${F}newer.openUnknown`)) expect(markup).toContain(piece);
    expect(markup).toContain(t(`${F}newer.openUnknownNote`));
    expect(markup).not.toContain(pieces(`${F}newer.openNotCountingNote`)[0] as string);
  });

  it('a newer visit whose work type does not count: said, and what to do', () => {
    const markup = card(
      car295({
        newerUncountedVisit: {
          ...openRepair,
          inDate: day('2026-10-20'),
          outDate: day('2026-10-21'),
          why: 'notCounting',
        },
      }),
    );
    expect(markup).toContain('data-odo-newer="notCounting"');
    expect(markup).toContain(t(`${F}mark.notCounting`));
    for (const piece of pieces(`${F}newer.notCounting`)) expect(markup).toContain(piece);
    expect(markup).toContain(t(`${F}newer.notCountingNote`));
  });

  it('C8: a newer visit checked out before the counted one — its two days and the counted visit’s exit', () => {
    const markup = card(
      car295({
        sinceServiceKm: 8_507,
        baseline: baseline({
          inDate: day('2026-09-26'),
          outDate: day('2026-10-20'),
          entryCounter: 19_790,
          counter: 19_790,
        }),
        newerUncountedVisit: {
          visitId: 'visit-1006',
          inDate: day('2026-10-06'),
          outDate: day('2026-10-06'),
          why: 'checkedOutEarlier',
          workType: SERVICE,
          workshop: null,
          counts: true,
        },
      }),
    );
    const box = markup.slice(markup.indexOf('data-odo-newer='));
    expect(box).toContain('data-odo-newer="checkedOutEarlier"');
    expect(box).toContain(t(`${F}mark.checkedOutEarlier`));
    for (const piece of pieces(`${F}newer.checkedOutEarlier`)) expect(box).toContain(piece);
    expect(box.split('>2026/10/06<').length - 1, 'its in and out').toBe(2);
    expect(box).toContain('>2026/10/20<');
    // Named by its work type alone when no workshop is on it.
    for (const piece of pieces(`${F}newer.work`)) expect(box).toContain(piece);
  });

  it('a figure the projection refused has no «كيف حُسب» card — that car has the reason card', () => {
    expect(
      card(car295({ sinceServiceKm: null, remainingKm: null, noAlarmReason: 'noService' })),
    ).toBe('');
  });

  it('in the reader’s language: the make and the work type by their English names', () => {
    const markup = card(car157(), 'en');
    expect(markup).toContain(translate('en', `${F}howComputed`));
    expect(markup).toContain('Sprinter 515');
    expect(markup).toContain('Repair');
    expect(markup).toContain('Dealership');
    expect(markup).not.toContain('إصلاح');
  });
});

describe('the reason card names C8 in its own words', () => {
  it('a refused car whose newest visit was checked out before the counted one', () => {
    const markup = draw(
      <AlarmReasonCard
        alarm={car295({
          sinceServiceKm: null,
          remainingKm: null,
          noAlarmReason: 'baselineBelowChain',
          newerUncountedVisit: {
            visitId: 'n',
            inDate: day('2026-10-06'),
            outDate: day('2026-10-06'),
            why: 'checkedOutEarlier',
            workType: SERVICE,
            workshop: null,
            counts: true,
          },
        })}
        reason="baselineBelowChain"
      />,
      client([], []),
    );
    const at = markup.indexOf('data-odo-fact="newer"');
    const line = markup.slice(at, markup.indexOf('</dd>', at));
    for (const piece of pieces('fleet.odometer.alarmReason.newer.checkedOutEarlier')) {
      expect(line).toContain(piece);
    }
    expect(line).toContain('>2026/10/06<');
    expect(line).not.toContain(pieces('fleet.odometer.alarmReason.card.newerVisitNotCounting')[0]);
  });
});

describe('«إنذارات الصيانة» — the same card on «منذ الخدمة», «من Y كم» on «المتبقي»', () => {
  const board = (alarms: FleetMaintenanceAlarmDto[]): string[] =>
    rows(
      draw(<MaintenanceAlarmsPage />, client([], alarms), { route: '/fleet/maintenance-alarms' }),
    );

  it('«منذ الخدمة» is the card’s trigger, with the amber mark of a newer visit beside it', () => {
    const all = board([car157(), car295()]);
    // The board orders its rows itself; each is found by its car.
    const row157 = all.find((row) => row.includes('data-odo-car="157"')) ?? '';
    const row295 = all.find((row) => row.includes('data-odo-car="295"')) ?? '';
    for (const row of [row157, row295]) {
      expect(row).toContain('data-odo-gap="board"');
      expect(row).toContain('data-odo-figure-trigger="true"');
    }
    expect(row295).toContain('>5,507<');
    expect(row157).toContain('>290<');
    expect(row157).toContain('data-odo-newer-mark="open"');
    expect(row295).not.toContain('data-odo-newer-mark');
  });

  it('«المتبقي»: «1,993 من 7,500 كم», the figure in the level’s colour', () => {
    const [row] = board([car295()]) as [string];
    const cell = row.slice(row.indexOf('data-odo-board-of'));
    expect(cell).toContain('>1,993<');
    expect(cell).toContain('>7,500<');
    expect(cell).toContain('text-emerald-700');
    for (const piece of pieces('fleet.alarms.figure.of')) expect(cell).toContain(piece);
  });

  it('overdue, or no rule: the board’s own cell as it was', () => {
    const [late] = board([car295({ level: 'red', remainingKm: -500 })]) as [string];
    expect(late).not.toContain('data-odo-board-of');
    expect(late).toContain('>500<');
    for (const piece of pieces('fleet.dashboard.overdueKm')) expect(late).toContain(piece);
    const [noRule] = board([
      car295({ rule: { vehicleType: null, intervalKm: 0, yellowKm: 1_000, redKm: 300 } }),
    ]) as [string];
    expect(noRule).not.toContain('data-odo-board-of');
    expect(noRule).toContain('>1,993<');
  });

  it('a refused car keeps the dash on «منذ الخدمة»', () => {
    const [row] = board([
      car295({ sinceServiceKm: null, remainingKm: null, noAlarmReason: 'noService' }),
    ]) as [string];
    expect(row).not.toContain('data-odo-gap="board"');
  });

  it('the board’s card says the figures are about the car now', () => {
    expect(read('components/AlarmFigureCell.tsx')).toContain(
      "footer={t('fleet.alarms.figure.footer')}",
    );
    expect(read('components/AlarmFigureCell.tsx')).toContain('footer={t(`${F}footer`)}');
  });
});
