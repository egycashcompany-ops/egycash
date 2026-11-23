// «الطقم الثابت» — the screen and its computer board, in the look of «تعيين السيارات» («واعمل ديزاين
// شاشة الطاقم الثابت زى التعيين اليومى»), minus the day.
//
// The risk of a twin is in the difference: a day that crept back in (a stepper, «يوم سابق», an
// availability word), a page header that came back or a second Excel control (the owner had the
// header removed at every width on 22 November, reversing answer 2 ج; ONE Excel per width), a flag
// on a standing member who can no longer drive (answer 1 ب: none), a workshop lock copied from the
// day, a save that writes without being asked. Each is
// asserted directly. The phone and tablet board has its own spec (`fleet-fixed-roster-touch.spec`);
// the board model's behaviour (undo, swap, transfer, counters, the payload) is
// `lib/fixed-roster-model.spec.ts`, the refusal line `lib/fixed-save-refusal.spec.ts`, the rules
// `lib/fixed-roster-board.spec.ts`.
//
// The web suite runs with `environment: 'node'` and no DOM, so nothing is clicked or dragged here:
// the page is rendered with `renderToStaticMarkup` (no window → the computer's board), a restored
// draft comes from a stubbed `sessionStorage`, and the wiring between a control and the model is
// read out of the source (`fixedSource`, comments stripped).
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
  SaveFleetFixedRosterSchema,
  type FleetFixedCrewRowDto,
  type FleetFixedRosterDto,
  type FleetPersonDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { resolveNavIcon } from '../../platform/navigation/app-icon';
import { pluralKey } from '../../shared/lib/plural';
import { FixedRosterPage } from './pages/FixedRosterPage';
import { CrewCandidates, FixedCrewDialog } from './components/roster/FixedCrewDialog';
import { applyEdit, changedRows } from './lib/fixed-roster-board';
import { FIXED_ROSTER_DRAFT_KEY } from './lib/draft-storage';
import { KNOWN_REASONS } from './lib/roster-board';
import { COUNTER_TONES } from './lib/roster-view';
import { fixedSource } from './fixed-roster-spec-sources';
import { rosterSource } from './roster-spec-sources';

// The shared `Dialog` draws through a portal, which a static render cannot. Here it draws in
// place, and only while open — exactly what the pen dialog's markup claims need.
vi.mock('../../shared/ui/Dialog', async () => {
  const { createElement } = await import('react');
  return {
    Dialog: (props: {
      open: boolean;
      title: string;
      description?: string;
      footer?: unknown;
      children?: unknown;
    }) =>
      props.open
        ? createElement(
            'div',
            { role: 'dialog', 'data-dialog-title': props.title },
            createElement('h2', null, props.title),
            props.description === undefined ? null : createElement('p', null, props.description),
            props.children as never,
            createElement('footer', null, props.footer as never),
          )
        : null,
  };
});

/** Real 24-hex ids: the save payload is parsed with the REAL schema, which demands ObjectIds. */
const V1 = '650000000000000000000001';
const V2 = '650000000000000000000002';
const V3 = '650000000000000000000003';
/** A car of another branch (or out of service): not on this board. */
const AWAY = '650000000000000000000099';
const E1 = '650000000000000000000011';
const E2 = '650000000000000000000012';
const E3 = '650000000000000000000013';
const E4 = '650000000000000000000014';
const E5 = '650000000000000000000015';
const E6 = '650000000000000000000016';
const MT = '650000000000000000000021';
const OLD_MT = '650000000000000000000022';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(join(HERE, path), 'utf8');
const strip = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** The whole screen as CODE: the shell, the model, the computer's board, the touch board. */
const SCREEN = fixedSource(['shell', 'model', 'desk', 'touch']);
const SHELL = fixedSource(['shell']);
const MODEL = fixedSource(['model']);
const DESK = fixedSource(['desk']);
const BOARD_FILE = strip(read('components/roster/FixedDeskBoard.tsx'));
const DIALOG = strip(read('components/roster/FixedCrewDialog.tsx'));
const PANEL = strip(read('components/roster/FixedDriversPanel.tsx'));
const CELLS = strip(read('components/roster/fixed-desk-cells.tsx'));
/** The daily board on a computer, as code — what must still be there. */
const DAILY_DESK = rosterSource(['desk']);

const row = (
  vehicleId: string,
  code: string,
  over: Partial<FleetFixedCrewRowDto> = {},
): FleetFixedCrewRowDto => ({
  vehicleId,
  code,
  plateNumber: `س ص ${code}`,
  typeId: 'vt1',
  inMaintenance: false,
  missionTypeId: null,
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  notes: null,
  ...over,
});

const NOTE = 'تُسلَّم المفاتيح لمشرف الوردية قبل الثامنة صباحًا، ولا تخرج السيارة إلا بإذن مكتوب.';

/**
 * 150: a full crew, a mission, a note. 151: nobody. 152: the WORKSHOP holds it — and it still
 * has its standing crew, both seats. E4 is fixed to a car that is not on this board; E6 is free.
 */
const BOARD: FleetFixedRosterDto = {
  rows: [
    row(V1, '150', {
      driver1EmployeeId: E1,
      driver2EmployeeId: E2,
      missionTypeId: MT,
      notes: NOTE,
    }),
    row(V2, '151'),
    row(V3, '152', { inMaintenance: true, driver1EmployeeId: E3, driver2EmployeeId: E5 }),
  ],
  drivers: [
    { employeeId: E1, assignedVehicleId: V1 },
    { employeeId: E2, assignedVehicleId: V1 },
    { employeeId: E3, assignedVehicleId: V3 },
    { employeeId: E5, assignedVehicleId: V3 },
    { employeeId: E4, assignedVehicleId: AWAY },
    { employeeId: E6, assignedVehicleId: null },
  ],
};

const PEOPLE: readonly (readonly [string, string, string])[] = [
  [E1, 'HR-1', 'أحمد محمد'],
  [E2, 'HR-2', 'محمد محمود'],
  [E3, 'HR-3', 'خالد علي'],
  [E4, 'HR-4', 'سعيد حسن'],
  [E5, 'HR-5', 'عمرو حسين'],
  [E6, 'HR-6', 'ياسر فتحي'],
];
const person = (employeeId: string, code: string, fullNameAr: string): FleetPersonDto => ({
  employeeId,
  code,
  fullNameAr,
  status: 'active',
  branchId: null,
  address: null,
  governorate: null,
  phone: null,
  hiredAt: null,
});
const PERSONS = new Map(PEOPLE.map(([id, code, name]) => [id, person(id, code, name)]));

const ALL = ['fleetRoster.view', 'fleetRoster.plan', 'fleetDriver.view'];
const VIEWER = ['fleetRoster.view', 'fleetDriver.view'];

const client = (board: FleetFixedRosterDto = BOARD): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['fleet', 'fixed-roster'], board);
  // The REAL `missionType` catalog key, in the shape `useFleetCatalog('missionType')` reads — the
  // same catalog the daily roster's mission column reads. One live mission, one archived.
  qc.setQueryData(['fleet', 'catalogs', 'list', { kind: 'missionType' }], {
    items: [
      { id: MT, kind: 'missionType', name: { ar: 'نقل نقدية', en: 'Cash run' }, isActive: true },
      {
        id: OLD_MT,
        kind: 'missionType',
        name: { ar: 'مهمة قديمة', en: 'Old run' },
        isActive: false,
      },
    ],
    meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
  });
  // FLEET's own people list — one key for the whole roster, every name on the screen.
  qc.setQueryData(['fleet', 'people'], [...PERSONS.values()]);
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

const render = ({
  permissions = ALL,
  route = '/fleet/fixed-roster',
  qc = client(),
}: { permissions?: string[]; route?: string; qc?: QueryClient } = {}): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <FixedRosterPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

