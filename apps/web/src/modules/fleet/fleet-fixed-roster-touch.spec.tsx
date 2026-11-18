// «الطقم الثابت» on a phone and a tablet — the touch board (components/roster/FixedTouchBoard.tsx and
// fixed-touch-parts.tsx) under the page shell, in the look of the daily «تعيين السيارات» touch board
// («واعمل ديزاين شاشة الطاقم الثابت زى التعيين اليومى»), minus the day.
//
// The risk of a twin is in the difference: a day that crept back in (a stepper, a weekday, a date
// under the drivers sheet's title), a second title or a second Excel control (owner's answer 2 ج:
// the page header on top, ONE Excel per width), a flag on a standing member who can no longer drive
// (answer 1 ب: none), the day's workshop lock and workshop group copied over, a «clear» that asks.
// Each is asserted directly, at the phone, the portrait and the landscape tablet, and a short phone.
//
// The web suite runs with `environment: 'node'` and no DOM: the shell is rendered with the layout
// handed in (`FixedRosterScreen layout=…`), a restored draft comes from a stubbed `sessionStorage`,
// and what a finger does (a sheet's content, a tap) is read out of the source (`fixedSource`,
// comments stripped). The sticky rows and the bottom bar were checked in a browser at 390×844,
// 820×1180, 1180×820 and 844×390, light and dark. The board model (undo, swap, transfer, counters,
// the lists, the payload) is `lib/fixed-roster-model.spec.ts`; the computer's board is
// `fleet-fixed-roster.spec.tsx`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type FleetFixedCrewRowDto,
  type FleetFixedRosterDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { FixedRosterScreen } from './pages/FixedRosterPage';
import { FIXED_ROSTER_DRAFT_KEY } from './lib/draft-storage';
import { toCardRow } from './lib/fixed-roster-model';
import { KNOWN_REASONS } from './lib/roster-board';
import { COUNTER_TONES } from './lib/roster-view';
import { type TouchLayout } from './lib/roster-layout';
import {
  NOTE_MAX,
  editTitle,
  fixedCardMenu,
  fixedTouchFacts,
  missionNotice,
} from './components/roster/fixed-touch-parts';
import { fixedSource } from './fixed-roster-spec-sources';

const V1 = '650000000000000000000001';
const V2 = '650000000000000000000002';
const V3 = '650000000000000000000003';
const V4 = '650000000000000000000004';
/** A car NOT on this board — another branch's, or one out of service. */
const V_OFF = '650000000000000000000039';
const E1 = '650000000000000000000011';
const E2 = '650000000000000000000012';
const E3 = '650000000000000000000013';
const E4 = '650000000000000000000014';
const E5 = '650000000000000000000015';
const E6 = '650000000000000000000016';
const E7 = '650000000000000000000017';
const E8 = '650000000000000000000018';
const MT = '650000000000000000000021';

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

/**
 *   152  E3 alone                       (sent first: the server's order is not the cards' order)
 *   150  E1 + E2, on mission MT, a note
 *   153  nobody
 *   151  in the WORKSHOP, E4 + E6, a note — its standing crew stays editable
 * Drivers: E5 held on a car OFF this board; E7 and E8 free.
 */
const ROWS: FleetFixedCrewRowDto[] = [
  row(V3, '152', { driver1EmployeeId: E3 }),
  row(V1, '150', {
    missionTypeId: MT,
    driver1EmployeeId: E1,
    driver2EmployeeId: E2,
    notes: 'الوردية الصباحية',
  }),
  row(V4, '153'),
  row(V2, '151', {
    inMaintenance: true,
    driver1EmployeeId: E4,
    driver2EmployeeId: E6,
    notes: 'تغيير زيت',
  }),
];
const BOARD: FleetFixedRosterDto = {
  rows: ROWS,
  drivers: [
    { employeeId: E1, assignedVehicleId: V1 },
    { employeeId: E2, assignedVehicleId: V1 },
    { employeeId: E3, assignedVehicleId: V3 },
    { employeeId: E4, assignedVehicleId: V2 },
    { employeeId: E5, assignedVehicleId: V_OFF },
    { employeeId: E6, assignedVehicleId: V2 },
    { employeeId: E7, assignedVehicleId: null },
    { employeeId: E8, assignedVehicleId: null },
  ],
};
/** Everybody on a crew: nobody left without one. */
const FULL: FleetFixedRosterDto = {
  rows: [row(V1, '150', { driver1EmployeeId: E1 })],
  drivers: [{ employeeId: E1, assignedVehicleId: V1 }],
};

const PEOPLE: readonly (readonly [string, string, string])[] = [
  [E1, 'أحمد محمد', '11001'],
  [E2, 'محمد محمود', '11002'],
  [E3, 'سعيد سعد', '11003'],
  [E4, 'كريم علي', '11004'],
  [E5, 'عمرو حسن', '11005'],
  [E6, 'ياسر فتحي', '11006'],
  [E7, 'هشام رضا', '11007'],
  [E8, 'أيمن نبيل', '11008'],
];

