// A car is CHOSEN by its code — displayed by it, searched by it, filtered by it — everywhere.
//
// PR "vehicle code only in vehicle selectors" made the DISPLAY code-only and stopped there, which
// left the half nobody can see from the markup: what the box actually asks. Four controls whose
// options read `150` were still narrowing them with Fleet's `search` — one term across code, plate,
// chassis AND motor — so typing a plate offered whichever car carries it, listed under a code the
// reader had never typed and could not connect to what they wrote. Two boards filtered rows they
// already held on `code || plateNumber`, with the same result and no request involved.
//
// So this file is a CENSUS, not a spot check: an exhaustive partition over every place the web app
// asks the vehicle registry for a list, plus every client-side filter over vehicle rows. A new one
// belongs to no bucket and fails here until somebody classifies it, which is the only way a rule
// this diffuse survives the next screen.
//
// Why by source. `apps/web` has no jsdom: nothing mounts, no effect runs, and a query hook's
// arguments exist only inside a render that cannot happen here. The behaviour itself is pinned
// where it is reachable — `vehicleCodeSearchQuery` in the contracts suite (it is the query, and
// `ListFleetVehiclesQuerySchema` is `.strict()`, so a misspelt field is rejected rather than
// ignored), `matchesVehicleCode` beside this file, and `vehicleIdentifierFilter` in the API suite
// (`code` finds a code and refuses a plate). What is left for source-reading is exactly the
// wiring: which helper each call site reaches for. That is a real question with a checkable answer,
// and it is the part that regressed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const text = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** Comments explain the rule; they must not be able to satisfy it. */
const code = (rel: string): string =>
  text(rel)
    .split('\n')
    .filter((line) => {
      const t = line.trimStart();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

/**
 * Every control whose job is to pick or filter A CAR, and which reaches the registry to do it.
 *
 * Each must build its query with `vehicleCodeSearchQuery` and must not send `search` — the two
 * halves of one rule, asserted separately so a failure says which half broke.
 */
const CODE_SELECTORS = [
  {
    file: 'modules/fleet/components/VehicleCodeFilter.tsx',
    what: 'the multi-select on the six filtered fleet screens (odometer, maintenance, alarms, registry, accidents, violations)',
  },
  {
    file: 'modules/fleet/components/RecordOdometerDialog.tsx',
    what: 'the vehicle picker on «تسجيل قراءة عداد»',
  },
  {
    file: 'modules/fleet/components/MaintenanceDialogs.tsx',
    what: 'the vehicle picker on the maintenance check-in',
  },
  {
    file: 'modules/gold/api/gold-api.ts',
    what: "Gold's receiving picker, through its own module's call",
  },
  {
    file: 'modules/fleet/pages/VehiclesListPage.tsx',
    what: 'the legacy `?code=` link lookup — literally "does a car carry this code?"',
  },
] as const;

/**
 * Filters over vehicle rows the screen ALREADY holds — no request to narrow, same question to
 * answer. They must go through `matchesVehicleCode` rather than spell a comparison of their own.
 */
const CLIENT_SIDE_FILTERS = [
  { file: 'modules/fleet/lib/roster-view.ts', what: 'the daily board’s `?q=` box' },
  { file: 'modules/fleet/pages/FixedRosterPage.tsx', what: 'the fixed roster’s `?q=` box' },
] as const;

/**
 * Registry queries that are NOT a vehicle-code selector. Each is allowed to ask whatever it asks,
 * and each says why — this is the half of the partition that stops the rule being applied where it
 * does not belong.
 */
const NOT_A_CODE_SELECTOR = [
  {
    file: 'modules/fleet/components/VehicleSelect.tsx',
    why: 'a plain dropdown of the whole active registry — it has no search box at all, so there is no term to route',
  },
  {
    file: 'modules/fleet/pages/AccidentsPage.tsx',
    why: 'an unfiltered id→code map so a retired car’s file still prints its code; the screen’s actual filter is VehicleCodeFilter',
  },
  {
    file: 'modules/fleet/pages/ViolationsPage.tsx',
    why: 'the same id→code map, plus the code→id lookup the rollup axis needs; filtering is VehicleCodeFilter’s',
  },
  {
    file: 'modules/fleet/pages/FleetDashboardPage.tsx',
    why: 'two counts — active vehicles, licences expiring — neither of them a search',
  },
] as const;

/**
 * The ARGUMENTS of every registry query in a file, and nothing else around them.
 *
 * Reading the whole file cannot answer this question. `VehicleCodeFilter` holds `searchValue` and
 * `onSearch` — MultiSelect props, named for the box rather than for any query — and `gold-api.ts`
 * is a whole module's API surface, where `searchEmployees` legitimately sends `search` to HR. Both
 * would read as violations. So the query is cut out at its own parentheses and only that is judged.
 */
const queryArguments = (source: string): string[] => {
  const found: string[] = [];
  for (const call of ['useVehicles(', 'useVehicleSearch(', '/fleet/vehicles${buildQuery(']) {
    let at = source.indexOf(call);
    while (at !== -1) {
      let depth = 0;
      let end = at + call.length - 1;
      for (; end < source.length; end += 1) {
        const ch = source[end];
        if (ch === '(') depth += 1;
        else if (ch === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      found.push(source.slice(at, end + 1));
      at = source.indexOf(call, at + 1);
    }
  }
  return found;
};

/** A `search` FIELD in a query object: `search:`, `search,` or `search }`. */
const SENDS_MULTI_FIELD_SEARCH = /\bsearch\s*[:,]|\bsearch\s*\}/;

describe('every vehicle-code selector searches the CODE', () => {
  it.each(CODE_SELECTORS.map((s) => ({ ...s })))(
    'builds its query with vehicleCodeSearchQuery — $what',
    ({ file }) => {
      expect(code(file)).toContain('vehicleCodeSearchQuery(');
    },
  );

  it.each(CODE_SELECTORS.map((s) => ({ ...s })))(
    'never asks Fleet’s four-identifier `search` — $what',
    ({ file }) => {
      const queries = queryArguments(code(file));
      expect(queries.length, `${file} no longer queries the registry`).toBeGreaterThan(0);
      for (const query of queries) {
        expect(
          SENDS_MULTI_FIELD_SEARCH.test(query),
          `${file} sends a multi-field search:\n${query}`,
        ).toBe(false);
      }
    },
  );
});

describe('every client-side vehicle filter matches the CODE', () => {
  it.each(CLIENT_SIDE_FILTERS.map((f) => ({ ...f })))(
    'goes through matchesVehicleCode — $what',
    ({ file }) => {
      expect(code(file)).toContain('matchesVehicleCode(');
    },
  );

  it.each(CLIENT_SIDE_FILTERS.map((f) => ({ ...f })))(
    'never reads a plate to decide what to show — $what',
    ({ file }) => {
      expect(code(file)).not.toContain('plateNumber');
    },
  );
});

describe('the census covers every registry query in the application', () => {
  /**
   * The partition, and the reason this file is a census rather than five assertions.
   *
   * Every module file that calls `useVehicles`/`useVehicleSearch` or names the `/fleet/vehicles`
   * LIST endpoint has to appear in exactly one bucket above. A screen added tomorrow with a
   * vehicle box belongs to none of them and fails here — nothing about it needs to be guessed.
   */
  const CLASSIFIED = new Set<string>([
    ...CODE_SELECTORS.map((s) => s.file),
    ...CLIENT_SIDE_FILTERS.map((f) => f.file),
    ...NOT_A_CODE_SELECTOR.map((n) => n.file),
    // The transport itself: `listVehicles` takes whatever params a caller built, and the callers
    // are what this census classifies.
    'modules/fleet/api/fleet-api.ts',
    'modules/fleet/api/fleet-queries.ts',
    'modules/gold/api/gold-queries.ts',
    // The picker's markup; its query is `gold-api.ts`, classified above.
    'modules/gold/components/VehiclePicker.tsx',
  ]);

  const found = (): string[] => {
    const out = execFileSync(
      'grep',
      ['-rEl', 'useVehicles\\(|useVehicleSearch\\(|/fleet/vehicles\\$\\{buildQuery', 'modules'],
      { cwd: SRC, encoding: 'utf8' },
    );
    return out
      .split('\n')
      .filter((line) => line !== '' && !line.includes('.spec.'))
      .sort();
  };

  it('classifies every file that queries the registry', () => {
    const unclassified = found().filter((file) => !CLASSIFIED.has(file));
    expect(
      unclassified,
      'a new file queries the vehicle registry and belongs to no bucket in this census — add it to CODE_SELECTORS, CLIENT_SIDE_FILTERS or NOT_A_CODE_SELECTOR (with a reason)',
    ).toEqual([]);
  });

  it('lists no file that has since stopped querying the registry', () => {
    // The other direction: a stale entry would make the census look complete while guarding a
    // file nobody calls any more.
    const live = new Set(found());
    const stale = [...CODE_SELECTORS, ...CLIENT_SIDE_FILTERS, ...NOT_A_CODE_SELECTOR]
      .map((e) => e.file)
      // The two roster filters hold rows rather than fetch them; they are never in `found()`.
      .filter((f) => !CLIENT_SIDE_FILTERS.some((c) => c.file === f))
      .filter((f) => !live.has(f));
    expect(stale).toEqual([]);
  });
});
