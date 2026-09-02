// A workshop counter that contradicts the odometer chain — WARNED ABOUT, never refused.
//
// `odometerAtService` and `exitOdometer` are typed by hand and compared against nothing: no
// server rule relates them to `fleet_odometer_logs`, and a dropped digit turns 280,500 into
// 28,000 in silence. The exit reading is the worse of the two, because it becomes the alarm's
// baseline — a typo there moves the next service rather than staying in its own row.
//
// The answer is advice at the moment of typing, and the rule it gives is the BRACKET: a counter
// measured on day D must sit at or above everything the chain recorded on or before D, and at or
// below everything it recorded after. Two things must therefore both hold, and this file exists
// to hold them: the warning must FIRE on either side of that bracket, and it must STAY QUIET
// where a divergence is legitimate — inside the bracket, and wherever a bound simply does not
// exist.
//
// The first version of this rule was one-sided (below the chain's global maximum) with a date
// condition bolted on beside it. The bracket subsumes both: the bounds are computed FOR THE
// VISIT'S OWN DATE, so back-dating is handled by which readings are in scope rather than by a
// separate clause — which is why no `visitDate`/`asOf` argument survives here.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  odometerBracketBreach,
  type FleetMaintenanceVisitDto,
  type FleetOdometerBracketDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { workshopOdometerBreach } from './lib/workshop-odometer-warning';
import { CheckInDialog, CheckOutDialog, MaintenanceEditDialog } from './components/MaintenanceDialogs';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

// ── 1. The rule itself ──────────────────────────────────────────────────────

const LOWER = 280_500;
const UPPER = 290_000;

const breach = (counter: number | null, bounds: { lowerBound: number | null; upperBound: number | null }) =>
  workshopOdometerBreach({ counter, bracket: bounds });

const BOTH = { lowerBound: LOWER, upperBound: UPPER };

describe('the bracket, one case per boundary position', () => {
  it('1. exactly ON the lower bound ⇒ no warning', () => {
    // Equality is INSIDE. A counter equal to a reading already on record is the same instrument
    // reading the same number twice — a car that did not move — not a contradiction.
    expect(breach(LOWER, BOTH)).toBeNull();
  });

  it('2. above the lower bound (and below the upper) ⇒ no warning', () => {
    expect(breach(LOWER + 1, BOTH)).toBeNull();
    expect(breach(285_000, BOTH)).toBeNull();
  });

  it('3. below the lower bound ⇒ belowChain', () => {
    expect(breach(LOWER - 1, BOTH)).toBe('belowChain');
    // The dropped digit — the case this exists for.
    expect(breach(28_000, BOTH)).toBe('belowChain');
  });

  it('4. exactly ON the upper bound ⇒ no warning', () => {
    expect(breach(UPPER, BOTH)).toBeNull();
  });

  it('5. below the upper bound ⇒ no warning', () => {
    expect(breach(UPPER - 1, BOTH)).toBeNull();
  });

  it('6. above the upper bound ⇒ aboveChain', () => {
    // The half the one-sided rule could never see: the car has since been recorded LOWER than it
    // supposedly left the workshop on.
    expect(breach(UPPER + 1, BOTH)).toBe('aboveChain');
    expect(breach(2_900_000, BOTH)).toBe('aboveChain');
  });
});

