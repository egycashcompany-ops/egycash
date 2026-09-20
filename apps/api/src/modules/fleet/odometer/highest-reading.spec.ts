// «عاوز لما اعمل فلتر يجبلى العداد فى حالة الفلتر كام» — and the one way to get it wrong.
//
// A COUNTER IS A POSITION, NOT A DISTANCE. An odometer reading says where a car is on its own
// instrument. Adding two cars' readings gives a number that exists on no dashboard in the fleet;
// adding one car's readings to each other counts the same measured instant twice, because
// `inReading` of one row IS `outReading` of the next (`odometer.model.ts`). The only honest
// reductions of a column of counters are «the highest» and «the lowest», and «وصلتها العربية»
// asks for the first.
//
// That is easy to write down and easy to lose: `$sum` is one character from `$max`, and a later
// hand adding «إجمالي العداد» beside it would be adding a category error. So the shape is pinned
// here — the figure is a MAXIMUM, it is measured over the WHOLE filtered set, and it comes from
// one place so three screens cannot disagree about where the same car is.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = __dirname;
const FLEET = join(HERE, '..');
const source = (path: string): string => readFileSync(join(FLEET, path), 'utf8');

describe('the figure is a maximum, and never a sum', () => {
  const helper = source('odometer/highest-reading.ts');

  it('reduces by COMPARISON — no arithmetic is done on a counter at all', () => {
    expect(helper).toContain('reading.reading > best.reading');
    for (const forbidden of ['$sum', '+=', 'reduce(']) {
      expect(helper, `${forbidden} has no business near a column of counters`).not.toContain(
        forbidden,
      );
    }
  });

  it('says WHY in the file, so the next hand does not have to rediscover it', () => {
    expect(helper).toMatch(/POSITION on an instrument, not a distance/);
  });

  it('answers with nothing rather than a zero when no car has a reading', () => {
    // A 0 here would be a claim — «the fleet is at zero kilometres» — and it would be wrong every
    // time it was shown. `StatStrip` draws an omitted value as a muted dash.
    expect(helper).toContain('reading: null');
    expect(helper).toMatch(/none of them is a zero/);
  });

  it('names the car holding it — a bare maximum over several cars names none of them', () => {
    expect(helper).toContain('codesByIds(');
  });

  it('reads the SAME source the maintenance alarm measures from', () => {
    // If this took its own reading, the strip and the alarm could disagree about where a car is.
    expect(helper).toContain('latestReadings(');
  });
});

describe('it describes the whole filtered set, never one page', () => {
  it.each([
    ['odometer/odometer.repository.ts', 'the readings register'],
    ['maintenance/maintenance.repository.ts', 'the workshop register'],
  ])('%s resolves the cars with $match + $group and nothing else — %s', (path) => {
    const body = source(path).slice(source(path).indexOf('async vehicleIdsMatching('));
    const stages = [...body.slice(0, 700).matchAll(/\$(match|group|skip|limit|sort)\b/g)].map(
      (m) => m[1],
    );
    expect(stages, 'a page cannot change a number the query never learned about').toEqual([
      'match',
      'group',
    ]);
  });

  it.each([
    ['odometer/odometer.service.ts', 'summary'],
    ['maintenance/maintenance.service.ts', 'summary'],
  ])('%s builds the summary filter with the SAME helper the list uses', (path) => {
    const body = source(path);
    // Both questions go through `filterFor`, so neither can grow a filter the other lacks.
    expect((body.match(/this\.filterFor\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(body).toContain('highestReadingAmong(');
  });

  it('the summary schemas carry the list’s filters and have NO page', () => {
    const contracts = readFileSync(
      join(FLEET, '..', '..', '..', '..', '..', 'packages', 'contracts', 'src', 'modules', 'fleet.ts'),
      'utf8',
    );
    for (const name of ['FleetOdometerSummaryQuerySchema', 'FleetMaintenanceSummaryQuerySchema']) {
      const at = contracts.indexOf(`export const ${name}`);
      expect(at, `${name} exists`).toBeGreaterThan(-1);
      const decl = contracts.slice(at, contracts.indexOf(';', at));
      // Built from the extracted filter object, and `.strict()` — so a request carrying `page`
      // is refused at the door rather than answered with one page's worth of a total.
      expect(decl).toMatch(/z\.object\((odometer|maintenance)Filters\)\.strict\(\)/);
      expect(decl).not.toContain('PaginationQuerySchema');
    }
  });

  it('both list schemas are built from those same filter objects', () => {
    const contracts = readFileSync(
      join(FLEET, '..', '..', '..', '..', '..', 'packages', 'contracts', 'src', 'modules', 'fleet.ts'),
      'utf8',
    );
    expect(contracts).toContain('...odometerFilters,');
    expect(contracts).toContain('...maintenanceFilters,');
  });
});

describe('the driver clause is composed once, so the page and the figure see the same visits', () => {
  it('lives in its own step and both callers apply it', () => {
    const repository = source('maintenance/maintenance.repository.ts');
    expect(repository).toContain('withDriverFilter(');
    // `listVisits` composes it, and the service composes it for BOTH the page and the summary —
    // so the drivers filter cannot be silently absent from one of the two.
    const service = source('maintenance/maintenance.service.ts');
    expect(service).toContain('withDriverFilter(');
    expect(service, 'and the page never folds it a second time').toContain(
      'driverEmployeeIds: undefined',
    );
  });
});