const client = (board: FleetFixedRosterDto | null = BOARD): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (board !== null) qc.setQueryData(['fleet', 'fixed-roster'], board);
  qc.setQueryData(['fleet', 'catalogs', 'list', { kind: 'missionType' }], {
    items: [
      { id: MT, kind: 'missionType', name: { ar: 'نقل نقدية', en: 'Cash run' }, isActive: true },
    ],
    meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
  });
  qc.setQueryData(
    ['fleet', 'people'],
    PEOPLE.map(([employeeId, fullNameAr, code]) => ({
      employeeId,
      code,
      fullNameAr,
      status: 'active' as const,
      branchId: null,
      address: null,
      governorate: null,
      phone: null,
      hiredAt: null,
    })),
  );
  return qc;
};

const PLANNER = ['fleetRoster.view', 'fleetRoster.plan', 'fleetDriver.view'];
const VIEWER = ['fleetRoster.view', 'fleetDriver.view'];

const store = (permissions: readonly string[]) =>
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
  layout = 'phone' as TouchLayout,
  short = false,
  permissions = PLANNER,
  query = '',
  board = BOARD as FleetFixedRosterDto | null,
  qc = client(board),
}: {
  layout?: TouchLayout;
  short?: boolean;
  permissions?: readonly string[];
  query?: string;
  board?: FleetFixedRosterDto | null;
  qc?: QueryClient;
} = {}): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/fleet/fixed-roster${query === '' ? '' : `?${query}`}`]}>
          <FixedRosterScreen layout={layout} short={short} />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

/** E3 moved from 152 to 153's first seat — two cars edited, as a reload would find them. */
const MOVED: FleetFixedCrewRowDto[] = ROWS.map((r) =>
  r.vehicleId === V3
    ? { ...r, driver1EmployeeId: null }
    : r.vehicleId === V4
      ? { ...r, driver1EmployeeId: E3 }
      : r,
);

/** The screen with a draft left in the tab's storage by an earlier visit (a reload). */
const renderRestored = (
  stored: FleetFixedCrewRowDto[],
  options: Parameters<typeof render>[0] = {},
): string => {
  const box = new Map([[FIXED_ROSTER_DRAFT_KEY, JSON.stringify(stored)]]);
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (k: string) => box.get(k) ?? null,
      setItem: (k: string, v: string) => void box.set(k, v),
      removeItem: (k: string) => void box.delete(k),
    },
  });
  return render(options);
};
afterEach(() => {
  vi.unstubAllGlobals();
});

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

/** The opening tag of the first element carrying `marker`. */
const tagOf = (markup: string, marker: string): string => {
  const at = markup.indexOf(marker);
  if (at === -1) throw new Error(`nothing marked ${marker}`);
  return markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at) + 1);
};
/** Is the button carrying `marker` disabled? (Its class list says `disabled:` either way.) */
const disabled = (markup: string, marker: string): boolean =>
  / disabled=""/u.test(tagOf(markup, marker));
/** One car's card, up to its end. */
const card = (markup: string, code: string): string => {
  const at = markup.indexOf(`data-car="${code}"`);
  if (at === -1) return '';
  return markup.slice(markup.lastIndexOf('<article', at), markup.indexOf('</article>', at));
};
/** The landscape drivers panel. */
const panel = (markup: string): string => {
  const at = markup.indexOf('data-drivers-panel="true"');
  if (at === -1) throw new Error('no drivers panel');
  return markup.slice(at, markup.indexOf('</aside>', at));
};
/** Every value of a data attribute, in document order. */
const all = (markup: string, attribute: string): string[] =>
  [...markup.matchAll(new RegExp(`${attribute}="([^"]*)"`, 'gu'))].map((m) => m[1] as string);
const count = (markup: string, needle: string): number => markup.split(needle).length - 1;
/** A button's markup, from its opening tag to its end. */
const buttonOf = (markup: string, marker: string): string => {
  const at = markup.indexOf(marker);
  if (at === -1) throw new Error(`no button marked ${marker}`);
  return markup.slice(markup.lastIndexOf('<button', at), markup.indexOf('</button>', at));
};

const LAYOUTS = ['phone', 'portrait', 'landscape'] as const;
const TOUCH = fixedSource(['touch']);
const TOUCH_RAW = fixedSource(['touch'], { raw: true });

// ── 1. no day ────────────────────────────────────────────────────────────────────────────────────

