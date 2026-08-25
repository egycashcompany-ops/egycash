// What the fixed-crew save is ALLOWED to write.
//
// The board reads widely — vehicles for the rows, maintenance for the badge, driver profiles for
// the pool, and now the catalog for the work type. Reading is free; writing is not. This screen
// owns exactly one collection, and the risk of a feature that touches five modules is that a
// convenience write creeps into one of the four it only reads from — a "fix up the driver
// profile while we are here" that no test would otherwise notice.
//
// So this pins the WRITE surface at the seam: which repositories the service mutates through,
// and which it may only ask questions of. The behaviour against a real database is covered in
// tests/integration/fleet.spec.ts; what is covered here is the shape, without needing mongo.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(HERE, 'fixed-roster.service.ts'), 'utf8');
/** The service's CODE — the header discusses the rules at length and would match either way. */
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
/** `save()` alone: `board()` above it legitimately reads from everywhere. */
const SAVE = CODE.slice(CODE.indexOf('async save('));

/** Every `x.y(` call in save(), as "repository.method". */
const calls = (): string[] => [
  ...new Set(
    [...SAVE.matchAll(/(\w+(?:Repository|Service))\.(\w+)\(/g)].map((m) => `${m[1]}.${m[2]}`),
  ),
];

const MUTATORS =
  /\.(create|updateById|softDeleteById|deleteOne|deleteMany|insertMany|bulkWrite|findOneAndUpdate|updateOne|updateMany)\(/;

describe('the fixed-crew save writes to one collection only', () => {
  it('mutates through the fixed-crew repository and nothing else', () => {
    const mutating = calls().filter((c) => MUTATORS.test(`.${c.split('.')[1] as string}(`));
    expect(mutating.sort()).toEqual([
      'fleetFixedCrewRepository.create',
      'fleetFixedCrewRepository.updateById',
    ]);
  });

  it('reads from the other four, and only reads', () => {
    // Each of these is a question the save has to ask; none of them may be an instruction.
    const readOnly = [
      'fleetVehicleRepository',
      'fleetDriverProfileRepository',
      'fleetCatalogItemRepository',
    ];
    for (const repo of readOnly) {
      for (const call of calls().filter((c) => c.startsWith(`${repo}.`))) {
        const method = call.split('.')[1] as string;
        expect(MUTATORS.test(`.${method}(`), `${call} must be a read`).toBe(false);
      }
    }
  });

  it('names the fixed-crew collection, and no other model', () => {
    const model = readFileSync(join(HERE, 'fixed-crew.model.ts'), 'utf8');
    expect(model).toContain("'fleet_fixed_crews'");
    // The service reaches no model directly — everything goes through a repository.
    expect(CODE).not.toMatch(/\bModel\.(create|updateOne|updateMany|deleteOne|deleteMany)\(/);
  });

  it('touches no collection belonging to another module', () => {
    for (const foreign of [
      'fleet_duty_assignments',
      'fleet_driver_profiles',
      'fleet_vehicles',
      'fleet_maintenance_visits',
      'employees',
    ]) {
      expect(CODE, `${foreign} is not this service's to write`).not.toContain(foreign);
    }
    expect(CODE, 'no daily-roster repository at all').not.toContain(
      'fleetDutyAssignmentRepository',
    );
  });

  it('writes exactly the four editable fields — the vehicle facts are not writable here', () => {
    const set = SAVE.slice(SAVE.indexOf('const set:'), SAVE.indexOf('let doc:'));
    for (const field of ['workTypeId', 'driver1EmployeeId', 'driver2EmployeeId', 'notes']) {
      expect(set, `${field} is written`).toContain(field);
    }
    for (const readOnly of ['code', 'plateNumber', 'typeId', 'status', 'inMaintenance']) {
      expect(set, `${readOnly} must not be writable from this board`).not.toContain(readOnly);
    }
  });

  it('validates the work type against the catalog before storing the reference', () => {
    // A dangling reference renders as a blank cell nobody can explain; a `workshop` id renders
    // as another vocabulary entirely. Both are refused at the boundary instead.
    expect(SAVE).toContain("findActiveOfKind(workTypeId, 'workType')");
    expect(SAVE, 'and it is refused, not silently dropped').toMatch(
      /findActiveOfKind\([\s\S]{0,200}ValidationError/,
    );
  });

  it('compares the same keys it stores — or every save would look like a change', () => {
    // Change detection is `JSON.stringify(before) === JSON.stringify(next)`. `before` is
    // `snapshot(doc)` and `next` is built in the loop; if their key sets or key ORDER drift
    // apart, an untouched row compares unequal and gets rewritten — a silent write amplifier
    // that no behavioural test would obviously catch, because the saved values are correct.
    const keysOf = (block: string): string[] =>
      [...block.matchAll(/^\s{2,10}(\w+):/gm)].map((m) => m[1] as string);
    const snapshot = CODE.slice(
      CODE.indexOf('const snapshot = (doc'),
      CODE.indexOf('const canonical'),
    );
    const next = SAVE.slice(SAVE.indexOf('const next = {'), SAVE.indexOf('const set:'));
    expect(keysOf(next), 'snapshot and next agree, in order').toEqual(keysOf(snapshot));
    expect(keysOf(snapshot)).toEqual([
      'workTypeId',
      'driver1EmployeeId',
      'driver2EmployeeId',
      'notes',
    ]);
  });
});
