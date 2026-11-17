// «تعيين السيارات» on a phone and a tablet — the touch board (components/roster/RosterTouchBoard.tsx
// and its parts), drawn by the page shell for a touch layout. The owner's asks it answers:
//
//   «فى تعديل بسيط ف شاشة تعبين الطاقم فى الحركه عاوز شكلها يتغير فى التابلت والفون» — the cards,
//   «انا برشح دول» — the phone's P1 card and the landscape tablet's split view (TL2),
//   «مينفعش ابحث فى الفون او التابلت ؟» — a car-code search on the phone and both tablet orientations.
//
// The web suite has no window, so the shell is rendered with the layout handed in
// (`RosterScreen layout=…`); what a finger does is verified in a browser against the approved shots.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type FleetRosterDayDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { RosterScreen } from './pages/RosterPage';
import { type TouchLayout } from './lib/roster-layout';
import { matchesVehicleCode } from './lib/vehicle-code-match';
import { touchCars } from './lib/roster-board';
import { rosterSource } from './roster-spec-sources';

const V1 = '650000000000000000000001';
const V2 = '650000000000000000000002';
const V3 = '650000000000000000000003';
const E1 = '650000000000000000000011';
const E2 = '650000000000000000000012';
const E3 = '650000000000000000000013';
const E4 = '650000000000000000000014';
const MT = '650000000000000000000021';

