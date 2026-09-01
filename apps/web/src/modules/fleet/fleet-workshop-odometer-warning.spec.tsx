// A workshop counter that contradicts the odometer chain — WARNED ABOUT, never refused.
//
// `odometerAtService` and `exitOdometer` are typed by hand and compared against nothing: no
// server rule relates them to `fleet_odometer_logs`, and a dropped digit turns 280,500 into
// 28,000 in silence. The exit reading is the worse of the two, because it becomes the alarm's
// baseline — a typo there moves the next service rather than staying in its own row.
//
// The answer is advice at the moment of typing. Two things must therefore both hold, and this
// file exists to hold them: the warning must FIRE on a number the chain would refuse, and it
// must STAY QUIET on the two divergences that are perfectly correct — a back-dated visit, whose
// counter belongs below the chain, and an ordinary counter above it, which is just driving.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type FleetExpectedReadingDto,
  type FleetMaintenanceVisitDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { workshopOdometerLooksWrong } from './lib/workshop-odometer-warning';
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

// The floor the chain would refuse a new reading below, and the day it was set.
const EXPECTED = 280_500;
const AS_OF = '2026-08-30';

const looksWrong = (counter: number | null, visitDate: string | null, over = {}): boolean =>
  workshopOdometerLooksWrong({
    counter,
    expectedReading: EXPECTED,
    visitDate,
    asOf: AS_OF,
    ...over,
  });

describe('the rule, on the numbers it was written for', () => {
  it('exactly on the floor ⇒ no warning', () => {
    expect(looksWrong(280_500, '2026-08-31')).toBe(false);
  });

  it('above the floor ⇒ no warning, because that is ordinary driving', () => {
    // A car moves between recorded readings. Higher than anything on record is the NORMAL case,
    // and warning about it would make the warning meaningless.
    expect(looksWrong(280_900, '2026-08-31')).toBe(false);
  });

  it('below the floor, on a visit dated after it ⇒ WARNING', () => {
    // 280,000 against a floor of 280,500 on a visit dated today: the chain has already passed
    // this number, so the car cannot be arriving on it.
    expect(looksWrong(280_000, '2026-08-31')).toBe(true);
  });

  it('below the floor, on a BACK-DATED visit ⇒ no warning', () => {
    // Last month's visit carries last month's counter. It belongs below where the chain has
    // since reached, and refusing to accept that would make the feature cry wolf on correct data.
    expect(looksWrong(275_000, '2026-07-01')).toBe(false);
  });

  it('the dropped digit — the case this exists for ⇒ WARNING', () => {
    expect(looksWrong(28_000, '2026-08-31')).toBe(true);
  });
});

describe('every unknown answers "no warning" rather than guessing', () => {
  it('no reading on record ⇒ nothing to compare against', () => {
    expect(looksWrong(1, '2026-08-31', { expectedReading: null })).toBe(false);
  });

  it('no `asOf` ⇒ the date half of the rule cannot be evaluated', () => {
    // Without it, a back-dated visit is indistinguishable from a typo — so it stays silent.
    expect(looksWrong(28_000, '2026-08-31', { asOf: null })).toBe(false);
  });

  it('no visit date ⇒ same', () => {
    expect(looksWrong(28_000, null)).toBe(false);
    expect(looksWrong(28_000, '')).toBe(false);
  });

  it('an empty or non-numeric counter ⇒ nothing has been typed yet', () => {
    expect(looksWrong(null, '2026-08-31')).toBe(false);
    expect(looksWrong(Number.NaN, '2026-08-31')).toBe(false);
  });

  it('an unparseable date ⇒ silence, not a warning drawn from a broken value', () => {
    expect(looksWrong(28_000, 'not-a-date')).toBe(false);
    expect(looksWrong(28_000, '2026-08-31', { asOf: 'not-a-date' })).toBe(false);
  });
});