/** The screen with a draft left in the tab's storage by an earlier visit (a reload). */
const renderRestored = (
  stored: FleetFixedCrewRowDto[],
  options: { permissions?: string[]; route?: string } = {},
): string => {
  const box = new Map([[FIXED_ROSTER_DRAFT_KEY, JSON.stringify(stored)]]);
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (k: string) => box.get(k) ?? null,
      setItem: (k: string, v: string) => void box.set(k, v),
      removeItem: (k: string) => void box.delete(k),
    },
  });
  try {
    return render(options);
  } finally {
    vi.unstubAllGlobals();
  }
};

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

/** The table body — where the cars and their crews live. */
const tbody = (markup: string): string =>
  markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tbody>'));
/** The header cells, in document order. */
const headers = (markup: string): string[] =>
  [
    ...markup
      .slice(markup.indexOf('<thead'), markup.indexOf('</thead>'))
      .matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g),
  ].map((m) => (m[1] as string).replace(/<[^>]*>/g, '').trim());
/** One car's row. */
const carRow = (markup: string, code: string): string => {
  const at = markup.indexOf(`data-car="${code}"`);
  if (at === -1) return '';
  return markup.slice(markup.lastIndexOf('<tr', at), markup.indexOf('</tr>', at));
};
/** The opening tag of a car's row. */
const rowTag = (markup: string, code: string): string => {
  const at = markup.indexOf(`data-car="${code}"`);
  return markup.slice(markup.lastIndexOf('<tr', at), markup.indexOf('>', at) + 1);
};
/** The codes of the rows drawn, in order. */
const drawnCodes = (markup: string): string[] =>
  [...tbody(markup).matchAll(/<tr[^>]*data-car="([^"]*)"/g)].map((m) => m[1] as string);
/** Every value of a data attribute, in document order. */
const all = (markup: string, attribute: string): string[] =>
  [...markup.matchAll(new RegExp(`${attribute}="([^"]*)"`, 'g'))].map((m) => m[1] as string);
/** One seat's zone, up to the seat's end. */
const seatOf = (markup: string, vehicleId: string, slot: 1 | 2): string => {
  const at = markup.indexOf(`data-drop-zone="${vehicleId}:driver${String(slot)}EmployeeId"`);
  if (at === -1) return '';
  return markup.slice(at, markup.indexOf('</div></div>', at));
};
/** The drivers panel. */
const panel = (markup: string): string => {
  const at = markup.indexOf('data-fixed-drivers="true"');
  return markup.slice(at, markup.indexOf('</aside>', at));
};
/** Whether the button carrying `marker` is disabled. */
const buttonDisabled = (markup: string, marker: string): boolean => {
  const at = markup.indexOf(marker);
  if (at === -1) throw new Error(`no button marked ${marker}`);
  const tag = markup.slice(markup.lastIndexOf('<button', at), markup.indexOf('>', at) + 1);
  return / disabled=""/.test(tag) || / disabled>/.test(tag);
};
/** A counter chip's opening tag. */
const chip = (markup: string, key: string): string => {
  const at = markup.indexOf(`data-counter="${key}"`);
  return markup.slice(markup.lastIndexOf('<button', at), markup.indexOf('>', at) + 1);
};
const count = (markup: string, needle: string): number => markup.split(needle).length - 1;

// ── 1. No page header, one Excel, no day ─────────────────────────────────────────────────────────

describe('the screen: no page header, one Excel, no day (owner, 22 November)', () => {
  it('draws NO page header — no breadcrumbs, no visible title, no divider', () => {
    const markup = render();
    expect(SHELL, 'the shell draws no PageHeader').not.toContain('PageHeader');
    expect(markup, 'no breadcrumbs: no link to «الحركة»').not.toContain('href="/fleet"');
    expect(markup, 'nor its trail').not.toContain('aria-label="breadcrumb"');
    expect(markup, 'nor the word «الحركة»').not.toContain(`>${t('fleet.module.title')}<`);
    // The one title left is for a screen reader: «الطقم الثابت», visually hidden.
    expect(count(markup, '<h1'), 'one h1 on the page').toBe(1);
    const h1 = markup.slice(markup.indexOf('<h1'), markup.indexOf('</h1>'));
    expect(h1, 'visually hidden').toContain('class="sr-only"');
    expect(h1).toContain(t('fleet.nav.fixedRoster'));
    expect(count(markup, t('fleet.nav.fixedRoster')), 'and nowhere else on the page').toBe(1);
  });

  it('opens on the toolbar row — the car count and the Excel pill are the first thing drawn', () => {
    const markup = render();
    const board = markup.indexOf('data-fixed-desk="true"');
    expect(board, 'the board').toBeGreaterThan(-1);
    expect(markup.indexOf('</h1>'), 'the hidden title before the board').toBeLessThan(board);
    const before = markup.slice(markup.indexOf('</h1>') + '</h1>'.length, board);
    expect(before, 'nothing visible between the hidden title and the board').not.toMatch(
      />[^<\s]/u,
    );
    const first = markup.slice(board);
    expect(
      first.indexOf('data-fixed-toolbar="true"'),
      'the toolbar row opens the board',
    ).toBeLessThan(first.indexOf('data-fixed-filters="true"'));
    expect(SHELL).toContain('<PageContainer fullHeight>');
  });

  it('keeps the Excel pill in the toolbar row — the screen’s one Excel control', () => {
    expect(SCREEN, 'the old header button is gone').not.toContain('ExportSheetButton');
    const markup = render();
    expect(all(markup, 'data-export'), 'ONE Excel control, the screen’s own hook').toEqual([
      'fixed-roster',
    ]);
    const toolbar = markup.slice(
      markup.indexOf('data-fixed-toolbar="true"'),
      markup.indexOf('data-fixed-filters="true"'),
    );
    expect(toolbar, 'beside the car count').toContain('data-export="fixed-roster"');
    expect(toolbar).toContain('data-filtered-count');
    expect(toolbar, '«تصدير» and the word Excel, as the daily pill').toContain(
      t('fleet.fuelCards.board.excel'),
    );
  });

  it('exports the table as drawn — the rows on screen, in their order', () => {
    expect(BOARD_FILE).toContain(
      '<ExcelPill name="fixed-roster" onExport={() => m.actions.exportSheet(rows)} />',
    );
  });

  it('has NO day — no stepper, no date box, no «يوم سابق», no day word', () => {
    const markup = render();
    expect(markup).not.toContain('data-day-stepper="');
    expect(markup).not.toContain('type="date"');
    expect(markup).not.toContain('data-readonly-day="');
    for (const key of [
      'fleet.roster.date',
      'fleet.roster.prevDay',
      'fleet.roster.nextDay',
      'fleet.roster.pastDayTitle',
      'fleet.dash.common.today',
    ]) {
      expect(markup, key).not.toContain(t(key));
    }
    // …and nothing in any of the screen's files reaches for one.
    for (const word of [
      'DeskDayStepper',
      'PastDayBanner',
      'weekdayOf',
      'slashDate',
      'shiftDay',
      'useRosterDay',
      'rosterDraftKey',
      'type="date"',
    ]) {
      expect(SCREEN, word).not.toContain(word);
    }
  });

  it('borrows the daily board’s pieces rather than copying it — and leaves the day’s behind', () => {
    for (const piece of [
      'SeatCell',
      'DeskCounters',
      'ExcelPill',
      'EditsBar',
      'ROSTER_TABLE',
      'MISSION_BOX',
      'useOverflowing',
      'AvailableList',
      'DriverSearch',
      'DriversHeading',
    ]) {
      expect(DESK, piece).toContain(piece);
    }
    for (const day of [
      'RosterAssignDialog',
      'DriverTabs',
      'UnavailableList',
      'CatalogMultiSelect',
      'DriverChip',
      'vehicleColour',
    ]) {
      expect(DESK, day).not.toContain(day);
    }
    expect(DESK, 'the daily board is not drawn').not.toMatch(/<RosterDeskBoard\b/);
    expect(DESK, 'nor its two-tab panel').not.toMatch(/\bDriversPanel\b/);
    expect(DESK, 'no page container of its own — the shell draws it').not.toContain(
      'PageContainer',
    );
  });
});

