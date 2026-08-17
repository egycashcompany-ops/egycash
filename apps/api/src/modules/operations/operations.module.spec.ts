// The manifest guards: the module registers cleanly, and its surfaces are exactly what the
// shipped slices claim. The pin-the-numbers block (pages.spec precedent) moves with every slice:
// OP-2 pinned 7 permissions, 2 pages, 4 routes, 4 collections — the next slice updates these in
// the same PR that grows them.
import { describe, expect, it } from 'vitest';
import { platformSatisfies, validateManifest } from '../../platform/kernel/module-registry';
import { operationsModule, operationsPages, operationsPermissions } from './operations.module';

describe('operations module manifest (OP-2)', () => {
  it('passes kernel manifest validation', () => {
    expect(() => {
      validateManifest(operationsModule);
    }).not.toThrow();
  });

  it('targets a platform version this kernel satisfies', () => {
    expect(platformSatisfies(operationsModule.requiresPlatform)).toBe(true);
  });

  it('pins the OP-2 surface', () => {
    expect(operationsModule.id).toBe('operations');
    expect(operationsPermissions.map((p) => p.key).sort()).toEqual([
      'operationsCatalog.manage',
      'operationsShipment.complete',
      'operationsShipment.create',
      'operationsShipment.delete',
      'operationsShipment.edit',
      'operationsShipment.view',
    ]);
    expect(operationsPages.map((p) => p.id)).toEqual([
      'operations.shipments',
      'operations.catalogs',
    ]);
    expect(operationsModule.routes.map((r) => r.prefix).sort()).toEqual([
      '/operations/bank-branches',
      '/operations/banks',
      '/operations/currencies',
      '/operations/shipments',
    ]);
    expect(operationsModule.collections.sort()).toEqual([
      'operations_bank_branches',
      'operations_banks',
      'operations_currencies',
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