describe('the date boundary is the DAY, and it is inclusive', () => {
  it('the visit ON the day the floor was set ⇒ warning', () => {
    expect(looksWrong(280_000, AS_OF)).toBe(true);
  });

  it('the day before ⇒ no warning', () => {
    expect(looksWrong(280_000, '2026-08-29')).toBe(false);
  });

  it('a timestamp is read as its day, not as its clock', () => {
    // `asOf` arrives as a full ISO string from the API and the visit date as `yyyy-mm-dd`.
    // Comparing them raw would make midnight-vs-midday decide the answer.
    expect(
      workshopOdometerLooksWrong({
        counter: 280_000,
        expectedReading: EXPECTED,
        visitDate: '2026-08-30',
        asOf: '2026-08-30T13:45:00.000Z',
      }),
    ).toBe(true);
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

const expectedDto = (over: Partial<FleetExpectedReadingDto> = {}): FleetExpectedReadingDto => ({
  vehicleId: VEHICLE,
  expectedReading: EXPECTED,
  asOf: `${AS_OF}T00:00:00.000Z`,
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

const client = (expected: FleetExpectedReadingDto | undefined = expectedDto()): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (expected !== undefined) qc.setQueryData(['fleet', 'odometer', 'expected', VEHICLE], expected);
  return qc;
};

const draw = (node: JSX.Element, qc: QueryClient): string =>
  renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </Provider>,
  );

/** The warning sentence, as the reader sees it. */
const WARNING = 'أقل من آخر قراءة مسجّلة';

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
  it('each one asks the rule, on its own date, with the REAL asOf beside it', () => {
    for (const [name, body] of Object.entries(dialogSources())) {
      expect(body, `${name} asks the shared rule`).toContain('workshopOdometerLooksWrong({');
      const call = body.slice(body.indexOf('workshopOdometerLooksWrong({'));
      const args = call.slice(0, call.indexOf('});') + 3);

      expect(args, `${name} compares on its own visit date`).toMatch(
        new RegExp(`visitDate: ${OWN_DATE[name] as string}\\b`),
      );
      // `asOf` is half the rule. Passing null here silently turns the warning off for good —
      // the rule returns false with no date — and nothing else in the file would show it.
      expect(args, `${name} passes the real asOf`).toMatch(
        /asOf: expected\.data\?\.asOf \?\? null/,
      );
      expect(args, `${name} passes the real floor`).toMatch(
        /expectedReading: expected\.data\?\.expectedReading \?\? null/,
      );
      expect(args, `${name} never uses today`).not.toContain('new Date()');
    }
  });

  it('and each one actually RENDERS it — as a warning, on the counter field', () => {
    // Computing the suspicion and then not showing it is the same as not having the feature.
    for (const [name, body] of Object.entries(dialogSources())) {
      const warnings = body.match(/warning=\{[\s\S]*?\n\s*\}/g) ?? [];
      const live = warnings.filter((w) => w.includes('counterLooksWrong'));
      expect(live.length, `${name} renders the suspicion it computed`).toBe(1);
      expect(live[0], `${name} names the warning string`).toContain(
        'fleet.maintenance.odometerBelowChain',
      );
    }
  });

  it('all three read the SAME rule — there is one, imported, not three copies', () => {
    const source = read('components/MaintenanceDialogs.tsx');
    expect((source.match(/workshopOdometerLooksWrong\(\{/g) ?? []).length).toBe(3);
    expect(source).toContain("from '../lib/workshop-odometer-warning'");
    // No dialog re-derives the comparison itself.
    expect(source, 'no local comparison against the floor').not.toMatch(
      /[<>]=?\s*expected\.data[?.]*\.expectedReading/,
    );
  });

  it('and never with `new Date()` — the VISIT’s date decides, not today', () => {
    // Using "now" would warn on every back-dated visit, which is the false positive the rule is
    // shaped to avoid.
    const source = read('components/MaintenanceDialogs.tsx');
    for (const call of source.split('workshopOdometerLooksWrong({').slice(1)) {
      expect(call.slice(0, call.indexOf('})'))).not.toContain('new Date()');
    }
  });
});

describe('a warning is not a refusal', () => {
  it('nothing in the dialogs gates Save on it', () => {
    // `complete` decides whether Save is enabled. The suspicion must not appear in it, and must
    // not disable a button anywhere.
    const source = read('components/MaintenanceDialogs.tsx');
    for (const block of source.split('const complete =').slice(1)) {
      expect(block.slice(0, block.indexOf(';'))).not.toContain('counterLooksWrong');
    }
    expect(source, 'no button is disabled by it').not.toMatch(/disabled=\{[^}]*counterLooksWrong/);
    expect(source, 'and it is never raised as an error').not.toMatch(
      /error=\{[^}]*counterLooksWrong/,
    );
  });

  it('and it never rewrites what was typed — the value is submitted as entered', () => {
    // The counter reaches the request straight from the field. A "helpful" correction here would
    // be the system inventing a reading nobody recorded.
    const source = read('components/MaintenanceDialogs.tsx');
    expect(source).toMatch(/odometerAtService: odometerNumber/);
    expect(source).toMatch(/exitOdometer: exitNumber/);
    expect(source, 'no clamping to the floor').not.toMatch(
      /Math\.(?:max|min)\([^)]*expectedReading/,
    );
    for (const call of source.split('workshopOdometerLooksWrong({').slice(1)) {
      const args = call.slice(0, call.indexOf('})'));
      expect(args, 'the rule only READS the counter').not.toMatch(/setOdometer|setExitOdometer/);
    }
  });

  it('the design system draws it as advice, and advice is not failure', () => {
    // `Field` renders `error` in red and `warning` in amber, and an error wins the slot. The
    // check-out field carries a real blocking error too, so the two must not claim it at once.
    const form = readFileSync(join(HERE, '../../shared/ui/form.tsx'), 'utf8');
    expect(form).toContain('warning?: string | undefined');
    const source = read('components/MaintenanceDialogs.tsx');
    expect(source, 'the blocking error suppresses the advice').toContain('!belowEntry && counterLooksWrong');
  });
});

describe('the dialogs render, and say nothing when there is nothing to say', () => {
  it('a car with no readings draws no warning', () => {
    const markup = draw(
      <CheckOutDialog open onClose={() => undefined} visit={visit()} />,
      client(expectedDto({ expectedReading: null, asOf: null })),
    );
    expect(markup).not.toContain(WARNING);
  });

  it('nor does an untouched check-in form', () => {
    const markup = draw(<CheckInDialog open onClose={() => undefined} />, client());
    expect(markup).not.toContain(WARNING);
  });

  it('nor an edit dialog whose stored counter is above the floor', () => {
    const markup = draw(
      <MaintenanceEditDialog open onClose={() => undefined} visit={visit({ odometerAtService: 280_900 })} />,
      client(),
    );
    expect(markup).not.toContain(WARNING);
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