describe('the states — loading, no car at all, filtered to nothing', () => {
  it('says nothing while the board loads: no count, no empty line in the panel', () => {
    const qc = client();
    qc.removeQueries({ queryKey: ['fleet', 'fixed-roster'] });
    const markup = render({ qc });
    const at = markup.indexOf('data-filtered-count');
    expect(markup.slice(markup.indexOf('>', at) + 1, markup.indexOf('</span>', at))).toBe('');
    expect(panel(markup)).not.toContain(t('fleet.fixedRoster.poolEmpty'));
    expect(markup).not.toContain('data-car="');
    expect(markup, 'and no unsaved bar').not.toContain('data-edits-bar="');
  });

  it('says «لا توجد سيارات» for a board with no car', () => {
    const markup = render({ qc: client({ rows: [], drivers: [] }) });
    expect(tbody(markup)).toContain(t('fleet.fixedRoster.noVehicles'));
  });

  it('leaves the table’s own empty line when the filters hide every car', () => {
    const markup = render({ route: '/fleet/fixed-roster?q=999' });
    expect(drawnCodes(markup)).toEqual([]);
    expect(tbody(markup)).not.toContain(t('fleet.fixedRoster.noVehicles'));
    expect(tbody(markup)).toContain(t('common.empty.title'));
  });
});

// ── 2. The toolbar's count ──────────────────────────────────────────────────────────────────────

describe('the car count under the title — Arabic’s own plural', () => {
  const sized = (n: number): FleetFixedRosterDto => ({
    rows: Array.from({ length: n }, (_, i) =>
      row(`6500000000000000000001${String(i).padStart(2, '0')}`, String(200 + i)),
    ),
    drivers: [],
  });
  const filteredCount = (markup: string): string => {
    const at = markup.indexOf('data-filtered-count');
    return markup.slice(markup.indexOf('>', at) + 1, markup.indexOf('</span>', at));
  };

  it.each([1, 2, 3, 10, 11, 100])('%i cars read as their own form', (n) => {
    const markup = render({ qc: client(sized(n)) });
    expect(filteredCount(markup)).toBe(
      t(pluralKey('fleet.fixedRoster.carCount', 'ar', n), { count: String(n) }),
    );
  });

  it('counts what the filters leave, and says so on hover', () => {
    const markup = render({ route: '/fleet/fixed-roster?q=150' });
    expect(filteredCount(markup)).toBe(t(pluralKey('fleet.fixedRoster.carCount', 'ar', 1)));
    const at = markup.indexOf('data-filtered-count');
    const tag = markup.slice(markup.lastIndexOf('<span', at), markup.indexOf('>', at));
    expect(tag).toContain('role="status"');
    expect(tag).toContain(`title="${t('fleet.fixedRoster.matchedRows')}"`);
  });

  it('is this screen’s own words — the daily board keeps «20 سيارة» as it was', () => {
    expect(BOARD_FILE).toContain("pluralKey('fleet.fixedRoster.carCount', locale, rows.length)");
    expect(BOARD_FILE).toContain("t('fleet.fixedRoster.matchedRows')");
    expect(BOARD_FILE).not.toContain('fleet.vehicles.count');
    expect(DAILY_DESK, 'the daily count is untouched').toContain(
      "t('fleet.vehicles.count', { count: num(rows.length) })",
    );
  });

  it('reads as approved in Arabic — the five forms, no Latin letter (green after the i18n merge)', () => {
    expect(t('fleet.fixedRoster.carCount.one')).toBe('سيارة واحدة');
    expect(t('fleet.fixedRoster.carCount.two')).toBe('سيارتان');
    expect(t('fleet.fixedRoster.carCount.few', { count: 3 })).toBe('3 سيارات');
    expect(t('fleet.fixedRoster.carCount.many', { count: 11 })).toBe('11 سيارة');
    expect(t('fleet.fixedRoster.carCount.other', { count: 100 })).toBe('100 سيارة');
    expect(t('fleet.fixedRoster.matchedRows')).toBe('عدد الصفوف بعد عوامل التصفية');
    for (const form of ['one', 'two', 'few', 'many', 'other']) {
      // As a reader sees it — the placeholder filled (its own name is not a word on screen).
      expect(t(`fleet.fixedRoster.carCount.${form}`, { count: 7 })).not.toMatch(/[A-Za-z{}]/);
      expect(translate('en', `fleet.fixedRoster.carCount.${form}`)).not.toBe(
        `fleet.fixedRoster.carCount.${form}`,
      );
    }
  });
});

// ── 3. The filter bar ───────────────────────────────────────────────────────────────────────────

describe('the filter bar — «كود السيارة», the counters, the reset; no «كل المهمات»', () => {
  it('has no «كل المهمات» dropdown — the mission chips are its control', () => {
    const markup = render();
    expect(markup).not.toContain(t('fleet.roster.allMissions'));
    expect(DESK).not.toContain('CatalogMultiSelect');
    expect(BOARD_FILE, 'the code filter in its icon box, the daily width').toContain(
      'className="w-48 shrink-0 lg:[&&]:!w-48 lg:[&&]:!flex-none"',
    );
    expect(BOARD_FILE).toContain('<VehicleCodeFilter');
    expect(BOARD_FILE).toContain('<DeskCounters counters={m.counters} onApply={patch} />');
  });

  it('counts the whole board in the daily chips — «بلا طقم» yellow, rose for the workshop alone', () => {
    const markup = render();
    expect(all(markup, 'data-counter')).toEqual(['total', 'workshop', 'crewed', 'uncrewed', MT]);
    expect(chip(markup, 'uncrewed'), '«بلا طقم» wears the daily «بلا سائق» yellow').toContain(
      COUNTER_TONES.unmanned,
    );
    expect(chip(markup, 'uncrewed')).not.toContain('rose');
    expect(chip(markup, 'workshop')).toContain(COUNTER_TONES.workshop);
    expect(chip(markup, 'crewed')).toContain(COUNTER_TONES.assigned);
    expect(chip(markup, 'total'), 'nothing narrows: «إجمالي» is the one applied').toContain(
      'aria-pressed="true"',
    );
    const figures = (key: string): string => {
      const at = markup.indexOf(`data-counter="${key}"`);
      return markup.slice(at, markup.indexOf('</button>', at)).replace(/<[^>]*>/g, '');
    };
    expect(figures('total')).toContain('3');
    expect(figures('workshop')).toContain('1');
    expect(figures('crewed')).toContain('2');
    expect(figures('uncrewed')).toContain('1');
    expect(figures(MT)).toContain('1');
  });

  it('narrows by the picked code, the view and the mission — and the counters never move', () => {
    expect(drawnCodes(render())).toEqual(['150', '151', '152']);
    expect(drawnCodes(render({ route: '/fleet/fixed-roster?q=150' }))).toEqual(['150']);
    expect(drawnCodes(render({ route: '/fleet/fixed-roster?view=uncrewed' }))).toEqual(['151']);
    expect(drawnCodes(render({ route: '/fleet/fixed-roster?view=workshop' }))).toEqual(['152']);
    expect(drawnCodes(render({ route: '/fleet/fixed-roster?view=crewed' }))).toEqual([
      '150',
      '152',
    ]);
    expect(drawnCodes(render({ route: `/fleet/fixed-roster?mission=${MT}` }))).toEqual(['150']);
    const narrowed = render({ route: '/fleet/fixed-roster?q=150' });
    const at = narrowed.indexOf('data-counter="total"');
    expect(narrowed.slice(at, narrowed.indexOf('</button>', at))).toContain('3');
  });

  it('offers the red reset only while something narrows the board', () => {
    const reset = `aria-label="${t('common.filters.clear')}"`;
    const clean = render();
    expect(!clean.includes(reset) || buttonDisabled(clean, reset), 'nothing to reset').toBe(true);
    const filtered = render({ route: '/fleet/fixed-roster?view=uncrewed' });
    expect(buttonDisabled(filtered, reset)).toBe(false);
    expect(BOARD_FILE).toContain(
      '<FilterBar hasActiveFilters={m.filtered} onClear={resetFilters}>',
    );
    expect(SHELL).toContain('patch({ q: null, mission: null, view: null })');
  });
});

