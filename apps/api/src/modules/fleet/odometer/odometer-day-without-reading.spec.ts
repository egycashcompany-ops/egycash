// A DAY RECORDED WITH NO READING — what it is, where it is allowed, and what it must never touch.
//
// «لا اما يسيبو فاضى ويدله انذار ان العربيه دى المفروض تدخل الرقم عشان احسب الصيانه، لو مش هيفرق
// فى الصيانه سيبوا فاضى». A day that was missed can still be worth recording — who took the car
// out, what happened — and what it cannot carry is a counter nobody wrote down. Every number the
// system could invent for it would be a lie told in the one column the maintenance alarm measures
// from, so the column is left empty and the alarm is told how many such days there are.
//
// The rule has four halves and each is pinned below, because each is a different way to get it
// wrong: WHEN it is allowed (a day that has already passed, and no other test), what the row IS
// (not a link in the chain — and the queries that must therefore skip it), what happens when the
// number turns up LATER (it fills that row; the day does not appear twice), and what the alarm
// SAYS about it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FleetOdometerLogModel } from './odometer.model';

const HERE = __dirname;
const source = (name: string): string => readFileSync(join(HERE, name), 'utf8');

describe('what the model lets a row be', () => {
  it('a reading is OPTIONAL on the document — a day with none is still a row', () => {
    const path = FleetOdometerLogModel.schema.path('outReading') as {
      isRequired?: boolean;
      options?: { default?: unknown };
    };
    expect(path.isRequired, 'required would make the whole feature impossible').toBeFalsy();
    expect(path.options?.default, 'and its absence is null, never 0 — 0 is a reading').toBeNull();
  });

  it('the DATE is still required — a day with no reading is at least a day', () => {
    expect((FleetOdometerLogModel.schema.path('date') as { isRequired?: boolean }).isRequired).toBe(
      true,
    );
  });

  it('the open-period index skips it, or a car could never have a real open period again', () => {
    const [, options] = (FleetOdometerLogModel.schema.indexes() as [
      Record<string, unknown>,
      Record<string, unknown> | undefined,
    ][]).find(([, o]) => o?.name === 'ux_open_period') as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    // Such a row carries `inReading: null` because it closes nothing. Under a filter that named
    // only `inReading: null` it would BE the car's open period, and the next real reading — the
    // one that genuinely opens a period — would be refused by the unique index.
    expect(options.partialFilterExpression).toMatchObject({ outReading: { $type: 'number' } });
  });
});

describe('when a reading may be left out — and the whole of the rule', () => {
  const service = source('odometer.service.ts');

  it('it is decided in `record`, before anything is written', () => {
    const at = service.indexOf('if (input.reading == null)');
    expect(at, 'the branch exists').toBeGreaterThan(-1);
    expect(at, 'and before the row is created').toBeLessThan(service.indexOf('const prior ='));
  });

  it('THE DAY MUST HAVE PASSED, and nothing else is asked of it', () => {
    const branch = service.slice(service.indexOf('if (input.reading == null)'));
    // «بس اللى هى فاتت». Today's reading is the one somebody is standing at the car to take, and
    // tomorrow's has not happened; every earlier day can only be remembered.
    expect(branch.slice(0, 400)).toContain('input.date >= startOfTodayUtc()');
    expect(service).toMatch(/const startOfTodayUtc = \(\): Date/);
  });

  it('a day at the END of the chain is NOT refused — the row is on no chain to end', () => {
    // It used to ask for a reading before the day AND after it, on the reasoning that a day with
    // none after it would be the car's open period carrying no number. Such a row is on NO chain,
    // so it cannot BE the open period, and `ux_open_period` excludes it by name.
    expect(service).not.toContain('bounds.lower === null || bounds.upper === null');
    expect(service).not.toMatch(/before it AND after it/);
  });

  it('the same empty day cannot be logged twice — no index can say so, so the service does', () => {
    const branch = service.slice(service.indexOf('if (input.reading == null)'));
    expect(branch).toContain('findDayWithoutReading(');
    expect(branch).toContain('already recorded for this vehicle without a reading');
  });

  it('the row it writes is EMPTY in all three reading columns, and splices nothing', () => {
    const branch = service.slice(
      service.indexOf('if (input.reading == null)'),
      service.indexOf('if (bounds.lower !== null'),
    );
    expect(branch).toContain('outReading: null');
    expect(branch).toContain('inReading: null');
    expect(branch).toContain('km: null');
    expect(branch, 'it closes no prior row').not.toContain('updateById');
    expect(branch, 'and it reports itself as no insertion into the chain').toContain(
      'inserted: false',
    );
  });

  it('the correction flow refuses to put a reading on it — recording the day is the way', () => {
    expect(service).toContain(
      'record the reading for that date instead of correcting this row',
    );
  });
});