describe('no day — the standing crew is a fact about a car', () => {
  const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  it.each([...LAYOUTS, 'short'] as const)('%s: no stepper, no date box, no weekday', (which) => {
    const html =
      which === 'short' ? render({ layout: 'portrait', short: true }) : render({ layout: which });
    expect(html).toContain('data-fixed-touch=');
    expect(html).not.toContain('data-day-stepper');
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('data-go-today');
    expect(html).not.toContain('data-readonly-day');
    expect(html).not.toMatch(/\d{4}\/\d{2}\/\d{2}/u);
    for (const day of WEEKDAYS) expect(html, day).not.toContain(day);
    expect(html).not.toContain(t('fleet.roster.prevDay'));
    expect(html).not.toContain(t('fleet.roster.nextDay'));
    expect(html).not.toContain(t('fleet.roster.pastDayTitle'));
  });

  it('draws none of the day’s pieces, nor reads a day', () => {
    for (const piece of [
      'DayStepper',
      'PastDayBanner',
      'weekdayOf',
      'slashDate',
      'shiftDay',
      'useRosterDay',
      'rosterDraftKey',
      'WorkshopGroup',
      'DriverTabs',
      'UnavailableList',
      'query.date',
      'editable',
    ]) {
      expect(TOUCH, piece).not.toContain(piece);
    }
  });

  it('the drivers sheet has a title and no date under it', () => {
    const sheet = TOUCH.slice(
      TOUCH.indexOf('name="pool"'),
      TOUCH.indexOf('toolbar=', TOUCH.indexOf('name="pool"')),
    );
    expect(sheet).toContain("title={t('fleet.fixedRoster.driversTitle')}");
    expect(sheet).not.toContain('subtitle');
  });
});

// ── 2. one title, one Excel (answer 2 ج) ─────────────────────────────────────────────────────────

describe('one title and one Excel control per width (owner’s answer 2 ج)', () => {
  it.each(LAYOUTS)(
    '%s: the page header’s «الطقم الثابت» is the only h1, above the board',
    (layout) => {
      const html = render({ layout });
      expect(count(html, '<h1')).toBe(1);
      const h1 = html.indexOf('<h1');
      expect(html.slice(h1, html.indexOf('</h1>', h1))).toContain(t('fleet.nav.fixedRoster'));
      expect(h1).toBeLessThan(html.indexOf('data-fixed-touch='));
      // The breadcrumbs: «الحركة» → /fleet, then the screen.
      expect(html).toContain('href="/fleet"');
      expect(html).toContain(t('fleet.module.title'));
    },
  );

  it('the board itself draws no title', () => {
    expect(TOUCH).not.toMatch(/<h1\b/u);
    expect(TOUCH).not.toContain('PageHeader');
    expect(TOUCH).not.toContain('ExportSheetButton');
    expect(fixedSource(['shell'])).not.toContain('ExportSheetButton');
  });

  it.each(LAYOUTS)(
    '%s: one Excel button, in the first row, with the screen’s own hook',
    (layout) => {
      const html = render({ layout });
      expect(count(html, 'data-export="fixed-roster"')).toBe(1);
      expect(html).not.toContain('data-export="roster"');
      const first = html.indexOf('data-first-row="true"');
      const excel = html.indexOf('data-export="fixed-roster"');
      expect(first).toBeGreaterThan(-1);
      expect(excel).toBeGreaterThan(first);
      // The first row ends before the filter row begins.
      expect(excel).toBeLessThan(html.indexOf('data-open-filters'));
      expect(html.indexOf('data-car-search')).toBeGreaterThan(first);
      expect(html.indexOf('data-car-search')).toBeLessThan(excel);
    },
  );

  it('exports the cards on show, in the order drawn, and says a failure in Arabic', () => {
    const exporting = TOUCH.slice(TOUCH.indexOf('const exportSheet = ()'));
    expect(exporting.slice(0, 200)).toContain('m.actions.exportSheet(drawn)');
    expect(exporting.slice(0, 300)).toContain('toast.error(errorMessage(error, locale))');
    expect(TOUCH).toContain('<ExcelButton name="fixed-roster" onExport={exportSheet} />');
  });

  it('a reader who cannot plan still has the Excel button', () => {
    expect(count(render({ permissions: VIEWER }), 'data-export="fixed-roster"')).toBe(1);
  });
});

// ── 3. where each layout keeps its rows ──────────────────────────────────────────────────────────