const day = (delta: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

const row = (
  vehicleId: string,
  code: string,
  over: Partial<FleetRosterDayDto['rows'][number]> = {},
): FleetRosterDayDto['rows'][number] => ({
  vehicleId,
  code,
  plateNumber: `س ص ${code}`,
  typeId: 'vt1',
  inMaintenance: false,
  planned: false,
  missionTypeId: null,
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  notes: null,
  ...over,
});

/**
 * 150: both seats filled, its operation still only PROJECTED from the fixed crew (the day is
 * saveable on arrival). 151: in the workshop. 410: stored, its driver out on leave today.
 */
const board = (
  date: string,
  stored = false,
  workshopNote: string | null = null,
): FleetRosterDayDto => ({
  date: `${date}T00:00:00.000Z`,
  rows: [
    row(V1, '150', {
      missionTypeId: MT,
      driver1EmployeeId: E1,
      driver2EmployeeId: E4,
      planned: stored,
    }),
    row(V2, '151', { inMaintenance: true, planned: stored, notes: workshopNote }),
    row(V3, '410', { driver1EmployeeId: E2, planned: true }),
  ],
  availableDrivers: [
    { employeeId: E1, assignedVehicleId: V1 },
    { employeeId: E3, assignedVehicleId: null },
    { employeeId: E4, assignedVehicleId: V1 },
  ],
  unavailableDrivers: [{ employeeId: E2, reason: 'hrLeave' }],
});

const client = (date: string, stored = false, workshopNote: string | null = null): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['fleet', 'roster', 'day', date], board(date, stored, workshopNote));
  qc.setQueryData(['fleet', 'catalogs', 'list', { kind: 'missionType' }], {
    items: [
      {
        id: MT,
        kind: 'missionType',
        name: { ar: 'نقل أموال (يومي)', en: 'Cash run' },
        isActive: true,
      },
    ],
    meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
  });
  qc.setQueryData(
    ['fleet', 'people'],
    (
      [
        [E1, 'أحمد محمد', '10411'],
        [E2, 'محمد محمود', '10612'],
        [E3, 'سعيد سعد', '11063'],
        [E4, 'كريم السيد', '10587'],
      ] as const
    ).map(([employeeId, fullNameAr, code]) => ({
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

const PLANNER = ['fleetRoster.view', 'fleetRoster.plan', 'fleetDriver.view'] as const;

const render = ({
  layout = 'phone' as TouchLayout,
  permissions = PLANNER as readonly string[],
  date = day(1),
  query = '',
  stored = false,
  workshopNote = null as string | null,
} = {}): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={client(date, stored, workshopNote)}>
        <MemoryRouter initialEntries={[`/fleet/roster?date=${date}${query}`]}>
          <RosterScreen layout={layout} />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

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

const TOUCH = rosterSource(['touch']);

// ── 1–2. the car search, where each layout keeps it ─────────────────────────────────────────

describe('the car-code search («مينفعش ابحث فى الفون او التابلت ؟»)', () => {
  it('is a full-keyboard search box at a finger’s size', () => {
    const html = render({ layout: 'phone' });
    expect(html).toContain('data-roster-touch="phone"');
    const input = tagOf(html, `placeholder="${t('fleet.roster.searchPlaceholder')}"`);
    expect(input).toContain('type="search"');
    expect(input).toContain(`aria-label="${t('fleet.vehicles.fields.code')}"`);
    expect(input).toContain('enterKeyHint="search"');
    // No number pad: the space and the dash of «120 133» / «120 - 489», the letters of «MG 2».
    expect(input.toLowerCase()).not.toContain('inputmode');
    // 16px words (a phone does not zoom), 48px tall.
    expect(input).toMatch(/\btext-base\b/u);
    expect(input).toMatch(/\bh-12\b/u);
    expect(TOUCH).not.toMatch(/inputMode/u);
  });

  it('phone: under the day stepper, in the block that scrolls away — not in the sticky row', () => {
    const html = render({ layout: 'phone' });
    const stepper = html.indexOf('data-day-stepper');
    const search = html.indexOf('data-car-search');
    const header = html.indexOf('data-touch-header');
    expect(stepper).toBeGreaterThan(-1);
    expect(search).toBeGreaterThan(stepper);
    expect(header).toBeGreaterThan(search);
  });

  it('portrait: a row of its own inside the sticky header, between the title row and the filters', () => {
    const html = render({ layout: 'portrait' });
    expect(html).toContain('data-roster-touch="portrait"');
    const header = html.indexOf('data-touch-header');
    const stepper = html.indexOf('data-day-stepper');
    const search = html.indexOf('data-car-search');
    const filters = html.indexOf('data-open-filters');
    expect(header).toBeGreaterThan(-1);
    expect(stepper).toBeGreaterThan(header);
    expect(search).toBeGreaterThan(stepper);
    expect(filters).toBeGreaterThan(search);
  });

  it('landscape: in the title row (title · search · stepper), beside the drivers panel', () => {
    const html = render({ layout: 'landscape' });
    expect(html).toContain('data-roster-touch="landscape"');
    const title = html.indexOf(`>${t('fleet.nav.roster')}</h1>`);
    const search = html.indexOf('data-car-search');
    const stepper = html.indexOf('data-day-stepper');
    expect(title).toBeGreaterThan(-1);
    expect(search).toBeGreaterThan(title);
    expect(stepper).toBeGreaterThan(search);
    const panel = html.slice(html.indexOf('data-drivers-panel'));
    expect(panel).toContain(t('fleet.roster.pickSlotHint'));
    expect(panel).toContain('data-driver-tab="available"');
  });
});

// ── 3–4. what the term finds, and where it lives ────────────────────────────────────────────

describe('touchCars — what the typed code shows on the cards', () => {
  // The day: four cars on the road, 410 in the workshop.
  const DAY_ROWS = [
    row('v120', '120'),
    row('v133', '133'),
    row('v410', '410', { inMaintenance: true }),
    row('v489', '489'),
    row('vmg2', 'MG 2'),
  ];
  const codes = (rows: readonly { code: string }[]): string[] => rows.map((r) => r.code);

  it.each([
    ['١٢٠', ['120']],
    ['120 133', ['120', '133']],
    ['120 - 489', ['120', '489']],
    ['MG 2', ['MG 2']],
  ])('«%s» narrows the road’s cards to %j', (term, found) => {
    const cars = touchCars(DAY_ROWS, DAY_ROWS, term);
    expect(cars.searching).toBe(true);
    expect(codes(cars.onRoad)).toEqual(found);
    expect(cars.inWorkshop).toEqual([]);
    expect(cars.termFinds).toBe(true);
  });

  it.each(['', '  ', '-'])('«%s» narrows nothing', (term) => {
    const cars = touchCars(DAY_ROWS, DAY_ROWS, term);
    expect(cars.searching).toBe(false);
    expect(codes(cars.onRoad)).toEqual(['120', '133', '489', 'MG 2']);
    expect(codes(cars.inWorkshop)).toEqual(['410']);
  });

  it('is ANDed with what the URL narrows (a counter view, the picked codes, the missions)', () => {
    const viewed = DAY_ROWS.filter((r) => r.code === '133' || r.code === '489');
    expect(codes(touchCars(viewed, DAY_ROWS, '120 133').onRoad)).toEqual(['133']);
  });

  it('finds a car the filters hide → the filters’ line, not «no car with this code»', () => {
    const viewed = DAY_ROWS.filter((r) => r.code === '489');
    const cars = touchCars(viewed, DAY_ROWS, '120');
    expect([...cars.onRoad, ...cars.inWorkshop]).toEqual([]);
    expect(cars.termFinds, 'the day has a 120').toBe(true);
  });

  it('finds no car at all → «لا توجد سيارة بهذا الكود»', () => {
    const cars = touchCars(DAY_ROWS, DAY_ROWS, '999');
    expect(cars.drawn).toEqual([]);
    expect(cars.termFinds).toBe(false);
  });

  it('finds a workshop car into the workshop group alone', () => {
    const cars = touchCars(DAY_ROWS, DAY_ROWS, '41');
    expect(cars.onRoad).toEqual([]);
    expect(codes(cars.inWorkshop)).toEqual(['410']);
  });

  it('draws — and writes to Excel — the road first, then the workshop', () => {
    expect(codes(touchCars(DAY_ROWS, DAY_ROWS, '').drawn)).toEqual([
      '120',
      '133',
      '489',
      'MG 2',
      '410',
    ]);
  });

  it('is what the board draws, exports, and lets go of with the red reset', () => {
    expect(TOUCH).toContain('touchCars(m.visible, m.shown, carTerm)');
    expect(TOUCH).toContain('m.actions.exportSheet(drawn)');
    const reset = TOUCH.slice(TOUCH.indexOf('const resetAll = ()'));
    expect(reset.indexOf("setCarTerm('')"), 'the typed code goes too').toBeGreaterThan(-1);
    expect(reset.indexOf("setCarTerm('')")).toBeLessThan(reset.indexOf('resetFilters()'));
  });
});

describe('the term is matched as the funnel’s codes are, and kept on the board alone', () => {
  // «120،133» (an Arabic comma between two codes) finds nothing today: the shared parser
  // `splitVehicleCodeList` (packages/contracts) does not split on «،». That is a known limit of
  // the parser, handed off — not a requirement, so it is not pinned here.
  it.each([
    ['١٢٠', ['120']],
    ['41', ['410']],
    ['120 133', ['120', '133']],
    ['120 - 489', ['120', '489']],
    ['MG 2', ['MG 2']],
    ['', ['120', '133', '410', '489', 'MG 2']],
    ['  ', ['120', '133', '410', '489', 'MG 2']],
    ['-', ['120', '133', '410', '489', 'MG 2']],
  ])('«%s» finds %j', (term, found) => {
    const codes = ['120', '133', '410', '489', 'MG 2'];
    expect(codes.filter((code) => matchesVehicleCode(code, term))).toEqual(found);
  });

  it('is never written to the URL nor remembered (a half-typed «1» must not come back)', () => {
    expect(TOUCH).toContain("const [carTerm, setCarTerm] = useState('')");
    expect(TOUCH).not.toMatch(/useSearchParams|useRememberedFilters|sp\.get\(/u);
    // Every URL write of the board names a URL key — none of them the term.
    for (const write of TOUCH.match(/patch\(\{[^}]*\}\)/gu) ?? []) {
      expect(write).not.toMatch(/carTerm|search:/u);
    }
    expect(rosterSource(['shell'])).toContain(
      "const REMEMBERED_FILTERS = ['mission', 'q', 'sort', 'view', 'unavailable'] as const;",
    );
  });
});

// ── 5–6. the counters and the filters sheet ─────────────────────────────────────────────────

describe('the counters and the filters', () => {
  it('count the whole day in Latin digits, whatever narrows the cards', () => {
    const html = render({ layout: 'phone', query: '&view=workshop' });
    const total = html.slice(html.indexOf('data-counter="total"'));
    expect(total.slice(0, total.indexOf('</button>'))).toContain('>3</span>');
    expect(html).toContain('data-counter="workshop" data-active="true"');
    expect(html).not.toMatch(/[٠-٩]/u);
  });

  it('keeps «نوع المهمة» in the filters sheet (only the computer lost its dropdown)', () => {
    const parts = rosterSource(['touch'], { raw: true });
    const sheet = parts.slice(parts.indexOf('export const FiltersSheet'));
    expect(sheet).toContain("t('fleet.roster.allMissions')");
    expect(sheet).toContain("t('fleet.roster.fields.mission')");
  });
});

// ── 7–8. the unsaved bar, and a past day ────────────────────────────────────────────────────

describe('the unsaved bar at the screen’s foot', () => {
  it('shows on a day still only projected: «حفظ» live, nothing of the reader’s to undo', () => {
    const html = render({ layout: 'phone' });
    expect(html).toContain('data-edits-bar="true"');
    expect(disabled(html, 'data-undo-edit')).toBe(true);
    expect(disabled(html, 'data-discard-edits')).toBe(true);
    expect(disabled(html, 'data-save-roster')).toBe(false);
  });

  it('is absent for a reader who cannot plan, on a past day and on an all-stored day', () => {
    expect(render({ permissions: ['fleetRoster.view', 'fleetDriver.view'] })).not.toContain(
      'data-edits-bar',
    );
    expect(render({ date: day(-1) })).not.toContain('data-edits-bar');
    expect(render({ stored: true })).not.toContain('data-edits-bar');
  });

  it.each(['phone', 'portrait', 'landscape'] as const)(
    '%s: a reader who only looks, on a day still plannable, gets no planning control',
    (layout) => {
      for (const date of [day(0), day(1)]) {
        const html = render({
          layout,
          date,
          permissions: ['fleetRoster.view', 'fleetDriver.view'],
        });
        for (const marker of [
          'data-clear-slot',
          'data-swap-drivers',
          'data-card-menu',
          'data-edits-bar',
          'draggable="true"',
          'data-mission="',
        ]) {
          expect(html, `${layout} ${date}: ${marker}`).not.toContain(marker);
        }
        expect(html).not.toContain(t('fleet.roster.pickDriver'));
        expect(html, 'nor is the day called over').not.toContain('data-readonly-day');
      }
    },
  );

  it('a past day is read, never planned', () => {
    const html = render({ layout: 'portrait', date: day(-1) });
    expect(html).toContain('data-readonly-day="true"');
    for (const marker of ['data-clear-slot', 'data-swap-drivers', 'data-card-menu']) {
      expect(html).not.toContain(marker);
    }
    expect(html).not.toContain(t('fleet.roster.pickDriver'));
  });
});

// ── 9. the cards ────────────────────────────────────────────────────────────────────────────

describe('one card per car', () => {
  it('offers the swap only where both seats are filled', () => {
    const html = render({ layout: 'phone' });
    expect(html.match(/data-swap-drivers="/gu)).toHaveLength(1);
    expect(html).toContain(`data-swap-drivers="${V1}"`);
  });

  it('groups the workshop’s cars last, folded, under «في الورشة (n)»', () => {
    const html = render({ layout: 'phone' });
    const group = html.slice(html.indexOf('data-workshop-group'));
    expect(tagOf(html, 'data-workshop-group')).toContain('data-open="false"');
    expect(group).toContain(t('fleet.vehicles.inWorkshop'));
    expect(group).toMatch(/\(<span class="font-figures">1<\/span>\)/u);
    expect(html).not.toContain('data-car="151"');
  });

  it('says on the seat why its driver is out today', () => {
    const html = render({ layout: 'phone' });
    const card = html.slice(html.indexOf('data-car="410"'));
    expect(card).toContain('data-driver-out="hrLeave"');
    expect(card).toContain(t('fleet.roster.reason.hrLeave'));
  });
});

// ── 10. the dashboard's «غائبون اليوم» link, and a workshop car's note ──────────────────────

describe('a link that asks for the absent (`?unavailable=`) lands on the absent list', () => {
  it('landscape: the panel opens on «غير المتاحين», narrowed to the reason', () => {
    const html = render({ layout: 'landscape', query: '&unavailable=hrLeave' });
    expect(tagOf(html, 'data-driver-tab="unavailable"')).toContain('aria-selected="true"');
    expect(tagOf(html, 'data-driver-tab="available"')).toContain('aria-selected="false"');
    expect(html).toContain(`data-unavailable-driver="${E2}"`);
    expect(tagOf(html, 'data-reason-filter="hrLeave"')).toContain('aria-pressed="true"');
  });

  it('landscape without the key: the available list, as before', () => {
    const html = render({ layout: 'landscape' });
    expect(tagOf(html, 'data-driver-tab="available"')).toContain('aria-selected="true"');
  });

  it('phone and portrait: the drivers sheet opens once on arrival, on that list', () => {
    expect(TOUCH).toContain('const [arrivedAsking] = useState(() => reasons.length > 0);');
    expect(TOUCH).toContain("useState<DriverTab>(arrivedAsking ? 'unavailable' : 'available')");
    expect(TOUCH).toContain("if (arrivedAsking && layout !== 'landscape') setPoolOpen(true);");
    // The drivers button opens the narrowed list too while the URL holds reasons.
    const pool = TOUCH.slice(TOUCH.indexOf('const openPool = ()'));
    expect(pool.slice(0, 200)).toContain(
      "setTab(reasons.length > 0 ? 'unavailable' : 'available')",
    );
  });
});

describe('a car the workshop holds keeps its note legible', () => {
  it('shows the note, read-only, on the compact workshop card', () => {
    const html = render({ layout: 'phone', query: '&view=workshop', workshopNote: 'تغيير زيت' });
    const card = html.slice(html.indexOf('data-car="151"'));
    const end = card.indexOf('</article>');
    expect(card.slice(0, end)).toContain('data-notes="151"');
    expect(card.slice(0, end)).toContain('تغيير زيت');
    expect(card.slice(0, end), 'not an edit button').not.toContain('data-notes-edit');
  });
});

describe('a seat on a touch card clears with ✕', () => {
  // «… بس خليهم علامه سله» — the owner's bin is the COMPUTER's remove mark. The touch seat's ✕
  // comes from the approved P1 / TL2 shots («انا برشح دول»), and is an open question to the owner
  // (touch ✕ against the bin he asked for on the computer). Pinned, so either answer is a
  // deliberate change here, not a silent drift.
  it('uses CloseIcon on the seat’s clear button', () => {
    const card = rosterSource(['touch']);
    const clear = card.slice(card.indexOf('data-clear-slot='));
    expect(clear.slice(0, 600)).toContain('<CloseIcon');
  });
});