describe('an absent bound constrains nothing', () => {
  it('7. only the lower bound exists ⇒ only the lower side can fire', () => {
    const only = { lowerBound: LOWER, upperBound: null };
    expect(breach(LOWER - 1, only)).toBe('belowChain');
    expect(breach(LOWER, only)).toBeNull();
    // Nothing above it on record, so nothing above it to contradict — however high.
    expect(breach(9_999_999, only)).toBeNull();
  });

  it('8. only the upper bound exists ⇒ only the upper side can fire', () => {
    const only = { lowerBound: null, upperBound: UPPER };
    expect(breach(UPPER + 1, only)).toBe('aboveChain');
    expect(breach(UPPER, only)).toBeNull();
    // A car whose first ever reading comes after its service has no lower bound at all.
    expect(breach(0, only)).toBeNull();
  });

  it('9. neither bound exists ⇒ nothing to compare against, ever', () => {
    const none = { lowerBound: null, upperBound: null };
    for (const counter of [0, 1, LOWER, UPPER, 9_999_999]) {
      expect(breach(counter, none), String(counter)).toBeNull();
    }
  });

  it('and a bracket that has not loaded yet says nothing at all', () => {
    // `null` bracket ≠ a bracket with null bounds: one is "not asked yet", the other is "asked,
    // and the chain is empty". Both are silent, and neither may be guessed from the other.
    expect(workshopOdometerBreach({ counter: 1, bracket: null })).toBeNull();
  });

  it('an empty or non-numeric counter is not a violation of anything', () => {
    expect(breach(null, BOTH)).toBeNull();
    expect(breach(Number.NaN, BOTH)).toBeNull();
    expect(breach(Number.POSITIVE_INFINITY, BOTH)).toBeNull();
  });
});

describe('dates decide which readings are IN the bracket, not whether the rule applies', () => {
  // The rule takes no date at all: the server resolves the bounds FOR the visit's own date, so
  // back-dating, same-day and future-dating are all expressed as different bound VALUES. These
  // pin the shapes the server can hand over.

  it('10. a same-day reading belongs to the LOWER bound', () => {
    // A reading dated exactly on the visit's day satisfies `date <= on`, so it lands in the lower
    // bound — and the invariant then requires the counter to sit at or above it. That is the same
    // boundary `latestReadingDate <= baselineDate` draws on the read side, from the other number.
    expect(breach(LOWER - 1, { lowerBound: LOWER, upperBound: null })).toBe('belowChain');
    expect(breach(LOWER, { lowerBound: LOWER, upperBound: null })).toBeNull();
  });

  it('11. a BACK-DATED visit is compared with the chain as it stood THEN', () => {
    // The chain has since run to 400,000, but on the visit's own day it stood at 100,000. A
    // counter of 100,200 is correct, and the old one-sided rule warned about it because it
    // compared against the global maximum. The bracket does not: 400,000 is the UPPER bound here,
    // and 100,200 sits comfortably between the two.
    expect(breach(100_200, { lowerBound: 100_000, upperBound: 400_000 })).toBeNull();
  });

  it('12. a FUTURE-DATED visit has readings on only one side of it', () => {
    // Nothing is recorded after a date in the future, so the upper bound is absent and the whole
    // chain is the lower one. A counter below everything recorded so far is still suspicious; one
    // above it is ordinary.
    expect(breach(LOWER - 1, { lowerBound: LOWER, upperBound: null })).toBe('belowChain');
    expect(breach(LOWER + 50_000, { lowerBound: LOWER, upperBound: null })).toBeNull();
  });

  it('13. tied readings collapse to one bound value, and the rule is indifferent to which row', () => {
    // FR-2 accepts a reading EQUAL to the floor, so two rows can share a value. Whichever row a
    // bound is taken from, the NUMBER is the same — so the warning cannot flicker between runs.
    const fromRowA = { lowerBound: LOWER, upperBound: UPPER };
    const fromRowB = { lowerBound: LOWER, upperBound: UPPER };
    for (const counter of [LOWER - 1, LOWER, UPPER, UPPER + 1]) {
      expect(breach(counter, fromRowA)).toBe(breach(counter, fromRowB));
    }
  });

  it('14. and the chain the bounds come from is now totally ordered', () => {
    // The server side of the same point: `outReading` alone does not order a chain that permits
    // equal values, so every ordering query breaks the tie on `_id`. Without it "the highest
    // reading" — and the DATE that travels with it — was whichever row mongo happened to return.
    const repo = readFileSync(
      join(HERE, '../../../../api/src/modules/fleet/odometer/odometer.repository.ts'),
      'utf8',
    );
    expect(repo, 'a single named order').toContain('const NEWEST_FIRST = { outReading: -1, _id: -1 }');
    expect(repo, 'no bare outReading sort is left').not.toMatch(/sort\(\{ outReading: -1 \}\)/);
    for (const sort of repo.match(/\$sort: \{[^}]*outReading[^}]*\}/g) ?? []) {
      expect(sort, `${sort} breaks ties`).toContain('_id');
    }
  });
});

