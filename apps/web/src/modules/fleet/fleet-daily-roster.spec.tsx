// The DAILY roster board (§4.5) — the day, and the two sources that make it.
//
// This screen is the fixed board's sibling and the difference is the whole point: it has a DATE.
// Everything asserted here follows from that — the past is not plannable, a vehicle's workshop
// visit is a fact about the selected day, a driver's availability is a verdict about that day,
// and the standing crew (§2.7b) is only ever a STARTING POINT for a day nobody has planned yet.
//
// The web suite runs with `environment: 'node'` and no jsdom, so nothing drags: what a drop means
// is the server's (`roster.service.ts`, covered by the integration suite), the drag ATTRIBUTES
// are read out of the markup here, and the interaction itself is verified in a browser.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type FleetRosterDayDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { RosterPage } from './pages/RosterPage';
import { filterDrivers } from './lib/driver-search';
import { rosterDraftKey } from './lib/draft-storage';
import { rosterSource } from './roster-spec-sources';

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * The screen is no longer one file: a page shell, one board model, the computer's board and the
 * parts both boards share («شاشه الكبيوتر اعملها زى باقى شاشات الحركة الجديده ك ui»). `RAW` is every
 * file of it as written; `SOURCE` is "the desktop page" — what `<RosterPage/>` draws without a window
 * — as CODE, the headers explaining the rules at length would match either way.
 */
const RAW = rosterSource(['shell', 'model', 'desk', 'shared', 'touch'], { raw: true });
const SOURCE = rosterSource(['shell', 'model', 'desk', 'shared']);
/** The computer's board alone, for claims about the table, its cells and its panel. */
const DESK = rosterSource(['desk']);
/** The board model alone (`useRosterBoard`) — the draft, the edits and the save. */
const MODEL = rosterSource(['model']);
const VIEW_SOURCE = readFileSync(join(HERE, 'lib/roster-view.ts'), 'utf8');
const SERVICE = readFileSync(
  join(HERE, '../../../../api/src/modules/fleet/roster/roster.service.ts'),
  'utf8',
);

