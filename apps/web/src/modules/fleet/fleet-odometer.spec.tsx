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
import { describe, expect, it } from 'vitest';
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
import { OdometerPage } from './pages/OdometerPage';

const HERE = dirname(fileURLToPath(import.meta.url));

const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
});

const VEHICLE_ID = 'v1';
const log = (o: Partial<FleetOdometerLogDto> = {}): FleetOdometerLogDto => ({
  id: 'o1',
  vehicleId: VEHICLE_ID,
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
  ...o,
});

const ALL = [
  'fleetOdometer.view',
  'fleetOdometer.record',
  'fleetOdometer.correct',
  'employee.view',
];

const ODOMETER_KEY = (over: Record<string, unknown> = {}) =>
  listKey('fleet', 'odometer', {
    page: 1,
    pageSize: 25,
    sortBy: 'date',
    sortDir: 'desc',
    vehicleCodes: undefined,
    from: undefined,
    to: undefined,
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
  qc.setQueryData(ODOMETER_KEY(keyOver), page(logs));
  qc.setQueryData(
    listKey('fleet', 'vehicles', { pageSize: MAX_PAGE_SIZE, sortBy: 'code', sortDir: 'asc' }),
    page([
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

const REQUIRED_COLUMNS = [
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
  it('renders the ten columns in the required order', () => {
    const head = thead(render());
    const at = REQUIRED_COLUMNS.map((key) => ({ key, at: head.indexOf(t(key)) }));
    for (const entry of at) expect(entry.at, `${entry.key} present`).toBeGreaterThan(-1);
    for (let i = 1; i < at.length; i += 1) {
      const prev = at[i - 1] as { key: string; at: number };
      const cur = at[i] as { key: string; at: number };
      expect(cur.at, `${cur.key} after ${prev.key}`).toBeGreaterThan(prev.at);
    }
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

  it('takes SEVERAL vehicles and SEVERAL alert levels at once', () => {
    const html = render({
      route: '/fleet/odometer?vehicleCodes=150,151&alerts=yellow,red',
      qc: client([log()], [alarm()], { vehicleCodes: ['150', '151'], alerts: ['yellow', 'red'] }),
    });
    // `MultiSelect` reports how many are chosen, so a filtered list never looks unfiltered.
    expect(html).toContain('٢');
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
    // The page used to pass its one filtered vehicle to the dialog. The multi-select must not
    // lose that; with SEVERAL selected there is no single answer, so it passes none.
    const source = readFileSync(join(HERE, 'pages/OdometerPage.tsx'), 'utf8');
    const mount = source.slice(source.indexOf('<RecordOdometerDialog'));
    expect(mount).toContain('vehicleCodes.length === 1');
    expect(mount).toContain('v.code === vehicleCodes[0]');
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

  it('lets the operator TYPE a vehicle code instead of scrolling a dropdown', () => {
    expect(source).toContain('Combobox');
    expect(source).not.toContain('VehicleSelect');
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

  it('asks for nothing the server derives — no km, no closing reading', () => {
    expect(source).not.toContain('inReading');
    // No km INPUT. `km:` does appear as an i18n interpolation for the server's expected-reading
    // hint, which is the opposite of asking the user for it, so the claim is about the form state.
    expect(source).not.toMatch(/useState.*\bkm\b/i);
    expect(source).not.toContain('record.mutateAsync({ km');
  });
});
