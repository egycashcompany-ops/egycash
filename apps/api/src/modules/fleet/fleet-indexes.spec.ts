// The index step, at the level that needs no database.
//
// Two things can be wrong here without any query being wrong: the wrong SET of collections gets
// covered, and the wrong OPTIONS get forwarded. Both are silent — a missing collection simply
// keeps the status quo the whole step exists to end, and a stray option makes the second build
// disagree with the first, which mongo answers with `IndexOptionsConflict` rather than a fix.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fleetIndexedModels, indexBuildPlan } from './fleet-indexes';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('every Fleet collection is covered — none may be forgotten', () => {
  const covered = new Set(fleetIndexedModels().map((entry) => entry.collection));

  it('covers every collection a `*.model.ts` in this module declares', () => {
    // Read from the FILES, not from the list under test: a list that checked itself would pass
    // the day somebody adds a model and forgets this one, which is the whole failure mode.
    const declared = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.model.ts')) {
          for (const match of readFileSync(full, 'utf8').matchAll(
            /model<[^>]+>\(\s*'[^']+',\s*\w+,\s*'([^']+)'/g,
          )) {
            declared.add(match[1] as string);
          }
        }
      }
    };
    walk(HERE);

    expect(declared.size, 'the scan found collections at all').toBeGreaterThan(10);
    expect([...declared].filter((name) => !covered.has(name))).toEqual([]);
  });

  it('and covers ONLY Fleet — no other module rides along', () => {
    for (const name of covered) expect(name, name).toMatch(/^fleet_/);
  });

  it('every covered model actually declares at least one index', () => {
    // A model in the list that declares nothing is a sign the list drifted from reality.
    for (const { collection, model } of fleetIndexedModels()) {
      expect(model.schema.indexes().length, collection).toBeGreaterThan(0);
    }
  });
});

describe('the step is actually wired into the boot path', () => {
  it('`runFleetMigrations` calls it — an unwired migration builds nothing, silently', () => {
    // The failure this catches is invisible everywhere else: the function can be perfect and
    // never run, which leaves production in exactly the state it was in before.
    const migration = readFileSync(join(HERE, 'fleet.migration.ts'), 'utf8');
    expect(migration).toContain("from './fleet-indexes'");
    const runner = migration.slice(migration.indexOf('export const runFleetMigrations'));
    expect(runner.slice(0, runner.indexOf('};') + 2)).toContain('await migrateFleetIndexes()');
  });

  it('and `runFleetMigrations` is what the module seed runs at boot', () => {
    const seed = readFileSync(join(HERE, 'fleet.seed.ts'), 'utf8');
    expect(seed).toContain('await runFleetMigrations()');
  });

  it('a unique index is never built without asking about duplicates first', () => {
    // Reported, never resolved: building over violating data fails anyway, and merging or
    // deleting a row would invent an answer the data does not contain.
    const source = readFileSync(join(HERE, 'fleet-indexes.ts'), 'utf8');
    const loop = source.slice(source.indexOf('for (const entry of indexBuildPlan'));
    const body = loop.slice(0, loop.indexOf('\n    }\n  }'));
    expect(body, 'uniqueness gates the check').toContain('if (entry.unique)');
    expect(body, 'and the check runs before the build').toMatch(
      /duplicateGroups\([\s\S]*?createIndex/,
    );
    expect(body, 'a violation skips rather than throws').toContain('continue;');
    expect(source, 'nothing here deletes a row').not.toMatch(
      /deleteOne|deleteMany|findOneAndDelete|updateOne|updateMany|bulkWrite|insert/,
    );
  });
});

describe('the plan forwards exactly the options that describe an index to the server', () => {
  const plan = (options: Record<string, unknown>) => indexBuildPlan([[{ a: 1 }, options]])[0]!;

  it('keeps name, unique, partialFilterExpression, sparse and expireAfterSeconds', () => {
    const entry = plan({
      name: 'ux_a',
      unique: true,
      partialFilterExpression: { isDeleted: false },
      sparse: true,
      expireAfterSeconds: 60,
    });
    expect(entry.options).toEqual({
      name: 'ux_a',
      unique: true,
      partialFilterExpression: { isDeleted: false },
      sparse: true,
      expireAfterSeconds: 60,
    });
  });

  it('drops mongoose-side hints — `background` above all', () => {
    // Modern mongo ignores it, but it would be stored as part of the definition a rebuild is
    // compared against, so forwarding it makes the step conflict-prone instead of idempotent.
    const entry = plan({ name: 'ix_a', background: true, weights: { a: 1 } });
    expect(entry.options).toEqual({ name: 'ix_a' });
  });

  it('reports uniqueness from the forwarded options, not from the raw ones', () => {
    expect(plan({ name: 'ux_a', unique: true }).unique).toBe(true);
    expect(plan({ name: 'ix_a' }).unique).toBe(false);
    expect(plan({ name: 'ix_a', unique: false }).unique).toBe(false);
  });

  it('carries the keys through untouched', () => {
    const entry = indexBuildPlan([[{ vehicleId: 1, outDate: -1 }, { name: 'ix' }]])[0]!;
    expect(entry.keys).toEqual({ vehicleId: 1, outDate: -1 });
  });
});

describe('the real Fleet schemas, planned', () => {
  const all = fleetIndexedModels().flatMap(({ collection, model }) =>
    indexBuildPlan(model.schema.indexes()).map((entry) => ({ collection, entry })),
  );

  it('every declared index is named — an unnamed one cannot be checked for presence', () => {
    for (const { collection, entry } of all) {
      expect(entry.options['name'], `${collection} ${JSON.stringify(entry.keys)}`).toBeTruthy();
    }
  });

  it('the uniques the design calls invariants are all in the plan', () => {
    const unique = new Set(
      all
        .filter((row) => row.entry.unique)
        .map((row) => `${row.collection}.${String(row.entry.options['name'])}`),
    );
    for (const name of [
      'fleet_vehicles.ux_code',
      'fleet_vehicles.ux_plate',
      'fleet_vehicles.ux_chassis',
      'fleet_vehicles.ux_motor',
      'fleet_maintenance_visits.ux_open_visit',
      'fleet_odometer_logs.ux_open_period',
      'fleet_duty_assignments.ux_vehicle_date',
      'fleet_fixed_crews.ux_fixed_vehicle',
      'fleet_driver_profiles.ux_employee_kind',
      'fleet_catalog_items.ux_kind_name_ar',
      'fleet_vehicle_types.ux_name_ar',
      'fleet_violation_grievances.ux_vehicle_year',
      'fleet_sweep_marks.ux_key',
    ]) {
      expect(unique.has(name), name).toBe(true);
    }
  });

  it('`markOnce`s index is one of them — the sweeps depend on it and on nothing else', () => {
    // `markOnce` reports "already announced" only by catching a duplicate key. Without this
    // index it always returns true, and both daily sweeps re-announce everything on every run.
    const source = readFileSync(join(HERE, 'sweeps/sweep-mark.model.ts'), 'utf8');
    expect(source).toContain('isDuplicateKey');
    expect(all.some((row) => row.collection === 'fleet_sweep_marks' && row.entry.unique)).toBe(
      true,
    );
  });
});