const V1 = '650000000000000000000001';
const V2 = '650000000000000000000002';
const E1 = '650000000000000000000011';
const E2 = '650000000000000000000012';
const E3 = '650000000000000000000013';
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
) => ({
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

const BOARD: FleetRosterDayDto = {
  date: `${day(1)}T00:00:00.000Z`,
  rows: [
    row(V1, '150', { missionTypeId: MT, driver1EmployeeId: E1 }),
    row(V2, '151', { inMaintenance: true }),
  ],
  availableDrivers: [
    { employeeId: E1, assignedVehicleId: V1 },
    { employeeId: E3, assignedVehicleId: null },
  ],
  unavailableDrivers: [{ employeeId: E2, reason: 'hrLeave' }],
};

const client = (board: FleetRosterDayDto = BOARD, date = day(1)): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['fleet', 'roster', 'day', date], board);
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
  // FLEET's own people list — see the fixed-roster spec beside this one.
  qc.setQueryData(
    ['fleet', 'people'],
    (
      [
        [E1, 'أحمد محمد'],
        [E2, 'محمد محمود'],
        [E3, 'سعيد سعد'],
      ] as const
    ).map(([employeeId, fullNameAr]) => ({
      employeeId,
      code: 'HR-1',
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
  permissions = ['fleetRoster.view', 'fleetRoster.plan'],
  date = day(1),
  qc = client(),
} = {}): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/fleet/roster?date=${date}`]}>
          <RosterPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);

/**
 * Is the button carrying `marker` actually disabled?
 *
 * Asserting `.toContain('disabled')` on the tag is NOT sound: every `Button` ships
 * `disabled:cursor-not-allowed disabled:opacity-70` in its class list, so that substring is
 * present whatever the state. Only the rendered ATTRIBUTE distinguishes them.
 */
const buttonDisabled = (markup: string, marker: string): boolean => {
  const at = markup.indexOf(marker);
  if (at === -1) throw new Error(`no button marked ${marker}`);
  const tag = markup.slice(markup.lastIndexOf('<button', at), markup.indexOf('>', at) + 1);
  return / disabled=""/.test(tag) || / disabled>/.test(tag);
};

/** The mission `<select>` of ONE row, found by the aria-label the cell gives it. '' when absent. */
const missionCell = (markup: string, code: string): string => {
  const at = markup.indexOf(`${code} · ${t('fleet.roster.fields.mission')}`);
  if (at === -1) return '';
  return markup.slice(markup.lastIndexOf('<select', at), markup.indexOf('</select>', at) + 9);
};

// ── 1. the day is a PLAN forward and a RECORD backward ──────────────────────

describe('the assignment date', () => {
  it('opens on today and takes any future day', () => {
    expect(render({ date: day(0), qc: client(BOARD, day(0)) })).toContain(`value="${day(0)}"`);
    expect(SOURCE, 'the floor is one function, used by the guard and the read-only rule').toContain(
      'earliestPlannableDay()',
    );
    expect(render({ date: day(1) })).toContain(`value="${day(1)}"`);
    expect(render({ date: day(45), qc: client(BOARD, day(45)) })).toContain(`value="${day(45)}"`);
  });

  it('SHOWS a past day the URL asks for, rather than sending the reader to today', () => {
    // Yesterday's crew is the thing operations asks for most often after tomorrow's. The board
    // used to clamp `?date=` to today, so it could not be looked at at all — the floor now
    // governs what may be EDITED, and nothing about what may be read.
    const past = { ...BOARD, date: `${day(-30)}T00:00:00.000Z` };
    const markup = render({ date: day(-30), qc: client(past, day(-30)) });
    expect(markup, 'the day asked for').toContain(`value="${day(-30)}"`);
    expect(markup, 'and its rows').toContain('>150<');
    expect(markup, 'with the crew it was planned with').toContain('أحمد محمد');
  });

  it('offers the step back — reading yesterday is one button away', () => {
    const markup = render({ date: day(0), qc: client(BOARD, day(0)) });
    const at = markup.indexOf(t('fleet.roster.prevDay'));
    const tag = markup.slice(markup.lastIndexOf('<button', at), markup.indexOf('>', at) + 1);
    expect(tag, 'yesterday is readable').not.toMatch(/ disabled=""| disabled>/);
  });

  it('names the day box the stepper and its calendar open — a hidden box is not a focus target', () => {
    // Both the date button and the cyan calendar move the focus into the box before the picker
    // opens: it is out of the Tab order, but a keyboard or a screen reader lands on «التاريخ».
    const markup = render({ date: day(1) });
    const box = markup.slice(
      markup.lastIndexOf('<input', markup.indexOf(`value="${day(1)}"`)),
      markup.indexOf('>', markup.indexOf(`value="${day(1)}"`)) + 1,
    );
    expect(box).toContain('type="date"');
    expect(box).toContain(`aria-label="${t('fleet.roster.date')}"`);
    expect(box).not.toContain('aria-hidden');
  });

  it('is refused SERVER-side too — the UI is not the guard', () => {
    // The floor above is a courtesy. This is the rule.
    expect(SERVICE, 'the service compares against today').toContain(
      'const todayUtc = utcDay(new Date())',
    );
    expect(SERVICE, 'and refuses what is earlier').toContain('PAST_DATE');
    expect(
      SERVICE,
      'in the SAME utcDay the board uses — not a second date interpretation',
    ).toContain('utcDay(input.date)');
  });
});

// ── 2. the mission filter, from the catalog ─────────────────────────────────

describe('the mission-type filter', () => {
  it('is the missionType catalog, never workType', () => {
    expect(SOURCE, 'the app’s own catalog select').toContain('<CatalogSelect');
    expect(SOURCE, 'on the mission vocabulary').toContain('kind="missionType"');
    expect(SOURCE, 'the workshop’s vocabulary has no place here').not.toContain('workType');
    const api = readFileSync(join(HERE, 'api/fleet-api.ts'), 'utf8');
    expect(api, 'and no endpoint was added for it').not.toMatch(/mission-type|missionTypes\(/);
  });

  it('narrows the board to one mission', () => {
    const both: FleetRosterDayDto = {
      ...BOARD,
      rows: [row(V1, '150', { missionTypeId: MT }), row(V2, '151', { missionTypeId: null })],
    };
    const all = render({ qc: client(both) });
    expect(all).toContain('150');
    expect(all).toContain('151');
    const filtered = renderToStaticMarkup(
      <Provider store={store(['fleetRoster.view', 'fleetRoster.plan'])}>
        <QueryClientProvider client={client(both)}>
          <MemoryRouter initialEntries={[`/fleet/roster?date=${day(1)}&mission=${MT}`]}>
            <RosterPage />
          </MemoryRouter>
        </QueryClientProvider>
      </Provider>,
    );
    const body = filtered.slice(filtered.indexOf('<tbody'), filtered.indexOf('</tbody>'));
    expect(body, 'the mission’s vehicle stays').toContain('150');
    expect(body, 'the one without it goes').not.toContain('151');
  });
});

// ── 3. counters ─────────────────────────────────────────────────────────────

describe('the day’s counters', () => {
  it('counts the projection, and names missions from the catalog', () => {
    const markup = render();
    expect(markup, 'إجمالي').toContain('data-counter="total"');
    expect(markup, 'صيانة').toContain('data-counter="workshop"');
    expect(markup, 'تشغيل').toContain('data-counter="assigned"');
    // One counter per ACTIVE catalog mission — a vocabulary nobody wrote into the code.
    expect(markup, 'the catalog’s own name').toContain('نقل أموال (يومي)');
    expect(markup, 'keyed by the catalog id').toContain(`data-counter="${MT}"`);
    expect(SOURCE, 'no hardcoded mission list').not.toMatch(/'(سفر|مسائي|محصنة|شلاتين)'/);
  });

  it('reports what the board actually holds', () => {
    const markup = render();
    // 2 vehicles, 1 in the workshop, 1 carrying a plan — in LATIN digits, as the approved computer
    // board prints every figure («اعتمد» on D1, «14 سيارة» and the chips in Latin digits).
    const chip = (key: string): string => {
      const idx = markup.indexOf(`data-counter="${key}"`);
      return markup.slice(idx, markup.indexOf('</button>', idx));
    };
    expect(chip('total')).toContain('>2<');
    expect(chip('workshop')).toContain('>1<');
    expect(chip('assigned')).toContain('>1<');
    expect(markup.slice(markup.indexOf('data-counter="total"')), 'no Eastern digit').not.toMatch(
      /[٠-٩]/u,
    );
  });
});

// ── 3b. the counters are FILTERS ────────────────────────────────────────────
//
// This suite has no DOM, so a click cannot be dispatched. What it can prove is both halves of the
// mechanism: that each chip is a real control carrying the right target (`data-counter` plus the
// `aria-pressed` state), and that arriving at that target actually narrows the board — which is
// the same way the mission dropdown above is tested. The rule itself is exercised as a function
// in `lib/roster-view.spec.ts`.

/** Render the board at a URL, so a chip's destination can be visited the way a click reaches it. */
const at = (query: string, board: FleetRosterDayDto = FILTERS_BOARD): string =>
  renderToStaticMarkup(
    <Provider store={store(['fleetRoster.view', 'fleetRoster.plan'])}>
      <QueryClientProvider client={client(board)}>
        <MemoryRouter initialEntries={[`/fleet/roster?date=${day(1)}${query}`]}>
          <RosterPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

/** Just the table body — what the board is SHOWING. */
const tbody = (markup: string): string =>
  markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tbody>'));

/**
 * A car's ROW in that body, by its own mark — not its bare code: the cells' classes hold figures
 * too (the laptop's `max-[1535px]:` holds «153»), so a bare code could be found in a class.
 */
const car = (code: string): string => `data-car="${code}"`;

/** Is this chip drawn as the one being applied? */
const chipActive = (markup: string, key: string): boolean => {
  const at_ = markup.indexOf(`data-counter="${key}"`);
  if (at_ === -1) throw new Error(`no counter ${key}`);
  const tag = markup.slice(markup.lastIndexOf('<button', at_), markup.indexOf('>', at_) + 1);
  return tag.includes('aria-pressed="true"');
};

/**
 * A day with all four shapes at once, so every chip has something to include AND something to
 * exclude. A fixture where a filter happens to keep everything proves nothing.
 *   150 — mission MT, a driver          → تشغيل, MT
 *   151 — in the workshop, no plan      → صيانة
 *   152 — in the workshop AND mission MT → صيانة, تشغيل, MT   (the overlap)
 *   153 — nothing at all                → only إجمالي
 */
const V3 = '650000000000000000000003';
const V4 = '650000000000000000000004';
const FILTERS_BOARD: FleetRosterDayDto = {
  ...BOARD,
  rows: [
    row(V1, '150', { missionTypeId: MT, driver1EmployeeId: E1 }),
    row(V2, '151', { inMaintenance: true }),
    row(V3, '152', { inMaintenance: true, missionTypeId: MT }),
    row(V4, '153'),
  ],
};

describe('the counters filter the board', () => {
  it('renders each chip as a real button that says whether it is applied', () => {
    // A tinted span with an onClick is not reachable by keyboard and announces nothing.
    const markup = at('');
    for (const key of ['total', 'workshop', 'assigned', MT]) {
      const idx = markup.indexOf(`data-counter="${key}"`);
      expect(idx, key).toBeGreaterThan(-1);
      expect(markup.lastIndexOf('<button', idx), `${key} is a button`).toBeGreaterThan(
        markup.lastIndexOf('<span', idx),
      );
    }
  });

  it('«إجمالي» shows every row, and is the state with no filter on', () => {
    const body = tbody(at(''));
    for (const code of ['150', '151', '152', '153']) expect(body, code).toContain(car(code));
    expect(chipActive(at(''), 'total'), 'إجمالي is the default').toBe(true);
  });

  it('«صيانة» shows only the cars the workshop holds', () => {
    const body = tbody(at('&view=workshop'));
    expect(body).toContain(car('151'));
    expect(body).toContain(car('152'));
    expect(body, 'not the working one').not.toContain(car('150'));
    expect(body, 'nor the idle one').not.toContain(car('153'));
  });

  it('«تشغيل» shows only the cars carrying a plan', () => {
    const body = tbody(at('&view=assigned'));
    expect(body).toContain(car('150'));
    expect(body, 'in the workshop but still carrying a mission').toContain(car('152'));
    expect(body, 'workshop with no plan').not.toContain(car('151'));
    expect(body, 'nothing at all').not.toContain(car('153'));
  });

  it('a MISSION chip narrows to that mission — through the dropdown’s own parameter', () => {
    const body = tbody(at(`&mission=${MT}`));
    expect(body).toContain(car('150'));
    expect(body).toContain(car('152'));
    expect(body).not.toContain(car('151'));
    expect(body).not.toContain(car('153'));
    // One axis, one parameter: the chip writes `mission`, so the select follows it.
    expect(SOURCE, 'no second copy of mission filtering').not.toContain('view: item.id');
  });

  it('marks the applied chip and only that one', () => {
    const workshop = at('&view=workshop');
    expect(chipActive(workshop, 'workshop')).toBe(true);
    expect(chipActive(workshop, 'total'), 'إجمالي steps aside').toBe(false);
    expect(chipActive(workshop, 'assigned')).toBe(false);
    expect(chipActive(workshop, MT)).toBe(false);

    const mission = at(`&mission=${MT}`);
    expect(chipActive(mission, MT)).toBe(true);
    expect(chipActive(mission, 'total')).toBe(false);
  });

  it('keeps every chip’s own colour whether or not it is applied', () => {
    // The colour tells the six apart; recolouring the applied one would spend it on a state the
    // ring already carries.
    const idle = at('');
    const applied = at('&view=workshop');
    const tone = (markup: string, key: string): string => {
      const idx = markup.indexOf(`data-counter="${key}"`);
      const tag = markup.slice(markup.lastIndexOf('<button', idx), markup.indexOf('>', idx) + 1);
      // Everything the ACTIVE state adds, removed — what is left is the chip's own colour.
      return (/class="([^"]*)"/.exec(tag)?.[1] ?? '')
        .replace(/ring-2 ring-offset-1 ring-offset-white dark:ring-offset-\[#111827\]|ring-0/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };
    for (const key of ['total', 'workshop', 'assigned', MT]) {
      expect(tone(idle, key), key).toBe(tone(applied, key));
    }
    // …and the six do not share one.
    const tones = ['total', 'workshop', 'assigned', MT].map((k) => tone(idle, k));
    expect(new Set(tones).size).toBe(tones.length);
  });

  it('combines with the code search and the mission — AND, never instead-of', () => {
    // Workshop ∩ mission = 152 alone; adding a search that excludes it empties the board.
    expect(tbody(at(`&view=workshop&mission=${MT}`))).toContain('152');
    expect(tbody(at(`&view=workshop&mission=${MT}`)), 'workshop without the mission').not.toContain(
      '151',
    );
    expect(
      tbody(at(`&view=workshop&mission=${MT}`)),
      'the mission outside the workshop',
    ).not.toContain('150');
    expect(
      tbody(at(`&view=workshop&mission=${MT}&q=153`)),
      'a contradiction shows nothing',
    ).not.toContain('152');
  });

  it('ignores a view it does not know instead of emptying the board', () => {
    const body = tbody(at('&view=nonsense'));
    for (const code of ['150', '151', '152', '153']) expect(body, code).toContain(code);
  });
});

describe('the counters count the DAY, never the filtered rows', () => {
  /** The number printed on one chip. */
  const shown = (markup: string, key: string): string => {
    const idx = markup.indexOf(`data-counter="${key}"`);
    const tag = markup.slice(idx, markup.indexOf('</button>', idx));
    return tag.slice(tag.lastIndexOf('<span'), tag.lastIndexOf('</span>'));
  };

  it('reads the same under every filter — this is the whole point', () => {
    // 4 vehicles: 2 in the workshop, 2 carrying a plan, 2 on mission MT. Narrowing the table to
    // one of those must not make the other chips report their own filtered view — a tally that
    // changes when you filter it is a tally of the filter, not of the day.
    const unfiltered = at('');
    const totals = ['total', 'workshop', 'assigned', MT].map((k) => shown(unfiltered, k));
    for (const query of ['&view=workshop', '&view=assigned', `&mission=${MT}`, '&q=150']) {
      const markup = at(query);
      expect(
        ['total', 'workshop', 'assigned', MT].map((k) => shown(markup, k)),
        query,
      ).toEqual(totals);
    }
  });

  it('counts the whole day even when the table shows one row', () => {
    const markup = at('&q=153');
    expect(tbody(markup), 'the table is narrowed').not.toContain('151');
    // Latin digits, as the approved computer board prints every figure («اعتمد» on D1).
    // The figure exactly: the span's text ends the slice, so «>4» is 4 and never 14 or 24.
    expect(shown(markup, 'total'), 'إجمالي still counts four').toMatch(/>4$/u);
    expect(shown(markup, 'workshop'), 'صيانة still counts two').toMatch(/>2$/u);
  });
});

describe('Reset', () => {
  it('is offered only when something is filtered', () => {
    // The reset is the new boards' own — the FilterBar's red button at the end of the dark bar
    // («شاشه الكبيوتر اعملها زى باقى شاشات الحركة الجديده ك ui») — and keeps its rule: only when
    // something is filtered.
    const reset = `aria-label="${t('common.filters.clear')}"`;
    const bar = (markup: string): string => {
      const from = markup.indexOf('data-roster-filters');
      expect(from, 'the filter bar').toBeGreaterThan(-1);
      return markup.slice(from, markup.indexOf('data-roster-table', from));
    };
    expect(bar(at('')), 'nothing to undo').not.toContain(reset);
    for (const query of ['&q=150', `&mission=${MT}`, '&view=workshop', '&view=assigned']) {
      expect(bar(at(query)), query).toContain(reset);
    }
    expect(SOURCE, 'the bar is told what is filtered').toContain(
      '<FilterBar hasActiveFilters={m.filtered} onClear={resetFilters}>',
    );
  });

  it('clears q, mission, view and the unavailable reasons together — and leaves the DAY alone', () => {
    // The button is one `patch` of exactly four keys — the unavailable panel's `unavailable` is a
    // remembered filter like the others; `date` is what the screen is about, not a filter, and a
    // reset that jumped back to today would throw away the day somebody navigated to.
    expect(SOURCE).toContain('patch({ q: null, mission: null, view: null, unavailable: null })');
    expect(SOURCE, 'the day survives a reset').not.toMatch(/patch\(\{ q: null[^}]*date: null/u);
  });

  it('brings every row back and returns «إجمالي» to the applied state', () => {
    // Cleared is the same address as never-filtered, so this is what the button lands on.
    const cleared = at('');
    for (const code of ['150', '151', '152', '153']) expect(tbody(cleared), code).toContain(code);
    expect(chipActive(cleared, 'total')).toBe(true);
    for (const key of ['workshop', 'assigned', MT])
      expect(chipActive(cleared, key), key).toBe(false);
  });
});

describe('a car the workshop holds is red, whole', () => {
  /** The <tr> containing a code. */
  const rowOf = (markup: string, code: string): string => {
    const body = tbody(markup);
    const found = body.split('<tr').find((r) => r.includes(code));
    if (found === undefined) throw new Error(`no row ${code}`);
    return found;
  };

  it('tints the row, not just a badge', () => {
    // The ROW carries the tint, by its own mark — and the board's table paints it the workshop's
    // rose, OPAQUE: the pinned «إجراءات» cell takes its row's colour, and a see-through rose would
    // show the seats scrolling under it at 1280px (approved D1 / D3, «اعتمد»).
    const markup = at('');
    expect(rowTag(markup, '151'), 'the workshop’s car').toContain('data-tint="workshop"');
    expect(DESK, 'rose, laid over the board').toContain(
      '[&_tbody_tr[data-tint=workshop]]:!bg-[#fff1f2]',
    );
    expect(DESK, 'and dark mode too').toContain(
      'dark:[&_tbody_tr[data-tint=workshop]]:!bg-[#291021]',
    );
  });

  /**
   * The row's OWN tag, where the tint lives. The row's bin is rose too — «اعملى الالوان دى», the
   * owner's colours for the actions — so «no rose» is asked of the `<tr>`, not of its cells.
   */
  const rowTag = (markup: string, code: string): string => {
    const row = rowOf(markup, code);
    return row.slice(0, row.indexOf('>'));
  };

  it('leaves an ordinary car alone', () => {
    const markup = at('');
    expect(rowTag(markup, '150')).not.toContain('data-tint');
    expect(rowTag(markup, '153')).not.toContain('data-tint');
  });

  it('reads `inMaintenance`, never the registry’s `inWorkshop`', () => {
    // `inWorkshop` is where the car is RIGHT NOW; this board plans a date, often a future one.
    expect(SOURCE).toContain('row.inMaintenance');
    expect(SOURCE, 'the registry flag has no place on a dated board').not.toContain(
      'row.inWorkshop',
    );
  });

  it('does not treat a mere ASSIGNMENT as the workshop', () => {
    // 150 carries a mission and a driver and is not in the workshop; 153 is stored-but-empty.
    const markup = at('');
    expect(rowTag(markup, '150'), 'a plan is not a workshop visit').not.toContain('data-tint');
    expect(rowTag(markup, '152'), 'and a car with both is still red').toContain(
      'data-tint="workshop"',
    );
  });

  it('keeps the tint under every filter', () => {
    for (const query of ['', '&view=workshop', `&mission=${MT}`, '&q=152']) {
      const markup = at(query);
      if (!tbody(markup).includes('152')) continue;
      expect(rowTag(markup, '152'), query).toContain('data-tint="workshop"');
    }
  });

  it('changes no rule: the drop is still refused and the server still enforces FR-5', () => {
    expect(SOURCE, 'the drop guard is untouched').toContain(
      'const droppable = mayPlan && !row.inMaintenance && !needsFirst',
    );
    expect(SERVICE, 'and FR-5 still throws server-side').toContain('unassignable (FR-5)');
  });
});

describe('a car the workshop holds takes no mission', () => {
  /** The mission `<select>` of one row, as a tag — '' when the row has none. */
  const missionTag = (markup: string, code: string): string => {
    const at_ = markup.indexOf(`${code} · ${t('fleet.roster.fields.mission')}`);
    if (at_ === -1) return '';
    return markup.slice(markup.lastIndexOf('<select', at_), markup.indexOf('>', at_) + 1);
  };
  const isDisabled = (tag: string): boolean => / disabled=""/.test(tag) || / disabled>/.test(tag);

  it('DISABLES the mission control on an in-workshop row', () => {
    // Not a new rule: the server counts a row carrying a mission as an ASSIGNING row and FR-5
    // refuses it, so the board was offering a save it already knew would come back a 409.
    const markup = at('');
    expect(missionTag(markup, '151'), 'the workshop’s car').not.toBe('');
    expect(isDisabled(missionTag(markup, '151'))).toBe(true);
  });

  it('leaves it editable on an ordinary row', () => {
    const markup = at('');
    expect(isDisabled(missionTag(markup, '150')), 'a working car').toBe(false);
    expect(isDisabled(missionTag(markup, '153')), 'an idle car').toBe(false);
  });

  it('still SHOWS a mission the row already holds, disabled but legible', () => {
    // 152 is in the workshop and carries MT. Hiding or blanking it would lose what the day says.
    // React renders a controlled <select> by marking the chosen <option selected>, not by putting
    // `value` on the select — so the value is asserted where it actually lands.
    const markup = at('');
    const at_ = markup.indexOf(`152 · ${t('fleet.roster.fields.mission')}`);
    const element = markup.slice(
      markup.lastIndexOf('<select', at_),
      markup.indexOf('</select>', at_) + 9,
    );
    expect(isDisabled(missionTag(markup, '152')), 'not editable').toBe(true);
    expect(element, 'the stored mission is the selected option').toContain(
      `<option value="${MT}" selected="">`,
    );
    expect(element, 'and its name is readable').toContain('نقل أموال (يومي)');
  });

  it('guards the HANDLER too, not only the attribute', () => {
    // A real browser refuses a click on a disabled select, but React's onChange is attached at the
    // root and still fires for a programmatically dispatched event — so the attribute alone left
    // the rule resting on markup. Found in the browser, fixed here.
    expect(SOURCE).toContain('if (row.inMaintenance) return;');
  });

  it('reads `inMaintenance`, not the registry’s `inWorkshop` and not a mere assignment', () => {
    expect(SOURCE).toContain('disabled={row.inMaintenance}');
    expect(SOURCE, 'the registry flag has no place on a dated board').not.toContain(
      'disabled={row.inWorkshop}',
    );
    expect(SOURCE, 'nor does having a crew').not.toContain('disabled={hasDriver(row)}');
  });

  it('changes no server rule — FR-5 still refuses the write', () => {
    expect(SERVICE, 'a mission alone is an ASSIGNING row').toContain(
      'row.missionTypeId != null || rowDrivers(row).length > 0',
    );
    expect(SERVICE).toContain('unassignable (FR-5)');
  });
});

describe('the assignment badge needs a DRIVER, not a mission', () => {
  const stateCell = (markup: string, code: string): string => {
    const body = tbody(markup);
    const row_ = body.split('<tr').find((r) => r.includes(`>${code}<`));
    if (row_ === undefined) throw new Error(`no row ${code}`);
    // The state column sits between the code cell and the mission select.
    const end = row_.indexOf(`${code} · ${t('fleet.roster.fields.mission')}`);
    return end === -1 ? row_ : row_.slice(0, end);
  };
  const assigned = t('fleet.roster.assigned');

  /** A day covering every combination the rule distinguishes. */
  const CREW_BOARD: FleetRosterDayDto = {
    ...BOARD,
    rows: [
      row(V1, '160'), // nothing at all
      row(V2, '161', { driver1EmployeeId: E1 }), // driver 1 only
      row(V3, '162', { driver2EmployeeId: E3 }), // driver 2 only
      row(V4, '163', { driver1EmployeeId: E1, driver2EmployeeId: E3 }), // both
      row('650000000000000000000005', '164', { missionTypeId: MT }), // a mission, no crew
    ],
  };

  it('shows NOTHING for a row with no drivers', () => {
    expect(stateCell(at('', CREW_BOARD), '160')).not.toContain(assigned);
  });

  it('shows it for driver 1 alone', () => {
    expect(stateCell(at('', CREW_BOARD), '161')).toContain(assigned);
  });

  it('shows it for driver 2 alone', () => {
    expect(stateCell(at('', CREW_BOARD), '162')).toContain(assigned);
  });

  it('shows it when both seats are filled', () => {
    expect(stateCell(at('', CREW_BOARD), '163')).toContain(assigned);
  });

  it('does NOT show it for a mission with no crew — an intention is not an assignment', () => {
    // The whole point of the rule, and the one case `carriesPlan` would have got wrong.
    expect(stateCell(at('', CREW_BOARD), '164')).not.toContain(assigned);
  });

  it('never prints the old «غير معيّنة» badge — silence is the state of an untouched row', () => {
    const markup = at('', CREW_BOARD);
    expect(markup).not.toContain('غير معيّنة');
    expect(SOURCE, 'and the label is gone from the code').not.toContain('fleet.roster.unassigned');
  });

  it('keeps the WORKSHOP badge, which is not an assignment state', () => {
    // It is also the third carrier of that fact beside the row's tint — `DataTable` requires a
    // tinted row to say what it is in a cell.
    const markup = at('');
    expect(stateCell(markup, '151'), 'workshop car with no crew').toContain(
      t('fleet.vehicles.inWorkshop'),
    );
    expect(stateCell(markup, '151'), 'and no assignment claim').not.toContain(assigned);
  });

  it('uses `hasDriver`, and leaves «تشغيل» on `carriesPlan`', () => {
    // Two facts, two names. Folding them would make the badge and the counter agree by accident.
    // The badge is the computer's status cell now, one badge per line (prettier wraps it).
    expect(DESK).toMatch(/hasDriver\(row\) && \(?\s*<Badge/u);
    expect(SOURCE, 'the counter is untouched').toContain('shown.filter(carriesPlan).length');
    expect(VIEW_SOURCE, 'and the two predicates stay separate').toContain('export const hasDriver');
  });
});

describe('neither change reaches the filters, the counters or the save', () => {
  it('leaves the tallies exactly as they were', () => {
    const markup = at('');
    const shown = (key: string): string => {
      const idx = markup.indexOf(`data-counter="${key}"`);
      const tag = markup.slice(idx, markup.indexOf('</button>', idx));
      return tag.slice(tag.lastIndexOf('<span'), tag.lastIndexOf('</span>'));
    };
    // 4 vehicles: 2 in the workshop, 2 carrying a plan (150 and 152, one of them crewless) — in
    // Latin digits, as the approved computer board prints every figure («اعتمد» on D1).
    // The figure exactly: the span's text ends the slice, so «>4» is 4 and never 14 or 24.
    expect(shown('total')).toMatch(/>4$/u);
    expect(shown('workshop')).toMatch(/>2$/u);
    expect(shown('assigned'), '«تشغيل» still counts a mission, badge or no badge').toMatch(/>2$/u);
  });

  it('leaves the filters narrowing exactly as they did', () => {
    expect(tbody(at('&view=assigned')), '152 has a mission and no crew').toContain('152');
    expect(tbody(at('&view=workshop'))).toContain('151');
    expect(tbody(at(`&mission=${MT}`))).toContain('150');
  });

  it('leaves the save measured against the whole day', () => {
    expect(SOURCE).toContain('rowsToSave(saved, draft)');
    expect(buttonDisabled(at(''), 'data-save-roster'), 'Save is live as before').toBe(false);
  });

  it('leaves the workshop row red and the drop still refused', () => {
    const body = tbody(at(''));
    const row151 = body.split('<tr').find((r) => r.includes('151')) ?? '';
    expect(row151.slice(0, row151.indexOf('>'))).toContain('data-tint="workshop"');
    expect(SOURCE).toContain('const droppable = mayPlan && !row.inMaintenance && !needsFirst');
  });
});

describe('a filter never reaches what is SAVED', () => {
  it('measures the save against the whole day, not the visible rows', () => {
    // A filtered board that saved only what it was showing would silently drop every edit the
    // dispatcher made before narrowing.
    expect(SOURCE).toContain('rowsToSave(saved, draft)');
    expect(SOURCE, 'never the filtered list').not.toContain('rowsToSave(saved, rows)');
    expect(SOURCE).toContain('hasEdits(saved, draft)');
    expect(SOURCE, 'nor for what «إلغاء» would throw away').not.toContain('hasEdits(saved, rows)');
  });

  it('leaves the day’s save button live while a filter hides the edited row', () => {
    // 150 is stored-empty-derived on this fixture, so the board has something to materialise; a
    // filter that shows only 153 must not turn Save off.
    const narrowed = at('&q=153');
    expect(narrowed, 'the table is narrowed').not.toContain('>150<');
    expect(buttonDisabled(narrowed, 'data-save-roster'), 'Save is still live').toBe(false);
  });

  it('filters the DISPLAY only — the draft itself is never rewritten', () => {
    // `shown` IS the draft on any day that may be planned — `const shown = editable ? draft :
    // saved` — so this is the same claim it always was, now written where a past day can also be
    // read from the same expression.
    expect(SOURCE, 'one filtered list, used for the table').toContain(
      'visibleRows(shown, { term: search, missions, view })',
    );
    // The model names it `plain` and hands it to touch's re-flagging; the computer shows it as is.
    expect(SOURCE, 'and the draft is what an editable day shows').toContain(
      'const plain = editable ? draft : saved',
    );
    expect(SOURCE, 'the pool still reads the whole board').toContain(
      'availableDrivers(board?.availableDrivers ?? [], shown)',
    );
  });
});