describe('each layout keeps the daily board’s frame, inside the shell’s page container', () => {
  it('phone: the first row scrolls away; only the filter row is sticky; the bar stays at the foot', () => {
    const html = render({ layout: 'phone' });
    expect(html.indexOf('data-first-row')).toBeLessThan(html.indexOf('data-touch-header'));
    const header = tagOf(html, 'data-touch-header');
    expect(header).toContain('data-sticky="filters"');
    expect(header).toMatch(/\bsticky top-0\b/u);
    expect(tagOf(html, 'data-touch-bottom')).toMatch(/\bsticky bottom-0\b/u);
  });

  it('portrait: the first row sits inside the sticky header, above the filter row', () => {
    const html = render({ layout: 'portrait' });
    const header = html.indexOf('data-touch-header');
    expect(tagOf(html, 'data-touch-header')).toContain('data-sticky="header"');
    expect(html.indexOf('data-first-row')).toBeGreaterThan(header);
    expect(html.indexOf('data-open-filters')).toBeGreaterThan(html.indexOf('data-first-row'));
  });

  it('short: nothing on top is sticky; the bottom bar still is', () => {
    const html = render({ layout: 'phone', short: true });
    const header = tagOf(html, 'data-touch-header');
    expect(header).toContain('data-sticky="none"');
    expect(header).not.toMatch(/\bsticky top-0\b/u);
    expect(tagOf(html, 'data-touch-bottom')).toMatch(/\bsticky bottom-0\b/u);
  });

  it('landscape: the split view — the search over the cars, the Excel at the row’s end', () => {
    const html = render({ layout: 'landscape' });
    expect(html).toContain('data-fixed-touch="landscape"');
    expect(html).toContain('data-cars-column="true"');
    expect(html).toContain('data-drivers-panel="true"');
    expect(html).not.toContain('data-touch-header');
    expect(tagOf(html, 'data-car-search')).toContain('w-[20rem]');
    expect(html).not.toContain('data-open-pool');
  });

  it.each(['phone', 'portrait'] as const)(
    '%s: no padding of its own; the sticky header bleeds by the container’s',
    (layout) => {
      const html = render({ layout });
      expect(tagOf(html, 'data-fixed-touch=')).not.toMatch(/\bpx-\d/u);
      expect(tagOf(html, 'data-touch-header')).toContain('-mx-4 px-4 sm:-mx-6 sm:px-6');
      expect(tagOf(html, 'data-touch-bottom')).toContain('-mx-4');
    },
  );

  it('the shell holds the board inside its full-height page container', () => {
    expect(fixedSource(['shell'])).toContain('<PageContainer fullHeight>');
    expect(tagOf(render({ layout: 'landscape' }), 'data-fixed-touch=')).not.toMatch(/\bp[xy]-\d/u);
  });
});

// ── 4. the cards ─────────────────────────────────────────────────────────────────────────────────

describe('one card per car, in code order, the workshop’s car in its place', () => {
  it.each(LAYOUTS)('%s: the cards follow the codes, not the server’s order', (layout) => {
    expect(all(render({ layout }), 'data-car')).toEqual(['150', '151', '152', '153']);
  });

  it('the workshop’s car is not grouped, not locked, and keeps its crew editable', () => {
    const html = render({ layout: 'phone' });
    expect(html).not.toContain('data-workshop-group');
    expect(html).not.toContain('data-workshop-lock');
    const workshop = card(html, '151');
    expect(workshop).not.toContain('data-workshop="true"');
    expect(workshop).toContain(t('fleet.vehicles.inWorkshop'));
    expect(workshop, 'the mission pill is a button').toContain('data-mission="151"');
    expect(workshop).toContain('data-clear-slot="151:1"');
    expect(workshop, 'both seats filled → the swap').toContain(`data-swap-drivers="${V2}"`);
    expect(workshop, 'its note edits').toContain('data-notes-edit="true"');
    expect(workshop).not.toContain(t('fleet.roster.inWorkshopNoDrop'));
    expect(TOUCH).toContain('workshopLock={false}');
    expect(TOUCH).toContain('fixedTouchCars(m.visible, m.draft, carTerm)');
  });

  it('says «معيّنة» or «بلا طقم» on every card — the desk’s «الحالة» words', () => {
    const html = render({ layout: 'portrait' });
    expect(card(html, '150')).toContain(t('fleet.roster.assigned'));
    expect(card(html, '152')).toContain(t('fleet.roster.assigned'));
    expect(card(html, '153')).toContain(t('fleet.fixedRoster.unassigned'));
    expect(card(html, '153')).not.toContain(t('fleet.roster.assigned'));
  });

  it('offers the swap only where both seats are filled (the workshop’s car included)', () => {
    for (const layout of LAYOUTS) {
      expect(all(render({ layout }), 'data-swap-drivers').sort(), layout).toEqual([V1, V2].sort());
    }
  });

  it('a seat waits for the first one: seat 2 of an empty car is not a target', () => {
    const empty = card(render({ layout: 'phone' }), '153');
    expect(empty).toContain('data-slot="153:1" data-slot-state="empty"');
    expect(empty).toContain('data-slot="153:2" data-slot-state="locked"');
    expect(empty).toContain(t('fleet.fixedRoster.needsFirstDriver'));
  });

  it('the ⋮ menu: «تعديل» (the note) and «إفراغ الطقم», the latter only with a driver', () => {
    const menu = fixedCardMenu(t);
    expect(menu.edit).toBe(t('common.edit'));
    expect(menu.clear).toBe(t('fleet.fixedRoster.clearCrew'));
    expect(menu.canClear(toCardRow(row(V1, '150', { driver2EmployeeId: E2 })))).toBe(true);
    expect(menu.canClear(toCardRow(row(V4, '153', { missionTypeId: MT, notes: 'x' })))).toBe(false);
    // Every card has a ⋮ for a planner: the note is always editable.
    expect(all(render({ layout: 'phone' }), 'data-card-menu')).toEqual([
      '150',
      '151',
      '152',
      '153',
    ]);
    expect(TOUCH).toContain('menu={menu}');
    expect(TOUCH).toContain('const menu = fixedCardMenu(t);');
  });

  it('«إفراغ الطقم» acts at once — no question, the mission and the note kept', () => {
    const clearing = TOUCH.slice(TOUCH.indexOf('onClearAll:'));
    expect(clearing.slice(0, 120)).toContain('m.actions.clearCrew(row.vehicleId)');
    expect(TOUCH).not.toContain('name="clear"');
    expect(TOUCH).not.toContain("t('fleet.roster.clearBody')");
  });

  it('the mission pill and the note open their own sheets — ⋮ «تعديل» is the note alone', () => {
    expect(TOUCH).toContain('onMission: (row) => setMissionFor(row)');
    expect(TOUCH).toContain('onEditNotes: (row) => setNotesFor(row)');
  });

  it('every card wears the standing crew’s badges, not the day’s', () => {
    expect(card(render({ layout: 'phone' }), '151')).toContain('data-fixed-badges="true"');
  });

  it('every figure in Latin digits', () => {
    for (const layout of LAYOUTS) expect(render({ layout }), layout).not.toMatch(/[٠-٩]/u);
  });
});

