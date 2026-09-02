// What a vehicle-code box actually SENDS, and what a board actually SHOWS — executed, not read.
//
// The display half of this rule was made true before the search half was, which is what made the
// bug visible rather than merely present: the options had already lost the plate that used to
// explain them, so a four-identifier `search` answered "150" with a car called `007` and nothing
// on the row to say why it was there. This file pins the half no rendering test can see.
//
// The other two layers are pinned where they live: `vehicleCodeSearchQuery` against the endpoint's
// own `.strict()` schema in the contracts suite, and `vehicleIdentifierFilter('code', …)` refusing
// a plate in the API suite. Together the three make one chain — box → query → server filter.
import { describe, expect, it } from 'vitest';
import { vehicleCodeSearchQuery, type FleetRosterRowDto } from '@ecms/contracts';
import { visibleRows } from './roster-view';
import { readTypedVehicleCodes } from './typed-vehicle-codes';

/**
 * `buildQuery` from `shared/lib/api-client`, which cannot be imported here — the module opens a
 * `fetch` client at load. Copied at the shape the assertions depend on: skip empty, stringify.
 */
const buildQuery = (params: Record<string, unknown>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
};

/** The URL a code picker sends for what was typed — the same call shape all four of them make. */
const url = (typed: string): string =>
  `/fleet/vehicles${buildQuery({ ...vehicleCodeSearchQuery(typed), pageSize: 50 })}`;

describe('the URL a vehicle-code selector sends', () => {
  it('asks `code`, and never `search`', () => {
    expect(url('150')).toBe('/fleet/vehicles?code=150&pageSize=50');
    expect(url('150')).not.toContain('search=');
  });

  it('asks for no narrowing at all when the box is empty', () => {
    // Not `code=`, which the schema would reject (`min(1)`), and not `search=` either.
    expect(url('')).toBe('/fleet/vehicles?pageSize=50');
    expect(url('   ')).toBe('/fleet/vehicles?pageSize=50');
  });

  it('carries a plate, chassis or motor number as a CODE — so the registry finds nothing', () => {
    // The point of the whole change, seen from the request: whatever is typed goes to the `code`
    // field. `vehicleIdentifierFilter('code', …)` then matches codes and only codes, which the
    // API suite asserts. There is no path left from this box to a plate.
    expect(url('س ص 4470')).toContain('code=');
    expect(url('س ص 4470')).not.toContain('search=');
    expect(url('CH-150')).toBe('/fleet/vehicles?code=CH-150&pageSize=50');
  });
});

const row = (code: string, plateNumber: string): FleetRosterRowDto =>
  ({
    vehicleId: `v-${code}`,
    typeId: 't1',
    code,
    plateNumber,
    inMaintenance: false,
    planned: false,
    missionTypeId: null,
    driver1EmployeeId: null,
    driver2EmployeeId: null,
    notes: null,
  }) as FleetRosterRowDto;

/** The fleet from the screenshots, plus the car that made the old behaviour visible. */
const DAY = [
  row('150', 'س ص 4470'),
  row('200', 'س ص 8891'),
  row('213', 'س ص 7702'),
  // Its code has nothing to do with 150; its plate, chassis and motor all contain it.
  row('007', 'ط ط 4150'),
];
const shown = (term: string): string[] => visibleRows(DAY, { term }).map((r) => r.code);

describe('the roster boards filter on the code', () => {
  it('shows the car whose CODE was typed', () => {
    expect(shown('150')).toEqual(['150']);
    expect(shown('213')).toEqual(['213']);
  });

  it('shows nothing for a plate number — it used to show whichever car carries it', () => {
    expect(shown('4470')).toEqual([]);
    expect(shown('8891')).toEqual([]);
    expect(shown('ط ط 4150')).toEqual([]);
  });

  it('takes a list of codes, the way the filter bar does', () => {
    expect(shown('150 - 213')).toEqual(['150', '213']);
    expect(shown('150,200')).toEqual(['150', '200']);
  });

  it('reads `150 -` and `150 - ` the canonical way', () => {
    // A trailing separator means the code before it is FINISHED. Both spellings are one keystroke
    // apart and must not answer differently — the same rule `readTypedVehicleCodes` applies in the
    // filter bar, reached here through the same parser.
    expect(shown('150 -')).toEqual(['150']);
    expect(shown('150 - ')).toEqual(['150']);
    expect(readTypedVehicleCodes('150 -')).toEqual({ chosen: ['150'], typing: '' });
    expect(readTypedVehicleCodes('150 - ')).toEqual({ chosen: ['150'], typing: '' });
  });

  it('shows the whole day for an empty box', () => {
    expect(shown('')).toHaveLength(4);
    expect(shown('  ')).toHaveLength(4);
  });

  it('matches a code that appears as a WORD inside a plate — by the code, as the bar does', () => {
    // `ط ط 150` is three tokens to the canonical parser — deduplicated to two — and one of them is
    // a real code, so car 150 is shown. It is matched on its OWN code; car 007's plate field is
    // never read, which is the guarantee. The odometer's filter bar answers the same text
    // identically: it ticks «ط» and asks the registry `code=150`. Reproduced rather than
    // special-cased, because the alternative is a second parser and one vocabulary is the point.
    expect(shown('ط ط 150')).toEqual(['150']);
    expect(readTypedVehicleCodes('ط ط 150')).toEqual({ chosen: ['ط'], typing: '150' });
  });
});