// ── 4. the two driver lists ─────────────────────────────────────────────────

describe('the driver lists', () => {
  it('holds both halves in ONE panel of two tabs — and the panel reaches the screen’s end', () => {
    // «اعتمد» on D1: the two side-by-side columns took «إجراءات» off the screen, so the computer's
    // board holds them in ONE panel with two tabs («السائقون المتاحون» / «غير المتاحين»), both
    // lists in the page (the other one hidden).
    expect(DESK, 'one panel').toContain('data-drivers-panel="true"');
    const markup = render();
    const panel = markup.slice(markup.indexOf('data-drivers-panel'));
    expect(panel.match(/role="tab"/g)?.length, 'two tabs').toBe(2);
    expect(panel.match(/role="tabpanel"/g)?.length, 'both lists in the page').toBe(2);
    expect(DESK, 'two columns no more').not.toContain('grid-cols-2');
    // THE HEIGHT IS INHERITED, not computed. Three shapes have been tried here: a fixed
    // `max-h-[26rem]` (416px of list with its own scrollbar and a quarter of the page blank
    // underneath), then `sticky top-4` + `max-h-[calc(100vh-2rem)]` (bounded by the viewport but
    // not by where the panel STARTS, so its foot hung a page-scroll below the fold), and now the
    // page itself is exactly the shell's height and hands that down.
    expect(SOURCE, 'the page is the screen').toContain('<PageContainer fullHeight>');
    expect(SOURCE, 'and the board grid takes that height').toContain(
      'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem]',
    );
    expect(SOURCE, 'the list takes what is left').toContain(
      "const LIST_SCROLL = 'min-h-0 flex-1 overflow-y-auto overscroll-contain'",
    );
    expect(SOURCE, 'and no fixed box remains').not.toContain('max-h-[26rem]');
    expect(SOURCE, 'nor any viewport arithmetic').not.toContain('max-h-[calc(100vh-2rem)]');
    expect(SOURCE, 'and nothing is pinned by scrolling any more').not.toContain('sticky top-4');
    expect(markup).toContain(t('fleet.roster.availableTitle'));
    expect(markup).toContain(t('fleet.roster.unavailableTitle'));
  });

  it('makes an AVAILABLE driver draggable', () => {
    const markup = render();
    const card = markup.slice(markup.indexOf(`data-driver-card="${E3}"`));
    expect(card.slice(0, 200), 'the pool row is a drag source').toContain('draggable="true"');
    expect(SOURCE, 'carrying the same payload the fixed board uses').toContain('setData(DRAG_TYPE');
  });

  it('drops a driver the DAY already seats — the pool answers the draft, not the server', () => {
    // E1 is seated on V1 in this board AND present in the server's available list (that list
    // means "free on this date", not "unseated"). The pool must exclude them, or a dispatcher
    // could drag the same person onto a second car and only learn it was illegal on save.
    const markup = render();
    expect(markup, 'the seated driver is not offered again').not.toContain(
      `data-driver-card="${E1}"`,
    );
    expect(markup, 'and the unseated one is').toContain(`data-driver-card="${E3}"`);
    expect(SOURCE, 'derived from the draft').toContain('availableDrivers(board?.availableDrivers');
  });

  it('does NOT make an unavailable driver draggable, and shows WHY', () => {
    const markup = render();
    const at = markup.indexOf(`data-unavailable-driver="${E2}"`);
    expect(at, 'the unavailable driver is listed — visible, not hidden').toBeGreaterThan(-1);
    const li = markup.slice(at, markup.indexOf('</li>', at));
    expect(li, 'and cannot be picked up').not.toContain('draggable');
    // The reason is the seam's own verdict, beside the name.
    expect(li, 'the reason is right there').toContain(t('fleet.roster.reason.hrLeave'));
  });

  it('uses the seam’s five reasons — no invented vocabulary', () => {
    const seam = readFileSync(
      join(HERE, '../../../../api/src/modules/fleet/availability/driver-availability.ts'),
      'utf8',
    );
    for (const reason of [
      'notADriver',
      'profileInactive',
      'notEmployed',
      'fleetUnavailability',
      'hrLeave',
    ]) {
      expect(seam, `${reason} is the seam’s`).toContain(`'${reason}'`);
      expect(SOURCE, `${reason} is known to the page`).toContain(reason);
      expect(translate('ar', `fleet.roster.reason.${reason}`)).not.toBe(
        `fleet.roster.reason.${reason}`,
      );
    }
    expect(SOURCE, 'the page re-derives no availability of its own').not.toContain(
      'isOnApprovedLeave',
    );
  });
});

// ── 5. dropping onto the board ──────────────────────────────────────────────

