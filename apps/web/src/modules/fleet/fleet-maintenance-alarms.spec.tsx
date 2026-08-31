// The maintenance-alarms board and its two filters.
//
// Four claims, each a rule a typecheck cannot see:
//   • BOTH filters take more than one answer, and neither is a single-value `<select>` any more;
//   • within a filter the answers are OR'd, and the two filters AND together;
//   • the alarm filter asks «كل الإنذارات», and the cars it offers come from the BOARD rather
//     than from a second call to the registry;
//   • the board is still fetched UNFILTERED — `GET /fleet/odometer/alarms` takes no query, so the
//     narrowing is an in-memory projection over live data and stays one.
//
// The web suite runs with `environment: 'node'` and no jsdom, so nothing clicks. A closed dropdown
// renders no options at all, which is why a selection is read from the TRIGGER — the one thing a
// closed `MultiSelect` does render — and the rows it produces are read from the table.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type FleetMaintenanceAlarmDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { MaintenanceAlarmsPage } from './pages/MaintenanceAlarmsPage';
import { alarmVehicleOptions } from './lib/alarm-vehicle-options';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'pages/MaintenanceAlarmsPage.tsx'), 'utf8');

const alarm = (
  code: string,
  level: FleetMaintenanceAlarmDto['level'],
  o: Partial<FleetMaintenanceAlarmDto> = {},
): FleetMaintenanceAlarmDto => ({
  vehicleId: `v${code}`,
  code,
  level,
  remainingKm: level === 'red' ? -100 : 500,
  sinceServiceKm: 4000,
  lastServiceAt: '2026-08-01T00:00:00.000Z',
  lastServiceVisitId: `visit-${code}`,
  ...o,
});

/** The whole board, in one call, exactly as the endpoint answers it. */
const BOARD: FleetMaintenanceAlarmDto[] = [
  alarm('150', 'red'),
  alarm('151', 'yellow'),
  alarm('152', 'none'),
];

const client = (board: FleetMaintenanceAlarmDto[] = BOARD): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The ONLY key the screen may read. Nothing seeds a vehicle registry: if the page went looking
  // for one, its options would come back empty and the selection tests would fail.
  qc.setQueryData(['fleet', 'odometer', 'alarms'], board);
  return qc;
};

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: { id: 'u1', permissions: { 'fleetOdometer.view': 'organization' } } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const render = ({ route = '/fleet/maintenance-alarms', qc = client() } = {}): string =>
  renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <MaintenanceAlarmsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);
const tbody = (markup: string): string =>
  markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tbody>'));
const bar = (markup: string): string => markup.slice(0, markup.indexOf('<table'));

/** The vehicle codes the table is showing, in row order. */
const shown = (markup: string): string[] =>
  [...tbody(markup).matchAll(/<span class="font-mono text-xs" dir="ltr">([^<]*)<\/span>/g)].map(
    (m) => m[1] as string,
  );

/** Every closed `MultiSelect` trigger in the bar, as `aria-label` → visible text. */
const triggers = (markup: string): Record<string, string> =>
  Object.fromEntries(
    [
      ...bar(markup).matchAll(
        /aria-haspopup="listbox"[^>]*aria-label="([^"]*)"[\s\S]*?<span[^>]*>([^<]*)<\/span>/g,
      ),
    ].map((m) => [m[1] as string, m[2] as string]),
  );

/**
 * The source of ONE `MultiSelect` in the filter bar, found by the label it carries.
 *
 * Props are not readable from the closed markup a node test can render, so the props that decide
 * how the OPEN panel behaves are asserted here instead — scoped to one picker, so a claim about
 * the cars can never be satisfied by the alarms beside them.
 */
/** One control's markup out of the filter bar — `tag` opens it, `label` identifies which one. */
const pickerSource = (label: string, tag = '<MultiSelect'): string => {
  const bar = SOURCE.slice(SOURCE.indexOf('<FilterBar'), SOURCE.indexOf('</FilterBar>'));
  const at = bar.indexOf(label);
  expect(at, `a picker labelled ${label}`).toBeGreaterThan(-1);
  return bar.slice(bar.lastIndexOf(tag, at), bar.indexOf('/>', at) + 2);
};

const VEHICLE = t('fleet.odometer.columns.vehicle');
const ALARMS = 'كل الإنذارات';

// ── 1. Both filters take more than one answer ───────────────────────────────