// ── 4. The table ────────────────────────────────────────────────────────────────────────────────

describe('the table — the daily board’s seven columns, the standing crew’s facts', () => {
  it('reads السيارة · الحالة · نوع المهمة · the two seats · ملاحظات · إجراءات', () => {
    expect(headers(render())).toEqual([
      t('fleet.odometer.columns.vehicle'),
      t('fleet.vehicles.columns.status'),
      t('fleet.roster.fields.mission'),
      t('fleet.odometer.fields.driver1'),
      t('fleet.odometer.fields.driver2'),
      t('fleet.attendance.fields.notes'),
      t('fleet.vehicles.columns.actions'),
    ]);
  });

  it('names each car by its code in bold, with no colour of its own and the car card on hover', () => {
    expect(BOARD_FILE).toMatch(
      /<VehicleHoverCode\s+vehicleId=\{row\.vehicleId\}\s+code=\{row\.code\}\s+focusable=\{false\}/u,
    );
    expect(BOARD_FILE).toContain("className={cn('text-sm font-bold', FIGURE)}");
    expect(SCREEN, 'the per-car colour is retired').not.toMatch(/vehicleColour|vehicle-colour/);
    const vehicle = BOARD_FILE.slice(
      BOARD_FILE.indexOf("key: 'vehicle',"),
      BOARD_FILE.indexOf("key: 'state',"),
    );
    expect(vehicle).toContain('sortable: true');
    expect(vehicle).toContain("sortKey: 'code'");
    expect(
      BOARD_FILE.slice(BOARD_FILE.indexOf("key: 'state',"), BOARD_FILE.indexOf("key: 'mission',")),
    ).toContain('sortable: true');
  });

  it('says the state in badges — «في الورشة» over «معيّنة» / «بلا طقم»', () => {
    const markup = render();
    const state = (code: string): string => {
      const at = carRow(markup, code).indexOf('data-status-cell');
      const cell = carRow(markup, code).slice(at);
      return cell.slice(0, cell.indexOf('</td>')).replace(/<[^>]*>/g, '|');
    };
    expect(state('150')).toContain(t('fleet.roster.assigned'));
    expect(state('150')).not.toContain(t('fleet.vehicles.inWorkshop'));
    expect(state('151')).toContain(t('fleet.fixedRoster.unassigned'));
    expect(state('152')).toContain(t('fleet.vehicles.inWorkshop'));
    expect(state('152')).toContain(t('fleet.roster.assigned'));
    expect(state('152').indexOf(t('fleet.vehicles.inWorkshop')), 'the workshop first').toBeLessThan(
      state('152').indexOf(t('fleet.roster.assigned')),
    );
  });

  it('tints the workshop row rose — and keeps its standing crew editable', () => {
    const markup = render();
    expect(rowTag(markup, '152')).toContain('data-tint="workshop"');
    expect(rowTag(markup, '150')).not.toContain('data-tint');
    const workshop = carRow(markup, '152');
    // The mission select: offered and NOT disabled — the day's lock is not a standing crew's.
    const select = workshop.slice(
      workshop.indexOf('<select'),
      workshop.indexOf('>', workshop.indexOf('<select')),
    );
    expect(select).toContain(`152 · ${t('fleet.roster.fields.mission')}`);
    expect(select).not.toMatch(/ disabled=""/);
    // The seats are ordinary seats: no «في الورشة — غير قابلة للتعيين», nothing refused.
    expect(workshop).not.toContain(t('fleet.roster.inWorkshopNoDrop'));
    expect(workshop).not.toContain('data-seat-state="workshop"');
    expect(workshop).not.toContain('data-drop-disabled="maintenance"');
    expect(seatOf(markup, V3, 1)).toContain('data-seat-state="filled"');
    expect(seatOf(markup, V3, 1)).toContain('data-seat-bin');
    // …and the row's actions are all there: the pen, the swap, the bin.
    expect(workshop).toContain('data-edit-row="152"');
    expect(workshop).toContain(`data-swap-drivers="${V3}"`);
    expect(workshop).toContain('data-clear-crew="152"');
    expect(BOARD_FILE, 'no workshop guard on the mission').not.toContain(
      'disabled={row.inMaintenance}',
    );
  });

  it('edits the mission in the cell, on the missionType catalog — never workType', () => {
    const markup = render();
    expect(carRow(markup, '150')).toContain(`150 · ${t('fleet.roster.fields.mission')}`);
    expect(carRow(markup, '150')).toContain('نقل نقدية');
    const mission = BOARD_FILE.slice(
      BOARD_FILE.indexOf("key: 'mission',"),
      BOARD_FILE.indexOf("key: 'driver1',"),
    );
    expect(mission).toContain('kind="missionType"');
    expect(SCREEN).not.toContain('workType');
    expect(mission, 'cleared is null').toContain(
      "m.actions.mission(row.vehicleId, id === '' ? null : id)",
    );
    expect(mission, 'the row’s drag handling never sees the select').toContain(
      'onMouseDown={(event) => event.stopPropagation()}',
    );
    expect(mission).toContain("allLabel={t('fleet.fixedRoster.noMissionType')}");
  });

  it('cuts a long mission with «…» and hovers its whole name — the box’s width unchanged', () => {
    const LONG = 'نقل أموال (يومي) بين الفروع والبنوك';
    const qc = client();
    qc.setQueryData(['fleet', 'catalogs', 'list', { kind: 'missionType' }], {
      items: [{ id: MT, kind: 'missionType', name: { ar: LONG, en: 'Cash run' }, isActive: true }],
      meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });
    const select = (markup: string, code: string): string => {
      const row_ = carRow(markup, code);
      const at = row_.indexOf('<select');
      return row_.slice(at, row_.indexOf('>', at) + 1);
    };
    for (const [markup, name] of [
      [render(), 'نقل نقدية'],
      [render({ qc }), LONG],
    ] as const) {
      expect(select(markup, '150'), 'the hover is the chosen mission’s name').toContain(
        `title="${name}"`,
      );
      expect(select(markup, '150'), 'and still says what the box is for').toContain(
        `aria-label="150 · ${t('fleet.roster.fields.mission')}"`,
      );
      expect(select(markup, '150')).not.toContain(
        `title="150 · ${t('fleet.roster.fields.mission')}"`,
      );
      // No mission chosen: nothing to hover but what the box is for.
      expect(select(markup, '151')).toContain(`title="151 · ${t('fleet.roster.fields.mission')}"`);
      const box = carRow(markup, '150').slice(0, carRow(markup, '150').indexOf('<select'));
      const boxClass = box.slice(box.lastIndexOf('<div class="mx-auto')).replaceAll('&amp;', '&');
      expect(boxClass, 'the shared box, cutting with «…»').toContain('[&_select]:!truncate');
      expect(boxClass, 'at the widths it had').toContain('mx-auto w-[9.5rem] max-[1535px]:w-36 ');
    }
    expect(BOARD_FILE).toContain('title={missionTitle(m.missionName, row.missionTypeId)}');
  });

  it('draws each seat as the daily seat — the name, the code under it', () => {
    const markup = render();
    const seat = seatOf(markup, V1, 1);
    expect(seat).toContain('أحمد محمد');
    expect(seat).toContain('HR-1');
    expect(seat.indexOf('أحمد محمد'), 'the code under the name').toBeLessThan(seat.indexOf('HR-1'));
    expect(seat).toContain('data-seat-bin="true"');
    expect(seat, 'draggable for a planner').toContain('draggable="true"');
    // An empty first seat: the dashed drop zone and «+ اختيار سائق» over the free drivers.
    expect(seatOf(markup, V2, 1)).toContain('data-seat-state="empty"');
    expect(seatOf(markup, V2, 1)).toContain(`data-driver-picker="${V2}:driver1EmployeeId"`);
    // A second seat with no first: not a target, and it says why.
    expect(seatOf(markup, V2, 2)).not.toContain('data-driver-picker');
    expect(seatOf(markup, V2, 2)).toContain(t('fleet.fixedRoster.needsFirstDriver'));
    expect(BOARD_FILE, 'the seat is the daily SeatCell over the standing row').toContain(
      'row={toSeatRow(row)}',
    );
    expect(BOARD_FILE, 'it offers the FREE drivers').toContain('pool={m.pool}');
    expect(BOARD_FILE, 'and says the fixed empty line').toContain('emptyLabel={poolEmpty}');
  });

  it('lets a seat’s name take a second line under 1366px — the whole table fits a 1280 screen (told 21)', () => {
    // Measured in the browser at 1280×800 with two 24-letter names in one row: 899px of table in
    // an 858px frame before, 858 in 858 with this (review L2). The daily seat is unchanged.
    expect(BOARD_FILE).toContain('nameClassName={FIXED_SEAT_NAME}');
    expect(CELLS).toContain(
      "FIXED_SEAT_NAME =\n  'max-[1365px]:whitespace-normal max-[1365px]:break-words max-[1365px]:[text-wrap:balance]';",
    );
    expect(tbody(render()), 'drawn on the seat’s name').toContain('max-[1365px]:whitespace-normal');
    expect(DAILY_DESK, 'the daily seat says nothing of it').not.toContain('max-[1365px]:');
  });

  it('promises the move in place — «سيُنقل من السيارة 150 عند الحفظ»', () => {
    // E1 moved from 150 to 151 in a draft left by an earlier visit.
    const markup = renderRestored([
      { ...BOARD.rows[0]!, driver1EmployeeId: E2, driver2EmployeeId: null },
      { ...BOARD.rows[1]!, driver1EmployeeId: E1 },
      BOARD.rows[2]!,
    ]);
    const seat = seatOf(markup, V2, 1);
    expect(seat).toContain('أحمد محمد');
    expect(seat).toContain('data-transfer-hint="150"');
    expect(seat).toContain(t('fleet.roster.transferHint', { code: '150' }));
    expect(seatOf(markup, V1, 1), 'the seat he stays in promises nothing').not.toContain(
      'data-transfer-hint',
    );
  });

  it('shows a note in three lines at most, the whole of it on hover', () => {
    const markup = render();
    const at = carRow(markup, '150').indexOf('data-fixed-note');
    const tag = carRow(markup, '150').slice(
      carRow(markup, '150').lastIndexOf('<span', at),
      carRow(markup, '150').indexOf('>', at),
    );
    expect(tag).toContain('line-clamp-3');
    expect(tag).toContain(`title="${NOTE}"`);
    expect(tag, 'the clamp is not undone by a display class').not.toMatch(/\bblock\b/);
    expect(tag).not.toContain('truncate');
    expect(CELLS).toContain('max-w-[8rem]');
  });

  it('offers the pen on EVERY row, the swap only on a pair, the bin only with a driver', () => {
    const markup = render();
    expect(all(markup, 'data-edit-row')).toEqual(['150', '151', '152']);
    expect(all(markup, 'data-swap-drivers'), 'both seats filled — the workshop too').toEqual([
      V1,
      V3,
    ]);
    expect(all(markup, 'data-clear-crew')).toEqual(['150', '152']);
    expect(markup).toContain(`aria-label="${t('fleet.roster.swapDrivers')}"`);
    expect(markup).toContain(`aria-label="${t('fleet.fixedRoster.clearCrew')}"`);
    expect(BOARD_FILE).toContain('data-row-actions="fixed-roster"');
    expect(BOARD_FILE, 'pinned, as the daily column').toContain(
      'className: cn(PINNED_CELL, overflowing && PINNED_EDGE)',
    );
  });

  it('swaps and empties through the model — «إفراغ الطقم» at once, with no question', () => {
    expect(BOARD_FILE).toContain('onClick={() => m.actions.swap(row.vehicleId)}');
    expect(BOARD_FILE).toContain('onClick={() => m.actions.clearCrew(row.vehicleId)}');
    expect(BOARD_FILE, 'no clear confirm').not.toContain('data-confirm="clear"');
    expect(DESK).not.toContain('clearBody');
    expect(DESK).not.toContain('clearAll');
    expect(BOARD_FILE, 'a drop is the model’s assign').toContain(
      'm.actions.assign({ vehicleId, slot }, employeeId)',
    );
    expect(BOARD_FILE).toContain(
      'onClear={(target, which) => m.actions.clear(target.vehicleId, which)}',
    );
  });
});

