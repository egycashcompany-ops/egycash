// The two chain queries, guarded at the source.
//
// Both are aggregations over mongo, so their behaviour is proved by the integration suite. What
// CANNOT be proved there quickly is the one decision that is easy to get wrong and silent when
// wrong: which FIELD is "the reading taken on this row's date".
//
// A row holds two numbers. `outReading` is measured on the row's own date; `inReading` is the
// SHARED reading that opens the next period, so it was measured on the NEXT row's date. Folding
// `inReading` into a date-bounded bound therefore imports a future reading into the past — a car
// read at 100,000 on 1 September and 400,000 on 1 October has ONE row dated 1 September carrying
// both, and the bracket for 15 September must answer 100,000.
//
// That is exactly the bug the integration suite caught on the first run of this change, and it
// produced a bound too HIGH, which turns healthy baselines into `baselineBelowChain` — a false
// refusal, the most expensive direction to be wrong in. This file stops it coming back.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'odometer.repository.ts'), 'utf8');

/** The body of one method, from its signature to the closing brace at method indentation. */
const methodBody = (name: string): string => {
  const start = source.indexOf(`  async ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const end = source.indexOf('\n  }\n', start);
  return source.slice(start, end);
};

describe('a date-bounded bound reads outReading, never the shared inReading', () => {
  for (const name of ['chainBounds', 'lowerBoundsAt']) {
    it(`${name} never folds inReading into its answer`, () => {
      const body = methodBody(name);
      expect(body, `${name} is bounded by a date`).toMatch(/\$lt|\$gte/);
      expect(body, `${name} must not use inReading`).not.toContain('inReading');
      expect(body, `${name} must not take a max across the two fields`).not.toMatch(
        /Math\.max|\$max/,
      );
    });
  }

  it('and both cut the day WHOLE, through the one shared helper', () => {
    // A bare `$lte` on a midnight date drops a reading stamped with a time on that same day into
    // the UPPER bound, where it reads as "a later reading" it is not.
    expect(source).toContain('private static dayAfter(on: Date): Date');
    for (const name of ['chainBounds', 'lowerBoundsAt']) {
      expect(methodBody(name), `${name} uses it`).toContain('dayAfter(');
    }
  });
});

describe('the UNBOUNDED read is different, and deliberately still takes the max', () => {
  it('latestReadings asks "how far has this car got?" and has no date bound', () => {
    // The contrast that makes the rule above meaningful rather than a blanket ban: with no date
    // cut, the shared reading IS this vehicle's furthest point, and dropping it would understate
    // the FR-2 floor.
    const body = methodBody('latestReadings');
    expect(body).toContain('inReading');
    expect(body).toContain('Math.max');
    expect(body, 'and it takes no date at all').not.toMatch(/\$lt:|\$gte:/);
  });

  it('findLatest likewise — the floor `record()` refuses below', () => {
    const service = readFileSync(join(HERE, 'odometer.service.ts'), 'utf8');
    expect(service).toContain('Math.max(latest.outReading, latest.inReading ?? latest.outReading)');
  });
});

describe('every ordering query breaks ties, so the chain is a TOTAL order', () => {
  it('there is one named order, and no bare outReading sort survives', () => {
    expect(source).toContain('const NEWEST_FIRST = { outReading: -1, _id: -1 }');
    expect(source).not.toMatch(/sort\(\{ outReading: -1 \}\)/);
  });

  it('and every sort that mentions outReading also mentions _id', () => {
    const sorts = [
      ...(source.match(/\$sort: \{[^}]*outReading[^}]*\}/g) ?? []),
      ...(source.match(/\.sort\(\{[^}]*outReading[^}]*\}\)/g) ?? []),
    ];
    expect(sorts.length, 'there are ordering queries to check').toBeGreaterThan(0);
    for (const sort of sorts) expect(sort, sort).toContain('_id');
  });

  it('neighbour lookups compare on (outReading, _id), not on outReading alone', () => {
    // Strict `$lt`/`$gt` on the value alone leaves a tied pair with no relationship in either
    // direction, so a correction would propagate to the wrong row.
    const body = methodBody('findNeighbors');
    expect(body).toContain('outReading: entry.outReading, _id: { $lt: entry._id }');
    expect(body).toContain('outReading: entry.outReading, _id: { $gt: entry._id }');
  });
});
