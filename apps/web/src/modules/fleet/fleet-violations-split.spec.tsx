// Two ledgers on one screen, and the rules that keep them apart.
//
// What this file defends, in the order it matters:
//   1. A TYPE BELONGS TO ONE SIDE. The company form must never offer «سرعة» and the drivers' bar
//      must never offer «رسوم قضائية» — the server refuses either, so offering one is offering a
//      422 the reader can do nothing about.
//   2. THE BAR COUNTS, THEN NAMES. Counters open one card per fine, carry over what is typed, and
//      file as ONE batch — never a partial one.
//   3. COLLECTED IS THE SERVER'S ANSWER. The tick reflects stored state and tints the row; it is
//      never painted ahead of the write.
//   4. A CAR'S YEARS STAY APART. The board groups by (vehicle, year), not by vehicle.
//
// The suite has no DOM, so a click cannot be made here: what IS asserted is everything either
// side of it — which control each half renders, from which list, and what the pure entry rules do
// with the values a click would produce. The clicking itself is verified in Chromium.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type FleetCatalogItemDto,
  type FleetViolationDto,
  type FleetViolationRollupDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { ViolationsPage } from './pages/ViolationsPage';
import {
  cardLabel,
  entryCards,
  entryComplete,
  entryTotal,
  incompleteCards,
  toBatchPayload,
  type DriverEntryCard,
} from './lib/driver-violation-entry';
import { toCsv, exportFilename } from './lib/violations-export';
import { buildViolationsPrintHtml } from './lib/violations-print';

const t = (key: string): string => translate('ar', key);

const V1 = '650000000000000000000001';
const V2 = '650000000000000000000002';
const E1 = '650000000000000000000011';
const CT_COURT = '650000000000000000000021';
const CT_PARK = '650000000000000000000022';
const DT_SPEED = '650000000000000000000031';
const DT_BELT = '650000000000000000000032';

