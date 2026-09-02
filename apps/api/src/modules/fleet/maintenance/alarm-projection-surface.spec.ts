// The projection has ONE shape, and the code says true things about itself.
//
// Two findings, one theme: a function that offered a parameter nobody used and that behaved
// differently when used, and a field documented as unwritable that two write paths write. Neither
// changes what the system does today. Both are ways the source lies to the next reader, and a
// lie about a write path is how a "safe" change gets made on a false premise.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAlarms } from './maintenance-alarm';

const HERE = dirname(fileURLToPath(import.meta.url));
const engine = readFileSync(join(HERE, 'maintenance-alarm.ts'), 'utf8');
const service = readFileSync(join(HERE, 'maintenance.service.ts'), 'utf8');
const model = readFileSync(join(HERE, 'maintenance.model.ts'), 'utf8');
const contracts = readFileSync(
  join(HERE, '../../../../../../packages/contracts/src/modules/fleet.ts'),
  'utf8',
);

describe('the alarm projection takes no arguments', () => {
  it('the signature has none', () => {
    // A TypeScript signature is not enough on its own — an optional parameter would still make
    // `computeAlarms.length` zero — so the source is read as well.
    expect(computeAlarms.length).toBe(0);
    const signature = engine.slice(
      engine.indexOf('export const computeAlarms'),
      engine.indexOf('=> {', engine.indexOf('export const computeAlarms')),
    );
    expect(signature, 'no vehicleIds parameter').not.toContain('vehicleIds');
  });

  it('and it always projects every ACTIVE vehicle', () => {
    // The divergence that made the dead branch dangerous: it skipped this filter.
    const body = engine.slice(engine.indexOf('export const computeAlarms'));
    expect(body).toContain('await allActiveVehicles()');

    // Scoped to the FUNCTION BODY, not to the rest of the file. A slice that ran on to the end
    // would be satisfied by the prose above `computeAlarms`, which names the filter while
    // explaining why the dead branch was dangerous — and would then keep passing with the real
    // filter deleted. Prose is not a query.
    const start = engine.indexOf('const allActiveVehicles');
    const fetcher = engine.slice(start, engine.indexOf('\n};', start));
    expect(fetcher, 'the filter is in the query itself').toContain("filter: { status: 'active' }");
    expect(fetcher, 'and it pages to exhaustion rather than taking one page').toContain(
      'for (let page = 1; ; page += 1)',
    );
  });

  it('nothing calls it with arguments', () => {
    // Belt and braces: were the parameter reintroduced, this catches the first caller.
    for (const rel of [
      'maintenance.controller.ts',
      '../odometer/odometer.service.ts',
      '../sweeps/fleet-sweeps.ts',
    ]) {
      const source = readFileSync(join(HERE, rel), 'utf8');
      const calls = source.match(/computeAlarms\([^)]*\)/g) ?? [];
      for (const call of calls) expect(call, `${rel}: ${call}`).toBe('computeAlarms()');
    }
  });

  it('and it no longer reaches for a vehicle by id', () => {
    // `getById` threw NotFoundError for a soft-deleted vehicle — an alarm projection answering a
    // list request with a 404 is the shape that branch had.
    const body = engine.slice(engine.indexOf('export const computeAlarms'));
    expect(body, 'no per-id lookup').not.toContain('fleetVehicleRepository.getById');
  });
});

describe('`spareParts` is described the way it actually behaves', () => {
  it('the write paths that exist are acknowledged, not denied', () => {
    // The claims that were false: "Never written any more" and "nothing writes to it any more".
    expect(model, 'the model no longer claims it is never written').not.toContain(
      'Never written any more',
    );
    expect(contracts, 'nor does the DTO').not.toContain('nothing writes to it any more');
  });

  it('because two paths do write it, verbatim', () => {
    expect(service, 'check-in stores what it was given').toContain(
      'spareParts: input.spareParts ?? []',
    );
    expect(service, 'and update does too').toContain(
      'if (input.spareParts !== undefined) set.spareParts = input.spareParts;',
    );
  });

  it('and both contracts still accept it', () => {
    for (const schema of ['CheckInFleetMaintenanceSchema', 'UpdateFleetMaintenanceSchema']) {
      const block = contracts.slice(contracts.indexOf(`export const ${schema}`));
      expect(block.slice(0, block.indexOf('.strict()')), schema).toContain('spareParts:');
    }
  });

  it('and it is still never matched against the catalog', () => {
    // The part that was always true and must stay true: the words are stored, never interpreted.
    const checkIn = service.slice(
      service.indexOf('async checkIn('),
      service.indexOf('async checkOut('),
    );
    expect(checkIn, 'parts are validated by ID only').toContain(
      'assertSpareParts(input.sparePartIds)',
    );
    expect(checkIn, 'the free text is not resolved to anything').not.toMatch(
      /findActiveOfKind\([^)]*spareParts\b/,
    );
  });
});
