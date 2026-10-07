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
 * «اكواد السيارات فى الادخال او الفلاتر لازم لازم تظهر كلها من شاشة السيارات فى اى شاشه من شاشات
 * الحركه … ولما نعمل شاشات تانى لازم تكون كدا».
 *
 * The two controls every Fleet screen picks or filters a car with. Each loads the WHOLE registry
 * (`useAllVehicles`, every page) and narrows it in the browser by CODE alone — no shortlist, no
 * page, no server search. A car picker on a new screen is one of these, or it fails the census
 * below: it would have to query the registry itself, and that query belongs to no bucket.
 */
const WHOLE_REGISTRY_PICKERS = [
  {
    file: 'modules/fleet/components/VehicleCodeFilter.tsx',
    what: 'the car filter on every Fleet filter bar (a board that already holds its cars passes them as `options`)',
  },
  {
    file: 'modules/fleet/components/VehicleCodeCombobox.tsx',
    what: 'the typed single car on every Fleet form — violations, accidents, odometer, maintenance, fuel cards, receipts',
  },
] as const;

/** Where the registry's ONE-PAGE hook may be named: its definition, and the registry's own table. */
const ONE_PAGE_ALLOWED = new Set([
  'modules/fleet/api/fleet-queries.ts',
  'modules/fleet/pages/VehiclesListPage.tsx',
]);

/** Where the list endpoint's call may be named — the transport, and the registry's own export. */
const LIST_CALL_ALLOWED = new Set([
  'modules/fleet/api/fleet-api.ts',
  'modules/fleet/api/fleet-queries.ts',
  'modules/fleet/lib/whole-vehicle-registry.ts',
  'modules/fleet/pages/VehiclesListPage.tsx',
]);

/**
 * Every control OUTSIDE Fleet that picks a car by asking the registry. Each must build its query
 * with `vehicleCodeSearchQuery` and must not send `search` — the two halves of one rule, asserted
 * separately so a failure says which half broke.
 */
const CODE_SELECTORS = [
  {
    file: 'modules/gold/api/gold-api.ts',
    what: "Gold's receiving picker, through its own module's call",
  },
] as const;

/**
 * Filters over vehicle rows the screen ALREADY holds — no request to narrow, same question to
 * answer. They must go through `matchesVehicleCode` rather than spell a comparison of their own.
 */
const CLIENT_SIDE_FILTERS = [
  {
    file: 'modules/fleet/lib/roster-view.ts',
    // Both boards: `visibleRows` for the day, `visibleFixedRows` for the standing crews. The
    // fixed roster used to filter inline on its page; since it took the daily board's bar it
    // reads through this module too, so one entry covers the pair.
    what: 'the daily and standing boards’ `?q=` codes — written by the same picker the accidents board uses',
  },
] as const;

/**
 * Registry queries that are NOT a vehicle-code selector. Each is allowed to ask whatever it asks,
 * and each says why — this is the half of the partition that stops the rule being applied where it
 * does not belong.
 */
const NOT_A_CODE_SELECTOR = [
  {
    file: 'modules/fleet/pages/VehiclesListPage.tsx',
    why: 'the registry screen itself — its table is paged on purpose — plus the legacy `?code=` link check, answered exactly against the whole registry',
  },
  {
    file: 'modules/fleet/components/RecordOdometerDialog.tsx',
    why: 'turns a code carried in from the filter into an id, against the same whole registry its `VehicleCodeCombobox` loads',
  },
  {
    file: 'modules/fleet/components/MaintenanceDialogs.tsx',
    why: 'turns a code carried in from the filter into an id, against the same whole registry its `VehicleCodeCombobox` loads',
  },
  {
    file: 'modules/fleet/pages/FuelCardsPage.tsx',
    why: 'an id→code-and-type map so each car’s section of cards is headed by its code, type and plate; the screen’s filter is VehicleCodeFilter and the card form’s car is VehicleCodeCombobox',
  },
  {
    file: 'modules/fleet/pages/AccidentsPage.tsx',
    why: 'an unfiltered id→code map so a retired car’s file still prints its code; the screen’s actual filter is VehicleCodeFilter',
  },
  {
    file: 'modules/fleet/components/DriverViolationsPanel.tsx',
    why: 'an id→code map so a retired car’s fine still prints its code; the batch bar’s car is VehicleCodeCombobox’s and filtering is VehicleCodeFilter’s',
  },
  {
    file: 'modules/fleet/components/ViolationDialogs.tsx',
    why: 'an id→code lookup so an existing fine SHOWS the car it is on — the car is not editable on a filed row, so there is nothing to select and no term to route',
  },
  {
    file: 'modules/fleet/pages/LicenseExpenseEditorPage.tsx',
    why: 'a code→id-and-plate map so a picked car writes its plate on the memo; the cars themselves are picked with VehicleCodeFilter',
  },
] as const;