// ── 5. the move, said on the seat ────────────────────────────────────────────────────────────────

describe('a driver moved from another car', () => {
  it('says «سيُنقل من السيارة 152 عند الحفظ» on his new seat until the save', () => {
    const html = renderRestored(MOVED, { layout: 'phone' });
    const moved = card(html, '153');
    expect(moved).toContain('data-transfer-hint="152"');
    expect(moved).toContain(t('fleet.roster.transferHint', { code: '152' }));
    expect(card(html, '152')).not.toContain('data-transfer-hint');
    vi.unstubAllGlobals();
    expect(render({ layout: 'phone' }), 'nothing moved').not.toContain('data-transfer-hint');
  });

  it('the seats are told the model’s move and nobody’s flag (answer 1 ب)', () => {
    const transferFrom = (): string | null => '214';
    const facts = fixedTouchFacts({ transferFrom, person: () => undefined }, true);
    expect(facts.expired.size).toBe(0);
    expect(facts.unavailable.size).toBe(0);
    expect(facts.transferFrom).toBe(transferFrom);
    expect(facts.armed).toBe(true);
    expect(fixedTouchFacts({ transferFrom, person: () => undefined }, false).armed).toBe(false);
  });
});

// ── 6. the drivers ───────────────────────────────────────────────────────────────────────────────