// ── 5. Answer 1 (ب): no flag on a standing member ───────────────────────────────────────────────

describe('no flag on a standing member who can no longer drive (answer 1 ب)', () => {
  it('draws no availability, licence or profile flag anywhere on the screen', () => {
    for (const markup of [render(), render({ permissions: VIEWER })]) {
      for (const hook of [
        'data-problem',
        'data-driver-out',
        'data-driver-licence',
        'data-roster-flag',
        'data-licence-footer',
        'data-licence-expired-panel',
        'data-unavailable-driver',
      ]) {
        // As an attribute: the table's classes name some of these hooks to style them.
        expect(markup, hook).not.toContain(`${hook}="`);
      }
      expect(markup, 'no «متاح» beside a driver').not.toContain(`>${t('fleet.roster.free')}<`);
      expect(markup).not.toContain(t('fleet.roster.licenceExpired'));
      expect(markup).not.toContain(t('fleet.roster.availableTitle'));
      expect(markup).not.toContain(t('fleet.roster.unavailableTitle'));
      for (const reason of KNOWN_REASONS) {
        expect(markup, reason).not.toContain(t(`fleet.roster.reason.${reason}`));
      }
    }
  });

  it('tells every seat that nobody is flagged', () => {
    expect(CELLS).toContain('expired: NO_FLAGS');
    expect(CELLS).toContain('unavailable: NO_REASONS');
    expect(BOARD_FILE).toContain('const facts = fixedSeatFacts(m);');
    expect(SCREEN, 'no new server fact is read').not.toMatch(
      /\.licenceExpired|profileActive|unavailableDrivers|unavailableReason/,
    );
  });
});

// ── 6. The drivers panel ────────────────────────────────────────────────────────────────────────