describe('assigning by drag', () => {
  /** The computer's seat — its own module now (`roster-desk-cells.tsx`), to the end of the file. */
  const CELLS = rosterSource(['desk']).slice(DESK.indexOf('\nexport const DASH'));
  const CELL = CELLS.slice(CELLS.indexOf('export const SeatCell = ('));

  it('declares the slot cell at module level — the drag-cancelling bug is not repeated', () => {
    // Over EVERY file of the screen, both boards: a component written inside another is a new
    // element type on every render, and a drag in flight dies with its node.
    const inner = [...RAW.matchAll(/\n[ \t]+const ([A-Z]\w*) = \(/g)].map((m) => m[1]);
    expect(inner, `rebuilt every render: ${inner.join(', ')}`).toEqual([]);
    expect(SOURCE).toContain('\nexport const SeatCell = (');
  });

  it('refuses to be a drop target when the vehicle is in the workshop', () => {
    expect(CELL, 'droppable is gated on maintenance').toContain('!row.inMaintenance');
    const markup = render();
    const zone = markup.slice(markup.indexOf(`data-drop-zone="${V2}:driver1EmployeeId"`));
    expect(zone.slice(0, 300), 'and the cell says so').toContain(
      'data-drop-disabled="maintenance"',
    );
    expect(markup, 'the vehicle is still ON the board').toContain('151');
  });

  it('asks for no click before the drag', () => {
    // The seat's person is the drag handle (`SeatPerson`, handed `draggable={mayPlan}`).
    expect(CELL).toContain('draggable={mayPlan}');
    const at = CELLS.indexOf('draggable={draggable}');
    expect(at, 'the handle').toBeGreaterThan(-1);
    const chip = CELLS.slice(at);
    expect(chip.slice(0, 400)).not.toContain('onClick');
    expect(chip.slice(0, 400)).not.toContain('onDoubleClick');
  });

  it('edits the DRAFT — a drop persists nothing on its own', () => {
    // The board hands the drop to the model; the model's every edit lands on the draft.
    const drop = DESK.slice(
      DESK.indexOf('const dropDriver ='),
      DESK.indexOf('const applyDialog ='),
    );
    expect(drop, 'the drop is an assign').toContain('m.actions.assign(');
    expect(drop, 'and does not save').not.toContain('mutateAsync');
    const edit = MODEL.slice(
      MODEL.indexOf('const edit = useCallback('),
      MODEL.indexOf('const commit ='),
    );
    expect(edit, 'the drop edits local state').toContain('setDraft(');
    expect(edit, 'and does not save').not.toContain('mutateAsync');
    expect(edit, 'through the board function').toContain(
      'assignDriver(rows, target.vehicleId, target.slot, employeeId)',
    );
  });

  it('commits through the EXISTING plan mutation, not a new path', () => {
    const commit = SOURCE.slice(
      SOURCE.indexOf('const commit ='),
      SOURCE.indexOf('const confirmClear'),
    );
    expect(commit, 'the existing mutation').toContain('plan.mutateAsync(');
    expect(commit, 'sending exactly the changed rows').toContain('rows: pending');
    const api = readFileSync(join(HERE, 'api/fleet-api.ts'), 'utf8');
    expect(api, 'no second endpoint').not.toMatch(/roster\/assign|roster\/drop/);
  });
});

// ── 6. the standing crew is a STARTING POINT, and only the server decides ───

describe('where the day comes from', () => {
  it('derives an unplanned day from the fixed crew — and never rewrites it', () => {
    expect(SERVICE, 'the standing crew is read').toContain('fleetFixedCrewRepository.findAll()');
    // Read-only by construction: the roster path calls nothing that writes that collection.
    expect(SERVICE, 'nothing on this path writes the fixed crew').not.toMatch(
      /fleetFixedCrewRepository\.(create|updateById|updateMany|deleteMany|softDelete)/,
    );
  });

  it('lets an EXISTING assignment speak for its own day', () => {
    const board = SERVICE.slice(SERVICE.indexOf('async board('), SERVICE.indexOf('async plan('));
    // The condition is EXACTLY the document's existence. Asserted whole rather than as a
    // substring: `assignment !== undefined && assignment.driver1EmployeeId !== null` contains
    // the substring too, and is precisely the bug — a day somebody emptied on purpose would
    // fall through and have the standing crew put back on it.
    expect(board, 'the distinction is the document’s existence, and nothing else').toContain(
      'if (assignment !== undefined) {',
    );
    expect(board, 'not whether its drivers happen to be null').not.toMatch(
      /driver1EmployeeId === null[\s\S]{0,80}fixed/,
    );
  });
});

// ── 7. the day is a DRAFT, and «حفظ» is what makes it a fact ────────────────
//
// The board used to write on every drop. Planning a day is a sequence of related decisions, so
// each keystroke became a fact, «إلغاء» had nothing to undo, and one plan produced a dozen audit
// entries. These assert the draft exists, that nothing leaves the page without a save, and that
// the save sends exactly what changed.

describe('the daily draft and its Save', () => {
  it('holds the day locally, seeded from the board the server derived', () => {
    // The rule itself now lives in `useDraftBoard`, shared with the fixed board and given a
    // memory across a reload. It is UNCHANGED: a draft is held together with the server board it
    // was taken from, compared by identity, so it resets when the server answers with a
    // different board and stays put in between.
    const hook = readFileSync(join(HERE, 'lib/useDraftBoard.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(hook, 'a draft, based on the board it came from').toContain(
      'edit.base === saved ? edit.rows',
    );
    expect(SOURCE, 'and this page uses it').toContain('useDraftBoard(');
    expect(SOURCE, 'the baseline IS the server’s derived day').toContain(
      'const saved = useMemo(() => board?.rows ?? []',
    );
  });

  it('derives the draft during RENDER, not in an effect', () => {
    // An effect runs after the first paint — the board would flash — and never runs at all under
    // `renderToStaticMarkup`, which is how this file tests the screen. A draft seeded by an
    // effect would therefore be untestable here and visibly wrong in a browser.
    // The page and its model: the computer's board measures its table in an effect (is it wider
    // than its frame?), which seeds nothing.
    expect(rosterSource(['shell', 'model']), 'no effect seeds the draft').not.toContain(
      'useEffect',
    );
  });

  it('offers Save and Cancel, and both are dead until something changes', () => {
    // This board arrives with an operation still only projected, so Save is deliberately LIVE —
    // see the two tests below. What must be dead with nothing edited is «إلغاء».
    const markup = render();
    expect(
      buttonDisabled(markup, `>${t('common.cancel')}<`),
      'nothing edited, so nothing to discard',
    ).toBe(true);
    // «اعتمد» on D1: «حفظ / إلغاء» live in the unsaved bar floating at the bottom, and the BAR is
    // what real changes gate — there is no «حفظ» to disable while nothing would be written.
    expect(DESK, 'the save is gated on real changes').toContain('mayPlan && m.dirty && (');
    expect(SOURCE, 'and the cancel is gated on real EDITS').toContain(
      'disabled={!edited || saving}',
    );
    expect(DESK, 'busy while the save is in flight').toContain('saving={m.saving}');
    expect(markup, 'both buttons are offered').toContain(t('common.save'));
    expect(markup).toContain(t('common.cancel'));
  });

  it('offers «تراجع» only for an edit made HERE — a draft restored on arrival has no history', () => {
    // A reload keeps the draft (sessionStorage), not its undo steps: «إلغاء» is live, «تراجع» is
    // not. The bar's undo is gated on the model's depth, never left on for show.
    const stored = new Map([
      [rosterDraftKey(day(1)), JSON.stringify(BOARD.rows.map((r) => ({ ...r, notes: 'تغيير' })))],
    ]);
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => stored.get(k) ?? null,
        setItem: (k: string, v: string) => void stored.set(k, v),
        removeItem: (k: string) => void stored.delete(k),
      },
    });
    try {
      const markup = render();
      expect(markup).toContain('data-edits-bar="true"');
      expect(buttonDisabled(markup, 'data-undo-edit'), 'nothing done here to take back').toBe(true);
      expect(buttonDisabled(markup, 'data-discard-edits'), 'the restored draft can go').toBe(false);
      expect(buttonDisabled(markup, 'data-save-roster'), 'and be saved').toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(DESK).toContain('undoable={m.undoDepth > 0}');
  });

  it('is SAVEABLE on an untouched day that still carries an inherited operation', () => {
    // The heart of the fix. V1 arrives `planned: false` with a mission and a driver projected
    // from the standing crew — nothing is stored for it yet, so `operations/crew-board`, which
    // lists the day by iterating the duty documents, does not know this vehicle exists. The
    // dispatcher must be able to commit that without first having to change something.
    const markup = render();
    expect(buttonDisabled(markup, 'data-save-roster="true"'), 'Save is live').toBe(false);
    expect(markup, 'and the day is marked unsaved').toContain('data-unsaved="true"');
  });

  it('is NOT saveable once every row is already stored', () => {
    const allStored: FleetRosterDayDto = {
      ...BOARD,
      rows: BOARD.rows.map((r) => ({ ...r, planned: true })),
    };
    const markup = render({ qc: client(allStored) });
    // «اعتمد» on D1: the unsaved bar (and its «حفظ») shows only while there is something to save.
    expect(markup, 'nothing left to commit').not.toContain('data-save-roster');
    expect(markup).not.toContain('data-unsaved="true"');
  });

  it('saves the EFFECTIVE day — edits, plus any operation still only projected', () => {
    // Not `changedRows`: an operation inherited from the standing crew is real to this screen
    // but invisible to Operations until a duty row exists for it. Sending only what changed made
    // "the dispatcher agreed with the fixed roster" and "there is nothing to plan" identical.
    expect(SOURCE, 'the payload is the effective day').toContain('rowsToSave(saved, draft)');
    expect(SOURCE, 'and dirty is exactly that').toContain('const dirty = pending.length > 0');
    expect(SOURCE, 'while «إلغاء» asks the narrower question').toContain('hasEdits(saved, draft)');
  });

  it('knows which rows are still only a projection, because the server says so', () => {
    expect(SERVICE, 'a stored day is flagged').toContain('planned: true');
    expect(SERVICE, 'and a derived one is flagged too').toContain('planned: false');
  });

  it('CANCEL restores the last saved day rather than clearing the board', () => {
    const hook = readFileSync(join(HERE, 'lib/useDraftBoard.ts'), 'utf8');
    expect(hook, 'discard rebases the draft on the saved board').toContain(
      'setEdit({ base: saved, rows: [...saved] })',
    );
    expect(hook, 'and clears STORAGE too — «إلغاء» must not survive a reload').toMatch(
      /discard[\s\S]{0,200}forget\(\)/,
    );
    expect(SOURCE, 'the page still offers it').toContain('discard');
  });

  it('sends exactly the changed rows, once, on Save', () => {
    const commit = SOURCE.slice(
      SOURCE.indexOf('const commit ='),
      SOURCE.indexOf('const confirmClear'),
    );
    expect(commit, 'nothing is sent when nothing changed').toContain('if (!dirty) return');
    expect(commit, 'the payload is the diff').toContain('rows: pending');
    expect(commit, 'for the day on screen').toContain('dateKey: date');
  });

  it('surfaces a refusal instead of failing silently', () => {
    // `usePlanRoster` defines its own `onError`, which opts the mutation OUT of the global error
    // toast. Without a local one the button would just stop spinning and the edits would vanish.
    const commit = SOURCE.slice(
      SOURCE.indexOf('const commit ='),
      SOURCE.indexOf('const confirmClear'),
    );
    expect(commit).toContain('toast.error(errorMessage(error, locale))');
  });

  it('never writes the FIXED crew — this screen has no path to it', () => {
    // Narrow on purpose: this screen legitimately reuses two `fleet.fixedRoster.*` TRANSLATION
    // keys («اسحب السائق هنا», «بدون نوع مهمة»). What it must not have is a way to WRITE the
    // standing crew — a mutation hook, or that board's endpoint.
    expect(SOURCE, 'no fixed-crew mutation hook').not.toContain('useSaveFixedRoster');
    expect(SOURCE, 'no fixed-crew query either').not.toContain('useFixedRoster');
    expect(SOURCE, 'and it does not even import the fixed board’s rules').not.toContain(
      'fixed-roster-board',
    );
    const api = readFileSync(join(HERE, 'api/fleet-api.ts'), 'utf8');
    const commit = SOURCE.slice(
      SOURCE.indexOf('const commit ='),
      SOURCE.indexOf('const confirmClear'),
    );
    expect(commit, 'the only write is the day plan').toContain('plan.mutateAsync');
    expect(api).toContain('planRoster');
  });

  it('routes the edit dialog through the draft too — one write path, not two', () => {
    const dialog = readFileSync(join(HERE, 'components/RosterAssignDialog.tsx'), 'utf8');
    expect(dialog, 'the dialog no longer persists').not.toContain('mutateAsync');
    expect(dialog, 'it hands its values back').toContain('onSave({');
    // The board hands the dialog's values to the model as ONE edit (one «تراجع» step), and the
    // model applies them to the draft through the board function.
    expect(DESK, 'the board hands them on').toContain(
      'if (editingRow !== null) applyDialog(editingRow, values);',
    );
    expect(DESK).toContain('m.actions.apply(row.vehicleId, values)');
    const apply = MODEL.slice(MODEL.indexOf('const apply ='), MODEL.indexOf('const undo ='));
    expect(apply, 'and the model applies them to the draft').toContain(
      'edit((rows) =>\n      applyEdit(rows, vehicleId, {',
    );
  });
});

// ── 8. «نوع المهمة», in the cell ────────────────────────────────────────────