describe('the drivers: one list, no «متاح», the held-off under «معيّنون على سيارات أخرى»', () => {
  it.each(['phone', 'portrait'] as const)(
    '%s: the drivers button is «السائقون», counting the drivers with no crew',
    (layout) => {
      const html = render({ layout });
      const button = buttonOf(html, 'data-open-pool');
      expect(button).toContain(`aria-label="${t('fleet.fixedRoster.driversTitle')}"`);
      expect(button).toContain(`title="${t('fleet.fixedRoster.driversTitle')}"`);
      expect(button).not.toContain(t('fleet.roster.availableTitle'));
      // E7 and E8 — not E5, held on a car off this board.
      expect(button).toMatch(/>2<\/span>$/u);
    },
  );

  it('phone: the drivers button is the icon and the number; portrait adds the word', () => {
    const word = `>${t('fleet.fixedRoster.driversTitle')}</span>`;
    expect(buttonOf(render({ layout: 'phone' }), 'data-open-pool')).not.toContain(word);
    expect(buttonOf(render({ layout: 'portrait' }), 'data-open-pool')).toContain(word);
  });

  it('landscape: «السائقون (n)» in the tabs’ place, the free drivers first, no «متاح»', () => {
    const side = panel(render({ layout: 'landscape' }));
    expect(side).toContain('data-drivers-heading="true"');
    expect(side).toContain(t('fleet.fixedRoster.driversTitle'));
    expect(side).toMatch(/data-drivers-heading="true"[\s\S]*?>2<\/span>/u);
    expect(side).not.toContain('role="tab"');
    expect(side).not.toContain('data-driver-tab');
    expect(all(side, 'data-driver-card')).toEqual([E7, E8]);
    expect(side).not.toContain(`>${t('fleet.roster.free')}<`);
    expect(side, 'the hint for a planner').toContain('data-target-hint="true"');
  });

  it('landscape: the driver held off the board is listed apart, blue «سيارة أخرى», not dragged', () => {
    const side = panel(render({ layout: 'landscape' }));
    const other = side.slice(side.indexOf('data-on-other-vehicles'));
    expect(other).toContain(t('fleet.roster.onOtherVehicles'));
    expect(other).toContain(`data-seated-driver="${E5}"`);
    const held = other.slice(other.indexOf(`data-seated-driver="${E5}"`));
    const end = held.indexOf('</li>');
    expect(held.slice(0, end)).toContain(t('fleet.roster.otherVehicle'));
    expect(held.slice(0, end), 'blue — the info tone').toContain('bg-sky-100');
    expect(held.slice(0, end)).not.toContain('draggable="true"');
    // A free driver is a drag source for a mouse on a planner's tablet.
    expect(tagOf(side, `data-driver-card="${E7}"`)).toContain('draggable="true"');
  });

  it('nobody without a crew: «لا يوجد سائقون بلا طقم ثابت», not the day’s sentence', () => {
    const side = panel(render({ layout: 'landscape', board: FULL }));
    expect(side).toContain(t('fleet.fixedRoster.poolEmpty'));
    expect(side).not.toContain(t('fleet.roster.availableEmpty'));
  });

  it('every list is drawn with no «متاح», the screen’s empty line and no licence block', () => {
    const lists = TOUCH.slice(
      TOUCH.indexOf('<AvailableList'),
      TOUCH.indexOf('/>', TOUCH.indexOf('<AvailableList')),
    );
    expect(lists).toContain('freeBadge={false}');
    expect(lists).toContain("emptyLabel={t('fleet.fixedRoster.poolEmpty')}");
    expect(lists).toContain('licence={null}');
    expect(count(TOUCH, '<AvailableList')).toBe(1);
  });

  it('the picker sheet: the seat’s title, the search alone (no tabs); a pick fills that seat', () => {
    const picker = TOUCH.slice(TOUCH.indexOf('name="picker"'), TOUCH.indexOf('name="pool"'));
    expect(picker).toContain("t('fleet.roster.assignTitle'");
    expect(picker).toContain('toolbar={<DriverSearch value={term} onChange={setTerm} />}');
    expect(picker).toContain('m.actions.assign(picker, employeeId)');
    expect(picker).toContain('occupant:');
  });

  it('the drivers sheet: the hint and the search; a pick chooses the driver first', () => {
    const pool = TOUCH.slice(TOUCH.indexOf('name="pool"'), TOUCH.indexOf('<MissionSheet'));
    expect(pool).toContain("t('fleet.roster.poolHint')");
    expect(pool).toContain('<DriverSearch value={term} onChange={setTerm} />');
    expect(pool).toContain('setPendingDriver(employeeId)');
    expect(pool).toContain('setPoolOpen(false)');
  });

  it('the list a seat is filled from is the model’s, for that seat', () => {
    expect(TOUCH).toContain('m.availableFor(term, fillTarget)');
    expect(TOUCH).toContain("const fillTarget = layout === 'landscape' ? target : picker;");
  });
});

// ── 7. the filters ───────────────────────────────────────────────────────────────────────────────

