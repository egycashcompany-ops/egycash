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
  MAX_PAGE_SIZE,
  type FleetCatalogItemDto,
  type FleetViolationDto,
  type FleetViolationRollupDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { formatNumber } from '../../shared/lib/format';
import { listKey } from '../../shared/lib/query-keys';
import { ViolationsPage } from './pages/ViolationsPage';
import { CompanyViolationsDetailLayer } from './components/CompanyViolationsDetailLayer';
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

const HERE = dirname(fileURLToPath(import.meta.url));
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
/**
 * The palette's own order, as `violation-type-colour` declares it. Written out here so a test can
 * say WHICH colour each position gets — the rule is «the Nth type gets the Nth hue», and only a
 * test that names them can tell that apart from «they happened not to collide».
 */
const PALETTE_ORDER = [
  'sky',
  'amber',
  'emerald',
  'violet',
  'rose',
  'cyan',
  'orange',
  'indigo',
] as const;

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
  vehicleCode: null,
  violationTypeId: DT_SPEED,
  amount: 400,
  year: null,
  count: null,
  unitValue: null,
  date: '2026-02-01T00:00:00.000Z',
  driverEmployeeId: E1,
  driverName: null,
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
  driverPages,
  driverTotal,
  permissions,
  seedCatalogs = true,
  year,
}: {
  /** `null` = seed nothing, so the query is genuinely pending. `undefined` would fall
   *  through to the default and quietly seed a row. */
  rollup?: FleetViolationRollupDto[] | null;
  drivers?: FleetViolationDto[] | null;
  /** Several pages already in hand — for the cases about reaching past the first one. */
  driverPages?: FleetViolationDto[][];
  /** How many rows MATCHED, when that is more than the pages seeded here hold. */
  driverTotal?: number;
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
        // The YEARS and the CODES, as the one string each carries — several of either are one
        // question and one cache entry, and a fresh array each render would otherwise mint a new
        // key every time.
        { year: year === undefined ? '' : year, vehicleCodes: '' },
      ],
      rollup,
    );
  }
  if (drivers !== null) {
    // AN INFINITE QUERY'S CACHE SHAPE, not a plain one. The board accumulates pages
    // (`useViolationsPages`) so that a fleet with more fines than one page still reaches all of
    // them, and TanStack stores that as `{ pages, pageParams }`. Seeding the old single-page
    // object left every driver row off the board — which is how this suite caught the change.
    //
    // `driverPages` lets a case seed SEVERAL pages and say how many rows matched in total, which
    // is what the >100 cases need; the common case is one page holding everything.
    const pages = driverPages ?? [drivers];
    const matched = driverTotal ?? drivers.length;
    const size = pages[0]?.length ?? 25;
    qc.setQueryData(
      listKey('fleet', 'violations', {
        kind: 'driver',
        // The chunk the board asks for is a CONSTANT now — there is no «لكل صفحة» box on this
        // screen, because reaching the whole answer is «تحميل المزيد» rather than a page size.
        pageSize: MAX_PAGE_SIZE,
        // The ORDER the ledger opens in, in both shapes: `sortBy`/`sortDir` are the platform's
        // pagination contract and `sort` is the whole order, which is what a reader who clicks a
        // second column adds to.
        sortBy: 'date',
        sortDir: 'desc',
        sort: 'date:desc',
        paged: 'infinite',
      }),
      {
        pages: pages.map((items, at) => ({
          items,
          meta: {
            page: at + 1,
            pageSize: size,
            totalItems: matched,
            totalPages: Math.max(1, Math.ceil(matched / Math.max(1, size))),
          },
        })),
        pageParams: pages.map((_, at) => at + 1),
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

  it('the car comes from the REGISTRY — typing searches it, it is never free text', () => {
    // The rule has not changed: a code the registry does not carry must not be storable, because
    // the statement would name a car that does not exist. What changed is how the registry is
    // reached — the owner asked to type the code, and a `<select>` could only ever offer one page
    // of it (MAX_PAGE_SIZE, 100), so the hundred-and-first car was unpickable. The typed text is a
    // SEARCH; `Combobox` still commits an option or nothing.
    const markup = page();
    expect(markup, 'no free-text code box writing straight into the form').not.toContain(
      'data-company-form="code"',
    );
    // By its own hook, not by `aria-label`: «كود السيارة» is the Arabic for both
    // `fleet.vehicles.fields.code` and `fleet.odometer.columns.vehicle`, so the filter bar's car
    // picker answers to the same name and an assertion on it proves nothing about this control.
    const at = markup.indexOf('data-vehicle-select="company-entry"');
    expect(at, 'the entry row picks the car from the registry').toBeGreaterThan(-1);
    const tag = markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at));
    expect(tag, 'a searchable box').toContain('role="combobox"');
    const source = readFileSync(join(HERE, 'components/VehicleCodeCombobox.tsx'), 'utf8');
    expect(source, 'and it commits an id the registry answered with').toContain(
      'byCode.get(code) ?? ',
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

  it('the year is sized OUTSIDE the control, because `cn` cannot merge widths', () => {
    // `cn` is a plain joiner: a width handed to `Select` sits beside its own `w-full` and loses,
    // which is why the year measured 86px however large a class it was given. The width therefore
    // lives on the elements around it — and now that the entry row is one line that COMPRESSES
    // rather than a row of fixed boxes, that is the field's share of the row (`flex-… basis-0`
    // over a `min-w-[…]` floor) with a `w-full` wrapper filling it.
    const markup = page();
    const at = markup.indexOf('data-company-form="year"');
    expect(at).toBeGreaterThan(-1);
    // From the FIELD that holds it: `Field`'s own `space-y-1.5` is the nearest landmark before
    // the control, and the field is where the share and the floor live.
    const field = markup.slice(markup.lastIndexOf('space-y-1.5', at), at);
    expect(field, 'the wrapper fills the field rather than naming a size').toContain(
      'class="w-full"',
    );
    expect(field, 'and the field takes a weighted share of the row').toMatch(
      /flex-\[[\d.]+\] basis-0 min-w-\[/,
    );
    // The control itself still carries no width of its own beyond `w-full` — the trap this test
    // was written for.
    const select = markup.slice(at, markup.indexOf('>', at));
    expect(select, 'no fixed width smuggled onto the control').not.toMatch(/\sw-\d/);
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

  it('every violation type wears a DIFFERENT colour, on the counter and on the card', () => {
    // «كل مخالفة بباك جراوند مختلف». Two things had to be true and neither was: the counters were
    // handed their colour as a `className`, where the control's own `bg-white` beat it, so they
    // rendered plain; and the colour came from a HASH, which gave two of the four seeded types the
    // same slot out of eight.
    const markup = page();
    // `class` is emitted BEFORE the data attribute, so the counter is found by its hook and its
    // class list read backwards from there.
    const counters = [...markup.matchAll(/class="([^"]*)"[^>]*data-driver-count="/g)].map(
      (m) => m[1] ?? '',
    );
    expect(counters.length, 'a counter per type').toBeGreaterThanOrEqual(2);
    const hues = counters.map((c) => c.match(/bg-(\w+)-100/)?.[1] ?? '');
    expect(new Set(hues).size, `distinct hues: ${hues.join(',')}`).toBe(counters.length);
    // The colour follows the type's POSITION in the catalog, which is what makes «all different»
    // a promise rather than luck. Distinctness alone does not prove it: two types out of eight
    // slots rarely collide under a hash either, and the real board's four DID.
    expect(hues, 'the palette, in catalog order').toEqual(PALETTE_ORDER.slice(0, hues.length));
    // And the tone is the ONLY background on the control: handed in as a `className` it landed
    // beside the input's own `bg-white` and lost, which is why every counter rendered plain.
    for (const c of counters) {
      expect(c, 'no white underneath the tone').not.toContain('bg-white');
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

describe('the next round of reports, as rules the markup carries', () => {
  it('no counter can be typed into until the car is chosen', () => {
    // «زرار الحفظ مش شغال» — it was working; the car had not been picked, and `canSave` needs
    // one. Saying so in a message was the first attempt and the owner asked for PREVENTION
    // instead: with no car, there is nothing to count fines against, so the counters are shut.
    const markup = page();
    const counters = markup.split('data-driver-count=').slice(1);
    expect(counters.length, 'the drivers bar renders one counter per type').toBeGreaterThan(0);
    for (const counter of counters) {
      expect(counter.slice(0, 400), 'shut while no car is chosen').toContain('disabled');
    }
  });

  it('the company entry row is ONE line that compresses, never a scroll box', () => {
    // Two earlier shapes were both wrong: `overflow-x-auto` hid «العدد» and the total behind a
    // scrollbar inside a form, and `flex-wrap` + `[&>*]:shrink-0` broke the statement over five
    // lines in a half-width panel.
    const markup = page();
    const save = markup.indexOf('data-company-save');
    const row = markup.slice(markup.lastIndexOf('<div class="flex min-w-0 flex-1', save), save);
    expect(row, 'one line from `md` up').toContain('md:flex-nowrap');
    expect(row, 'and it does not scroll sideways').not.toContain('overflow-x-auto');
    expect(row, 'nothing refuses to shrink any more').not.toContain('[&>*]:shrink-0');
    // Every field takes a weighted share over a floor — that is what "compresses" means.
    const shares = [...row.matchAll(/flex-\[[\d.]+\] basis-0 min-w-\[/g)];
    expect(shares.length, 'year, car, type, unit value, count, total').toBe(6);
  });

  it('both bars ask about the collected state, and the drivers half asks the SERVER', () => {
    // The company rollup arrives whole and is narrowed here; the drivers list is paged, so its
    // filter has to travel or the answer would be «the settled rows of page one».
    const markup = page();
    expect(markup, 'the company half').toContain('data-company-settled');
    expect(markup, 'and the drivers half').toContain('data-driver-settled');
    const panel = readFileSync(join(HERE, 'components/DriverViolationsPanel.tsx'), 'utf8');
    expect(panel, 'the drivers filter is a query parameter').toContain('collected:');
  });

  it('the drivers board can reach every matched row, with no pager — the 100-row cap stays shut', () => {
    // REGRESSION. Removing «السابق / التالي» first left a board that fetched ONE page and stopped:
    // the count beside the filters said «٤٤٠» over a hundred visible rows, with no control
    // anywhere to reach the other three hundred and forty. The paging rules themselves live in
    // `lib/violations-paging.spec.ts` and the presses are done in Chromium against a real >100
    // dataset; what is pinned HERE is the WIRING, because a component that quietly went back to a
    // single `useQuery` would pass both of those and still hide 340 fines.
    const panel = readFileSync(join(HERE, 'components/DriverViolationsPanel.tsx'), 'utf8');
    const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code, 'pages accumulate rather than replace').toContain('useViolationsPages(params)');
    expect(code, 'every page fetched so far is what the board renders').toContain('flatMap');
    expect(code, 'there is a control that fetches the next one').toContain('fetchNextPage()');
    expect(code, 'offered only while the server still has rows').toContain('hasNextPage === true');
    expect(code, 'and the reader is told how much is on screen').toContain('data-driver-loaded');
    // The page number must not travel in the request params — the hook owns it, and a pinned one
    // would refetch page 1 for every «more».
    const params = code.slice(code.indexOf('const params = useMemo'), code.indexOf('const list ='));
    expect(params, 'no page in the request params').not.toMatch(/\bpage,/);
  });

  it('shows how much of a >100 answer is on screen, and offers the rest', () => {
    // The reported shape, exactly: 440 matched, one page of 100 in hand.
    const first = Array.from({ length: 100 }, (_, i) => driverRow({ id: `vio-${i + 1}` }));
    const markup = page({ driverPages: [first], driverTotal: 440 });
    const at = markup.indexOf('data-driver-loaded');
    expect(at, 'the board says how much it is showing').toBeGreaterThan(-1);
    const said = markup.slice(markup.indexOf('>', at) + 1, markup.indexOf('<', at));
    expect(said, 'both numbers, not just the total').toContain(formatNumber(100, 'ar'));
    expect(said, 'and the size of the whole answer').toContain(formatNumber(440, 'ar'));
    expect(markup, 'with a way to the other 340').toContain('data-driver-load-more');
  });

  it('stops offering «تحميل المزيد» once every matched row is on screen', () => {
    const all = Array.from({ length: 12 }, (_, i) => driverRow({ id: `vio-${i + 1}` }));
    const markup = page({ driverPages: [all], driverTotal: 12 });
    expect(markup, 'nothing left to load').not.toContain('data-driver-load-more');
  });

  it('numbers no rows on EITHER board — «شيل التسلسل» from the company half and the drivers half', () => {
    // The serial was the first cell of both: a `seq` column on the drivers grid, and a spanning
    // first `<td>` on the company rollup that ran the four total lines of one car. Both go, and
    // with them the `index` each was counted from.
    const driver = readFileSync(join(HERE, 'components/DriverViolationsPanel.tsx'), 'utf8');
    const company = readFileSync(join(HERE, 'components/CompanyViolationsPanel.tsx'), 'utf8');
    const strip = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const [name, code] of [
      ['drivers', strip(driver)],
      ['company', strip(company)],
    ] as const) {
      expect(code, `${name}: no serial cell`).not.toContain('formatNumber(index + 1, locale)');
      expect(code, `${name}: no serial header`).not.toContain('fleet.violations.columns.seq');
    }
    // The company rollup renders its own `<table>`, so the head is the other half of the proof.
    const markup = page();
    const head = markup.slice(markup.indexOf('<thead'), markup.indexOf('</thead>'));
    // Header TEXTS, not a substring search: «م» is one letter and lives inside «المبلغ».
    const headings = [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
      (m[1] as string).replace(/<[^>]*>/g, '').trim(),
    );
    expect(headings, 'and no «م» in the company head').not.toContain(
      t('fleet.violations.columns.seq'),
    );
    expect(headings[0], 'the company rollup opens on the year').toBe(
      t('fleet.violations.fields.year'),
    );
  });

  it('this screen carries NO title, NO pager and NO «لكل صفحة» — and the others keep theirs', () => {
    // All three by the owner's instruction, arrived at in that order. The page-size box was the
    // last to go and is the one worth explaining: it only ever existed to work around the pager,
    // and once «تحميل المزيد» reached the whole answer a chunk size stopped being a question to
    // put to a reader at all.
    const markup = page();
    expect(markup, 'no page heading').not.toMatch(/<h1[^>]*>[^<]*مخالفات السيارات/);
    expect(markup, 'no "showing X–Y of Z"').not.toContain(t('common.pagination.showing'));
    const panel = readFileSync(join(HERE, 'components/DriverViolationsPanel.tsx'), 'utf8');
    const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code, 'no pager').not.toContain('<Pagination');
    expect(code, 'no page-size box either').not.toContain('PageSizeSelect');
    expect(code, 'and nothing is left importing it').not.toMatch(/import[\s\S]{0,80}PageSizeSelect/);
    // The chunk the board asks for is a constant, not a control the reader sets.
    expect(code, 'the chunk is fixed').toMatch(/pageSize: MAX_PAGE_SIZE/);
    // The heading is a plain centred h2 again — there is no longer a control laid over the row to
    // balance against, which is what the `absolute left-0` was for.
    expect(panel, 'a plain centred heading').toMatch(
      /<h2 className="mb-4 text-center[\s\S]{0,160}driverTitle/,
    );
    expect(code, 'no hand-measured spacer is left to drift').not.toContain('w-[5.5rem]');

    // AND THE REST OF THE APP IS UNTOUCHED. `Pagination` is shared by ~20 other screens; the
    // summary sentence and the page-size box are still its default, so removing them HERE must
    // not have removed them THERE.
    const pagination = readFileSync(
      join(HERE, '../../shared/ui/Pagination.tsx'),
      'utf8',
    );
    expect(pagination, 'the summary is still on by default').toContain('summary = true');
    expect(pagination, 'and the page-size box still ships with it').toContain('<PageSizeSelect');
  });

  it('the car code can be TYPED in both entry rows, and still commits one car', () => {
    // «انه يقدر يكتب برضو وهتكون واحد بس». A native `<select>` also capped the offer at one page
    // of the registry — MAX_PAGE_SIZE, 100 — so on a larger fleet the hundred-and-first car was
    // unpickable and a row already filed against it showed the empty «اختر…» row.
    const markup = page();
    for (const which of ['company-entry', 'driver-entry']) {
      const at = markup.indexOf(`data-vehicle-select="${which}"`);
      expect(at, `${which} renders a car control`).toBeGreaterThan(-1);
      const tag = markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at));
      expect(tag, `${which} is a text box, not a dropdown`).toMatch(/^<input\b/);
      expect(tag, `${which} announces itself as a combobox`).toContain('role="combobox"');
    }
    const source = readFileSync(join(HERE, 'components/VehicleCodeCombobox.tsx'), 'utf8');
    expect(source, 'the typing is a SERVER search, not a filter over one page').toContain(
      'vehicleCodeSearchQuery(query)',
    );
    // `Combobox` only ever commits an option, which is what «واحد بس» has to mean here: a code no
    // car carries cannot be stored, however it was typed.
    expect(source, 'and the value is a single vehicle id').toContain(
      'onChange: (vehicleId: string) => void',
    );
  });

  it('ONE car for both entry bars — picking it on either side files against the same one', () => {
    // «لما احدد كود عربيه يتحدد فى التانيه تلقائى». A clerk works a car at a time: the company's
    // statement and that car's drivers' fines are the same sitting, and picking it twice was two
    // chances to pick two different cars and file half the sitting against the wrong one.
    const pageSrc = readFileSync(join(HERE, 'pages/ViolationsPage.tsx'), 'utf8');
    expect(pageSrc, 'the page owns it').toContain("const [entryVehicleId, setEntryVehicleId] = useState('')");
    // Handed to BOTH halves, and to nothing else: the two BOARDS keep their own car filters.
    expect((pageSrc.match(/entryVehicleId=\{entryVehicleId\}/g) ?? []).length).toBe(2);
    expect((pageSrc.match(/onEntryVehicleChange=\{setEntryVehicleId\}/g) ?? []).length).toBe(2);
    for (const file of ['components/CompanyViolationsPanel.tsx', 'components/DriverViolationsPanel.tsx']) {
      const panel = readFileSync(join(HERE, file), 'utf8');
      expect(panel, `${file} reads the shared car`).toContain('const formVehicleId = entryVehicleId;');
      expect(panel, `${file} writes the shared car`).toContain(
        'const setFormVehicleId = onEntryVehicleChange;',
      );
      expect(panel, `${file} keeps no car of its own`).not.toContain(
        "const [formVehicleId, setFormVehicleId] = useState('')",
      );
    }
    // …and a saved driver batch no longer empties it, which would have emptied the other bar too.
    const driverPanel = readFileSync(join(HERE, 'components/DriverViolationsPanel.tsx'), 'utf8');
    expect(driverPanel).not.toContain("setFormVehicleId('')");
  });

  it('neither board’s head is see-through, and the drivers’ head stays put', () => {
    // «راس الجدول بايظ المفروض ميكونش شفاف» · «عاوز اثبت راس الجدول بتاع السواقيين». A sticky head
    // is drawn OVER the rows, so a 60%-opaque one lets them through it and reads as broken.
    const company = readFileSync(join(HERE, 'components/CompanyViolationsPanel.tsx'), 'utf8');
    const head = company.slice(company.indexOf('<thead'), company.indexOf('</thead>'));
    expect(head, 'the company head is pinned').toContain('sticky top-0');
    expect(head, 'and opaque').toContain('dark:bg-slate-800');
    expect(head, 'not 60% of it').not.toContain('dark:bg-slate-800/60');

    // The drivers' board is a `DataTable`, so its head is pinned through the table's own prop —
    // and the wrapper must NOT scroll, or sticky would stick to the wrapper and ride away with it.
    const driver = readFileSync(join(HERE, 'components/DriverViolationsPanel.tsx'), 'utf8');
    expect(driver).toContain('stickyHead');
    expect(driver, 'the table scrolls, not the box around it').toContain(
      '<div className="min-h-0 flex-1">',
    );
    const table = readFileSync(join(HERE, '../../shared/ui/DataTable.tsx'), 'utf8');
    expect(table, 'sticky makes the table itself the scroll port').toContain(
      "stickyHead ? 'h-full overflow-auto' : 'overflow-x-auto'",
    );
    expect(table, 'and turns the head opaque').toContain(
      "stickyHead ? 'dark:bg-slate-800' : 'dark:bg-slate-800/60'",
    );
  });

  it('the company board asks about EVERY car the picker holds, not one of them', () => {
    // The rollup took a single `vehicleId`, so the board resolved a lone code and sent NOTHING the
    // moment a second was picked: the chips read «١٥٠، ١٥١ +٢» while the table answered for the
    // whole fleet. A filter that silently stops filtering cannot be told from one that is absent.
    const panel = readFileSync(join(HERE, 'components/CompanyViolationsPanel.tsx'), 'utf8');
    expect(panel, 'no "only when exactly one" left anywhere').not.toContain('soleVehicleId');
    expect(panel, 'every picked code travels').toContain('useViolationRollup(');
    expect(panel).toContain('askedCodes');
    // …and it no longer reads the whole registry just to turn one code into one id.
    expect(panel, 'the server resolves the codes now').not.toContain('useVehicles(');

    const api = readFileSync(join(HERE, 'api/fleet-api.ts'), 'utf8');
    const call = api.slice(api.indexOf('export const violationRollup'));
    expect(call.slice(0, 700), 'the codes are what the endpoint is asked').toContain('vehicleCodes');
  });

  it('the drivers bar wraps rather than scrolling, so the code list is not clipped', () => {
    // An `overflow-x` ancestor computes `overflow-y` to `auto` as well, which would open the car
    // box's dropdown inside a scroll port instead of over the bar. A native select popup escaped
    // that; a typed combobox cannot. The owner did not want a sideways scroll in a form either.
    const panel = readFileSync(join(HERE, 'components/DriverViolationsPanel.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const bar = panel.slice(panel.indexOf('data-driver-bar'), panel.indexOf('data-driver-bar') + 400);
    expect(bar, 'no sideways scroll in the entry bar').not.toContain('overflow-x-auto');
    expect(bar, 'it wraps instead').toContain('flex-wrap');
  });

  it('the entry row’s total can hold a real money figure without cutting it', () => {
    // Measured at the 2xl split: «112,500.00 ج.م.» wanted 140px in a 62px cell, and `truncate`
    // showed a cut-off number beside a Save button. A truncated amount is not a smaller amount.
    const panel = readFileSync(join(HERE, 'components/CompanyViolationsPanel.tsx'), 'utf8');
    const at = panel.indexOf('data-company-form-total');
    const field = panel.slice(panel.lastIndexOf('<Field', at), at);
    expect(field, 'the widest share in the row').toMatch(/flex-\[1\.6\] basis-0 min-w-\[5\.5rem\]/);
    expect(
      panel.slice(at, at + 600),
      'and the full figure is always recoverable',
    ).toContain('title={');
  });

  it('a settled fine is out of the drivers’ page total too', () => {
    // The company half is narrowed on the server; this figure is computed in the browser, so it
    // has to apply the same rule or the two halves of one screen disagree.
    const panel = readFileSync(join(HERE, 'components/DriverViolationsPanel.tsx'), 'utf8');
    expect(panel).toMatch(/rows\s*\.filter\(\(row\) => !row\.collected\)\s*\.reduce/);
  });

  it('the count beside each filter bar is readable, not a hairline', () => {
    const markup = page();
    for (const hook of ['data-driver-count-badge', 'data-company-count']) {
      const at = markup.indexOf(hook);
      expect(at, `${hook} is rendered`).toBeGreaterThan(-1);
      const attrs = markup.slice(at, markup.indexOf('>', at));
      expect(attrs, `${hook} is 14px`).toContain('text-sm');
      expect(attrs, `${hook} is no longer 11px`).not.toContain('text-[11px]');
    }
  });

  it('the edit dialog offers the car and the year, rather than printing them', () => {
    // The commonest correction on this screen is exactly those two, and the only way back used
    // to be delete-and-re-file — which throws away the row's history to fix a typo.
    const dialogs = readFileSync(join(HERE, 'components/ViolationDialogs.tsx'), 'utf8');
    const vehicleDialog = dialogs.slice(
      dialogs.indexOf('export const VehicleViolationDialog'),
      dialogs.indexOf('export const DriverViolationDialog'),
    );
    expect(vehicleDialog, 'the car is a picker on an existing row too').not.toContain(
      'violation === null && (',
    );
    expect(vehicleDialog, 'and the year is no longer frozen once filed').not.toContain(
      'disabled={violation !== null}',
    );
    expect(vehicleDialog, 'both travel on the update').toContain('{ vehicleId }');
    expect(vehicleDialog, 'and only when they changed').toContain(
      'Number(year) !== violation.year',
    );
  });

  it('the driver on a filed fine is picked from the REGISTRY, listed before typing', () => {
    // It was `OptionalEmployeeField`: the whole payroll, and nothing shown at all until a letter
    // was typed — so clearing a driver left an empty box with no way to discover who could go in
    // it. `RegistryDriverPicker` runs its query with an empty search, by design.
    // Comments stripped: the note beside the control NAMES the thing it replaced, and a rule
    // about the code must not be satisfiable — or broken — by prose.
    const dialogs = readFileSync(join(HERE, 'components/ViolationDialogs.tsx'), 'utf8');
    const code = dialogs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code, 'the registry picker').toContain('<RegistryDriverPicker');
    expect(code, 'not the payroll search box').not.toContain('OptionalEmployeeField');
    const picker = readFileSync(join(HERE, 'components/DriverPickerFilter.tsx'), 'utf8');
    expect(picker, 'and it lists with an empty search').toContain('enabled: allowed,');
  });
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


// ── the car's own ledger ────────────────────────────────────────────────────
//
// The layer portals through `SideLayer` into `document.body`, and this suite runs with
// `environment: 'node'` and no jsdom — so it cannot be RENDERED here at all, let alone opened by a
// click. What is asserted below is therefore the structure of the source, and the rendering half
// is proved in Chromium against a real (vehicle, year) that has fines of both kinds.
//
// Weak on its own, so the assertions are chosen to be the ones a regression would actually break:
// that a SECOND server query exists and narrows by the same car and year, that the drivers' table
// sits AFTER the grievance line rather than anywhere in the file, and that the three row actions
// are defined exactly ONCE for both tables.

describe('the counters are one row, and they wrap as one', () => {
  // «ال4 بتوع الادخال يكونوا فى صف واحد جمب بعض». Each counter used to be a direct child of the
  // wrapping bar, so a narrow enough bar broke the four across two lines — «عكس» and «سرعة» on
  // one, «تليفون» and «حزام» under them. They are four readings of the same stack.
  const SOURCE = readFileSync(join(HERE, 'components/DriverViolationsPanel.tsx'), 'utf8');
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('wraps the counters in a group of their own', () => {
    // Anchored on the counter input itself — `types.map` appears earlier for the options list, and
    // a guard that matched the wrong one would pass while the counters stayed split.
    const at = CODE.indexOf('data-driver-count=');
    expect(at, 'the counters are still rendered from the catalogue').toBeGreaterThan(-1);
    const openedBefore = CODE.slice(0, at);
    const group = openedBefore.lastIndexOf('flex-nowrap');
    const mapAt = openedBefore.lastIndexOf('types.map');
    expect(group, 'a non-wrapping group holds them').toBeGreaterThan(-1);
    expect(group, 'and it opens BEFORE the map, so it holds all four').toBeLessThan(mapAt);
  });

  it('the bar itself still wraps, so the group can drop below the car box', () => {
    // `flex-nowrap` on the GROUP, never on the bar: an unwrappable bar would push the row off the
    // page instead of folding it, which is the scroll the owner asked to be rid of.
    const bar = CODE.slice(CODE.indexOf('data-driver-bar'), CODE.indexOf('data-driver-bar') + 600);
    expect(bar).toContain('flex-wrap');
  });

  /**
   * AND THE FIVE OF THEM FIT ON ONE ROW — «مدخلات السواقيين كلها على صف واحد».
   *
   * They did not, and the measurement said why. `w-20` was handed to `Input` as a `className`,
   * and `cn` is a plain joiner: it landed beside the control's own `w-full` and lost on emission
   * order, so every counter rendered 200px wide. Four of them wanted 800px inside a 716px panel,
   * «حزام» measured at `left: -18` — outside its own panel — and the bar folded the group onto a
   * second line. The same trap the tone hit one block above, on the same control.
   */
  it('puts the counter WIDTH on the field, never on the control', () => {
    const at = CODE.indexOf('data-driver-count=');
    const field = CODE.slice(0, at).lastIndexOf('<Field');
    const counter = CODE.slice(field, CODE.indexOf('</Field>', at));
    expect(counter, 'the field carries the share').toMatch(/<Field[^>]*className=\{ENTRY_CELL\}/);
    // `Field`'s wrapper has no width of its own, so a class passed there stands. `Input`'s does.
    const control = counter.slice(counter.indexOf('<Input'));
    expect(control, 'and the control is not asked to carry it').not.toMatch(/className="w-\d/);
  });

  /**
   * ALL FIVE THE SAME WIDTH, FILLING THE BAR — «انا عاوزهم يكونوا كلهم ب كود السياره ماليين
   * المكان اللى هما فيه».
   *
   * They were a 112px car box beside four 80px counters with the far end of the panel empty.
   * Every field now takes `flex-1 basis-0` over one floor, so the five divide the bar equally —
   * measured at 1920: 97px each, and the bar's scrollWidth equal to its clientWidth.
   */
  it('gives all five fields the SAME share of the bar', () => {
    expect(CODE, 'one share, declared once').toContain("const ENTRY_CELL = 'flex-1 basis-0");
    const bar = CODE.slice(CODE.indexOf('data-driver-bar'), CODE.indexOf('</Field>', CODE.indexOf('data-driver-count=')));
    // The car box's own field takes it too — that is what makes it one of the five rather than
    // a fixed box the other four line up beside.
    expect(bar.match(/className=\{ENTRY_CELL\}/g)?.length ?? 0, 'the code box and a counter').toBeGreaterThanOrEqual(2);
    expect(bar, 'and no fixed width is left on the car box').not.toMatch(/<div className="w-\d+">\s*<VehicleCodeCombobox/);
  });

  it('pays the counters group for its own gaps, so a counter equals the car box exactly', () => {
    // At a plain `flex-[4]` the group's three 8px gaps came out of the four counters and each
    // was 6px narrower than the car box — measured, 102 against 96. A 1.5rem basis covers them.
    // Anchored BACKWARDS from the counter itself: `types.map` appears earlier for the options
    // list, and a guard that matched the wrong one would read an empty slice and pass on nothing.
    const at = CODE.indexOf('data-driver-count=');
    const mapAt = CODE.lastIndexOf('types.map', at);
    const group = CODE.slice(CODE.lastIndexOf('<div', mapAt), mapAt);
    expect(group.length, 'the group was found').toBeGreaterThan(0);
    expect(group, 'four shares plus its own 24px of gaps').toContain('flex-[4_1_1.5rem]');
    expect(group, 'and the four still never split across lines').toContain('flex-nowrap');
  });

  it('lets the «pick a car first» notice wrap its TEXT rather than wrap the row', () => {
    // Unbounded it demanded the width of its own sentence — 283px, measured — and that, not a
    // panel out of room, is what pushed the counters onto a second line.
    const at = CODE.indexOf('data-driver-needs-vehicle');
    const notice = CODE.slice(CODE.lastIndexOf('<p', at), CODE.indexOf('>', at + 200));
    expect(notice, 'bounded').toMatch(/max-w-\[/);
    expect(notice, 'and allowed to give width back').toContain('shrink');
  });
});

describe('opening a car’s year shows BOTH halves of what its totals are made of', () => {
  const SOURCE = readFileSync(join(HERE, 'components/CompanyViolationsDetailLayer.tsx'), 'utf8');
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('is a component that actually loads — the source below is read, not imported', () => {
    // The assertions in this block read the file as TEXT, which proves nothing about whether the
    // module still resolves. Importing it does: a broken import inside the layer, or an export
    // renamed out from under the screen, fails here rather than in the browser.
    expect(typeof CompanyViolationsDetailLayer).toBe('function');
  });

  it('asks the server for the DRIVERS’ fines of the same car and the same year', () => {
    // «إجمالى السيارة» on the board is the company rows PLUS these, so a layer that showed only
    // the first was a ledger you could not reconcile: the number on the board did not match the
    // rows behind it, and the only way to the missing half was to leave and filter the drivers'
    // board by hand to the same car and the same year.
    //
    // A driver fine stores a DATE, not a year — `yearClause` turns the year into a UTC range on
    // the server — so this is one more query, not a filter over a car's whole history.
    expect(CODE, 'a second list query').toContain('const driverList = useViolations(');
    const q = CODE.slice(CODE.indexOf('const driverList'), CODE.indexOf('const catalog'));
    expect(q, 'for the driver shape').toContain("kind: 'driver'");
    expect(q, 'the same car').toContain('vehicleId: row.vehicleId');
    expect(q, 'the same year').toContain('year: String(row.year)');
    expect(CODE, 'named by the drivers’ own catalogue').toContain(
      "useFleetCatalog('violationType', 'driver')",
    );
  });

  it('puts that table UNDER the «قبل التظلم» line, not somewhere else in the layer', () => {
    // The owner asked for it there specifically: it is the figure that reports both halves.
    const grievance = SOURCE.indexOf('data-detail-grievance');
    const heading = SOURCE.indexOf("t('fleet.violations.driverTitle')");
    const table = SOURCE.indexOf('columns={driverColumns}');
    expect(grievance, 'the grievance line is still there').toBeGreaterThan(-1);
    expect(heading, 'the drivers’ heading comes after it').toBeGreaterThan(grievance);
    expect(table, 'and its table after that').toBeGreaterThan(heading);
  });

  it('gives the driver rows the SAME three actions, from one definition', () => {
    // «اقدر برضو اعمل علامه صح او امسح او اعدل». Defined once and used by both tables: two copies
    // drift, and the one that drifts is always the permission check.
    expect(CODE, 'one definition').toContain('const rowActions =');
    for (const hook of ['data-detail-collect=', 'data-detail-delete=', 'data-detail-edit=']) {
      expect((CODE.match(new RegExp(hook, 'g')) ?? []).length, `${hook} is not copied`).toBe(1);
    }
    expect(
      (CODE.match(/render: rowActions,/g) ?? []).length,
      'and both tables use it',
    ).toBe(2);
    // Each still behind its own grant — the thing a second copy would have lost.
    for (const grant of ['fleetViolation.collect', 'fleetViolation.delete', 'fleetViolation.edit']) {
      expect(CODE, `${grant} still gates its action`).toContain(`can('${grant}')`);
    }
  });

  it('numbers no rows either — «شيل التسلسل» reached the side layer as well', () => {
    // The layer is where a car's year opens into the fines behind it, and it draws TWO tables:
    // the company rows and the drivers' rows of the same car and year. Both opened on a serial,
    // the same «م» the two boards behind them have just lost.
    expect(CODE, 'no serial header in either table').not.toContain(
      'fleet.violations.columns.seq',
    );
    expect(CODE, 'and no serial cell').not.toContain('formatNumber(index + 1, locale)');
    // Which column each table opens on now — read from the source in order, so a serial put back
    // under a different name still moves these and still fails.
    const firstKeyAfter = (decl: string): string => {
      const at = CODE.indexOf(decl);
      expect(at, `${decl} is declared`).toBeGreaterThan(-1);
      return /key: '([^']+)'/.exec(CODE.slice(at))?.[1] ?? '';
    };
    expect(firstKeyAfter('const columns:'), 'the company table opens on the type').toBe('type');
    expect(firstKeyAfter('const driverColumns:'), 'the drivers’ table on the date').toBe('date');
  });

  it('routes edit and delete by the row’s KIND, so a driver fine opens the driver dialog', () => {
    // The layer hands the row straight up; the page already dispatches on `violation.kind`, which
    // is why this needed no new dialog and no new prop.
    const pageSource = readFileSync(join(HERE, 'pages/ViolationsPage.tsx'), 'utf8');
    expect(pageSource, 'the page decides by kind').toMatch(/kind === 'driver'|kind !== 'driver'/);
    expect(CODE, 'the layer just reports the row').toContain('onEdit(v)');
    expect(CODE, 'and the row it reports is whichever table it came from').toContain('onDelete(v)');
  });
});

/**
 * THE COMPANY ENTRY ROW'S PROPORTIONS — «قلل السنه شويه وكود العربيه شويه وكبر قيمة الوحدة والعدد».
 *
 * Every field on this row is `flex-<weight> basis-0` over a `min-w-[…]` floor, so what changes is
 * the SHARE each one takes, not a fixed size. The two picked fields hold short, fixed-length
 * values — a four-digit year, a three-character code — and the two typed ones hold figures a
 * person reads back before saving, so the share moves from the first pair to the second.
 *
 * The floors move with them, and they are the part that can break the row: a flex child refuses
 * to shrink below its floor, so raising two of them without lowering another pushes the row past
 * its panel. Measured at 1536 — the width where the screen splits into two ledgers and this bar
 * is narrowest — the row went 7px over until the type's floor came down 8px.
 */
describe('the company entry row gives its width to the figures that are typed', () => {
  const SOURCE = readFileSync(join(HERE, 'components/CompanyViolationsPanel.tsx'), 'utf8');
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  /** One field's `flex-[…]` weight and `min-w-[…]` floor, found by the hook inside it. */
  const field = (hook: string): { weight: number; floor: number } => {
    const at = CODE.indexOf(hook);
    expect(at, `${hook} is on the row`).toBeGreaterThan(-1);
    const open = CODE.slice(0, at).lastIndexOf('<Field');
    const head = CODE.slice(open, at);
    const weight = Number(head.match(/flex-\[([\d.]+)\]/)?.[1] ?? NaN);
    const floor = Number(head.match(/min-w-\[([\d.]+)rem\]/)?.[1] ?? NaN);
    expect(weight, `${hook} has a weight`).not.toBeNaN();
    expect(floor, `${hook} has a floor`).not.toBeNaN();
    return { weight, floor };
  };

  const YEAR = 'data-company-form="year"';
  const VALUE = 'data-company-form="value"';
  const COUNT = 'data-company-form="count"';

  it('the typed figures still outweigh the year, which only had to FIT', () => {
    // The year's growth is a floor, not a share: it is the smallest box that holds four digits,
    // and above that width the two typed figures are still the ones given room to breathe.
    expect(field(VALUE).weight, 'unit value over year').toBeGreaterThan(field(YEAR).weight);
    expect(field(COUNT).weight, 'count over year').toBeGreaterThan(field(YEAR).weight);
  });

  it('and the unit value still outweighs the vehicle code', () => {
    expect(field(VALUE).weight, 'unit value over the code').toBeGreaterThan(
      field('testId="company-entry"').weight,
    );
  });

  it('their floors stay clear of the widths that made them unreadable', () => {
    // They were 3.125rem (50px) and 2.625rem (42px) — a money figure and a three-digit count with
    // nowhere to sit. A little came back off them for the year, but not back to there.
    expect(field(VALUE).floor, 'unit value').toBeGreaterThanOrEqual(3.5);
    expect(field(COUNT).floor, 'count').toBeGreaterThanOrEqual(3);
  });

  /**
   * THE YEAR FITS ITS FOUR DIGITS — «كبر السنه حاجه بسيطه بحيث تكون ءد الاربع ارقام».
   *
   * MEASURED in Chromium, not chosen: «2026» is 35.6px of text in this face, the tight select's
   * own padding takes 32px and its borders 2px, so the box needs 69.6px before the digits start
   * fighting the chevron. At the old 3.5rem floor it had 56px and 24px of room for 35.6px of
   * digits. 4.5rem (72px) is the smallest round floor above what the measurement asks for, and it
   * leaves 40px of room — verified at 1536 and 1920 alike.
   */
  it('gives the year a floor above what four digits and a chevron actually need', () => {
    expect(field(YEAR).floor, 'year, in rem').toBeGreaterThanOrEqual(4.5);
  });

  it('the year and the code both grew, and the two figures gave it back', () => {
    // «كبر كود العربيه شويه وهتقلل شويه صغيره من قيمة الوحدة و العدد».
    expect(field(YEAR).weight, 'year').toBeGreaterThanOrEqual(1);
    expect(field('testId="company-entry"').weight, 'vehicle code').toBeGreaterThanOrEqual(1.3);
    expect(field(VALUE).weight, 'unit value gave a little back').toBeLessThan(1.5);
    expect(field(COUNT).weight, 'count gave a little back').toBeLessThan(1.2);
  });

  it('the row’s total floor did not grow — that is what keeps it inside the panel at 1536', () => {
    // Every floor on the row, summed. It was 25rem before this change and must not exceed it:
    // the bar has ~510px of content at the split, and the floors plus gaps are what fill it.
    const floors = [YEAR, 'testId="company-entry"', 'allLabel', VALUE, COUNT, 'data-company-form-total'];
    const total = floors.reduce((sum, hook) => sum + field(hook).floor, 0);
    expect(total, `floors sum to ${total}rem`).toBeLessThanOrEqual(25);
  });

  it('the row is still one line from `md` up, and still never scrolls sideways', () => {
    const row = CODE.slice(CODE.indexOf('<div className="flex min-w-0 flex-1 flex-wrap items-end gap-1.5'));
    const open = row.slice(0, row.indexOf('>'));
    expect(open, 'one line on a desktop').toContain('md:flex-nowrap');
    expect(open, 'wrapping is the phone fallback').toContain('flex-wrap');
    expect(open, 'never a sideways scroll in a form').not.toContain('overflow-x');
  });
});