describe('the mission type is chosen on the row', () => {
  it('renders a real select per row, bound to missionTypeId', () => {
    const markup = render();
    const cell = missionCell(markup, '150');
    expect(cell, 'a select, not a label').toContain('<select');
    expect(cell, 'single-select — no multiple, no size').not.toContain('multiple');
    expect(cell, 'holding the row’s current mission').toContain(`value="${MT}"`);
  });

  it('offers the catalog’s active items and a way back to none', () => {
    const markup = render();
    expect(markup, 'the catalog name, localized').toContain('نقل أموال (يومي)');
    expect(markup, 'and an empty option to clear it').toContain(
      t('fleet.fixedRoster.noMissionType'),
    );
  });

  it('writes the choice into the DRAFT, not to the server', () => {
    // The cell hands the choice to the model, whose every edit lands on the draft.
    expect(DESK, 'the cell edits the draft').toContain(
      "m.actions.mission(row.vehicleId, id === '' ? null : id)",
    );
    expect(MODEL, 'through the board function').toContain(
      'return setMission(rows, vehicleId, missionTypeId);',
    );
    const mission = MODEL.slice(MODEL.indexOf('const mission ='), MODEL.indexOf('const notes ='));
    expect(mission, 'an edit, never a write').toContain('edit((rows) =>');
    expect(mission).not.toContain('mutateAsync');
  });

  it('shows the name as text to a reader who may not plan', () => {
    const markup = render({ permissions: ['fleetRoster.view'] });
    // The header's mission FILTER is a select for everyone — it narrows what you read. What a
    // viewer must not get is the per-ROW editor, so the assertion is about that cell alone.
    expect(missionCell(markup, '150'), 'no editable control on the row').toBe('');
    expect(markup, 'but the mission is still readable').toContain('نقل أموال (يومي)');
  });
});

// ── 9. the vehicle cell: the code, and not the plate ────────────────────────

describe('the vehicle cell', () => {
  it('shows the code', () => {
    expect(render(), 'the identifier this fleet dispatches by').toContain('>150<');
  });

  it('does NOT show the plate number under it', () => {
    // A second identifier under every row of the column the eye scans for one.
    const markup = render();
    expect(markup, 'the plate is gone from the cell').not.toContain('س ص 150');
    const vehicleCol = SOURCE.slice(
      SOURCE.indexOf("key: 'vehicle'"),
      SOURCE.indexOf("key: 'state'"),
    );
    expect(vehicleCol, 'and the cell does not render it at all').not.toContain('plateNumber');
  });

  it('and does not SEARCH it either — the board answers by code, like every other car box', () => {
    // This asserted the opposite until the whole application was made to name a car by its code:
    // the box was «الكود أو رقم اللوحة» and the filter read both fields. That combination was the
    // problem, not either half of it. With the plate gone from the cell, a plate search returned a
    // row whose only visible identifier was not what had been typed and nothing said why.
    //
    // The rule now lives in `lib/vehicle-code-match.ts`, built on the canonical parser, so this
    // board answers `150 - 151` exactly as the filter bars do. Behaviour is pinned there and in
    // `vehicle-code-search.spec.ts`; what is checked here is that the board reaches for it.
    expect(VIEW_SOURCE, 'the shared matcher, not a comparison of its own').toContain(
      'matchesVehicleCode(row.code, term)',
    );
    expect(VIEW_SOURCE, 'and no plate is consulted anywhere in it').not.toContain('plateNumber');
  });
});

// ── 10. the counters answer the DRAFT ───────────────────────────────────────

describe('the day’s counters', () => {
  it('count the draft, so an unsaved edit is reflected immediately', () => {
    expect(SOURCE, 'counted off what the day SHOWS, not the server’s last answer').toContain(
      'for (const row of shown)',
    );
    const block = SOURCE.slice(
      SOURCE.indexOf('const counters = useMemo'),
      SOURCE.indexOf('const pool'),
    );
    expect(block, 'the total is the shown board’s length').toContain('value: shown.length');
    expect(block, 'the workshop tally reads what the day shows').toContain(
      'shown.filter((row) => row.inMaintenance).length',
    );
    // Named `carriesPlan` and shared with the filter, so the chip cannot count one thing and
    // show another.
    expect(block, 'and so does the operating tally').toContain('shown.filter(carriesPlan).length');
    expect(block, 'the memo depends on what the day shows').toContain(
      '[shown, missionTypes.data, locale, t, missionsKey, view]',
    );
  });

  it('names missions from the catalog — nothing is hardcoded', () => {
    const block = SOURCE.slice(
      SOURCE.indexOf('const counters = useMemo'),
      SOURCE.indexOf('const pool'),
    );
    expect(block, 'one counter per ACTIVE catalog item').toContain(
      '.filter((item) => item.isActive)',
    );
    expect(block, 'named by the catalog').toContain('localized(item.name, locale)');
    const markup = render();
    expect(markup, 'the catalog name appears as a counter').toContain('نقل أموال (يومي)');
    for (const literal of ['صيانة و', 'نقل أموال (صيانة)']) {
      expect(block, `no hardcoded mission name: ${literal}`).not.toContain(literal);
    }
  });

  it('sits in the same top strip as the filters, not in a block of its own', () => {
    // The CODE PICKER, not a search box: the owner asked for the same control the accidents board
    // carries — «كود العربيه ... يكونوا زى شاشه الحوادث» — so what is looked for here is the
    // picker's own label. Both stand in ONE strip, the code picker first.
    //
    // CHANGED by the owner: «شاشه الكبيوتر اعملها زى باقى شاشات الحركة الجديده ك ui و شيل الفلتر
    // بتاع كل المهمات اللى جمب كود السيارة بس وسيب الباقى». The strip is now the new boards' dark
    // FilterBar (as on Accidents), and «كل المهمات» beside «كود السيارة» is gone — the per-mission
    // counter chip is the computer's mission control.
    const markup = render();
    const filters = markup.indexOf('data-roster-filters');
    const strip = markup.indexOf('data-counter="total"');
    const codeFilterAt = markup.indexOf(t('fleet.vehicles.fields.code'));
    expect(filters, 'one filter strip').toBeGreaterThan(-1);
    expect(codeFilterAt, 'the code picker is in it').toBeGreaterThan(filters);
    expect(codeFilterAt, 'the code picker comes first in the strip').toBeLessThan(strip);
    expect(strip, 'and the counters stand in the same strip').toBeLessThan(
      markup.indexOf('data-roster-table'),
    );
    // ABOVE the grid of the table and the drivers panel — a strip inside the grid's first column
    // would still come before the table.
    expect(filters, 'the strip is above the grid, not in it').toBeLessThan(
      markup.indexOf('grid min-h-0 flex-1 grid-cols-'),
    );
    expect(markup.indexOf('grid min-h-0 flex-1 grid-cols-')).toBeGreaterThan(-1);
    expect(markup, '«كل المهمات» is gone from the computer').not.toContain(
      t('fleet.roster.allMissions'),
    );
    expect(DESK, 'in the new boards’ bar').toContain('<FilterBar');
    expect(DESK).toContain('DARK_FILTER_BAR');
  });

  it('narrows the board by a code PICKED, not by a code typed from memory', () => {
    // The defect this replaced: a free-text box asks the reader to already know a code, and
    // offers no way to see what the board holds. The picker's options are the board's own cars.
    expect(SOURCE, 'the roster reaches for the shared picker').toContain('<VehicleCodeFilter');
    expect(SOURCE, 'and offers the rows it already holds').toContain('options={m.codeOptions}');
    // On the COMPUTER the free-text box stays gone — the code filter is the picker («كود العربيه
    // ... يكونوا زى شاشه الحوادث»). A typed box is the phone's and the tablet's own: «مينفعش ابحث
    // فى الفون او التابلت ؟» — see `fleet-roster-touch.spec.tsx`.
    expect(SOURCE, 'the free-text box is gone').not.toContain('fleet.roster.searchPlaceholder');
    const touch = rosterSource(['touch']);
    expect(touch, 'the touch board types its codes').toContain('fleet.roster.searchPlaceholder');
    expect(touch, 'in a search box').toContain('type="search"');
    expect(touch, 'that takes letters and lists, not a number pad').not.toContain('inputMode');
  });
});

// ── 11. a second driver needs a first, on the DAY ──────────────────────────
//
// `operations/crew-board` reads the DUTY row's slot 1 as "the driver" of the day, so a day
// holding only a second driver reaches Operations as a crewless vehicle with a real person
// committed to it. The rule lives in the schema, the service and the board arithmetic; this is
// the part a dispatcher meets.

describe('driver 2 depends on driver 1', () => {
  const zone = (markup: string, vehicleId: string, slot: string): string => {
    const at = markup.indexOf(`data-drop-zone="${vehicleId}:${slot}"`);
    return at === -1 ? '' : markup.slice(at, markup.indexOf('>', at));
  };

  it('makes slot 2 a NON-target while slot 1 is empty', () => {
    // V2 in this board is in the workshop, so use a plain empty vehicle for the claim.
    const board: FleetRosterDayDto = { ...BOARD, rows: [row(V1, '150')] };
    const markup = render({ qc: client(board) });
    expect(zone(markup, V1, 'driver1EmployeeId'), 'the first seat is open').not.toContain(
      'data-drop-disabled',
    );
    expect(zone(markup, V1, 'driver2EmployeeId'), 'the second is not, and says why').toContain(
      'data-drop-disabled="needsFirstDriver"',
    );
  });

  it('refuses the drop in code, not only in the styling', () => {
    // A `data-` attribute is a label. This is the gate: `onDragOver` never prevents the default,
    // so the browser does not treat the slot as a drop target at all.
    expect(SOURCE, 'the gate exists').toContain(
      "const needsFirst = slot === 'driver2EmployeeId' && row.driver1EmployeeId === null",
    );
    expect(SOURCE, 'and both handlers ride it').toContain(
      'const droppable = mayPlan && !row.inMaintenance && !needsFirst',
    );
  });

  it('OPENS slot 2 as soon as slot 1 holds somebody', () => {
    const board: FleetRosterDayDto = {
      ...BOARD,
      rows: [row(V1, '150', { driver1EmployeeId: E1 })],
    };
    const markup = render({ qc: client(board) });
    expect(zone(markup, V1, 'driver2EmployeeId')).not.toContain('data-drop-disabled');
  });

  it('is refused SERVER-side too — the UI is not the guard', () => {
    expect(SERVICE, 'the service refuses the pair').toContain('DRIVER2_WITHOUT_DRIVER1');
  });
});

// ── 12. one day's board never becomes another day's ────────────────────────
//
// A REAL bug, and worth stating plainly because the symptom looked cosmetic and was not.
//
// `useRosterDay` is keyed by the date and carried `placeholderData: (prev) => prev`. That option
// is right almost everywhere on that module — a filter or a page's previous answer is the same
// question, slightly stale. Here the key IS the entity's identity, so it served ANOTHER DAY's
// roster: not stale data, wrong data. And because this board is editable the harm ran past
// display — with the previous day's rows in hand the page armed «حفظ», and a save inside that
// window POSTED that day's crew under the NEW date, overwriting the day actually planned there.
//
// Measured in Chromium before the fix: switching to a day with its own stored crew showed the
// previous day's driver with no loading state, Save enabled, and one click wrote `…01` onto a
// day whose stored driver was `…02`.

describe('a day shows its own board, and only its own', () => {
  it('the query does NOT serve the previous day while a new one loads', () => {
    const queries = readFileSync(join(HERE, 'api/fleet-queries.ts'), 'utf8');
    const hook = queries.slice(
      queries.indexOf('export const useRosterDay'),
      queries.indexOf('export const usePlanRoster'),
    );
    expect(hook, 'keyed by the date').toContain('queryKey: rosterDayKey(date)');
    expect(
      hook,
      'and it must not hand back the previous key’s board — that is another DAY',
    ).not.toContain('placeholderData');
  });

  it('ignores a board that describes a DIFFERENT date', () => {
    // The invariant restated where it is relied on, so a caching option added to the hook later
    // cannot quietly put another day's crew on screen and into the payload again.
    expect(SOURCE, 'the response carries the day it describes, and the page checks it').toContain(
      'boardQuery.data?.date.slice(0, 10) === date ? boardQuery.data : undefined',
    );
  });

  it('renders NOTHING of another day when the cached board is stale', () => {
    // A cache primed for the wrong date: the page must not paint that crew.
    const qc = client(BOARD, day(1));
    const markup = render({ date: day(2), qc });
    expect(markup, 'no vehicle row from the other day').not.toContain('data-drop-zone');
    expect(markup, 'and no driver from it either').not.toContain(`data-driver-chip="${E1}"`);
  });

  it('does not arm «حفظ» against another day’s rows', () => {
    // The data-integrity half. Armed here, one click posts the wrong day's crew under this date.
    const qc = client(BOARD, day(1));
    const markup = render({ date: day(2), qc });
    // «اعتمد» on D1: no unsaved bar, and so no «حفظ», while nothing would be written.
    expect(markup, 'nothing to save for a day we have not got').not.toContain('data-save-roster');
    expect(markup).not.toContain('data-unsaved="true"');
  });

  it('says it is LOADING rather than showing an empty fleet', () => {
    // Rejecting the board must not read as "this day has no vehicles".
    expect(SOURCE, 'the table waits for the right day').toContain(
      'boardQuery.isPending || (board === undefined && !boardQuery.isError)',
    );
  });

  it('shows each day its own state — a stored override does not leak to the next day', () => {
    // The two days differ the way they really can: one has a stored duty row, the other inherits
    // the (dateless) standing crew. Rendered from their own caches, each shows its own answer.
    const overridden: FleetRosterDayDto = {
      ...BOARD,
      date: `${day(2)}T00:00:00.000Z`,
      rows: [row(V1, '150', { planned: true, missionTypeId: MT, driver1EmployeeId: E3 })],
    };
    const inherited: FleetRosterDayDto = {
      ...BOARD,
      date: `${day(3)}T00:00:00.000Z`,
      rows: [row(V1, '150', { planned: false, missionTypeId: MT, driver1EmployeeId: E1 })],
    };
    // Scoped to the SEAT, not the whole page: an unseated driver also appears in the pool, so
    // `markup.contains(chip)` would be true either way and the assertion would prove nothing.
    const seated = (markup: string, vehicleId: string): string | null => {
      const at = markup.indexOf(`data-drop-zone="${vehicleId}:driver1EmployeeId"`);
      if (at === -1) return null;
      const cell = markup.slice(at, markup.indexOf('</div>', at));
      return /data-driver-chip="([0-9a-f]{24})"/.exec(cell)?.[1] ?? null;
    };
    const d2 = render({ date: day(2), qc: client(overridden, day(2)) });
    const d3 = render({ date: day(3), qc: client(inherited, day(3)) });
    expect(seated(d2, V1), 'the overridden day seats its own driver').toBe(E3);
    expect(seated(d3, V1), 'the inherited day seats the standing one').toBe(E1);
  });
});

