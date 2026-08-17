// The manifest guards: the module registers cleanly, and its surfaces are exactly what the
// shipped slices claim. The pin-the-numbers block (pages.spec precedent) moves with every slice:
// OP-3 pinned 9 permissions, 3 pages, 6 routes, 6 collections — the next slice updates these in
// the same PR that grows them.
import { describe, expect, it } from 'vitest';
import { platformSatisfies, validateManifest } from '../../platform/kernel/module-registry';
import { operationsModule, operationsPages, operationsPermissions } from './operations.module';

describe('operations module manifest (OP-3)', () => {
  it('passes kernel manifest validation', () => {
    expect(() => {
      validateManifest(operationsModule);
    }).not.toThrow();
  });

  it('targets a platform version this kernel satisfies', () => {
    expect(platformSatisfies(operationsModule.requiresPlatform)).toBe(true);
  });

  it('pins the OP-3 surface', () => {
    expect(operationsModule.id).toBe('operations');
    expect(operationsPermissions.map((p) => p.key).sort()).toEqual([
      'operationsCatalog.manage',
      'operationsCrew.plan',
      'operationsCrew.view',
      'operationsDay.manage',
      'operationsShipment.complete',
      'operationsShipment.create',
      'operationsShipment.delete',
      'operationsShipment.edit',
      'operationsShipment.view',
    ]);
    expect(operationsPages.map((p) => p.id)).toEqual([
      'operations.shipments',
      'operations.crew-board',
      'operations.catalogs',
    ]);
    expect(operationsModule.routes.map((r) => r.prefix).sort()).toEqual([
      '/operations/bank-branches',
      '/operations/banks',
      '/operations/crew-board',
      '/operations/currencies',
      '/operations/days',
      '/operations/shipments',
    ]);
    expect(operationsModule.collections.sort()).toEqual([
      'operations_bank_branches',
      'operations_banks',
      'operations_crew_assignments',
      'operations_currencies',
      'operations_days',
      'operations_shipments',
    ]);
  });

  it('every page is pointed at by at least one permission (no empty pages at boot)', () => {
    const used = new Set(operationsPermissions.map((p) => p.pageId));
    for (const page of operationsPages) {
      expect(used.has(page.id)).toBe(true);
    }
  });
});