describe('the row is on NO chain, and every question the chain asks must skip it', () => {
  const repository = source('odometer.repository.ts');

  it('there is ONE clause for it, not one condition copied eight times', () => {
    expect(repository).toContain("const ON_THE_CHAIN = { outReading: { $ne: null } } as const;");
  });

  it.each([
    ['findOpen', 'the car’s open period'],
    ['findLatest', 'how far the car has got'],
    ['findNeighbors', 'the correction flow’s two sides'],
    ['findPriorByDate', 'the row a new reading follows'],
    ['findChainHead', 'the row a new head hands on to'],
    ['chainBounds', 'the bracket FR-2 is enforced against'],
    ['latestReadings', 'the alarm engine’s fleet-wide read'],
    ['lowerBoundsAt', 'the alarm projection’s per-vehicle bound'],
  ])('%s carries it — %s', (method) => {
    const at = repository.indexOf(`${method}(`);
    expect(at, `${method} exists`).toBeGreaterThan(-1);
    // The clause has to be inside that method's own body, not merely somewhere in the file.
    const body = repository.slice(at, at + 1400);
    expect(body, `${method} must skip a day with no reading`).toContain('ON_THE_CHAIN');
  });

  it('MISSING one is wrong in the expensive direction, and the file says why', () => {
    // `null` sorts BELOW `0` in MongoDB, so an unfiltered day-row wins `sort({ outReading: 1 })`
    // and becomes an upper bound of nothing — refusing every legitimate reading after that date.
    expect(repository).toMatch(/sorts `null` BELOW `0`/);
  });
});

describe('when the number turns up later, it FILLS that day', () => {
  const service = source('odometer.service.ts');

  it('the path that HAS a reading looks for the empty day too, not only the path without one', () => {
    // Two rows for one day is a register that has to be read twice to be believed: one would sit
    // there forever saying «بدون قراءة» about a day that now has a reading.
    const measured = service.indexOf('const measured = {');
    expect(measured, 'the reading path exists').toBeGreaterThan(-1);
    expect(service.indexOf('findDayWithoutReading(', measured)).toBeGreaterThan(-1);
  });

  it('it UPDATES that row rather than creating a second one, under its own version', () => {
    const branch = service.slice(service.indexOf('const empty = await'));
    expect(branch.slice(0, 1800)).toContain('empty === null');
    expect(branch.slice(0, 1800)).toContain('version: empty.__v');
  });

  it('the filled row is spliced like any other reading — same bounds, same prior, same hand-on', () => {
    const measured = service.slice(service.indexOf('const measured = {'));
    expect(measured.slice(0, 300)).toContain('inReading: handOn');
    // The SAME measurements go into the create and into the fill, so the two cannot drift.
    expect((measured.match(/\.\.\.measured,/g) ?? []).length).toBe(2);
  });

  it('what the second form leaves blank keeps what the day was recorded with', () => {
    // The empty day may be the only surviving record of who took the car out, and a blank field
    // on the form that carries the number is not a retraction.
    expect(service).toContain('driver(input.driver1EmployeeId, empty.driver1EmployeeId)');
    expect(service).toContain('driver(input.driver2EmployeeId, empty.driver2EmployeeId)');
    expect(service).toContain('input.notes ?? empty.notes');
  });

  it('the trail calls it an UPDATE — the row is older than this act', () => {
    expect(service).toContain("action: outcome.filled ? 'update' : 'create'");
  });
});

describe('what the maintenance alarm says about it', () => {
  it('counts the days, per vehicle, from each car’s own service date', () => {
    const alarm = readFileSync(join(HERE, '..', 'maintenance', 'maintenance-alarm.ts'), 'utf8');
    expect(alarm).toContain('daysWithoutReadingSince(');
    expect(alarm).toContain('since: baselines.get(String(vehicle._id))?.serviceDate ?? null');
    expect(alarm).toContain('daysWithoutReading: unread.get(id) ?? 0');
  });

  it('counts ONLY days with no reading, and only live ones', () => {
    const repository = source('odometer.repository.ts');
    const body = repository.slice(repository.indexOf('daysWithoutReadingSince('));
    expect(body.slice(0, 900)).toContain('outReading: null');
    expect(body.slice(0, 900)).toContain('isDeleted: false');
  });

  it('is one query for the whole fleet, not one per car', () => {
    const repository = source('odometer.repository.ts');
    const body = repository.slice(
      repository.indexOf('daysWithoutReadingSince('),
      repository.indexOf('The LOWER bound for many vehicles'),
    );
    expect((body.match(/\$or:/g) ?? []).length, 'every vehicle in one $or').toBe(1);
    expect((body.match(/aggregate</g) ?? []).length).toBe(1);
  });
});