// ── finding a driver in EITHER list ────────────────────────────────────────
//
// Each panel carries its own box, searching its own list — the same shape as the Fixed Roster's
// driver panel. The two answer different questions ("who can I put on a car" and "who is out
// today, and why"), so the terms are independent: filtering one panel leaves the other alone.
//
// The filtering itself is `filterDrivers`, already proven pure in `driver-search.spec.ts`. What
// is asserted here is that THIS PAGE routes BOTH lists through it — a page that filtered one
// and rendered the other raw would pass every test in that file.
describe('each driver list has its own search', () => {
  const index = new Map([
    [E1, { employeeId: E1, nameAr: 'محمد حاتم', nameEn: 'Mohamed Hatem', code: 'DRV-1' }],
    [E2, { employeeId: E2, nameAr: 'علي سعيد', nameEn: 'Ali Said', code: 'DRV-2' }],
    [E3, { employeeId: E3, nameAr: 'سامي فؤاد', nameEn: 'Sami Fouad', code: 'DRV-3' }],
  ]);
  const available = [
    { employeeId: E1, assignedVehicleId: null },
    { employeeId: E3, assignedVehicleId: null },
  ];
  const unavailable = [{ employeeId: E2, reason: 'hrLeave' }];

  it('finds a driver who is AVAILABLE', () => {
    expect(filterDrivers(available, index, 'محمد').map((d) => d.employeeId)).toEqual([E1]);
  });

  it('finds a driver who is UNAVAILABLE — the half a one-sided search would hide', () => {
    expect(filterDrivers(unavailable, index, 'علي').map((d) => d.employeeId)).toEqual([E2]);
    // And the reason travels with them: the row still says WHY they cannot be assigned.
    expect(filterDrivers(unavailable, index, 'علي')[0]?.reason).toBe('hrLeave');
  });

  it('matches part of a name, in either language, and the code', () => {
    for (const term of ['حات', 'hate', 'HATE', 'drv-1']) {
      expect(
        filterDrivers(available, index, term).map((d) => d.employeeId),
        term,
      ).toEqual([E1]);
    }
  });

  it('answers with an empty list when nobody matches — in both halves', () => {
    expect(filterDrivers(available, index, 'zzzz')).toEqual([]);
    expect(filterDrivers(unavailable, index, 'zzzz')).toEqual([]);
  });

  it('CLEARING the box brings everybody back, on both sides', () => {
    for (const term of ['', '   ']) {
      expect(filterDrivers(available, index, term)).toHaveLength(2);
      expect(filterDrivers(unavailable, index, term)).toHaveLength(1);
    }
  });

  it('the page filters the AVAILABLE list', () => {
    // The model answers the list for a term; the panel renders that answer, not the pool.
    const available = MODEL.slice(
      MODEL.indexOf('const availableFor = useCallback('),
      MODEL.indexOf('const unavailableFor = useCallback('),
    );
    expect(available).toContain('filterDrivers(board?.availableDrivers ?? [], searchIndex, term)');
    expect(DESK, 'and renders the filtered list, not the pool').toContain(
      'const options = m.availableFor(availableSearch, null);',
    );
    expect(DESK).toContain('options={options}');
  });

  it('the page filters the UNAVAILABLE list', () => {
    expect(MODEL).toContain('byReasons(filterDrivers(unavailable, searchIndex, term), asked)');
    expect(DESK, 'and renders the filtered list, not the server array').toContain(
      'const unavailable = m.unavailableFor(unavailableSearch, reasons);',
    );
    expect(DESK).toContain('drivers={unavailable}');
  });

  it('indexes BOTH halves, so one term can reach either', () => {
    const from = SOURCE.indexOf('useEmployeeRecords(');
    const call = SOURCE.slice(from, SOURCE.indexOf('const searchIndex', from));
    expect(call).toContain('pool.map');
    expect(call, 'the unavailable half is indexed too').toContain('unavailable.map');
  });

  it('shows ONE box, inside the drivers panel — the open tab’s own', () => {
    // «اعتمد» on D1: ONE drivers panel with two tabs, and ONE search box on screen under them.
    // Each list keeps its own box (below); the other tab's is hidden, not unmounted, so a tab
    // switched while the box is still reporting the last keys does not lose them.
    const markup = render();
    const placeholder = 'placeholder="' + t('fleet.fixedRoster.driverSearchPlaceholder');
    const boxes = markup.split(placeholder);
    expect(boxes.length - 1, 'one box per list').toBe(2);
    const shown = markup.indexOf(placeholder);
    const hidden = markup.indexOf(placeholder, shown + 1);
    const wrapperOf = (at: number): string =>
      markup.slice(markup.lastIndexOf('<div', markup.lastIndexOf('<div', at) - 1), at);
    expect(wrapperOf(shown), 'the available tab’s box is on screen').not.toContain('hidden=""');
    expect(wrapperOf(hidden), 'the other one is hidden').toContain('hidden=""');
  });

  it('puts the box inside the panel, under its two tabs — not above the table', () => {
    // Position is the claim: a box between the table and the panel would look like it filtered
    // the cars. It sits in the panel, after both tabs and before either list.
    const markup = render();
    const placeholder = 'placeholder="' + t('fleet.fixedRoster.driverSearchPlaceholder');
    const panel = markup.indexOf('data-drivers-panel');
    const box = markup.indexOf(placeholder);
    expect(panel, 'the panel').toBeGreaterThan(-1);
    expect(box, 'the box is in the panel').toBeGreaterThan(panel);
    for (const tab of ['available', 'unavailable']) {
      expect(markup.indexOf(`data-driver-tab="${tab}"`), `${tab} tab`).toBeGreaterThan(panel);
      expect(markup.indexOf(`data-driver-tab="${tab}"`), `under the ${tab} tab`).toBeLessThan(box);
    }
    expect(box, 'and above both lists').toBeLessThan(markup.indexOf('role="tabpanel"'));
  });

  it('keeps the two terms INDEPENDENT — each list filters by its OWN box', () => {
    // The point of splitting them: a shared term emptied whichever panel the person was not in.
    // Asserted on the filter calls themselves rather than on the surrounding block, because a
    // dependency array naming both terms would satisfy a looser check while the call passed the
    // wrong one — which is exactly the mistake this guards.
    expect(DESK, 'the available list filters by the available box').toContain(
      'm.availableFor(availableSearch, null)',
    );
    expect(DESK, 'the unavailable list filters by the unavailable box').toContain(
      'm.unavailableFor(unavailableSearch, reasons)',
    );
    // Neither may reach for the other's term.
    expect(DESK).not.toContain('m.availableFor(unavailableSearch');
    expect(DESK).not.toContain('m.unavailableFor(availableSearch');
    // Each box shows and writes its OWN list's term, and only the open tab's box is on screen.
    expect(DESK).toContain(
      '<DriverSearch value={availableSearch} onChange={setAvailableSearch} />',
    );
    expect(DESK).toContain(
      '<DriverSearch value={unavailableSearch} onChange={setUnavailableSearch} />',
    );
    expect(DESK).toContain("<div hidden={tab !== 'available'}>");
    expect(DESK).toContain("<div hidden={tab !== 'unavailable'}>");
    expect(DESK, 'no box shared between the two terms').not.toMatch(/value=\{tab === 'available'/u);
  });

  it('is DISPLAY ONLY — the draft, the counters and the payload read the unfiltered lists', () => {
    // The rule that keeps a search from becoming a data change: the two `shown*` arrays are
    // rendered and nothing else. `pool` is what the drag rules and counters read.
    expect(SOURCE, 'the pool still feeds the drag rules').toContain(
      'availableDrivers(board?.availableDrivers',
    );
    for (const forbidden of [
      'rowsToSave(saved, shown',
      'hasEdits(saved, shown',
      'availableDrivers(shown',
    ]) {
      expect(SOURCE, `${forbidden} would make a search change the data`).not.toContain(forbidden);
    }
  });

  it('does not make the search a URL parameter — it is not what the page is about', () => {
    // `?q=` filters VEHICLES and belongs in a shareable link. Which driver you were hunting for
    // does not, and putting it in the URL would also reset it on every navigation.
    expect(SOURCE).toContain("const [availableSearch, setAvailableSearch] = useState('')");
    expect(SOURCE).toContain("const [unavailableSearch, setUnavailableSearch] = useState('')");
    expect(SOURCE).not.toContain("sp.get('driver')");
  });
});

// ── a day's unsaved work survives a reload, and belongs to that day ────────
describe('the daily draft is persisted, per day', () => {
  it('keys the draft by DATE — the whole of the cross-day guarantee', () => {
    expect(SOURCE).toContain('useDraftBoard(rosterDraftKey(date), saved, ROSTER_EDITABLE_FIELDS)');
  });

  it('drops only THIS day’s draft after a successful save', () => {
    const commit = SOURCE.slice(
      SOURCE.indexOf('const commit'),
      SOURCE.indexOf('const confirmClear'),
    );
    expect(commit, 'the save clears the draft').toContain('acceptDraft()');
    const before = commit.indexOf('plan.mutateAsync');
    expect(before, 'and only AFTER the server accepted it').toBeLessThan(
      commit.indexOf('acceptDraft()'),
    );
    expect(commit.slice(commit.indexOf('catch')), 'a REFUSED save keeps the work').not.toContain(
      'acceptDraft()',
    );
    // …in memory too. A save the server folds away (a row of nulls for a car with no stored plan)
    // answers with the board it already held, the query cache keeps that board's identity, and a
    // draft tied to the board by identity would outlive the save with «تغييرات غير محفوظة» still
    // up — found on the real page (the approved touch check P7).
    expect(commit.indexOf('discard();'), 'the in-memory draft goes too').toBeGreaterThan(
      commit.indexOf('acceptDraft()'),
    );
    expect(commit.slice(commit.indexOf('catch')), 'but never on a refusal').not.toContain(
      'discard();',
    );
  });

  it('restores only the fields a reader edits, and only usable values', () => {
    // Both boards share one spec, so neither can drift into trusting a field the other checks.
    expect(SOURCE).toContain('ROSTER_EDITABLE_FIELDS');
    const storage = readFileSync(join(HERE, 'lib/draft-storage.ts'), 'utf8');
    for (const field of ['missionTypeId', 'driver1EmployeeId', 'driver2EmployeeId']) {
      expect(storage, `${field} is checked as an id`).toContain(`${field}: 'id'`);
    }
  });

  it('never posts the draft anywhere', () => {
    const storage = readFileSync(join(HERE, 'lib/draft-storage.ts'), 'utf8');
    expect(storage).not.toMatch(/\bfetch\(|planRoster|saveFixedRoster/);
  });
});

// ── taking somebody off the day says «احذف», and it looks like it ───────────
//
// «الاكس اللى جمب السواق لما ادوس عليها تشيل السواق زى ما هى ماشى لكن اللى جمب التعديل تشيل
// الاتنين السواقيين بس خليهم علامه سله». Both gestures were a cross. A cross dismisses a thing on
// screen; these two REMOVE people from a plan, and the Fixed Roster has said so with a bin since
// it was built — the two boards are read side by side.
describe('the board removes with a bin, not with a cross', () => {
  it('the per-driver control is a bin', () => {
    const at = SOURCE.indexOf('data-clear-slot=');
    expect(at, 'the per-driver control is still there').toBeGreaterThan(-1);
    expect(SOURCE.slice(at, at + 900), 'and wears a bin').toContain('<TrashIcon');
  });

  it('the row control is a bin too, and it empties the whole car', () => {
    const at = SOURCE.indexOf('fleet.roster.clearAssignment');
    expect(at, 'the row control is still there').toBeGreaterThan(-1);
    // The bin with the two lines inside it — the owner's picture of the row's actions.
    expect(SOURCE.slice(at, at + 700)).toContain('<Trash2Icon');
  });

  it('no cross is left doing a removal on this board', () => {
    // The COMPUTER's board. The phone and tablet seat clears with ✕ «إزالة من هذه الخانة» as the
    // owner picked it — «انا برشح دول» on P1 / TL2 — so the claim is the computer's own.
    expect(DESK, 'CloseIcon is gone from the board entirely').not.toContain('CloseIcon');
    expect(DESK, 'nor does it hand the lists a seat’s occupant to clear with one').not.toContain(
      'occupant=',
    );
  });

  it('the row control still clears BOTH seats, the mission and the note', () => {
    // The behaviour the icon now advertises. Changing the icon without this would be a label on
    // the wrong box. The confirm hands the car to the model's `clearAll`.
    expect(DESK).toContain('if (clearing !== null) m.actions.clearAll(clearing.vehicleId);');
    expect(MODEL).toContain('clearAll: confirmClear,');
    const at = MODEL.indexOf('const confirmClear =');
    const body = MODEL.slice(at, at + 400);
    expect(body).toContain('driver1EmployeeId: null');
    expect(body).toContain('driver2EmployeeId: null');
    expect(body).toContain('missionTypeId: null');
  });
});

/**
 * THE UNSAVED ROWS ARE TINTED, AND THE TINT CLEARS ITSELF ON SAVE.
 *
 * «يعمل الbackground للصف او العربيه اللى حصل عليها تغيير ولسه معملش حفظ، لما يعمل حفظ اللون
 * يتشال عشان ممكن يعمل تعديل ويخودش باله هو عدل ايه».
 *
 * Asserted at source level because the tint is a function of DRAFT state, and these specs render
 * in a node environment where nothing can be dragged, typed or dropped to create one.
 */
describe('a car edited and not yet saved is tinted', () => {
  /** The model (which rows are unsaved) and the computer's board (how a row says so). */
  const CODE = rosterSource(['model', 'desk']);

  it('paints the row with the board’s unsaved amber', () => {
    // «اعتمد» on D1 / D3: the computer's rows are tinted by their own mark in OPAQUE colours — the
    // pinned «إجراءات» cell takes its row's colour, and the see-through `UNSAVED_ROW` would show
    // the seats scrolling under it at 1280px. The same amber, laid over the board's surface;
    // `UNSAVED_ROW` stays the touch card's.
    expect(CODE, 'a mark on the row').toContain("? 'unsaved'");
    expect(CODE, 'painted amber, opaque').toContain(
      '[&_tbody_tr[data-tint=unsaved]]:!bg-[#fffbeb]',
    );
    expect(CODE, 'applied per row').toContain('m.unsavedIds.has(row.vehicleId)');
    expect(rosterSource(['touch']), 'the cards keep the shared constant').toContain('UNSAVED_ROW');
  });

  /**
   * The set is `changedRows`, not `rowsToSave`. The second is what a save would WRITE, and it
   * carries rows whose operation is merely projected from the standing crew and that nobody has
   * touched — tinting those would tell the reader they had edited cars they never opened.
   */
  it('tints what the READER changed, not everything a save would write', () => {
    const at = CODE.indexOf('const unsavedIds');
    expect(at, 'the set exists').toBeGreaterThan(-1);
    const decl = CODE.slice(at, CODE.indexOf(');', CODE.indexOf('[saved, draft]', at)));
    expect(decl, 'the reader’s own edits').toContain('changedRows(saved, draft)');
    expect(decl, 'not the save payload').not.toContain('rowsToSave');
  });

  it('an unsaved edit outranks the workshop tint — the workshop also has a badge', () => {
    // Only one row colour can win, and the rose one is backed by the badge in the code cell.
    // An unsaved edit has nothing but this colour, so it must not be the one that loses.
    const at = CODE.indexOf('rowProps=');
    const rule = CODE.slice(at, CODE.indexOf('loading=', at));
    expect(rule.indexOf("'unsaved'"), 'unsaved is tested first').toBeGreaterThan(-1);
    expect(rule.indexOf("'unsaved'")).toBeLessThan(rule.indexOf('inMaintenance'));
  });

  it('nothing clears the tint by hand — the draft reset is what clears it', () => {
    // A save hands the screen a new server board; `useDraftBoard` resets the draft against it;
    // a draft equal to its baseline has no changed rows. An explicit "clear the tint" step would
    // be a second source of truth for the same fact, and the two would drift.
    expect(CODE).not.toMatch(/setUnsaved|clearTint|setUnsavedIds/);
  });
});

// ── «مش ظاهر ملاحظات إجراءات» — the whole row fits beside the two pools ─────
//
// At 1600px with the 240px sidebar the table was handed about 820px and needed about 1025px.
// In RTL the excess spills off the LEFT edge, and the left edge is where «ملاحظات» and «إجراءات»
// are drawn — so the two columns the reader acts from were the two they could not see. Measured
// in a browser after the change: the table and its box are both 914px at 1600, nothing clipped.
describe('the board fits: notes and actions are on screen', () => {
  it('gives the pools a fixed width and the table everything else', () => {
    // «اعتمد» on D1: the ONE drivers panel takes 20rem (24rem from 1750px) and the table the rest,
    // so «إجراءات» is whole on the screen at 1536 and 1920.
    expect(SOURCE).toContain('grid-cols-[minmax(0,1fr)_20rem]');
    expect(SOURCE).toContain('min-[1750px]:grid-cols-[minmax(0,1fr)_24rem]');
    expect(SOURCE, 'no third of the screen reserved for the pools any more').not.toContain(
      'xl:grid-cols-3',
    );
    expect(SOURCE, 'nor a span that assumed it').not.toContain('xl:col-span-2');
  });

  it('wears the new Fleet boards’ table', () => {
    // «شاشه الكبيوتر اعملها زى باقى شاشات الحركة الجديده ك ui»: the table the Accidents and
    // Maintenance boards draw — their floor per column and their sticky head — inside the boards'
    // dark table, its seats and selects on a 6px gutter of their own.
    const at = DESK.indexOf('<DataTable');
    const table = DESK.slice(at, DESK.indexOf('/>', at));
    expect(table).toContain('minColumnWidth={4}');
    expect(table).toContain('stickyHead');
    for (const board of ['pages/AccidentsPage.tsx', 'pages/MaintenancePage.tsx']) {
      const other = readFileSync(join(HERE, board), 'utf8');
      expect(other, `as ${board} does`).toContain('minColumnWidth={4}');
      expect(other, `as ${board} does`).toContain('stickyHead');
    }
    expect(DESK, 'the boards’ dark table').toContain('DARK_TABLE,');
    // 6px from 1536px up, as approved; 4px on a laptop («تمام اعتمد» — the laptop fit, below).
    expect(DESK, 'a tight gutter for the seats').toContain(
      "const TIGHT_CELL = '[&&]:!px-1.5 max-[1535px]:[&&]:!px-1'",
    );
  });

  it('holds a driver seat to a bounded width and a long note to a short column', () => {
    // «كبر اى مكان فيه اسم سواق» — the name is still the seat's biggest word. «اعتمد» on D1: the
    // seat is the COMPACT one — the name in bold over the employee code — between 11rem and
    // 15rem, and a long note WRAPS in an 8rem column rather than widening the table past its
    // frame.
    expect(DESK, 'the seat is bounded').toContain('min-w-[11rem] max-w-[15rem]');
    expect(DESK, 'the seated name reads bold').toContain(
      "'text-[12.5px] font-bold leading-5 text-slate-900 min-[1750px]:text-sm dark:text-slate-50'",
    );
    expect(DESK, 'the note wraps in a short column').toContain(
      'max-w-[8rem] whitespace-normal break-words',
    );
  });

  it('still leaves the mission select room for «نقل أموال (يومي)»', () => {
    // «صغر ... نوع المهمة» — 9.5rem at the tight gutter: 152px less the 36px chevron and 8px
    // start padding is 108px; the label needs 104px.
    const at = DESK.indexOf("key: 'mission'");
    const cell = DESK.slice(at, DESK.indexOf("key: 'driver1'"));
    expect(cell).toContain('className={MISSION_BOX}');
    expect(DESK).toMatch(/const MISSION_BOX =\s*"mx-auto w-\[9\.5rem\]/u);
    expect(cell).toContain('density="tight"');
  });
});

// ── «تمام اعتمد» — the laptop fit (1280–1535px) ─────────────────────────────
//
// The owner approved: «على اللابتوب بس (1366 و1440) أصغّر عرض قائمة السواقين اللي على الشمال شوية،
// وأضيّق خانة «نوع المهمة» وعمود «ملاحظات» شوية. كده الجدول كله يدخل في الشاشة من غير سحب، و«السائق
// الثاني» و«ملاحظات» يبانوا كاملين. على 1536 وأكبر الشكل اللي اعتمدته مش هيتغير خالص» — «تمام اعتمد».
//
// Measured in a browser before the change: the table needed 1021px and its frame gave 912px at
// 1366×768 and 986px at 1440×900, so «ملاحظات» and part of «السائق الثاني» slid under the pinned
// «إجراءات». The three named narrowings alone gave back about 60px; the rest came from tighter
// gutters, gap and action box. After: 939px of table in a 944px frame at 1366, the whole table in
// its 1018px frame at 1440 — and at 1280 the table's floor still overflows its 858px frame by 81px,
// where the pinned «إجراءات» and its edge carry on as before. The shots (1366, 1440, 1536, 1920,
// touch) are the proof of the pixels; these claims pin the rules that make them.
describe('the laptop fit — «تمام اعتمد»', () => {
  const LAPTOP = 'max-[1535px]:';
  /** Every `max-[…px]:` rule written in the given text. */
  const maxRules = (text: string): string[] => text.match(/max-\[\d+px\]:[^\s'"`]+/gu) ?? [];
  /** The class list of the first element carrying `marker`, in rendered markup. */
  const classOf = (markup: string, marker: string): string => {
    const at = markup.indexOf(marker);
    if (at === -1) throw new Error(`nothing marked ${marker}`);
    const tag = markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at));
    // The markup escapes `&` and `>` inside an attribute; the classes are read as written.
    return (/class="([^"]*)"/u.exec(tag)?.[1] ?? '')
      .replaceAll('&amp;', '&')
      .replaceAll('&gt;', '>')
      .replaceAll('&lt;', '<');
  };

  it('narrows the three pieces the owner named — the drivers panel, «نوع المهمة», «ملاحظات»', () => {
    // Each laptop value is written BESIDE the approved one, never in its place.
    expect(DESK, 'the panel: 20rem → 18.25rem, beside an 8px gap').toContain(
      'grid-cols-[minmax(0,1fr)_20rem] gap-3 max-[1535px]:grid-cols-[minmax(0,1fr)_18.25rem] max-[1535px]:gap-2 min-[1750px]:grid-cols-[minmax(0,1fr)_24rem] min-[1750px]:gap-4',
    );
    expect(DESK, 'the mission box: 9.5rem → 9rem').toMatch(
      /const MISSION_BOX =\s*"mx-auto w-\[9\.5rem\] max-\[1535px\]:w-36 /u,
    );
    expect(DESK, 'the notes’ floor: 5rem → 3.5rem, the 8rem ceiling kept').toContain(
      'min-w-[5rem] max-w-[8rem] whitespace-normal break-words text-xs leading-snug [text-wrap:balance] max-[1535px]:min-w-[3.5rem]',
    );
  });

  it('keeps «نقل أموال (يومي)» whole in the 9rem box, beside its chevron', () => {
    // The box's room for words is its width less the select's border (1px a side), its tight
    // start gutter (`px-2`, 8px) and the chevron's reserve (`pe-6`, 24px) — read from `Select`
    // itself, so a change there breaks this claim rather than the label. The label is 105.2px
    // (14px Cairo, semibold — measured), «بدون نوع مهمة» 91px.
    const FORM = readFileSync(join(HERE, '../../shared/ui/form.tsx'), 'utf8');
    expect(FORM).toContain("(density === 'tight' ? 'px-2' : 'px-3')");
    expect(FORM).toContain("density === 'tight' ? 'appearance-none pe-6' : 'appearance-none pe-9'");
    const at = DESK.indexOf("key: 'mission'");
    expect(DESK.slice(at, DESK.indexOf("key: 'driver1'")), 'the mission select is tight').toContain(
      'density="tight"',
    );
    const room = 9 * 16 - 2 - 8 - 24;
    expect(room - 105.2, 'about 5px to spare').toBeGreaterThanOrEqual(4);
  });

  it('closes up only spacing — gutters, the gap, the action box, the panel’s own padding', () => {
    expect(DESK, 'the cells’ 9px gutter → 6px').toContain(
      "const LAPTOP_GUTTERS = 'max-[1535px]:[&_td]:!px-1.5 max-[1535px]:[&_th]:!px-1.5'",
    );
    expect(DESK, 'on the roster’s table').toMatch(/ROW_TINTS,\s*LAPTOP_GUTTERS,\s*\);/u);
    expect(DESK, 'the action box 16px → 12px between its icons').toContain(
      "const LAPTOP_ACTIONS = 'max-[1535px]:gap-1 max-[1535px]:px-1'",
    );
    expect(DESK).toContain(
      'className={cn(ACTION_GROUP, LAPTOP_ACTIONS)} data-row-actions="roster"',
    );
    expect(DESK, 'the panel’s 12px → 8px around the tabs and the search').toContain(
      'border-b border-slate-200 p-3 max-[1535px]:p-2',
    );
    // «السائقون المتاحون (8)» needs about 119px in a tab; the 18.25rem panel's equal tabs give it
    // 128px once their own gaps close up — and a two-digit count (about 8px more) still fits.
    expect(DESK, 'the tabs’ own gaps').toContain(
      '[&_[role=tab]]:!h-9 [&_[role=tab]]:!gap-1 [&_[role=tab]]:!px-1 [&_[role=tab]]:!text-[13px] max-[1535px]:[&_[role=tab]]:!gap-0.5 max-[1535px]:[&_[role=tab]]:!px-0.5 max-[1535px]:[&_[role=tablist]]:!gap-0.5',
    );
    // Nothing on a laptop shrinks a word, hides a piece or cuts a text.
    const rules = maxRules(DESK);
    expect(rules.length, 'the laptop rules are there').toBeGreaterThanOrEqual(13);
    for (const rule of rules) {
      expect(rule, 'one band: 1280–1535px').toMatch(/^max-\[1535px\]:/u);
      expect(rule, 'no type size, no hiding, no cutting').not.toMatch(
        /text-|hidden|invisible|truncate|line-clamp|overflow|whitespace|w-0|max-w/u,
      );
    }
  });

  it('never reaches the touch boards or the lists they share', () => {
    // «على 1536 وأكبر … مش هيتغير خالص» and the phone/tablet boards untouched: the laptop rules
    // live on the computer's board alone — the shared lists are tightened from the desk panel.
    const elsewhere = rosterSource(['touch', 'shared', 'shell', 'model'], { raw: true });
    expect(elsewhere).not.toContain(LAPTOP);
  });

  it('draws the laptop rules on the board itself, not in dead constants', () => {
    const markup = render();
    expect(classOf(markup, 'data-roster-table="true"')).toContain(
      'max-[1535px]:[&_td]:!px-1.5 max-[1535px]:[&_th]:!px-1.5',
    );
    expect(
      classOf(markup, 'grid min-h-0 flex-1 grid-cols-'),
      'the grid of table and panel',
    ).toContain('max-[1535px]:grid-cols-[minmax(0,1fr)_18.25rem] max-[1535px]:gap-2');
    expect(classOf(markup, 'data-row-actions="roster"')).toContain('max-[1535px]:gap-1');
    const mission = missionCell(markup, '150');
    expect(mission, 'the default board offers a mission select on 150').not.toBe('');
    const box = markup.slice(0, markup.indexOf(mission));
    expect(box.slice(box.lastIndexOf('<div class="mx-auto')), 'its box').toContain(
      'w-[9.5rem] max-[1535px]:w-36',
    );
    const panel = markup.slice(markup.indexOf('data-drivers-panel'));
    expect(panel.slice(0, 2000), 'the panel’s header').toContain('p-3 max-[1535px]:p-2');
  });
});

// ── «زرار اسوتش يبدل بين السواقيين اللى على العربيه» ─────────────────────────
describe('the row swaps its two drivers', () => {
  const FULL: FleetRosterDayDto = {
    ...BOARD,
    rows: [
      row(V1, '150', { missionTypeId: MT, driver1EmployeeId: E1, driver2EmployeeId: E3 }),
      row(V2, '151', { inMaintenance: true, driver1EmployeeId: E2, driver2EmployeeId: E3 }),
    ],
  };

  it('offers the swap on a car that has both drivers', () => {
    const markup = render({ qc: client(FULL) });
    expect(markup).toContain(`data-swap-drivers="${V1}"`);
    expect(markup).toContain(t('fleet.roster.swapDrivers'));
  });

  it('does not offer it on a car the workshop holds — FR-5 refuses the assignment', () => {
    expect(render({ qc: client(FULL) })).not.toContain(`data-swap-drivers="${V2}"`);
  });

  it('does not offer it where there is only one driver to trade', () => {
    expect(render(), 'the default board seats E1 alone on 150').not.toContain('data-swap-drivers=');
  });

  it('does not offer it on a day that cannot be planned', () => {
    expect(render({ qc: client(FULL), permissions: ['fleetRoster.view'] })).not.toContain(
      'data-swap-drivers=',
    );
  });

  it('sits in the actions, between edit and delete, and edits the DRAFT only', () => {
    const BOARD_FILE = rosterSource(['desk']);
    const edit = BOARD_FILE.indexOf("t('fleet.roster.editAssignment')");
    const swap = BOARD_FILE.indexOf('data-swap-drivers=');
    const clear = BOARD_FILE.indexOf("t('fleet.roster.clearAssignment')");
    expect(edit).toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(edit);
    expect(clear).toBeGreaterThan(swap);
    expect(BOARD_FILE.slice(swap, swap + 500)).toContain('m.actions.swap(row.vehicleId)');
    expect(BOARD_FILE.slice(swap, swap + 500)).toContain('<SwapIcon');
    // …and the model's swap is an edit of the draft, through the board function.
    expect(MODEL).toContain(
      'const swap = (vehicleId: string): void => edit((rows) => swapDrivers(rows, vehicleId));',
    );
  });
});

describe('the names are the board — «كبر اى مكان فيه اسم سواق»', () => {
  const CHIP = readFileSync(join(HERE, 'components/DriverChip.tsx'), 'utf8');
  it('reads a big chip a size up, and wraps a long name instead of cutting it', () => {
    expect(CHIP).toContain(
      "'whitespace-normal break-words py-1.5 text-center text-sm leading-snug'",
    );
    expect(CHIP, 'the default chip is unchanged elsewhere').toContain("'truncate py-1 text-xs'");
  });
  it('reads the name as the seat’s biggest word, and the lists’ names at 15px', () => {
    // «اعتمد» on D1: the computer's seat is the compact one, not the chip — the name in bold over
    // its employee code in the figures' face — and the lists read names at 15px. (`DriverChip`
    // itself is unchanged; the standing board still draws it.)
    //
    // A TRADE the owner may not have noticed, named here and in the hand-off: on the approved D1
    // the seat's name is 12.5px between 1280 and 1749px (14px from 1750px, as the car code), where
    // «كبر اى مكان فيه اسم سواق» had made it 14px — the price of «إجراءات» on screen at 1536.
    expect(DESK, 'the seat draws no chip').not.toContain('<DriverChip');
    const markup = render();
    const seat = markup.slice(markup.indexOf(`data-driver-chip="${E1}"`));
    expect(seat.slice(0, 1500), 'the seat says the name').toContain('أحمد محمد');
    expect(seat.slice(0, 1500), 'over the code').toContain('>HR-1<');
    expect(DESK, 'the code in the figures’ face').toContain(
      "className={cn(NUM, 'text-[11px] font-semibold text-slate-500 dark:text-slate-400')}",
    );
    expect(rosterSource(['shared']), 'the lists read a name at 15px').toContain(
      "'block text-[15px] font-semibold leading-5'",
    );
    expect(DESK, 'the seat’s name: 12.5px, the car code’s 14px from 1750px').toContain(
      "'text-[12.5px] font-bold leading-5 text-slate-900 min-[1750px]:text-sm dark:text-slate-50'",
    );
    expect(DESK, 'the car code').toContain("className={cn('text-sm font-bold', FIGURE)}");
  });
});

// ── the computer's board, as the owner approved it ──────────────────────────
//
// «شاشه الكبيوتر اعملها زى باقى شاشات الحركة الجديده ك ui و شيل الفلتر بتاع كل المهمات اللى جمب كود
// السيارة بس وسيب الباقى» — and «اعتمد» on the shot D1-board-1536-dk. What is NEW on the computer;
// what it kept is asserted above.
describe('the computer’s board — «اعتمد» on D1', () => {
  it('drops ONLY «كل المهمات»: the mission chip narrows the board and shows it is pressed', () => {
    const markup = at(`&mission=${MT}`);
    expect(markup, 'no mission drop-down beside the code').not.toContain(
      t('fleet.roster.allMissions'),
    );
    expect(SOURCE, 'nor its control').not.toContain('<CatalogMultiSelect');
    expect(tbody(markup), '?mission= still narrows').toContain('150');
    expect(tbody(markup)).not.toContain('151');
    expect(chipActive(markup, MT), 'the mission chip is the control, pressed').toBe(true);
    expect(markup, 'the code picker stays').toContain(t('fleet.vehicles.fields.code'));
  });

  it('opens on its toolbar — no page title, no breadcrumbs — counting the cars in Latin digits', () => {
    const markup = at('');
    expect(markup, 'no page title').not.toContain('<h1');
    expect(SOURCE, 'nor the page header').not.toContain('PageHeader');
    const toolbar = markup.slice(markup.indexOf('data-roster-toolbar'));
    expect(toolbar.slice(0, 600), 'the count of the cars on screen').toContain(
      translate('ar', 'fleet.vehicles.count', { count: '4' }),
    );
    // …the cars ON SCREEN: a filter narrows it.
    const narrowed = at('&view=workshop');
    expect(narrowed.slice(narrowed.indexOf('data-roster-toolbar')).slice(0, 600)).toContain(
      translate('ar', 'fleet.vehicles.count', { count: '2' }),
    );
  });

  it('reads the table’s words in Cairo and its figures in the figures’ face', () => {
    // After the shot the owner approved, the table's words were moved to Cairo with `!important`
    // so a name has no wide Azeret Mono spaces in it («عمرو  حسن»).
    expect(DESK).toContain('"[&_td]:![font-family:\'Cairo\',ui-sans-serif,sans-serif]"');
    expect(DESK, 'the code').toContain("const FIGURE = cn('whitespace-nowrap', NUM);");
    expect(DESK, 'on the code cell').toContain("className={cn('text-sm font-bold', FIGURE)}");
  });

  it('pins «إجراءات» to the table’s end edge, head and cells', () => {
    expect(DESK).toContain("const PINNED_CELL = 'sticky end-0 z-[1] [background-color:inherit]';");
    expect(DESK).toContain("const PINNED_HEAD = 'sticky end-0 z-[2] [background-color:inherit]';");
    const markup = at('');
    const head = markup.slice(
      markup.lastIndexOf('<th', markup.indexOf(`>${t('fleet.vehicles.columns.actions')}<`)),
    );
    expect(head.slice(0, head.indexOf('>')), 'the head').toContain('sticky end-0');
    const cell = markup.lastIndexOf('<td', markup.indexOf('data-row-actions="roster"'));
    expect(markup.slice(cell, markup.indexOf('>', cell)), 'and each cell').toContain(
      'sticky end-0',
    );
  });

  it('says «في الورشة — غير قابلة للتعيين» ONCE per workshop car, and keeps each badge whole', () => {
    const markup = at('');
    const rowOf = (code: string): string =>
      tbody(markup)
        .split('<tr')
        .find((r) => r.includes(`>${code}<`)) ?? '';
    for (const code of ['151', '152']) {
      expect(rowOf(code).split(t('fleet.roster.inWorkshopNoDrop')).length - 1, code).toBe(1);
    }
    expect(rowOf('150'), 'not on a working car').not.toContain(t('fleet.roster.inWorkshopNoDrop'));
    expect(DESK, 'a badge never breaks its words').toContain('[&_span]:whitespace-nowrap');
  });

  it('holds both driver lists in one panel: two tabs counted in Latin digits, one box', () => {
    const markup = at('');
    const panel = markup.slice(markup.indexOf('data-drivers-panel'));
    const tab = (key: string): string => {
      const idx = panel.indexOf(`data-driver-tab="${key}"`);
      return panel.slice(panel.lastIndexOf('<button', idx), panel.indexOf('</button>', idx));
    };
    // E3 is the one free driver (E1 sits on 150); E2 is on leave.
    expect(tab('available')).toContain('>1<');
    expect(tab('unavailable')).toContain('>1<');
    expect(tab('available'), 'opens on the available list').toContain('aria-selected="true"');
    expect(panel.match(/role="tabpanel"/g)?.length, 'both lists are in the page').toBe(2);
    expect(panel, 'the free driver').toContain(`data-driver-card="${E3}"`);
    expect(panel, 'and the absent one, in the hidden tab').toContain(
      `data-unavailable-driver="${E2}"`,
    );
  });

  it('opens the absent list when the link asks for a reason («غائبون اليوم»)', () => {
    const markup = at('&unavailable=hrLeave');
    const idx = markup.indexOf('data-driver-tab="unavailable"');
    const tag = markup.slice(markup.lastIndexOf('<button', idx), markup.indexOf('>', idx) + 1);
    expect(tag).toContain('aria-selected="true"');
    expect(markup, 'the reason chip is pressed').toMatch(
      /data-reason-filter="hrLeave" aria-pressed="true"/u,
    );
  });

  it('exports through the boards’ Excel pill', () => {
    const markup = at('');
    const idx = markup.indexOf('data-export="roster"');
    expect(idx, 'the pill').toBeGreaterThan(-1);
    const button = markup.slice(
      markup.lastIndexOf('<button', idx),
      markup.indexOf('</button>', idx),
    );
    expect(button).toContain(`title="${t('fleet.export.excel')}"`);
    expect(button).toContain(t('fleet.fuelCards.board.excel'));
    expect(DESK, 'the rows on screen, in their order').toContain(
      'onExport={() => m.actions.exportSheet(rows)}',
    );
  });
});