describe('the drivers panel — one list under «السائقون (n)»', () => {
  it('heads the list in the tabs’ place, n = the drivers with no standing crew', () => {
    const markup = panel(render());
    expect(markup).toContain('data-drivers-heading');
    const heading = markup.slice(markup.indexOf('data-drivers-heading'), markup.indexOf('</h2>'));
    expect(heading).toContain(t('fleet.fixedRoster.driversTitle'));
    // E6 alone: E4 is held on a car off the board and is listed apart, not counted.
    expect(heading.replace(/<[^>]*>/g, '')).toContain('(1)');
    expect(markup, 'nothing to switch to').not.toContain('role="tablist"');
    expect(markup).not.toContain('role="tab"');
    expect(PANEL).toContain('count={m.pool.length}');
  });

  it('lists the free drivers first, draggable, with no word beside them', () => {
    const markup = panel(render());
    expect(all(markup, 'data-driver-card'), 'the free driver, and him alone').toEqual([E6]);
    const at = markup.indexOf(`data-driver-card="${E6}"`);
    const free = markup.slice(markup.lastIndexOf('<', at), markup.indexOf('</li>', at));
    expect(free).toContain('ياسر فتحي');
    expect(free).toContain('HR-6');
    expect(free).toContain('draggable="true"');
    expect(free, 'no badge on a free driver').not.toContain(
      'inline-flex items-center rounded-full',
    );
  });

  it('lists a driver held on a car off this board under «معيّنون على سيارات أخرى», blue «سيارة أخرى»', () => {
    const markup = panel(render());
    const other = markup.slice(markup.indexOf('data-on-other-vehicles'));
    expect(other).toContain(t('fleet.roster.onOtherVehicles'));
    expect(all(other, 'data-seated-driver')).toEqual([E4]);
    const at = other.indexOf(`data-seated-driver="${E4}"`);
    const held = other.slice(at, other.indexOf('</li>', at));
    expect(held).toContain('سعيد حسن');
    expect(held).toContain(t('fleet.roster.otherVehicle'));
    expect(held, 'the daily blue, not the old amber').toContain('bg-sky-100');
    expect(held).not.toContain('bg-amber');
    expect(held, 'the daily seated-row rule: not a drag source').not.toContain('draggable');
    // The drivers this board seats are on their seats, not in the panel.
    for (const seated of [E1, E2, E3, E5]) expect(markup).not.toContain(seated);
  });

  it('says «لا يوجد سائقون بلا طقم ثابت» when every driver has a standing crew', () => {
    const crewed: FleetFixedRosterDto = {
      rows: [row(V1, '150', { driver1EmployeeId: E1 })],
      drivers: [{ employeeId: E1, assignedVehicleId: V1 }],
    };
    const markup = panel(render({ qc: client(crewed) }));
    expect(markup).toContain(t('fleet.fixedRoster.poolEmpty'));
    expect(markup).not.toContain(t('fleet.roster.availableEmpty'));
    const none = panel(render({ qc: client({ rows: [row(V1, '150')], drivers: [] }) }));
    expect(none).toContain(t('fleet.fixedRoster.poolEmpty'));
    expect(PANEL).toContain("emptyLabel={t('fleet.fixedRoster.poolEmpty')}");
    expect(PANEL).toContain('freeBadge={false}');
  });

  it('searches by name or code in its own box, and offers the driver card on a name', () => {
    const markup = panel(render());
    expect(markup).toContain(`placeholder="${t('fleet.fixedRoster.driverSearchPlaceholder')}`);
    expect(PANEL).toContain('options={m.availableFor(term, null)}');
    expect(PANEL).toContain('hoverCard');
    expect(PANEL).toContain('part="list"');
    expect(PANEL).toContain('licence={null}');
  });

  it('sits beside the table at the daily widths', () => {
    expect(BOARD_FILE).toContain(
      'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem] gap-3 max-[1535px]:grid-cols-[minmax(0,1fr)_18.25rem] max-[1439px]:gap-2 min-[1750px]:grid-cols-[minmax(0,1fr)_24rem] min-[1750px]:gap-4',
    );
  });
});

// ── 7. The unsaved bar ──────────────────────────────────────────────────────────────────────────

describe('the unsaved bar — «حفظ» / «إلغاء» at the foot, only while there is something to save', () => {
  /** 151 given a note and 152 a mission, in a draft left by an earlier visit. */
  const EDITED = [
    BOARD.rows[0]!,
    { ...BOARD.rows[1]!, notes: 'تغيير' },
    { ...BOARD.rows[2]!, missionTypeId: MT },
  ];

  it('is not there on a board nobody has touched', () => {
    const markup = render();
    expect(markup).not.toContain('data-edits-bar="');
    expect(markup).not.toContain('data-save-roster="');
    expect(markup, 'no tint either').not.toContain('data-tint="unsaved"');
  });

  it('comes back with a restored draft: the edited codes, «تراجع» off, «إلغاء» and «حفظ» live', () => {
    const markup = renderRestored(EDITED);
    expect(markup).toContain('data-edits-bar="true"');
    expect(markup).toContain('data-edits-count="2"');
    const bar = markup.slice(markup.indexOf('data-edits-bar'));
    expect(bar).toContain(t('fleet.roster.editedCars'));
    expect(bar).toContain('151');
    expect(bar).toContain('152');
    expect(buttonDisabled(markup, 'data-undo-edit'), 'a reload starts the steps again').toBe(true);
    expect(buttonDisabled(markup, 'data-discard-edits')).toBe(false);
    expect(buttonDisabled(markup, 'data-save-roster')).toBe(false);
    // The edited rows are amber — over the workshop's rose on 152.
    expect(rowTag(markup, '151')).toContain('data-tint="unsaved"');
    expect(rowTag(markup, '152')).toContain('data-tint="unsaved"');
    expect(rowTag(markup, '150')).not.toContain('data-tint="unsaved"');
  });

  it('is never shown to a reader who may not plan', () => {
    const markup = renderRestored(EDITED, { permissions: VIEWER });
    expect(markup).not.toContain('data-edits-bar="');
    // The draft in the tab is still drawn, as the daily board draws it — and says it is unsaved.
    expect(rowTag(markup, '151')).toContain('data-tint="unsaved"');
  });

  it('is wired to the model — undo, discard (asking first for more than one car), save', () => {
    expect(BOARD_FILE).toContain('mayPlan && m.dirty && (');
    expect(BOARD_FILE).toContain('undoable={m.undoDepth > 0}');
    expect(BOARD_FILE).toContain('onUndo={m.actions.undo}');
    expect(BOARD_FILE).toContain('shape="floating"');
    expect(BOARD_FILE).toContain('if (m.changed.length > 1) setAskDiscard(true);');
    expect(BOARD_FILE).toContain("title={t('fleet.roster.discardAll')}");
    expect(BOARD_FILE).toContain('<CodeList');
    expect(BOARD_FILE).toContain('void m.actions.save();');
    // A code in the bar brings its car back: only the filters that hide it are lifted.
    expect(BOARD_FILE).toContain(
      'patch(fixedFiltersHiding(row, { search: query.search, missions, view }));',
    );
    expect(BOARD_FILE).toContain('tr[data-car="${CSS.escape(code)}"]');
  });
});

// ── 8. Permissions ──────────────────────────────────────────────────────────────────────────────

describe('a reader without fleetRoster.plan reads the board and changes nothing', () => {
  it('gets no «إجراءات», no picker, nothing to drag, no bin, the mission as text', () => {
    const markup = render({ permissions: VIEWER });
    expect(headers(markup)).not.toContain(t('fleet.vehicles.columns.actions'));
    expect(markup).not.toContain('data-row-actions="');
    expect(markup).not.toContain('data-driver-picker="');
    expect(markup).not.toContain('draggable="true"');
    expect(markup).not.toContain('data-seat-bin="');
    expect(tbody(markup), 'no control in the rows').not.toContain('<select');
    expect(carRow(markup, '150'), 'the mission by name').toContain('نقل نقدية');
    expect(seatOf(markup, V2, 1), 'an empty seat says so').toContain(
      t('fleet.fixedRoster.noDriver'),
    );
    expect(seatOf(markup, V1, 1), 'a filled seat still names its driver').toContain('أحمد محمد');
  });

  it('reuses the daily roster’s grant — one flag every affordance reads', () => {
    expect(SHELL).toContain("const mayPlan = can('fleetRoster.plan');");
    expect(SCREEN).not.toContain('fleetFixedRoster');
  });
});