/**
 * Every reference in a file to the registry's LIST endpoint, in either shape it can take.
 *
 * `/fleet/vehicles` also names a ROUTE (breadcrumbs, nav) and the DETAIL/mutation endpoints
 * (`/fleet/vehicles/${id}`), neither of which is a search. Requiring a query — a `?` or a `${`
 * immediately after, and no `/` — is what separates the list call from both.
 */
const LIST_ENDPOINT = /\/fleet\/vehicles(?![/\w])\s*(\?|\$\{)/;

/**
 * The ARGUMENTS of every registry query in a file, and nothing else around them.
 *
 * Reading the whole file cannot answer this question. `VehicleCodeFilter` holds `searchValue` and
 * `onSearch` — MultiSelect props, named for the box rather than for any query — and `gold-api.ts`
 * is a whole module's API surface, where `searchEmployees` legitimately sends `search` to HR. Both
 * would read as violations. So each query is cut out at its own delimiters and only that is judged.
 *
 * Two shapes reach the registry: a hook call, bounded by its parentheses, and a URL template,
 * bounded by its backtick. Both are read, so a query written as a raw string cannot slip past a
 * check that only understood hooks.
 */
const queryArguments = (source: string): string[] => {
  const found: string[] = [];
  for (const call of ['useVehicles(', 'useAllVehicles(', 'useVehicleSearch(']) {
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
  for (const line of source.split('\n')) {
    // A URL template: everything from the endpoint to the end of the line carries its query.
    if (LIST_ENDPOINT.test(line)) found.push(line);
  }
  return found;
};

/**
 * The OBJECT LITERALS inside a query — where a field can actually be named.
 *
 * A positional argument is not a field however it is spelled: Gold's picker holds its box text in
 * a state variable called `search` and hands it over as `useVehicleSearch(search, enabled)`, which
 * is a value going to a code-only call, not a `search` field going to the registry. Only what sits
 * inside braces can name a field, so only that is judged.
 */
const objectLiterals = (query: string): string[] => {
  const regions: string[] = [];
  for (let at = 0; at < query.length; at += 1) {
    if (query[at] !== '{') continue;
    let depth = 0;
    for (let end = at; end < query.length; end += 1) {
      if (query[end] === '{') depth += 1;
      else if (query[end] === '}') {
        depth -= 1;
        if (depth === 0) {
          regions.push(query.slice(at, end + 1));
          break;
        }
      }
    }
  }
  return regions;
};

/**
 * Every way the registry's list can be reached: its hooks, its API call, and its endpoint written
 * out — with a query, or bare and concatenated (`'/fleet/vehicles' + …`).
 */
const REGISTRY_GREP = String.raw`\b(useVehicles|useAllVehicles|useVehicleSearch|listVehicles|searchVehicles)\b|/fleet/vehicles(\?|\$\{|['"\`][[:space:]]*[+),])`;
const REGISTRY_NAMES =
  /\b(?:useVehicles|useAllVehicles|useVehicleSearch|listVehicles|searchVehicles)\b|\/fleet\/vehicles(?:\?|\$\{|['"`]\s*[+),])/u;

/**
 * Every module file that reaches the vehicle registry's LIST endpoint — through either hook, or
 * by naming the endpoint itself. Broader than the buckets above on purpose: the point is to
 * catch what nobody thought to register.
 */
const found = (): string[] => {
  const out = execFileSync('grep', ['-rEl', REGISTRY_GREP, 'modules'], {
    cwd: SRC,
    encoding: 'utf8',
  });
  return (
    out
      .split('\n')
      .filter((line) => line !== '' && !line.includes('.spec.'))
      // A name only in a comment is not a query.
      .filter((file) => REGISTRY_NAMES.test(code(file)))
      .sort()
  );
};

/** A `search` FIELD: `search:`, the `{ search }` shorthand, or `search=` written into a URL. */
const SEARCH_FIELD = /\bsearch\s*[:,}]/;
const SEARCH_IN_URL = /[?&]search=/;

/** Does this registry query carry Fleet's four-identifier `search`? */
const sendsMultiFieldSearch = (query: string): boolean =>
  SEARCH_IN_URL.test(query) || objectLiterals(query).some((o) => SEARCH_FIELD.test(o));

describe('every Fleet car picker offers the WHOLE registry', () => {
  it.each(WHOLE_REGISTRY_PICKERS.map((p) => ({ ...p })))(
    'loads every page of the registry — $what',
    ({ file }) => {
      expect(code(file)).toContain('useAllVehicles(');
    },
  );

  it.each(WHOLE_REGISTRY_PICKERS.map((p) => ({ ...p })))(
    'asks for no page and no shortlist — $what',
    ({ file }) => {
      const source = code(file);
      expect(source, 'a one-page registry query').not.toContain('useVehicles(');
      expect(source, 'a server-side code search').not.toContain('vehicleCodeSearchQuery(');
      expect(source, 'a capped list').not.toMatch(/pageSize\s*:/u);
      expect(source, 'a size cap').not.toMatch(/SEARCH_SIZE/u);
    },
  );

  it('narrows by the code, starting-with first, in the single-car picker', () => {
    expect(code('modules/fleet/components/VehicleCodeCombobox.tsx')).toContain(
      'rankVehicleCodes([...byCode.keys()], query)',
    );
  });

  it('narrows the registry by the typed code in the filter', () => {
    expect(code('modules/fleet/components/VehicleCodeFilter.tsx')).toMatch(
      /registryVehicleCodeOptions\(\s*vehicles\.data\?\.items \?\? \[\],\s*search,\s*value\s*\)/u,
    );
  });

  /**
   * THE RULE FOR EVERY SCREEN, INCLUDING THE NEXT ONE. Nothing under Fleet may pick a car from one
   * page of the registry or from a server shortlist. Judged on whole WORDS in comment-stripped
   * code, so a renamed import, a direct `listVehicles` call or a hook added under `api/` is seen
   * the same as the old shape. Each name has an exact list of places it may appear, and why.
   */
  it('no Fleet file asks the registry for a page or a shortlist of cars', () => {
    const fleet = found().filter((file) => file.startsWith('modules/fleet/'));
    const offenders: string[] = [];
    for (const file of fleet) {
      const source = code(file);
      if (/\bvehicleCodeSearchQuery\b/u.test(source))
        offenders.push(`${file}: a server code search`);
      if (/\buseVehicles\b/u.test(source) && !ONE_PAGE_ALLOWED.has(file)) {
        offenders.push(`${file}: one page of the registry (useVehicles)`);
      }
      if (/\blistVehicles\b/u.test(source) && !LIST_CALL_ALLOWED.has(file)) {
        offenders.push(`${file}: a direct registry list call (listVehicles)`);
      }
    }
    expect(
      offenders,
      'a Fleet screen picks a car from a page or a shortlist of the registry. Use VehicleCodeCombobox (one car) or VehicleCodeFilter (a filter) — both offer every car',
    ).toEqual([]);
  });

  it('the one-page query is the registry screen’s own table, and only that', () => {
    const page = code('modules/fleet/pages/VehiclesListPage.tsx');
    expect(page.match(/\buseVehicles\([^)]*\)/gu)).toEqual(['useVehicles(params)']);
    // …and its export, which walks the filtered pages itself.
    expect(page.match(/\blistVehicles\(/gu)).toHaveLength(1);
    const queries = code('modules/fleet/api/fleet-queries.ts');
    // `useVehicles` and `useAllVehicles` — no third hook built on the list endpoint.
    expect(queries.match(/\blistVehicles\b/gu)).toHaveLength(2);
  });

  it('`useAllVehicles` really walks every page', () => {
    const queries = code('modules/fleet/api/fleet-queries.ts');
    const hook = queries.slice(
      queries.indexOf('export const useAllVehicles'),
      queries.indexOf('export const useVehicle ='),
    );
    expect(hook).toContain('fetchWholeVehicleRegistry(api.listVehicles, anyStatus)');
    expect(hook).not.toMatch(/pageSize/u);
  });

  it('the two pickers cut nothing off the list in the browser either', () => {
    for (const { file } of WHOLE_REGISTRY_PICKERS) {
      expect(code(file), `${file} slices its options`).not.toMatch(/\.(?:slice|splice)\(/u);
    }
  });

  /**
   * A filter given its OWN options does not load the registry. Only the boards the owner kept
   * that way may do it — each already holds every car it reports on.
   */
  it('only the boards pass their own options to the car filter', () => {
    const passing = execFileSync('grep', ['-rlE', '<VehicleCodeFilter', 'modules'], {
      cwd: SRC,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line !== '' && !line.includes('.spec.'))
      .filter((file) => {
        const source = code(file);
        let at = source.indexOf('<VehicleCodeFilter');
        while (at !== -1) {
          const end = source.indexOf('/>', at);
          if (/\boptions=/u.test(source.slice(at, end))) return true;
          at = source.indexOf('<VehicleCodeFilter', at + 1);
        }
        return false;
      })
      .sort();
    expect(passing).toEqual([
      // The balance transfer — every place that holds a card, a car or a label on no car.
      'modules/fleet/components/FuelTransferDialog.tsx',
      // Both rosters — every active car on the day's board.
      'modules/fleet/pages/FixedRosterPage.tsx',
      // «التراخيص» — the «ت» licence-class cars, as the owner asked.
      'modules/fleet/pages/LicensingPage.tsx',
      // «إنذارات الصيانة» — the board of every active car.
      'modules/fleet/pages/MaintenanceAlarmsPage.tsx',
      'modules/fleet/pages/RosterPage.tsx',
    ]);
  });
});

/**
 * Which cars each form's car box offers — the WHOLE registry, at the status scope that form has
 * always had («زى ما هما»):
 *
 *   • `any`     — a historical fact that may name a car disposed of since: every status.
 *   • `active`  — fuel cards and transfers: the active cars.
 *   • `checkIn` — the maintenance check-in: the active cars, less those already in a workshop.
 *
 * A new form's car box joins this table, or the census below fails.
 */
const CAR_BOX_SCOPES: readonly {
  file: string;
  scope: 'any' | 'active' | 'checkIn';
  boxes?: number;
}[] = [
  { file: 'modules/fleet/components/AccidentFormDialog.tsx', scope: 'any' },
  { file: 'modules/fleet/components/CompanyViolationsPanel.tsx', scope: 'any' },
  { file: 'modules/fleet/components/DriverViolationsPanel.tsx', scope: 'any' },
  { file: 'modules/fleet/components/ReceiptDialog.tsx', scope: 'any' },
  { file: 'modules/fleet/components/RecordOdometerDialog.tsx', scope: 'any' },
  // Edit, and record.
  { file: 'modules/fleet/components/ViolationDialogs.tsx', scope: 'any', boxes: 2 },
  { file: 'modules/fleet/pages/NoticeEditorPage.tsx', scope: 'any' },
  { file: 'modules/fleet/components/FuelCardDialog.tsx', scope: 'active' },
  { file: 'modules/fleet/components/MaintenanceDialogs.tsx', scope: 'checkIn' },
];

/** The props of every `<VehicleCodeCombobox … />` element in a file, comments left out. */
const carBoxes = (file: string): string[] => {
  const source = code(file);
  const boxes: string[] = [];
  let at = source.indexOf('<VehicleCodeCombobox');
  while (at !== -1) {
    boxes.push(source.slice(at, source.indexOf('/>', at)));
    at = source.indexOf('<VehicleCodeCombobox', at + 1);
  }
  return boxes;
};

describe('each form’s car box keeps its status scope', () => {
  it.each(CAR_BOX_SCOPES.map((entry) => ({ ...entry })))(
    '$file offers the $scope cars',
    ({ file, scope, boxes = 1 }) => {
      const found = carBoxes(file);
      expect(found, `${file} car boxes`).toHaveLength(boxes);
      for (const box of found) {
        expect(box, 'every status').toMatch(
          scope === 'any' ? /\banyStatus\b/u : /^(?![\s\S]*\banyStatus\b)/u,
        );
        expect(box, 'cars already in a workshop').toMatch(
          scope === 'checkIn' ? /\bexcludeInWorkshop\b/u : /^(?![\s\S]*\bexcludeInWorkshop\b)/u,
        );
      }
    },
  );

  it('the table covers every car box in the application', () => {
    const using = execFileSync('grep', ['-rl', '<VehicleCodeCombobox', 'modules'], {
      cwd: SRC,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line !== '' && !line.includes('.spec.'))
      .filter((file) => carBoxes(file).length > 0)
      .sort();
    expect(using).toEqual(CAR_BOX_SCOPES.map((entry) => entry.file).sort());
  });

  /**
   * A code carried in from a page's filter is resolved against the SAME list the box offers: a
   * narrower list would leave a code the box shows but never turns into an id, so Save would stay
   * off with nothing said.
   */
  it('a carried-in code is resolved against the list its box offers', () => {
    const odometer = code('modules/fleet/components/RecordOdometerDialog.tsx');
    expect(odometer).toContain("useAllVehicles({ anyStatus: true }, open && pickedCode !== '')");
    expect(odometer).toContain('resolveCarriedVehicleCode(registry.data.items, pickedCode)');
    expect(odometer).toContain('pendingCode={pickedCode}');

    const checkIn = code('modules/fleet/components/MaintenanceDialogs.tsx');
    expect(checkIn).toContain("useAllVehicles({}, open && pickedCode !== '')");
    expect(checkIn).toMatch(
      /resolveCarriedVehicleCode\(registry\.data\.items, pickedCode, \{\s*excludeInWorkshop: true,\s*\}\)/u,
    );
    expect(checkIn).toContain('pendingCode={pickedCode}');

    const box = code('modules/fleet/components/VehicleCodeCombobox.tsx');
    expect(box, 'the box offers by the same rule').toContain(
      'vehicleCodeEntries(items ?? [], { excludeInWorkshop, chosenId: value })',
    );
  });

  it('a legacy `?code=` link is read against the whole registry, exactly', () => {
    const page = code('modules/fleet/pages/VehiclesListPage.tsx');
    expect(page).toMatch(/useAllVehicles\(\s*\{ anyStatus: true \},/u);
    expect(page).toContain('legacyCodeNamesAVehicle(legacyLookup.data?.items ?? [], legacyCode)');
  });
});

describe('every vehicle-code selector outside Fleet searches the CODE', () => {
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
        expect(sendsMultiFieldSearch(query), `${file} sends a multi-field search:\n${query}`).toBe(
          false,
        );
      }
    },
  );
});

describe('a file that reads the registry for another reason picks no car with it', () => {
  it.each(
    NOT_A_CODE_SELECTOR.filter((n) => n.file.startsWith('modules/fleet/')).map((n) => ({ ...n })),
  )('renders no raw Combobox over the registry — $file', ({ file }) => {
    // A car is picked with VehicleCodeCombobox; `\b` does not match inside that name.
    expect(code(file)).not.toMatch(/<Combobox\b/u);
  });
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
   * THE INVARIANT, and the reason this is a census rather than five assertions.
   *
   * Not "the five files listed above avoid `search`" — that check passes the moment somebody adds
   * a sixth selector inside a file already on some list, which is exactly how a rule this diffuse
   * rots. This says: NOWHERE in the application does a vehicle registry query carry a `search`
   * field. It holds over every file the detector finds, listed or not, and there is no exemption
   * because there is nothing left to exempt — the registry list page filters by named column
   * (`plateNumber`, `chassisNumber`, `motorNumber`), never by one term across four.
   *
   * The endpoint still ACCEPTS `search`, and the API suite still pins what it does. What this
   * forbids is the web application asking it.
   */
  it('no vehicle registry query anywhere in the application sends `search`', () => {
    const offenders: string[] = [];
    for (const file of found()) {
      for (const query of queryArguments(code(file))) {
        if (sendsMultiFieldSearch(query)) offenders.push(`${file}\n    ${query.trim()}`);
      }
    }
    expect(
      offenders,
      'a vehicle registry query sends Fleet’s four-identifier `search`. A control that picks or filters a CAR must build its query with `vehicleCodeSearchQuery` (code only). `search` belongs to the registry LIST PAGE, which browses rather than picks — and that page filters by named column, so nothing should need it',
    ).toEqual([]);
  });

  /**
   * The partition. Every detected file has to appear in exactly one bucket above, so a screen
   * added tomorrow with a vehicle box belongs to none of them and fails here — nothing about it
   * needs to be guessed.
   */
  const CLASSIFIED = new Set<string>([
    ...WHOLE_REGISTRY_PICKERS.map((p) => p.file),
    ...CODE_SELECTORS.map((s) => s.file),
    ...CLIENT_SIDE_FILTERS.map((f) => f.file),
    ...NOT_A_CODE_SELECTOR.map((n) => n.file),
    // The transport itself: these take whatever params a caller built, and the callers are what
    // this census classifies. They are exempt from CLASSIFICATION, never from the invariant above.
    'modules/fleet/api/fleet-api.ts',
    'modules/fleet/api/fleet-queries.ts',
    // Walks the pages of whatever list call it is handed — `useAllVehicles` hands it the registry's.
    'modules/fleet/lib/whole-vehicle-registry.ts',
    'modules/gold/api/gold-queries.ts',
    // The picker's markup; its query is `gold-api.ts`, classified above.
    'modules/gold/components/VehiclePicker.tsx',
  ]);

  it('classifies every file that queries the registry', () => {
    const unclassified = found().filter((file) => !CLASSIFIED.has(file));
    expect(
      unclassified,
      'a new file queries the vehicle registry and belongs to no bucket in this census — a car picker uses VehicleCodeCombobox or VehicleCodeFilter; anything else goes in NOT_A_CODE_SELECTOR (with a reason)',
    ).toEqual([]);
  });

  it('lists no file that has since stopped querying the registry', () => {
    // The other direction: a stale entry would make the census look complete while guarding a
    // file nobody calls any more.
    const live = new Set(found());
    // EVERY classified file — the transport entries too: a dead exemption is a silent one.
    const stale = [...CLASSIFIED]
      // The two roster filters hold rows rather than fetch them; they are never in `found()`.
      .filter((f) => !CLIENT_SIDE_FILTERS.some((c) => c.file === f))
      .filter((f) => !live.has(f));
    expect(stale).toEqual([]);
  });

  it('reaches the registry only through the two module API layers', () => {
    // Closes the other way in: a file that writes the endpoint itself never has to call a hook,
    // so the hook-shaped detector alone could not see it. Naming the list endpoint is allowed in
    // exactly the two places whose job is to publish it.
    const namesEndpoint = execFileSync(
      'grep',
      ['-rEl', String.raw`/fleet/vehicles(\?|\$\{|['"\`][[:space:]]*[+),])`, 'modules'],
      { cwd: SRC, encoding: 'utf8' },
    )
      .split('\n')
      .filter((line) => line !== '' && !line.includes('.spec.'))
      .sort();
    expect(namesEndpoint, 'a module reaches the registry outside its API layer').toEqual([
      'modules/fleet/api/fleet-api.ts',
      'modules/gold/api/gold-api.ts',
    ]);
  });
});

// ── The one selector that does NOT reach the registry ──────────────────────────────────────────
describe('a picker given its own options narrows them itself', () => {
  const FILTER = code('modules/fleet/components/VehicleCodeFilter.tsx');

  it('narrows a passed-in list with the shared matcher', () => {
    // The alarms board hands the control every car it reports on rather than searching, so no
    // request changes as the reader types — and `MultiSelect` filters nothing of its own once an
    // `onSearch` handler is present, which this control passes on every screen because that is how
    // a typed code is taken into the selection. Typing on that board narrowed nothing at all.
    expect(FILTER, 'the passed-in list is narrowed here').toContain('narrowVehicleCodeOptions(');
    // …and specifically by what is being typed, not by some other value that happens to be in
    // scope: `search` is the trailing fragment, the same thing the registry is asked for.
    expect(FILTER).toMatch(/narrowVehicleCodeOptions\(\s*options,\s*search,\s*value\s*\)/);
  });

  it('does not hand a passed-in list straight through', () => {
    // The shape that was there: `options ?? vehicleCodeOptions(...)` — the caller's list, verbatim,
    // whatever was typed over it.
    expect(FILTER).not.toMatch(/options\s*\?\?\s*vehicleCodeOptions/);
  });
});
