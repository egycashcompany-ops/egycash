// The baseline is chosen by a TOTAL order.
//
// `alarmBaselines` sorts closed counting visits and takes `$first`. Every write path stores
// `outDate` at midnight UTC, so two counting visits closed on the same day sort EQUAL — and
// mongo's sort is not stable, so `$first` picked one of them arbitrarily. The same request could
// answer with a different baseline counter, a different date and a different `lastServiceVisitId`
// on a refresh, and the alarms board would show a different «أساس الإنذار» each time.
//
// This is the maintenance-side twin of the odometer chain's tie-break: FR-2 permits equal
// readings there, and midnight-UTC dates permit equal `outDate` here. Both are ordinary, and both
// need `_id` to make "the latest one" mean something.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const repository = readFileSync(join(HERE, 'maintenance.repository.ts'), 'utf8');

const aggregation = (): string => {
  const start = repository.indexOf('async alarmBaselines(');
  expect(start, 'alarmBaselines exists').toBeGreaterThan(-1);
  return repository.slice(start, repository.indexOf('\n  }\n', start));
};

describe('same-day services are ordered, not guessed', () => {
  it('the sort breaks ties on _id', () => {
    expect(aggregation()).toContain('$sort: { vehicleId: 1, outDate: -1, _id: -1 }');
  });

  it('no ordering stage in this file sorts on a date alone', () => {
    // Any `$sort` that decides WHICH ROW wins must be total. A partial one is a coin toss the
    // reader cannot see.
    for (const sort of repository.match(/\$sort: \{[^}]*\}/g) ?? []) {
      expect(sort, `${sort} is a total order`).toContain('_id');
    }
  });

  it('and the three picked fields still come from ONE row', () => {
    // The counter, the date and the id must agree with each other; `$first` on a total order is
    // what makes that true.
    const body = aggregation();
    expect(body).toContain(
      "odometerAtService: { $first: { $ifNull: ['$exitOdometer', '$odometerAtService'] } }",
    );
    expect(body).toContain("outDate: { $first: '$outDate' }");
    expect(body).toContain("visitId: { $first: '$_id' }");
  });

  it('the filter still selects only closed, counting, live visits', () => {
    // The tie-break must not have widened what is eligible to be a baseline.
    const body = aggregation();
    expect(body).toContain('outDate: { $ne: null }');
    expect(body).toContain('isDeleted: false');
    expect(body).toContain('workTypeId: { $in:');
  });
});

describe('it matches the odometer side, which had the same problem', () => {
  it('both name the newest row with a descending _id', () => {
    const odometer = readFileSync(join(HERE, '../odometer/odometer.repository.ts'), 'utf8');
    expect(odometer).toContain('const NEWEST_FIRST = { outReading: -1, _id: -1 }');
    expect(aggregation()).toContain('_id: -1');
  });

  it('and the sweep already names the baseline by that row’s id', () => {
    // Which makes the determinism visible downstream: an arbitrary `$first` would have produced
    // an arbitrary announcement key too.
    const sweeps = readFileSync(join(HERE, '../sweeps/fleet-sweeps.ts'), 'utf8');
    expect(sweeps).toContain(
      'alarmMarkKey(alarm.vehicleId, alarm.level, alarm.lastServiceVisitId)',
    );
  });
});