// ── 9. The pen dialog ───────────────────────────────────────────────────────────────────────────

describe('the pen dialog — «تعديل · 150», the four facts together', () => {
  const MODEL_STUB = {
    person: (id: string) => PERSONS.get(id),
    transferFrom: (_employeeId: string, _vehicleId: string): string | null => null,
    dialogCandidates: (_vehicleId: string): string[] => [E6, E1, E2],
  };
  const renderDialog = (
    target: FleetFixedCrewRowDto,
    model: Partial<typeof MODEL_STUB> = {},
  ): string =>
    renderToStaticMarkup(
      <Provider store={store(ALL)}>
        <QueryClientProvider client={client()}>
          <FixedCrewDialog
            row={target}
            m={{ ...MODEL_STUB, ...model }}
            onClose={() => undefined}
            onSave={() => undefined}
          />
        </QueryClientProvider>
      </Provider>,
    );

  it('opens on the car’s CURRENT facts, titled «تعديل · code»', () => {
    const markup = renderDialog(BOARD.rows[0]!);
    expect(markup).toContain(`data-dialog-title="${t('common.edit')} · 150"`);
    expect(markup).toContain(t('fleet.fixedRoster.editHint'));
    expect(markup).toContain(`<option value="${MT}" selected="">`);
    expect(markup).toContain(t('fleet.fixedRoster.noMissionType'));
    expect(markup, 'an archived mission is not offered').not.toContain('مهمة قديمة');
    expect(markup).toMatch(/maxlength="500"/i);
    expect(markup).toContain(NOTE);
    for (const seed of [
      'useState<string | null>(row.missionTypeId)',
      'useState<string | null>(row.driver1EmployeeId)',
      'useState<string | null>(row.driver2EmployeeId)',
      "useState<string>(row.notes ?? '')",
    ]) {
      expect(DIALOG, seed).toContain(seed);
    }
  });

  it('keeps an archived mission already on the car legible', () => {
    const markup = renderDialog({ ...BOARD.rows[1]!, missionTypeId: OLD_MT });
    expect(markup).toContain(`<option value="${OLD_MT}" selected="">`);
    expect(markup).toContain('مهمة قديمة');
  });

  it('draws a chosen seat as the daily dialog: the name, the code beside it with a gap, and ✕', () => {
    const markup = renderDialog(BOARD.rows[0]!);
    expect(count(markup, 'data-crew-seat="filled"')).toBe(2);
    const seat = markup.slice(markup.indexOf('data-crew-seat="filled"'));
    expect(seat).toContain('أحمد محمد');
    expect(seat).toContain('HR-1');
    expect(seat, 'a real gap between name and code').toContain('gap-x-2');
    expect(seat).toContain(`aria-label="${t('common.clear')}"`);
    expect(DIALOG, 'its own face, as approved — not the shared EmployeeName').not.toContain(
      'EmployeeName',
    );
    // The shared renderer keeps a gap of its own now (the owner's 22 November «صلحهم»): the margin
    // on an element in the page's direction, the code isolated inside it — no longer `ms-2` on
    // the left-to-right code, which in Arabic put the gap on the far side.
    const shared = read('components/EmployeeName.tsx');
    expect(shared, 'the shared gap').toContain(
      '<span className="ms-2 font-figures text-xs text-slate-500">\n          <bdi dir="ltr">{person.code}</bdi>',
    );
    expect(shared, 'the old margin on the code is gone').not.toContain(
      '<span className="ms-2 font-figures text-xs text-slate-500" dir="ltr">',
    );
  });

  it('offers «اختيار سائق» on an empty seat — the second waits for the first', () => {
    const markup = renderDialog(BOARD.rows[1]!);
    expect(count(markup, 'data-crew-seat="empty"')).toBe(2);
    expect(markup).toContain(t('fleet.roster.pickDriver'));
    const second = markup.slice(
      markup.lastIndexOf('<button', markup.lastIndexOf('data-crew-seat="empty"')),
    );
    expect(second.slice(0, second.indexOf('>'))).toMatch(/ disabled=""/);
    expect(markup).toContain(t('fleet.fixedRoster.needsFirstDriver'));
    const first = markup.slice(
      markup.lastIndexOf('<button', markup.indexOf('data-crew-seat="empty"')),
    );
    expect(first.slice(0, first.indexOf('>'))).not.toMatch(/ disabled=""/);
    expect(DIALOG).toContain('disabled={driver1 === null}');
  });

  it('promises the move under the seat', () => {
    const markup = renderDialog(BOARD.rows[0]!, {
      transferFrom: (id: string) => (id === E1 ? '214' : null),
    });
    expect(markup).toContain('data-transfer-hint="214"');
    expect(markup).toContain(t('fleet.roster.transferHint', { code: '214' }));
  });

  it('lists the candidates minus the other seat’s pick — a name and a code, no word beside them', () => {
    const markup = renderToStaticMarkup(
      <Provider store={store(ALL)}>
        <CrewCandidates
          model={MODEL_STUB}
          candidates={[E6, E3, E1]}
          exclude={E1}
          onPick={() => undefined}
        />
      </Provider>,
    );
    expect(all(markup, 'data-crew-candidate')).toEqual([E6, E3]);
    expect(markup).not.toContain(t('fleet.roster.otherVehicle'));
    expect(markup, 'no badge at all').not.toContain('rounded-full');
    expect(markup).not.toContain(`>${t('fleet.roster.free')}<`);
    const empty = renderToStaticMarkup(
      <Provider store={store(ALL)}>
        <CrewCandidates
          model={MODEL_STUB}
          candidates={[E1]}
          exclude={E1}
          onPick={() => undefined}
        />
      </Provider>,
    );
    expect(empty).toContain(t('fleet.fixedRoster.poolEmpty'));
    expect(DIALOG).toContain('const candidates = m.dialogCandidates(row.vehicleId);');
    expect(DIALOG).toContain('exclude={driver2}');
    expect(DIALOG).toContain('exclude={driver1}');
  });

  it('keeps today’s rules: the same person twice is refused, clearing seat 1 promotes seat 2', () => {
    expect(DIALOG).toContain('const sameTwice = driver1 !== null && driver1 === driver2;');
    expect(DIALOG).toContain('disabled={sameTwice}');
    expect(DIALOG).toContain("t('fleet.fixedRoster.sameDriverTwice')");
    expect(DIALOG).toMatch(
      /if \(id === null && driver2 !== null\) \{\s*setDriver1\(driver2\);\s*setDriver2\(null\);/,
    );
    expect(DIALOG).toContain("notes: notes.trim() === '' ? null : notes.trim()");
    expect(
      SaveFleetFixedRosterSchema.safeParse({ rows: [{ vehicleId: V1, notes: '' }] }).success,
      'the contract refuses an empty note',
    ).toBe(false);
  });

  it('fills the mission from the REAL catalog in ONE select, with its loading, empty and failed lines', () => {
    expect(DIALOG).toContain("useFleetCatalog('missionType')");
    expect(DIALOG).toContain('missionTypes.data?.items ?? []');
    expect(DIALOG).toContain('value={item.id}');
    expect(DIALOG).toContain('localized(item.name, locale)');
    expect(DIALOG).toContain('<Select');
    expect(DIALOG).not.toContain('MultiSelect');
    expect(DIALOG).not.toMatch(/\bmultiple\b/);
    expect(DIALOG).toContain('missionTypes.isPending');
    expect(DIALOG).toContain('missionTypes.isError');
    expect(DIALOG).toContain('noMissionTypesYet');
    expect(DIALOG).toContain('e.target.value || null');
  });

  it('CANCEL touches nothing; «حفظ» hands back and the board writes ONE step, only on a change', () => {
    expect(DIALOG, 'no draft of its own to write').not.toContain('setDraft');
    expect(DIALOG).not.toContain('mutate');
    expect(DIALOG, 'it hands back, the board applies').not.toContain('applyEdit(');
    expect(DIALOG).not.toContain('m.actions');
    expect(BOARD_FILE).toContain('onClose={() => setEditing(null)}');
    expect(BOARD_FILE).toContain('if (!same) m.actions.apply(row.vehicleId, values);');
    expect(BOARD_FILE, 'the dialog opens on the draft’s row').toContain(
      'm.draft.find((row) => row.vehicleId === editing)',
    );
    expect(MODEL, 'through the board’s rule').toContain('applyEdit(rows, vehicleId, { ...values');
  });

  it('is offered on every row and opens nothing until the pen is pressed', () => {
    const markup = render();
    expect(markup).not.toContain('role="dialog"');
    expect(markup).toContain(`aria-label="${t('common.edit')}"`);
    expect(t('common.edit')).toBe('تعديل');
  });
});

// ── 10. Saving and the draft ────────────────────────────────────────────────────────────────────

describe('saving — only «حفظ» writes, a refusal keeps the work', () => {
  it('sends only the cars whose facts changed, in the shape the contract accepts', () => {
    const saved = [row(V1, '150', { driver1EmployeeId: E1 }), row(V2, '151')];
    const draft = [row(V1, '150'), row(V2, '151', { driver1EmployeeId: E1 })];
    const rows = changedRows(saved, draft);
    expect(rows).toHaveLength(2);
    expect(SaveFleetFixedRosterSchema.safeParse({ rows }).success).toBe(true);
  });

  it('carries the mission as the catalog ID, and null when cleared', () => {
    const saved = [row(V1, '150'), row(V2, '151')];
    const picked = applyEdit(saved, V1, {
      missionTypeId: MT,
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      notes: null,
    });
    const rows = changedRows(saved, picked);
    expect(rows[0]?.missionTypeId).toBe(MT);
    expect(SaveFleetFixedRosterSchema.safeParse({ rows }).success).toBe(true);
    const cleared = applyEdit(picked, V1, {
      missionTypeId: null,
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      notes: null,
    });
    const back = changedRows(picked, cleared);
    expect(back[0]?.missionTypeId).toBeNull();
    expect(SaveFleetFixedRosterSchema.safeParse({ rows: back }).success).toBe(true);
  });

  it('refuses a payload with one person in both seats, or one driver in two crews', () => {
    expect(
      SaveFleetFixedRosterSchema.safeParse({
        rows: [{ vehicleId: V1, driver1EmployeeId: E1, driver2EmployeeId: E1 }],
      }).success,
    ).toBe(false);
    expect(
      SaveFleetFixedRosterSchema.safeParse({
        rows: [
          { vehicleId: V1, driver1EmployeeId: E1 },
          { vehicleId: V2, driver1EmployeeId: E1 },
        ],
      }).success,
    ).toBe(false);
  });

  it('writes in one place — the model’s save — and drops the draft only once the server took it', () => {
    expect(SCREEN.match(/mutateAsync/g) ?? [], 'one caller').toHaveLength(1);
    const commit = MODEL.slice(MODEL.indexOf('const commit'), MODEL.indexOf('const exportSheet'));
    expect(commit.indexOf('mutateAsync')).toBeLessThan(commit.indexOf('acceptDraft()'));
    const refusal = commit.slice(commit.indexOf('catch'));
    expect(refusal, 'a refusal keeps the draft').not.toContain('acceptDraft');
    expect(refusal).not.toContain('discard(');
    expect(refusal, 'and says why, in Arabic').toContain('toast.error(');
    expect(refusal).toContain('fixedSaveRefusal(');
  });

  it('does NOT re-read the board when the save is refused', () => {
    const QUERIES = read('api/fleet-queries.ts');
    const at = QUERIES.indexOf('export const useSaveFixedRoster');
    const hook = QUERIES.slice(at, QUERIES.indexOf('\n};', at));
    expect(hook).toMatch(/onError:/);
    const onError = hook.slice(hook.indexOf('onError:'));
    for (const reread of ['invalidateQueries', 'setQueryData', 'refetch', 'resetQueries']) {
      expect(onError, reread).not.toContain(reread);
    }
  });

  it('keys the draft with NO DATE — one standing board, one draft', () => {
    expect(MODEL).toContain('useDraftBoard(FIXED_ROSTER_DRAFT_KEY, saved, ROSTER_EDITABLE_FIELDS)');
    const storage = read('lib/draft-storage.ts');
    expect(storage).toContain("FIXED_ROSTER_DRAFT_KEY = 'ecms.fleet.fixedRoster.draft'");
    expect(storage).not.toMatch(/FIXED_ROSTER_DRAFT_KEY = [^\n]*\$\{/);
    expect(MODEL, 'no effect seeds the draft').not.toContain('useEffect');
  });

  it('reaches the server through exactly two functions — read the board, save it — and one catalog', () => {
    const imports = [
      ...SCREEN.matchAll(/import \{([^}]*)\} from '(?:\.\.\/)+api\/fleet-queries';/g),
    ].flatMap((m) =>
      (m[1] as string)
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== ''),
    );
    expect([...new Set(imports)].sort()).toEqual([
      'useFixedRoster',
      'useFleetCatalog',
      'useSaveFixedRoster',
    ]);
    expect(SCREEN, 'no second api module').not.toMatch(/from '(?:\.\.\/)+api\/fleet-api'/);
    expect(SCREEN).not.toMatch(/hr\/|employee-api|driver-api/);
    const api = read('api/fleet-api.ts');
    const from = api.indexOf('export const getFixedRoster');
    const fixed = api.slice(from, api.indexOf('\n\n', from));
    expect(fixed).toContain("get<FleetFixedRosterDto>('/fleet/fixed-roster')");
    expect(fixed).toContain(
      "post<FleetFixedRosterDto & { changedCount: number }>('/fleet/fixed-roster'",
    );
    expect(fixed).not.toMatch(/\bdel</);
  });
});

