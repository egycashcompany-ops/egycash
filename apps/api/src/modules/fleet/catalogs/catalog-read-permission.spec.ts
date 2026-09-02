// Who may READ the Fleet catalogs.
//
// The catalogs are the module's vocabulary. Six of the nine kinds are pointed at from outside the
// vehicle registry, so gating the read on `fleetVehicle.view` alone left whole screens working
// against empty selects — and said nothing while doing it: the request 403s, the picker is simply
// empty, and the table cannot name the workshop it is showing.
//
// This file pins the two halves that matter: the READ is open to every audience whose screens
// point at a kind, and the WRITE did not move an inch.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const routes = readFileSync(join(HERE, 'catalog-item.routes.ts'), 'utf8');
const FLEET = join(HERE, '..');

const handlerBlock = (method: 'get' | 'post' | 'patch'): string => {
  const start = routes.indexOf(`router.${method}(`);
  expect(start, `${method} route exists`).toBeGreaterThan(-1);
  return routes.slice(start, routes.indexOf('asyncHandler', start));
};

describe('every audience whose screens point at a kind may read', () => {
  const readers = [
    'fleetVehicle.view',
    'fleetMaintenance.view',
    'fleetRoster.view',
    'fleetViolation.view',
    'fleetCatalog.manage',
  ];

  it('the list route accepts any of them', () => {
    const block = handlerBlock('get');
    expect(block).toContain('authorizeAny(');
    for (const key of readers) expect(block, key).toContain(`'${key}'`);
  });

  it('and `fleetCatalog.manage` is among them — a manager must be able to LIST what it manages', () => {
    // The plainest of the five: without it, whoever administers the catalogs could create and
    // rename items and never see them.
    expect(handlerBlock('get')).toContain("'fleetCatalog.manage'");
  });
});

describe('every kind a Fleet screen points at has a reader that can fetch it', () => {
  // The mapping the widening is derived FROM, restated independently: each kind is resolved by
  // some service through `findActiveOfKind`, and whoever works that screen must be able to see
  // the list the picker is built from.
  const readersFor: Record<string, string> = {
    workshop: 'fleetMaintenance.view',
    workType: 'fleetMaintenance.view',
    sparePart: 'fleetMaintenance.view',
    missionType: 'fleetRoster.view',
    violationType: 'fleetViolation.view',
    licenseClass: 'fleetVehicle.view',
    operation: 'fleetVehicle.view',
    insuranceCompany: 'fleetVehicle.view',
  };

  it('each consumed kind maps to a permission the read route accepts', () => {
    const block = handlerBlock('get');
    for (const [kind, permission] of Object.entries(readersFor)) {
      expect(block, `${kind} → ${permission}`).toContain(`'${permission}'`);
    }
  });

  it('and every kind in that map really is consumed by a service', () => {
    // Guards the map itself: a kind listed here that nothing points at would be justifying a
    // permission with a consumer that does not exist.
    const sources = [
      'maintenance/maintenance.service.ts',
      'roster/roster.service.ts',
      'fixed-roster/fixed-roster.service.ts',
      'violations/violation.service.ts',
      'vehicles/vehicle.service.ts',
    ].map((rel) => readFileSync(join(FLEET, rel), 'utf8'));
    const all = sources.join('\n');
    for (const kind of Object.keys(readersFor)) {
      expect(all, `${kind} is pointed at by a service`).toContain(`'${kind}'`);
    }
  });
});

describe('writing did not move', () => {
  for (const method of ['post', 'patch'] as const) {
    it(`${method} still demands fleetCatalog.manage, and only that`, () => {
      const block = handlerBlock(method);
      expect(block).toContain("authorize('fleetCatalog.manage')");
      expect(block, 'no widening on the write path').not.toContain('authorizeAny');
    });
  }

  it('and the read is the ONLY route that widened', () => {
    expect((routes.match(/authorizeAny\(/g) ?? []).length).toBe(1);
  });
});