describe('the filters', () => {
  it('count the whole board, «بلا طقم» in the daily «بلا سائق» yellow', () => {
    const html = render({ layout: 'phone', query: 'view=uncrewed' });
    const total = html.slice(html.indexOf('data-counter="total"'));
    expect(total.slice(0, total.indexOf('</button>'))).toContain('>4</span>');
    expect(tagOf(html, 'data-counter="uncrewed"')).toContain('data-active="true"');
    expect(tagOf(html, 'data-counter="uncrewed"')).toContain(COUNTER_TONES.unmanned);
    expect(tagOf(html, 'data-counter="workshop"')).toContain(COUNTER_TONES.workshop);
    // The view narrows the cards: 153 alone has nobody.
    expect(all(html, 'data-car')).toEqual(['153']);
    expect(html, 'the red reset is lit').toContain('data-reset-filters="true"');
  });

  it('a second tap on the pressed state chip lets it go (the computer’s chip only sets)', () => {
    expect(TOUCH).toContain(
      "counter.active && typeof counter.apply.view === 'string' ? { view: null } : counter.apply",
    );
  });

  it('a mission narrows the cards and the funnel counts it', () => {
    const html = render({ layout: 'portrait', query: `mission=${MT}` });
    expect(all(html, 'data-car')).toEqual(['150']);
    expect(buttonOf(html, 'data-open-filters')).toMatch(/>1<\/span>$/u);
  });

  it('keeps «نوع المهمة» in the filters sheet, with the car codes in code order', () => {
    const sheet = TOUCH.slice(TOUCH.indexOf('<FiltersSheet'), TOUCH.indexOf('<ConfirmSheet'));
    expect(sheet).toContain('missions={m.missionOptions}');
    expect(sheet).toContain('pickedMissions={missions}');
    expect(sheet).toContain('codes={m.codeOptions.map((option) => option.value)}');
    expect(sheet).toContain('results={drawn.length}');
    expect(sheet).toContain('onReset={resetAll}');
  });

  it('the typed code is the board’s own: never in the URL, cleared by the red reset', () => {
    expect(TOUCH).toContain("const [carTerm, setCarTerm] = useState('')");
    expect(TOUCH).not.toMatch(/useSearchParams|useRememberedFilters|sp\.get\(/u);
    for (const write of TOUCH.match(/patch\(\{[^}]*\}\)/gu) ?? []) {
      expect(write).not.toMatch(/carTerm|search:/u);
    }
    const reset = TOUCH.slice(TOUCH.indexOf('const resetAll = ()'));
    expect(reset.indexOf("setCarTerm('')")).toBeGreaterThan(-1);
    expect(reset.indexOf("setCarTerm('')")).toBeLessThan(reset.indexOf('resetFilters()'));
    expect(fixedSource(['shell'])).toContain(
      "const REMEMBERED_FILTERS = ['mission', 'q', 'sort', 'view'] as const;",
    );
  });

  it('a picked code that finds nothing says the filters’ line', () => {
    const html = render({ layout: 'phone', query: 'q=999' });
    expect(all(html, 'data-car')).toEqual([]);
    expect(tagOf(html, 'data-empty=')).toContain('data-empty="filters"');
    expect(html).toContain(t('common.noResults'));
  });
});

// ── 8. the unsaved bar ───────────────────────────────────────────────────────────────────────────

describe('the unsaved bar at the screen’s foot', () => {
  it.each(LAYOUTS)('%s: absent on a clean board', (layout) => {
    expect(render({ layout })).not.toContain('data-edits-bar');
  });

  it.each([
    ['phone', 'phone'],
    ['portrait', 'strip'],
    ['landscape', 'floating'],
  ] as const)('%s: a restored draft shows the %s bar with the edited codes', (layout, shape) => {
    const html = renderRestored(MOVED, { layout });
    expect(html).toContain('data-edits-bar="true"');
    expect(all(html, 'data-edited-code').sort()).toEqual(['152', '153']);
    // A reload keeps the draft, not its history: «تراجع» starts again.
    expect(disabled(html, 'data-undo-edit')).toBe(true);
    expect(disabled(html, 'data-discard-edits')).toBe(false);
    expect(disabled(html, 'data-save-roster')).toBe(false);
    const bar = tagOf(html, 'data-edits-bar');
    if (shape === 'floating') expect(bar).toContain('rounded-2xl');
    else expect(bar).not.toContain('rounded-2xl');
    if (shape === 'strip') expect(bar).toContain('px-6');
    if (shape !== 'floating') {
      expect(html.indexOf('data-edits-bar')).toBeGreaterThan(html.indexOf('data-touch-bottom'));
    }
    expect(card(html, '153')).toContain('data-unsaved="true"');
  });

  it.each(LAYOUTS)('%s: absent for a reader who cannot plan, a draft or not', (layout) => {
    expect(renderRestored(MOVED, { layout, permissions: VIEWER })).not.toContain('data-edits-bar');
  });

  it('«إلغاء» asks first when more than one car is edited', () => {
    const discard = TOUCH.slice(TOUCH.indexOf('const discard = ()'));
    expect(discard.slice(0, 160)).toContain('if (m.changed.length > 1) setAskDiscard(true);');
    expect(TOUCH).toContain('name="discard"');
    expect(TOUCH).toContain('edited={m.dirty}');
    expect(TOUCH).toContain('undoable={m.undoDepth > 0}');
  });

  it('«حفظ» is the model’s; a refusal keeps the draft, the target and the chosen driver', () => {
    const save = TOUCH.slice(TOUCH.indexOf('const save = ()'), TOUCH.indexOf('const discard = ()'));
    expect(save).toContain('m.actions.save().then((stored)');
    expect(save).toContain('if (!stored) return;');
  });
});

// ── 9. who may edit ──────────────────────────────────────────────────────────────────────────────