// ── 11. Navigation ──────────────────────────────────────────────────────────────────────────────

describe('navigation', () => {
  const NAV = readFileSync(join(HERE, '../../../../api/src/seed-navigation.ts'), 'utf8');
  const navRow = (route: string): string => {
    const at = NAV.indexOf(`route: '${route}'`);
    return NAV.slice(NAV.lastIndexOf('{', at), NAV.indexOf('}', at));
  };

  it('registers «الطقم الثابت» as a Fleet application on its real route, with its own icon', () => {
    const fixed = navRow('/fleet/fixed-roster');
    expect(fixed).toContain("ar: 'الطقم الثابت'");
    const name = /(?<!previous)[Ii]con: '([a-z]+)'/.exec(fixed)?.[1] ?? '';
    const SENTINEL = (() => null) as unknown as ReturnType<typeof resolveNavIcon>;
    expect(resolveNavIcon(name, SENTINEL), `icon '${name}'`).not.toBe(SENTINEL);
    expect(navRow('/fleet/drivers')).toContain("icon: 'users'");
    expect(name).not.toBe('users');
  });

  it('reuses the roster grant rather than inventing a permission', () => {
    expect(navRow('/fleet/fixed-roster')).toContain("permission: 'fleetRoster.view'");
    expect(NAV).not.toContain('fleetFixedRoster');
  });

  it('sits beside the daily roster, inside the Fleet category', () => {
    const daily = NAV.indexOf("route: '/fleet/roster'");
    const fixed = NAV.indexOf("route: '/fleet/fixed-roster'");
    expect(fixed).toBeGreaterThan(daily);
    expect(fixed - daily).toBeLessThan(400);
  });
});
