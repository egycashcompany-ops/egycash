// FR-4's `outDate ≥ inDate` is checked on the END STATE of an edit, not on the request.
//
// The behaviour lives in a service that needs a database, so the integration suite is where it is
// proved. What this file adds is a guard the LOCAL suite can run: the defect it fixes was not a
// wrong comparison but a missing one, and a missing check is invisible to every test that does
// not specifically go looking for it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'maintenance.service.ts'), 'utf8');

/** The body of `update`, which is where an edit's end state is decided. */
const updateBody = (): string => {
  const start = source.indexOf('  async update(');
  expect(start, 'update exists').toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('\n  }\n', start));
};

describe('the pair is ordered on what the row will HOLD', () => {
  it('update re-checks inDate against the outDate already on the row', () => {
    const body = updateBody();
    expect(body, 'the merged inDate is computed').toContain('input.inDate ?? before.inDate');
    expect(body, 'and compared with the stored outDate').toContain('before.outDate !== null');
    expect(body, 'refused as a validation error').toMatch(
      /inDate > before\.outDate[\s\S]*?ValidationError/,
    );
  });

  it('the comparison is `>`, so an equal pair passes', () => {
    // `outDate ≥ inDate` is inclusive. In and out on the same day is the commonest visit there
    // is; `>=` here would refuse it and break ordinary work to catch a typo.
    expect(updateBody()).not.toMatch(/inDate >= before\.outDate/);
  });

  it('an OPEN visit is left unconstrained — the null check is not optional', () => {
    // Without it, `inDate > null` is false in JS and the guard would silently never fire; with a
    // coercion the other way it would refuse every edit on an open visit.
    const body = updateBody();
    expect(body).toContain('before.outDate !== null &&');
  });

  it('and check-out still enforces the same rule from its own side', () => {
    // The two halves together are the invariant. Removing either leaves one direction open.
    const checkOut = source.slice(source.indexOf('  async checkOut('));
    expect(checkOut).toContain('input.outDate < before.inDate');
  });

  it('outDate stays absent from the update surface', () => {
    // The whole asymmetry existed because one date can move and the other cannot. If `outDate`
    // ever becomes editable, this guard alone stops being sufficient.
    const contracts = readFileSync(
      join(HERE, '../../../../../../packages/contracts/src/modules/fleet.ts'),
      'utf8',
    );
    const schema = contracts.slice(contracts.indexOf('export const UpdateFleetMaintenanceSchema'));
    expect(schema.slice(0, schema.indexOf('.strict()'))).not.toMatch(/^\s*outDate:/m);
  });
});