const catalogItem = (
  id: string,
  ar: string,
  violationSide: 'company' | 'driver',
): FleetCatalogItemDto => ({
  id,
  kind: 'violationType',
  name: { ar, en: ar },
  countsForAlarm: false,
  violationSide,
  isActive: true,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const COMPANY_TYPES = [
  catalogItem(CT_COURT, 'رسوم قضائية', 'company'),
  catalogItem(CT_PARK, 'الانتظار في الممنوع', 'company'),
];
const DRIVER_TYPES = [
  catalogItem(DT_SPEED, 'سرعة', 'driver'),
  catalogItem(DT_BELT, 'حزام', 'driver'),
];

const rollupRow = (over: Partial<FleetViolationRollupDto> = {}): FleetViolationRollupDto => ({
  vehicleId: V1,
  code: '168',
  year: 2026,
  vehicleCount: 4,
  vehicleAmount: 2040.15,
  driverCount: 0,
  driverAmount: 0,
  totalCount: 4,
  totalAmount: 2040.15,
  rowCount: 4,
  collectedCount: 0,
  totalBeforeGrievance: 0,
  ...over,
});

const driverRow = (over: Partial<FleetViolationDto> = {}): FleetViolationDto => ({
  id: 'vio-1',
  kind: 'driver',
  vehicleId: V1,
  violationTypeId: DT_SPEED,
  amount: 400,
  year: null,
  count: null,
  unitValue: null,
  date: '2026-02-01T00:00:00.000Z',
  driverEmployeeId: E1,
  collected: false,
  version: 0,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  ...over,
});

const store = (
  permissions = [
    'fleetViolation.view',
    'fleetViolation.record',
    'fleetViolation.edit',
    'fleetViolation.delete',
    'fleetViolation.collect',
    'fleetViolation.grievance',
  ],
) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((p) => [p, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const page = ({
  rollup = [rollupRow()],
  drivers = [driverRow()],
  permissions,
  seedCatalogs = true,
  year,
}: {
  /** `null` = seed nothing, so the query is genuinely pending. `undefined` would fall
   *  through to the default and quietly seed a row. */
  rollup?: FleetViolationRollupDto[] | null;
  drivers?: FleetViolationDto[] | null;
  permissions?: string[];
  seedCatalogs?: boolean;
  year?: string;
} = {}): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(
    listKey('fleet', 'vehicles', {
      pageSize: 200,
      sortBy: 'code',
      sortDir: 'asc',
    }),
    undefined,
  );
  if (seedCatalogs) {
    qc.setQueryData(
      listKey('fleet', 'catalogs', { kind: 'violationType', violationSide: 'company' }),
      { items: COMPANY_TYPES, meta: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 } },
    );
    qc.setQueryData(
      listKey('fleet', 'catalogs', { kind: 'violationType', violationSide: 'driver' }),
      { items: DRIVER_TYPES, meta: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 } },
    );
  }
  if (rollup !== null) {
    qc.setQueryData(
      [
        'fleet',
        'violations',
        'rollup',
        { year: year === undefined ? undefined : Number(year), vehicleId: undefined },
      ],
      rollup,
    );
  }
  if (drivers !== null) {
    qc.setQueryData(
      listKey('fleet', 'violations', {
        kind: 'driver',
        page: 1,
        pageSize: 25,
        sortBy: 'date',
        sortDir: 'desc',
      }),
      {
        items: drivers,
        meta: { page: 1, pageSize: 25, totalItems: drivers.length, totalPages: 1 },
      },
    );
  }
  return renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter
          initialEntries={[`/fleet/violations${year === undefined ? '' : `?year=${year}`}`]}
        >
          <ViolationsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

// ── 1 · a type belongs to one side ──────────────────────────────────────────

describe('the two halves offer their OWN violation types, and only those', () => {
  it('puts both ledgers on one screen, company first so RTL reads it on the right', () => {
    const markup = page();
    expect(markup).toContain('data-violations-split="true"');
    expect(markup, 'the company half').toContain('data-violations-panel="company"');
    expect(markup, 'the drivers half').toContain('data-violations-panel="driver"');
    expect(
      markup.indexOf('data-violations-panel="company"'),
      'company is first in the DOM, which is the right in RTL',
    ).toBeLessThan(markup.indexOf('data-violations-panel="driver"'));
  });

  it('offers company types in the company form and NEVER a driver type', () => {
    const markup = page();
    const company = markup.slice(
      markup.indexOf('data-violations-panel="company"'),
      markup.indexOf('data-violations-panel="driver"'),
    );
    expect(company, 'the company vocabulary').toContain('رسوم قضائية');
    expect(company, 'and the rest of it').toContain('الانتظار في الممنوع');
    expect(company, 'never a driver fine').not.toContain('سرعة');
    expect(company, 'nor another').not.toContain('حزام');
  });

  it('counts driver types in the bar and NEVER a company type', () => {
    const markup = page();
    const driver = markup.slice(markup.indexOf('data-violations-panel="driver"'));
    expect(driver, 'a counter for each driver type').toContain(`data-driver-count="${DT_SPEED}"`);
    expect(driver).toContain(`data-driver-count="${DT_BELT}"`);
    expect(driver, 'never a company fine').not.toContain('رسوم قضائية');
    expect(driver).not.toContain('الانتظار في الممنوع');
  });

  it('has exactly one counter per live driver type — the catalog decides how many', () => {
    const markup = page();
    const counters = [...markup.matchAll(/data-driver-count="([^"]+)"/g)].map((m) => m[1]);
    expect(counters).toEqual([DT_SPEED, DT_BELT]);
  });

  it('renders no counters at all when the catalog has not answered yet', () => {
    const markup = page({ seedCatalogs: false });
    expect(markup, 'nothing invented client-side').not.toContain('data-driver-count=');
  });
});

// ── 2 · the bar counts, then names ──────────────────────────────────────────

describe('the drivers bar: counts in, one card per fine out', () => {
  const TYPES = [
    { id: DT_SPEED, name: 'سرعة' },
    { id: DT_BELT, name: 'حزام' },
  ];

  it('opens one card per unit counted, in the catalog’s order', () => {
    const cards = entryCards(TYPES, { [DT_SPEED]: 1, [DT_BELT]: 2 });
    expect(cards.map(cardLabel)).toEqual(['سرعة - 1', 'حزام - 1', 'حزام - 2']);
  });

  it('carries over what is already typed when a count grows', () => {
    const first = entryCards(TYPES, { [DT_SPEED]: 1 });
    const typed = first.map((c) => ({
      ...c,
      driverEmployeeId: E1,
      amount: '400',
      date: '2026-02-01',
    }));
    const grown = entryCards(TYPES, { [DT_SPEED]: 2 }, typed);
    expect(grown, 'two cards now').toHaveLength(2);
    expect(grown[0]?.driverEmployeeId, 'the first keeps its driver').toBe(E1);
    expect(grown[1]?.driverEmployeeId, 'the new one is blank').toBe('');
  });

  it('drops the highest ordinal when a count shrinks, not the one being filled', () => {
    const two = entryCards(TYPES, { [DT_SPEED]: 2 }).map((c, i) => ({
      ...c,
      amount: String(i + 1),
    }));
    const one = entryCards(TYPES, { [DT_SPEED]: 1 }, two);
    expect(one).toHaveLength(1);
    expect(one[0]?.amount, 'the first survives').toBe('1');
  });

  it('renames cards when the catalog renames the type', () => {
    const cards = entryCards(TYPES, { [DT_SPEED]: 1 });
    const renamed = entryCards([{ id: DT_SPEED, name: 'سرعة زائدة' }], { [DT_SPEED]: 1 }, cards);
    expect(cardLabel(renamed[0] as DriverEntryCard)).toBe('سرعة زائدة - 1');
  });

  it('is not fileable until every card names a day, a driver and money', () => {
    const cards = entryCards(TYPES, { [DT_SPEED]: 2 });
    expect(entryComplete(cards), 'nothing filled').toBe(false);
    const half = [
      { ...(cards[0] as DriverEntryCard), date: '2026-02-01', driverEmployeeId: E1, amount: '400' },
      cards[1] as DriverEntryCard,
    ];
    expect(entryComplete(half), 'one card still empty').toBe(false);
    expect(incompleteCards(half), 'and the panel can point at it').toEqual([
      `${DT_BELT}:1`.replace(DT_BELT, DT_SPEED) === half[1]?.key
        ? (half[1]?.key as string)
        : (half[1]?.key as string),
    ]);
    const whole = half.map((c) => ({
      ...c,
      date: '2026-02-01',
      driverEmployeeId: E1,
      amount: '400',
    }));
    expect(entryComplete(whole)).toBe(true);
    expect(incompleteCards(whole)).toEqual([]);
  });

  it('refuses a bad amount rather than filing a zero', () => {
    const [card] = entryCards(TYPES, { [DT_SPEED]: 1 });
    const typed = { ...(card as DriverEntryCard), date: '2026-02-01', driverEmployeeId: E1 };
    expect(entryComplete([{ ...typed, amount: 'abc' }])).toBe(false);
    expect(entryComplete([{ ...typed, amount: '' }])).toBe(false);
    expect(entryComplete([{ ...typed, amount: '400.555' }]), 'more than piastres').toBe(false);
    expect(entryComplete([{ ...typed, amount: '400.50' }])).toBe(true);
  });

  it('adds up only what is really a number', () => {
    const cards = entryCards(TYPES, { [DT_SPEED]: 2 }).map((c, i) => ({
      ...c,
      amount: i === 0 ? '400' : 'oops',
    }));
    expect(entryTotal(cards)).toBe(400);
  });

  it('sends ONE payload carrying every card, against the one vehicle', () => {
    const cards = entryCards(TYPES, { [DT_SPEED]: 1, [DT_BELT]: 1 }).map((c) => ({
      ...c,
      date: '2026-02-01',
      driverEmployeeId: E1,
      amount: '400',
    }));
    const payload = toBatchPayload(V2, cards);
    expect(payload.vehicleId).toBe(V2);
    expect(payload.rows).toHaveLength(2);
    expect(payload.rows.map((r) => r.violationTypeId)).toEqual([DT_SPEED, DT_BELT]);
    expect(payload.rows[0]?.amount, 'money is a number by the time it ships').toBe(400);
    expect(payload.rows[0]?.date.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('throws rather than filing a partial stack', () => {
    const cards = entryCards(TYPES, { [DT_SPEED]: 2 }).map((c, i) =>
      i === 0 ? { ...c, date: '2026-02-01', driverEmployeeId: E1, amount: '400' } : c,
    );
    // A client that trimmed the empty card would file one fine, report success, and leave the
    // reader believing two were recorded.
    expect(() => toBatchPayload(V2, cards)).toThrow();
    expect(() => toBatchPayload('', [])).toThrow();
  });

  it('keeps the entry layer CLOSED until something is counted', () => {
    // It used to be a permanently visible dark box that said «nothing here yet» — a third of the
    // panel's height spent telling a reader that they had not started. It is a layer now: counting
    // opens it, and until then the board below has that room.
    const markup = page();
    expect(markup, 'no entry layer before anything is counted').not.toContain(
      'data-entered-panel="true"',
    );
    expect(markup, 'and no empty-state placeholder either').not.toContain('data-entered-empty');
    // The counting bar itself is what IS on screen — the way in is still visible.
    expect(markup, 'the counting bar is still there').toContain('data-driver-bar="true"');
  });
});

// ── 3 · collected is the server's answer ────────────────────────────────────

describe('collected: stored, shown, and never painted ahead of the write', () => {
  it('offers the tick on every driver row and reports the stored state', () => {
    const markup = page({ drivers: [driverRow({ collected: false })] });
    expect(markup).toContain('data-collect="vio-1"');
    expect(markup, 'not collected yet').toContain('aria-pressed="false"');
  });

  it('tints the row and flips the tick once the server says collected', () => {
    const markup = page({ drivers: [driverRow({ collected: true })] });
    expect(markup, 'the tick reads as pressed').toContain('aria-pressed="true"');
    expect(markup, 'and the row is green').toContain('bg-emerald-50');
  });

  it('leaves an uncollected row untinted', () => {
    const markup = page({ drivers: [driverRow({ collected: false })] });
    expect(markup).not.toContain('bg-emerald-50 dark:bg-emerald-950/40');
  });

  it('offers no tick to a reader without the collect grant', () => {
    const markup = page({
      permissions: ['fleetViolation.view', 'fleetViolation.edit'],
      drivers: [driverRow()],
    });
    expect(markup).not.toContain('data-collect=');
    expect(markup, 'but editing is still theirs').toContain('data-edit="vio-1"');
  });

  it('offers no edit or delete to a reader who may only look', () => {
    const markup = page({ permissions: ['fleetViolation.view'], drivers: [driverRow()] });
    expect(markup).not.toContain('data-edit=');
    expect(markup).not.toContain('data-delete=');
    expect(markup).not.toContain('data-collect=');
  });

  it('hides the statement form from a reader who may not record', () => {
    const markup = page({ permissions: ['fleetViolation.view'] });
    // The bar is still drawn — it is the screen's shape — but its save is refused.
    expect(markup).toContain('data-company-save="true"');
    expect(markup).toContain('disabled');
  });
});

// ── 4 · a car's years stay apart ────────────────────────────────────────────

/**
 * What a count badge SAYS — the text between its own tags, found by the badge's data attribute.
 *
 * These panels render to a string (no DOM in this suite), so the badge is read out of the markup;
 * reading it by tag boundaries rather than by a character count is what keeps the assertion about
 * the count instead of about the element's attribute list.
 */
const countBadgeText = (markup: string, attribute: string): string => {
  const at = markup.indexOf(attribute);
  if (at === -1) throw new Error(`no element carries ${attribute}`);
  const open = markup.indexOf('>', at);
  const close = markup.indexOf('<', open);
  return markup
    .slice(open + 1, close)
    .replace(/<!--.*?-->/g, '')
    .trim();
};

describe('the eight reported defects, as rules the markup carries', () => {
  // These were verified by hand in Chromium, which is the only place a click, a computed width or
  // a drawer's real screen edge can be checked. What is checkable HERE is the decision each fix
  // encodes — and none of it was, so every one of these could be reverted with the whole suite
  // green. Each assertion below fails against the code as it stood before its fix.

  it('the car is CHOSEN from the registry, never typed', () => {
    // A typed code is a code the statement may not carry; the screen already holds the list.
    const markup = page();
    expect(markup, 'no free-text code box').not.toContain('data-company-form="code"');
    // By its own hook, not by `aria-label`: «كود السيارة» is the Arabic for both
    // `fleet.vehicles.fields.code` and `fleet.odometer.columns.vehicle`, so the filter bar's car
    // picker answers to the same name and an assertion on it proves nothing about this control.
    const at = markup.indexOf('data-vehicle-select="company-entry"');
    expect(at, 'the entry row picks the car from the registry').toBeGreaterThan(-1);
    expect(markup.slice(markup.lastIndexOf('<', at), at), 'and it is a select').toMatch(
      /^<select\b/,
    );
  });

  it('«اختر نوع المخالفة» cannot be chosen back to nothing', () => {
    // A statement row has no «no type» value — the server refuses it — so the empty option exists
    // to name the control, not to be an answer.
    const markup = page();
    const at = markup.indexOf('اختر نوع المخالفة');
    expect(at, 'the type control is rendered').toBeGreaterThan(-1);
    const select = markup.slice(at, markup.indexOf('</select>', at));
    expect(select, 'the empty option is disabled').toMatch(/<option value=""[^>]*disabled/);
  });

  it('the year is sized by a WRAPPER, because `cn` cannot merge widths', () => {
    // `cn` is a plain joiner: a `w-28` handed to `Select` sits beside its own `w-full` and loses,
    // which is why the year measured 86px however large a class it was given.
    const markup = page();
    const at = markup.indexOf('data-company-form="year"');
    expect(at).toBeGreaterThan(-1);
    // The wrapper is the element immediately before the select in the markup.
    const before = markup.slice(Math.max(0, at - 400), at);
    expect(before, 'a sized wrapper, not a class on the control').toMatch(/class="w-\d+"/);
  });

  it('both filter bars write each filter NAME above its control', () => {
    const markup = page();
    for (const label of [
      translate('ar', 'fleet.vehicles.fields.code'),
      translate('ar', 'fleet.violations.fields.driver'),
      translate('ar', 'fleet.violations.fields.amount'),
    ]) {
      expect(markup, `${label} is named above its control`).toContain(
        `data-filter-field="${label}"`,
      );
    }
  });

  it('the type filter takes SEVERAL kinds, not one', () => {
    // A clerk reconciling a stack asks «speeding and seatbelt». A `<select>` cannot be asked that,
    // which is why this is a listbox trigger and why the URL key carries a list.
    const markup = page();
    const at = markup.indexOf(`data-filter-field="${translate('ar', 'fleet.violations.fields.type')}"`);
    expect(at, 'the type filter is named').toBeGreaterThan(-1);
    const field = markup.slice(at, at + 700);
    expect(field, 'a multi-select, not a dropdown').toContain('aria-haspopup="listbox"');
    expect(field, 'and not a single-value select').not.toContain('<select');
  });

  it('no filter is NAMED with an instruction', () => {
    // «اختر نوع المخالفة» is what to DO, not what the column asks about. A bar's labels are nouns;
    // the imperative belongs inside the control, as its empty row.
    const markup = page();
    const labels = [...markup.matchAll(/data-filter-field="([^"]+)"/g)].map((m) => m[1]);
    expect(labels.length, 'both bars rendered their fields').toBeGreaterThanOrEqual(6);
    for (const label of labels) {
      expect(label, `${label} names a thing, not an action`).not.toMatch(/^اختر/);
    }
  });

  it('the company entry row WRAPS rather than scrolling sideways', () => {
    // At half the screen the row needs 825px and has 556. `overflow-x-auto` put «العدد» and the
    // total behind a scrollbar inside a form, where nothing said they were there.
    const markup = page();
    const at = markup.indexOf('data-company-form="year"');
    const container = markup.slice(Math.max(0, at - 900), at);
    expect(container, 'the entry row wraps').toContain('flex-wrap');
    expect(container, 'and does not scroll').not.toContain('overflow-x-auto');
  });

  it('the driver entry PICKS its car, exactly as the company entry does', () => {
    const markup = page();
    expect(markup, 'no typed code box').not.toContain('data-driver-form="code"');
    expect(markup).toContain('data-vehicle-select="driver-entry"');
  });

  it('a fully settled (vehicle, year) group is marked as such', () => {
    // The tick changed colour on its own, which told a reader nothing until they had found it.
    // Settled is a state of the GROUP, and the drivers' board beside this one has tinted its
    // settled rows green since it was built.
    const settled = page({ rollup: [rollupRow({ rowCount: 3, collectedCount: 3 })] });
    const at = settled.indexOf('data-rollup-settled="true"');
    expect(at, 'the group says it is settled').toBeGreaterThan(-1);
    // The tint must be on THAT tag. `bg-emerald-50` is also how the drivers' board marks its own
    // settled rows, and both halves render into this one string — so an unscoped `toContain`
    // passes on the neighbour's green and proves nothing about this group.
    const tag = settled.slice(settled.lastIndexOf('<', at), settled.indexOf('>', at));
    expect(tag, 'and reads as settled').toContain('bg-emerald-50');

    const partial = page({ rollup: [rollupRow({ rowCount: 3, collectedCount: 1 })] });
    expect(partial, 'some is not all').not.toContain('data-rollup-settled="true"');
  });

  it('every filter field takes an EQUAL share of its row', () => {
    // `flex-1 basis-0` is the whole of «الفلاتر مش مظبوطة»: without it the share of the row a
    // control gets depends on how long its own words happen to be.
    const markup = page();
    const fields = markup.split('data-filter-field=').slice(1);
    expect(fields.length, 'both bars rendered their fields').toBeGreaterThanOrEqual(6);
    for (const field of fields) {
      expect(field.slice(0, 200)).toContain('flex-1 basis-0');
    }
  });

  // NOT asserted here: that the entry cards list is not a scroll box of its own (an `overflow`
  // ancestor clips the absolutely-positioned driver dropdown inside each card). The cards only
  // exist after a counter is pressed, and this suite has no DOM to press one with — a static
  // render contains no `<ul>` at all, so any assertion about it would pass whatever the class
  // list said. It is checked in Chromium instead, against COMPUTED styles and the panel's real
  // painted height, which is stronger than a string match would have been either way.
});

describe('the company board groups by (vehicle, year)', () => {
  const MIXED = [
    rollupRow({ code: '168', year: 2026 }),
    rollupRow({
      vehicleId: V2,
      code: '170',
      year: 2025,
      vehicleAmount: 1304.98,
      driverAmount: 1400,
      totalAmount: 2704.98,
      totalCount: 5,
      driverCount: 2,
      vehicleCount: 3,
    }),
  ];

  it('draws one group per pair, not one per vehicle', () => {
    const markup = page({ rollup: MIXED });
    expect(markup).toContain('data-rollup-group="168:2026"');
    expect(markup).toContain('data-rollup-group="170:2025"');
  });

  it('shows the four totals the business reads a year by', () => {
    const markup = page({ rollup: [rollupRow()] });
    for (const key of ['company', 'drivers', 'beforeGrievance', 'total']) {
      expect(markup, `the ${key} line`).toContain(`data-line-amount="${key}"`);
    }
  });

  it('counts nothing on the pre-appeal line — it is a figure, not a tally', () => {
    const markup = page({ rollup: [rollupRow()] });
    const cell = markup.slice(markup.indexOf('data-line-count="beforeGrievance"'));
    expect(cell.slice(0, 120), 'a dash, never a zero').toContain('—');
  });

  it('counts the groups it is showing', () => {
    const markup = page({ rollup: MIXED });
    expect(markup).toContain('data-company-count');
    // The badge's own TEXT, not a fixed-width window into the markup after the attribute: the
    // count is what this asserts, and a window is hostage to how many attributes the element
    // happens to carry — adding a `title` to the badge broke this while the count it checks was
    // still exactly where it belongs.
    expect(countBadgeText(markup, 'data-company-count')).toBe('٢');
  });

  it('adds up the visible groups into the panel’s own footer', () => {
    const markup = page({ rollup: MIXED });
    for (const key of ['company', 'drivers', 'all']) {
      expect(markup).toContain(`data-company-total="${key}"`);
    }
  });

  it('offers a way into one pair’s own violations', () => {
    const markup = page({ rollup: MIXED });
    expect(markup).toContain('data-inspect="168:2026"');
    expect(markup).toContain('data-inspect="170:2025"');
  });
});

// ── 5 · the states a board can be in ────────────────────────────────────────

describe('loading, empty and error are each said differently', () => {
  it('says nothing is recorded rather than drawing an empty table', () => {
    const markup = page({ rollup: [] });
    expect(markup).toContain(t('fleet.violations.empty'));
    expect(markup, 'and no table at all').not.toContain('data-company-table');
  });

  it('shows a skeleton while the board has not answered', () => {
    const markup = page({ rollup: null });
    expect(markup, 'no table, no empty state — a placeholder').not.toContain('data-company-table');
    expect(markup).not.toContain(t('fleet.violations.empty'));
  });

  it('still renders the drivers half when the company half is empty', () => {
    const markup = page({ rollup: [] });
    expect(markup).toContain('data-violations-panel="driver"');
  });
});

// ── 6 · what the two document buttons produce ───────────────────────────────

describe('print and CSV carry exactly what is on screen', () => {
  it('offers both actions on both halves', () => {
    const markup = page();
    for (const half of ['company', 'driver']) {
      expect(markup).toContain(`data-print="${half}"`);
      expect(markup).toContain(`data-export="${half}"`);
    }
  });

  it('quotes a field that would otherwise split a column', () => {
    const csv = toCsv(
      ['a', 'b'],
      [
        ['plain', 'has,comma'],
        ['has"quote', 'has\nnewline'],
      ],
    );
    const lines = csv.split('\n');
    expect(lines[0], 'BOM so Excel reads Arabic').toBe('﻿a,b');
    expect(lines[1]).toBe('plain,"has,comma"');
    expect(csv, 'a quote is doubled').toContain('"has""quote"');
  });

  it('names the file by what it is and the day it was taken', () => {
    expect(exportFilename('driver-violations', '2026-09-06')).toBe(
      'driver-violations-2026-09-06.csv',
    );
  });

  it('escapes the document rather than letting a name close a tag', () => {
    const html = buildViolationsPrintHtml({
      title: 'T',
      subtitle: 'S',
      header: ['<b>h</b>'],
      rows: [['a & b']],
      totals: [{ label: '"q"', value: '1' }],
      rtl: true,
    });
    expect(html).toContain('&lt;b&gt;h&lt;/b&gt;');
    expect(html).toContain('a &amp; b');
    expect(html).toContain('&quot;q&quot;');
    expect(html, 'right to left, because the board is').toContain('dir="rtl"');
  });

  it('prints an empty board as a result rather than a blank sheet', () => {
    const html = buildViolationsPrintHtml({
      title: 'T',
      subtitle: 'S',
      header: ['h'],
      rows: [],
      totals: [],
      rtl: false,
    });
    expect(html).toContain('class="empty"');
    expect(html, 'no table headers over nothing').not.toContain('<tbody></tbody>');
  });
});