describe('the alarms filter bar', () => {
  it('offers exactly two filters, and neither is a single-value select', () => {
    const markup = render();
    expect(Object.keys(triggers(markup))).toEqual([VEHICLE, ALARMS]);
    // The old bar asked each question one answer at a time. A `<select>` in this bar would mean
    // one of them still does.
    expect(bar(markup), 'no single-value select survives').not.toContain('<select');
  });

  it('asks «كل الإنذارات», not «كل المستويات»', () => {
    const markup = render();
    expect(t('fleet.alarms.allAlarms')).toBe(ALARMS);
    expect(triggers(markup)[ALARMS], 'the empty trigger asks the question').toBe(ALARMS);
    expect(bar(markup)).not.toContain('كل المستويات');
  });

  it('names EVERY chosen car in the vehicle trigger, not just a count', () => {
    const markup = render({ route: '/fleet/maintenance-alarms?vehicleCodes=150,151' });
    expect(triggers(markup)[VEHICLE]).toBe('150, 151');
  });

  it('holds more than one alarm level at once', () => {
    const markup = render({ route: '/fleet/maintenance-alarms?level=red,yellow' });
    // The level filter counts rather than names — a three-word vocabulary is legible as a count,
    // and that is how every other short-vocabulary bar in the system reads.
    expect(bar(markup), 'the trigger still asks the question').toContain(ALARMS);
    expect(bar(markup), 'and says how many are set').toMatch(/>2<\/span>/);
  });

  it('offers the alarm levels the board reports, and invents none', () => {
    // Read from the source: a closed dropdown renders no options, and the point of this test is
    // that the vocabulary was not extended.
    const options = [...SOURCE.matchAll(/\{ value: '(red|yellow|none|[a-z]+)', label: t\(/g)].map(
      (m) => m[1],
    );
    expect(options).toEqual(['red', 'yellow', 'none']);
  });
});

// ── 2. OR inside a filter, AND across them ──────────────────────────────────

describe('what the filters keep', () => {
  it('keeps every row when nothing is chosen', () => {
    expect(shown(render())).toEqual(['150', '151', '152']);
  });

  it('ORs the chosen vehicles: code ∈ selected', () => {
    const markup = render({ route: '/fleet/maintenance-alarms?vehicleCodes=150,152' });
    expect(shown(markup)).toEqual(['150', '152']);
  });

  it('ORs the chosen levels: level ∈ selected', () => {
    const markup = render({ route: '/fleet/maintenance-alarms?level=red,yellow' });
    expect(shown(markup)).toEqual(['150', '151']);
  });

  it('ANDs the two filters together', () => {
    // (150 OR 151) AND (red OR yellow) — 152 fails the vehicle test, and a red car outside the
    // chosen pair would fail it too.
    const markup = render({
      route: '/fleet/maintenance-alarms?vehicleCodes=150,151,152&level=red,yellow',
    });
    expect(shown(markup)).toEqual(['150', '151']);

    const narrow = render({ route: '/fleet/maintenance-alarms?vehicleCodes=152&level=red,yellow' });
    expect(shown(narrow), 'the quiet car is not red or yellow, so nothing survives').toEqual([]);
  });

  it('still reads a bookmarked single value the way it always did', () => {
    expect(shown(render({ route: '/fleet/maintenance-alarms?level=red' }))).toEqual(['150']);
  });

  it('sorts red first and most-overdue first, whatever the filter', () => {
    const board = [
      alarm('9', 'yellow'),
      alarm('8', 'red', { remainingKm: -50 }),
      alarm('7', 'red', { remainingKm: -900 }),
    ];
    expect(shown(render({ qc: client(board) }))).toEqual(['7', '8', '9']);
  });
});

// ── 3. Where the options come from ──────────────────────────────────────────

describe('the vehicle options', () => {
  it('come from the BOARD, not from a second call to the registry', () => {
    // Nothing seeds a vehicle-registry key in this suite, so a trigger that can still name every
    // car proves the options were read off the board the screen already holds.
    expect(SOURCE, 'no registry hook').not.toContain('useVehicles');
    expect(shown(render())).toEqual(['150', '151', '152']);
  });

  it('keeps a chosen code the board no longer reports, so the filter can be unset', () => {
    const markup = render({ route: '/fleet/maintenance-alarms?vehicleCodes=999' });
    expect(triggers(markup)[VEHICLE], 'still named in the trigger').toBe('999');
    expect(shown(markup), 'and it matches nothing on the board').toEqual([]);
  });
});

// ── 4. A selection assembled across SEVERAL searches ────────────────────────

describe('searching the car picker', () => {
  // A fleet outgrows a dropdown, so the picker carries a search box and the reader narrows to a
  // handful, ticks them, narrows to a different handful, and ticks those too. The property that
  // makes that work is that the search only decides what is VISIBLE: the selection lives in the
  // URL, above the component, so nothing the search does can drop it.
  //
  // The interaction itself needs a DOM and is verified in a browser. What a node test can hold is
  // the contract underneath it — and that contract is what a future change would break.

  const BIG: FleetMaintenanceAlarmDto[] = [
    alarm('150', 'red'),
    alarm('151', 'yellow'),
    alarm('152', 'red'),
    alarm('153', 'none'),
    alarm('161', 'yellow'),
    alarm('165', 'red'),
    alarm('166', 'none'),
    alarm('170', 'yellow'),
    alarm('171', 'none'),
    alarm('172', 'red'),
  ];

  it('keeps a selection assembled from TWO different searches', () => {
    // «15» → tick 150 and 152; «16» → tick 161 and 165. This is the end state that produces, and
    // all four have to survive into the trigger, the URL round-trip and the table.
    const markup = render({
      route: '/fleet/maintenance-alarms?vehicleCodes=150,152,161,165',
      qc: client(BIG),
    });
    expect(triggers(markup)[VEHICLE], 'the first two are named, the tail counted').toBe(
      '150, 152 +2',
    );
    expect(shown(markup)).toEqual(['150', '152', '165', '161']);
  });

  it('narrows nothing itself — the search box is the component’s, over the WHOLE board', () => {
    // If the page ever handed the picker a slice, or took the search over from it, typing would
    // quietly answer "which of these few" instead of "which car". Both are guarded here because
    // neither is visible from the closed trigger a node test can read.
    const picker = pickerSource('<VehicleCodeFilter', '<VehicleCodeFilter');
    expect(picker, 'the options are the board').toContain('options={vehicleOptions}');
    // This screen passes its own options, so the shared control skips the registry search that
    // the other five use — see `VehicleCodeFilter`, where `remote` is false without them.
    expect(picker, 'the component does its own searching').not.toContain('onSearch');
    expect(SOURCE, 'the board is never trimmed before it becomes options').not.toMatch(
      /alarmsQuery\.data[\s\S]{0,80}\.slice\(/,
    );
  });

  it('keeps its search box even when the board reports FEWER than seven cars', () => {
    // `MultiSelect` shows the box at `options.length >= searchThreshold`, and its default of 7 is
    // right for a fixed vocabulary — a handful of statuses is read, not searched. A fleet is not
    // that: its length is whatever the board reports today, and a control that grows a search box
    // on Tuesday and loses it on Wednesday teaches nobody where to type.
    //
    // Two halves, both checkable, and the rule they compose is `length >= 0`, which always holds:
    // Asked for once, in the control every screen shares, rather than screen by screen.
    const control = readFileSync(join(HERE, 'components/VehicleCodeFilter.tsx'), 'utf8');
    expect(control, 'the box is unconditional').toContain('searchThreshold={0}');

    const small = [alarm('150', 'red'), alarm('151', 'yellow'), alarm('152', 'none')];
    expect(alarmVehicleOptions(small, []).length, 'a board too small for the default').toBeLessThan(
      7,
    );
    expect(shown(render({ qc: client(small) })), 'and the screen still works').toEqual([
      '150',
      '151',
      '152',
    ]);
  });

  it('leaves the ALARM picker on the component default — this is one screen’s car list, not a rule', () => {
    // Three levels are read at a glance. Forcing a search box onto them would be noise, and it
    // would also mean the change had leaked out of the filter it was meant for.
    expect(pickerSource("t('fleet.alarms.allAlarms')")).not.toContain('searchThreshold');
  });

  it('offers every car on the board, so the search has all of them to find', () => {
    // Read through the table rather than the closed dropdown: the options are built from the same
    // board the rows come from, so a full table is a full option list.
    expect(shown(render({ qc: client(BIG) }))).toHaveLength(BIG.length);
  });

  it('cannot lose a chosen car by changing the search, because the URL holds it', () => {
    // The selection is a URL parameter read on every render — not component state the search can
    // reset. Re-rendering with the same route from a different board proves the selection is not
    // derived from what happens to be visible.
    const route = '/fleet/maintenance-alarms?vehicleCodes=150,161';
    expect(triggers(render({ route, qc: client(BIG) }))[VEHICLE]).toBe('150, 161');
    // Even against a board that reports neither of them, both are still named and un-tickable.
    expect(triggers(render({ route, qc: client([alarm('900', 'red')]) }))[VEHICLE]).toBe(
      '150, 161',
    );
  });
});

// ── 5. The board is still fetched whole ─────────────────────────────────────

describe('the request', () => {
  it('carries no filter at all — the narrowing is the in-memory projection it always was', () => {
    const api = readFileSync(join(HERE, 'api/fleet-api.ts'), 'utf8');
    const line = api.slice(api.indexOf('listMaintenanceAlarms'));
    expect(line.slice(0, line.indexOf(';'))).toContain(`'/fleet/odometer/alarms'`);
    expect(line.slice(0, line.indexOf(';')), 'no query string is built').not.toContain(
      'buildQuery',
    );
    // And the page asks for the board once, without parameters of its own.
    expect(SOURCE).toContain('useMaintenanceAlarms()');
  });
});