describe('the rule is the CONTRACT’s, not a second copy on this side', () => {
  it('the web helper delegates to the shared bracket function', () => {
    const lib = read('lib/workshop-odometer-warning.ts');
    expect(lib).toContain("from '@ecms/contracts'");
    expect(lib).toContain('odometerBracketBreach(');
    // No private comparison against a bound anywhere in the web copy.
    expect(lib, 'no local < or > against a bound').not.toMatch(/counter\s*[<>]=?\s*\w*[Bb]ound/);
  });

  it('and answers identically to it, across the whole range', () => {
    // Swept rather than sampled: if the alias ever stopped delegating, some counter would differ.
    for (let counter = LOWER - 5_000; counter <= UPPER + 5_000; counter += 250) {
      expect(breach(counter, BOTH)).toBe(odometerBracketBreach(counter, BOTH));
    }
  });
});

// ── 2. The three dialogs ────────────────────────────────────────────────────

const VEHICLE = '650000000000000000000001';
const PERMS = [
  'fleetMaintenance.view',
  'fleetMaintenance.checkIn',
  'fleetMaintenance.checkOut',
  'fleetMaintenance.edit',
  'fleetOdometer.view',
  'fleetVehicle.view',
  'hrEmployee.view',
];

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(PERMS.map((p) => [p, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const VISIT_DATE = '2026-08-31';
const bracketDto = (over: Partial<FleetOdometerBracketDto> = {}): FleetOdometerBracketDto => ({
  vehicleId: VEHICLE,
  on: VISIT_DATE,
  lowerBound: LOWER,
  lowerBoundAt: '2026-08-30T00:00:00.000Z',
  upperBound: null,
  upperBoundAt: null,
  ...over,
});

const visit = (over: Partial<FleetMaintenanceVisitDto> = {}): FleetMaintenanceVisitDto =>
  ({
    id: '650000000000000000000091',
    vehicleId: VEHICLE,
    vehicleCode: '150',
    driverInEmployeeId: null,
    driverOutEmployeeId: null,
    inDate: '2026-08-31T00:00:00.000Z',
    outDate: null,
    workshopId: 'w1',
    workTypeId: 'wt1',
    spareParts: [],
    sparePartIds: [],
    odometerAtService: 10_000,
    exitOdometer: null,
    takenInByEmployeeId: null,
    takenOutByEmployeeId: null,
    notes: null,
    version: 0,
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
    ...over,
  }) as FleetMaintenanceVisitDto;

/**
 * The bracket is cached per (vehicle, DATE) — the date is part of the question, so the fixture
 * must seed the same key the dialog asks with, or the test would prove nothing but a cache miss.
 */
const client = (bracket: FleetOdometerBracketDto | undefined = bracketDto()): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (bracket !== undefined) {
    qc.setQueryData(['fleet', 'odometer', 'bracket', VEHICLE, VISIT_DATE], bracket);
  }
  return qc;
};

const draw = (node: JSX.Element, qc: QueryClient): string =>
  renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </Provider>,
  );

/** The two warning sentences, as the reader sees them. */
const BELOW = 'المسجّلة بالفعل يوم';
const ABOVE = 'المسجّلة لاحقاً يوم';

/** Each dialog's own source, so a claim can be made about ONE of them at a time. */
const dialogSources = (): Record<string, string> => {
  const source = read('components/MaintenanceDialogs.tsx');
  const at = (name: string) => source.indexOf(`export const ${name}`);
  return {
    'check-in': source.slice(at('CheckInDialog'), at('CheckOutDialog')),
    'check-out': source.slice(at('CheckOutDialog'), at('MaintenanceEditDialog')),
    edit: source.slice(at('MaintenanceEditDialog')),
  };
};

/** The date field each dialog must compare on — its OWN visit date, never another's. */
const OWN_DATE: Record<string, string> = {
  'check-in': 'inDate',
  'check-out': 'outDate',
  edit: 'inDate',
};

describe('the warning reaches all three dialogs', () => {
  it('each one asks the bracket on its OWN visit date, never another\u2019s and never today', () => {
    for (const [name, body] of Object.entries(dialogSources())) {
      expect(body, `${name} asks for a bracket`).toContain('useOdometerBracket(');
      const call = body.slice(body.indexOf('useOdometerBracket('));
      const args = call.slice(0, call.indexOf(');') + 2);
      // The date argument IS the rule's date half now. Passing the wrong one — or today — would
      // compare a back-dated visit against a chain it never met, and nothing else would show it.
      expect(args, `${name} brackets on its own visit date`).toMatch(
        new RegExp(`\\b${OWN_DATE[name] as string}\\b`),
      );
      expect(args, `${name} never uses today`).not.toContain('new Date()');
    }
  });

  it('and each one actually RENDERS it — as a warning, on the counter field', () => {
    // Computing the suspicion and then not showing it is the same as not having the feature.
    for (const [name, body] of Object.entries(dialogSources())) {
      const warnings = body.match(/warning=\{[\s\S]*?\}/g) ?? [];
      const live = warnings.filter((w) => w.includes('counterWarningText'));
      expect(live.length, `${name} renders the suspicion it computed`).toBe(1);
    }
  });

  it('all three read the SAME rule — one helper, imported, not three copies', () => {
    const source = read('components/MaintenanceDialogs.tsx');
    expect((source.match(/const counterWarning =/g) ?? []).length, 'defined once').toBe(1);
    expect((source.match(/= counterWarning\(/g) ?? []).length, 'used by all three').toBe(3);
    expect(source).toContain("from '../lib/workshop-odometer-warning'");
    // No dialog re-derives the comparison itself.
    expect(source, 'no local comparison against a bound').not.toMatch(
      /[<>]=?\s*bracket\.data/,
    );
  });

  it('the sentence names the bound AND the day that set it', () => {
    // A bound without its date cannot be acted on. Both sides must carry both facts, or the
    // warning degrades into a riddle the operator cannot check.
    const source = read('components/MaintenanceDialogs.tsx');
    const helper = source.slice(source.indexOf('const counterWarning ='));
    const body = helper.slice(0, helper.indexOf('\n};') + 3);
    expect(body).toContain('lowerBound');
    expect(body).toContain('upperBound');
    expect(body).toContain('lowerBoundAt');
    expect(body).toContain('upperBoundAt');
    expect(body, 'and it is dated for the reader').toContain('formatDate(at, locale)');
  });
});

describe('a warning is not a refusal', () => {
  it('nothing in the dialogs gates Save on it', () => {
    const source = read('components/MaintenanceDialogs.tsx');
    for (const block of source.split('const complete =').slice(1)) {
      expect(block.slice(0, block.indexOf(';'))).not.toContain('counterWarningText');
    }
    expect(source, 'no button is disabled by it').not.toMatch(/disabled=\{[^}]*counterWarningText/);
    expect(source, 'and it is never raised as an error').not.toMatch(
      /error=\{[^}]*counterWarningText/,
    );
  });

  it('and it never rewrites what was typed — the value is submitted as entered', () => {
    const source = read('components/MaintenanceDialogs.tsx');
    expect(source).toMatch(/odometerAtService: odometerNumber/);
    expect(source).toMatch(/exitOdometer: exitNumber/);
    expect(source, 'no clamping to a bound').not.toMatch(/Math\.(?:max|min)\([^)]*[Bb]ound/);
  });

  it('the design system draws it as advice, and advice is not failure', () => {
    const form = readFileSync(join(HERE, '../../shared/ui/form.tsx'), 'utf8');
    expect(form).toContain('warning?: string | undefined');
    const source = read('components/MaintenanceDialogs.tsx');
    expect(source, 'the blocking error suppresses the advice').toContain(
      'belowEntry ? undefined : counterWarningText',
    );
  });

  it('the server never refuses a visit over the bracket — no 409, no validation error', () => {
    const service = readFileSync(
      join(HERE, '../../../../api/src/modules/fleet/maintenance/maintenance.service.ts'),
      'utf8',
    );
    // The workshop's counter stays authoritative. The ONLY counter rule the server enforces is
    // exit >= entry, which predates this and is a different claim entirely.
    expect(service, 'the visit is never refused over the chain').not.toContain('chainBounds');
    expect(service, 'nor over a bracket').not.toContain('odometerBracket');
    expect(service).not.toContain('lowerBound');
  });
});

describe('the dialogs render, and say what there is to say — and nothing more', () => {
  it('a car with no readings at all draws no warning', () => {
    const markup = draw(
      <CheckOutDialog open onClose={() => undefined} visit={visit()} />,
      client(bracketDto({ lowerBound: null, lowerBoundAt: null })),
    );
    expect(markup).not.toContain(BELOW);
    expect(markup).not.toContain(ABOVE);
  });

  it('nor does an untouched check-in form', () => {
    const markup = draw(<CheckInDialog open onClose={() => undefined} />, client());
    expect(markup).not.toContain(BELOW);
    expect(markup).not.toContain(ABOVE);
  });

  it('nor an edit dialog whose stored counter sits inside the bracket', () => {
    const markup = draw(
      <MaintenanceEditDialog
        open
        onClose={() => undefined}
        visit={visit({ odometerAtService: 280_900 })}
      />,
      client(),
    );
    expect(markup).not.toContain(BELOW);
    expect(markup).not.toContain(ABOVE);
  });

  // NO POSITIVE CONTROL LIVES HERE, AND THAT IS DELIBERATE.
  //
  // Every dialog seeds its fields from a `useEffect`, and this suite runs `renderToStaticMarkup`
  // in a DOM-less environment where effects never fire — so `odometer` and `inDate` are both
  // empty at render time, whatever visit is passed in. A "the warning appears" test written here
  // would pass against an empty form and would keep passing if the warning were deleted, which is
  // worse than no test. The negatives above are still real: they prove nothing spurious is drawn.
  //
  // The rendering proof is the real-browser verification, where the effects run, the fields hold
  // the visit's own numbers, and the warning is measured in the DOM. The WIRING between the rule
  // and the field is pinned by the source assertions further up.

  it('and nothing renders while the bracket is still loading', () => {
    const markup = draw(
      <MaintenanceEditDialog
        open
        onClose={() => undefined}
        visit={visit({ odometerAtService: 28_000 })}
      />,
      // No seeded bracket: the query has not answered, so there is nothing to compare against.
      client(undefined),
    );
    expect(markup).not.toContain(BELOW);
    expect(markup).not.toContain(ABOVE);
  });
});

describe('what this feature must not have touched', () => {
  it('the odometer chain is not written to, and its rules are unchanged', () => {
    const source = read('components/MaintenanceDialogs.tsx');
    // No dialog records a reading as a side effect of a workshop visit — that would put a fact
    // into `fleet_odometer_logs` that nobody at the odometer recorded.
    expect(source).not.toContain('useRecordOdometer');
    expect(source).not.toContain('recordOdometer');
    expect(source).not.toContain('correctOdometer');
  });

  it('and the alarm rule is untouched — this is input advice, not a maintenance rule', () => {
    const rule = read('lib/workshop-odometer-warning.ts');
    expect(rule).not.toContain('computeAlarm');
    expect(rule, 'no threshold').not.toMatch(/yellowKm|redKm|intervalKm/);
    expect(rule, 'and no alarm level').not.toMatch(/'red'|'yellow'|level/);
  });
});