describe('a reader who cannot plan', () => {
  it.each(LAYOUTS)('%s: sees the crews and changes nothing', (layout) => {
    const html = renderRestored(MOVED, { layout, permissions: VIEWER });
    for (const marker of [
      'data-card-menu',
      'data-clear-slot',
      'data-swap-drivers',
      'data-mission="',
      'draggable="true"',
      'data-pool-hint',
      'data-target-hint',
      'data-notes-edit',
    ]) {
      expect(html, `${layout}: ${marker}`).not.toContain(marker);
    }
    expect(html, 'no seat is a button').not.toMatch(/<button[^>]*data-slot=/u);
    expect(html).not.toContain(t('fleet.roster.pickDriver'));
    expect(html).toContain(t('fleet.fixedRoster.noDriver'));
  });

  it('every edit is gated by the one grant the shell reads', () => {
    expect(fixedSource(['shell'])).toContain("const mayPlan = can('fleetRoster.plan');");
    expect(TOUCH).toContain('const { mayPlan, missions, view, patch } = query;');
  });
});

// ── 10. no flag for a standing member (answer 1 ب) ───────────────────────────────────────────────

describe('no flag for a standing member who can no longer drive (owner’s answer 1 ب)', () => {
  it.each(LAYOUTS)('%s: no flag hook, no reason word, no licence word', (layout) => {
    const html = render({ layout });
    for (const marker of [
      'data-driver-out',
      'data-driver-licence',
      'data-roster-flag',
      'data-problem',
      'data-licence-expired-panel',
      'data-unavailable-driver',
      'data-held-elsewhere',
    ]) {
      expect(html, `${layout}: ${marker}`).not.toContain(marker);
    }
    for (const reason of KNOWN_REASONS) {
      expect(html, reason).not.toContain(t(`fleet.roster.reason.${reason}`));
    }
    expect(html).not.toContain(t('fleet.roster.licenceExpired'));
    expect(html).not.toContain(t('fleet.roster.crewAbsent'));
    expect(html).not.toContain(`>${t('fleet.roster.free')}<`);
  });

  it('reads no availability, licence or reason fact', () => {
    for (const fact of [
      'unavailableFor',
      'm.unavailable',
      'm.expired',
      'm.licence',
      'm.reasonLabel',
      'm.chips',
      'poolLicensed',
      'licenceExpired',
    ]) {
      expect(TOUCH, fact).not.toContain(fact);
    }
  });
});

// ── 11. the small sheets ─────────────────────────────────────────────────────────────────────────

describe('the mission and note sheets', () => {
  it('take «تعديل · {code}» — the pen dialog’s idiom', () => {
    expect(editTitle(t, '150')).toBe(`${t('common.edit')} · 150`);
    const mission = TOUCH.slice(TOUCH.indexOf('<MissionSheet'), TOUCH.indexOf('<NotesSheet'));
    expect(mission).toContain('title={editTitle(t, missionCode)}');
    expect(mission).toContain('notice={missionNotice(t, m.missionCatalog)}');
    expect(mission).toContain('m.actions.mission(missionFor.vehicleId, id)');
    const notes = TOUCH.slice(TOUCH.indexOf('<NotesSheet'), TOUCH.indexOf('<FiltersSheet'));
    expect(notes).toContain('title={editTitle(t, notesCode)}');
    expect(notes).toContain("subtitle={t('fleet.attendance.fields.notes')}");
    expect(notes).toContain('maxLength={NOTE_MAX}');
    expect(notes).toContain('m.actions.notes(notesFor.vehicleId, notes)');
  });

  it('cap the note at 500 letters, as the pen dialog does', () => {
    expect(NOTE_MAX).toBe(500);
    expect(TOUCH_RAW).toContain('export const NOTE_MAX = 500;');
  });

  it('say the catalog’s state over the missions when there is something to say', () => {
    const base = { loading: false, failed: false, empty: false };
    expect(missionNotice(t, { ...base, failed: true })).toBe(
      t('fleet.fixedRoster.missionTypesFailed'),
    );
    expect(missionNotice(t, { ...base, empty: true })).toBe(
      t('fleet.fixedRoster.noMissionTypesYet'),
    );
    expect(missionNotice(t, base)).toBeUndefined();
    expect(missionNotice(t, { ...base, loading: true })).toBeUndefined();
  });
});

// ── 12. the board’s states ───────────────────────────────────────────────────────────────────────

describe('loading, empty', () => {
  it('waits with the spinner while the board has not come', () => {
    const html = render({ layout: 'phone', board: null });
    expect(html).toContain(t('common.loading'));
    expect(all(html, 'data-car')).toEqual([]);
    expect(html, 'the first row is there already').toContain('data-export="fixed-roster"');
  });

  it('a board with no car says so', () => {
    const html = render({ layout: 'portrait', board: { rows: [], drivers: [] } });
    expect(tagOf(html, 'data-empty=')).toContain('data-empty="board"');
    expect(html).toContain(t('fleet.fixedRoster.noVehicles'));
  });

  it('a refused request is the shared error panel with a retry', () => {
    expect(TOUCH).toContain('<ErrorState error={m.status.error} onRetry={m.status.retry} />');
  });
});
