// The manifest guards: the module registers cleanly, and its surfaces are exactly what the
// shipped slices claim. The pin-the-numbers block (pages.spec precedent) moves with every slice:
// 14 permissions, 5 pages, 10 routes, 9 collections. B3 adds `operations_crew_requirements` — the
// operations roster — under the EXISTING crew route prefix and the EXISTING crew grants, so only
// the collection count moves.
import { describe, expect, it } from 'vitest';
import { platformSatisfies, validateManifest } from '../../platform/kernel/module-registry';
import { operationsModule, operationsPages, operationsPermissions } from './operations.module';

describe('operations module manifest (B3)', () => {
  it('passes kernel manifest validation', () => {
    expect(() => {
      validateManifest(operationsModule);
    }).not.toThrow();
  });

  it('targets a platform version this kernel satisfies', () => {
    expect(platformSatisfies(operationsModule.requiresPlatform)).toBe(true);
  });

  it('pins the current surface', () => {
    expect(operationsModule.id).toBe('operations');
    expect(operationsPermissions.map((p) => p.key).sort()).toEqual([
      'operationsCatalog.manage',
      'operationsCrew.plan',
      'operationsCrew.reorder',
      'operationsCrew.view',
      'operationsDay.manage',
      'operationsExecution.own',
      'operationsShipment.complete',
      'operationsShipment.create',
      'operationsShipment.delete',
      'operationsShipment.edit',
      'operationsShipment.view',
      'operationsVault.dispatch',
      'operationsVault.receive',
      'operationsVault.view',
    ]);
    expect(operationsPages.map((p) => p.id)).toEqual([
      'operations.shipments',
      'operations.crew-board',
      'operations.vault',
      'operations.my-day',
      'operations.catalogs',
    ]);
    expect(operationsModule.routes.map((r) => r.prefix).sort()).toEqual([
      '/operations/assignments',
      '/operations/bank-branches',
      '/operations/banks',
      '/operations/crew-board',
      '/operations/currencies',
      '/operations/days',
      '/operations/mobile',
      '/operations/reports',
      '/operations/secured',
      '/operations/shipments',
    ]);
    expect(operationsModule.collections.sort()).toEqual([
      'operations_bank_branches',
      'operations_banks',
      'operations_crew_assignments',
      'operations_crew_requirements',
      'operations_currencies',
      'operations_days',
      'operations_shipment_assignments',
      'operations_shipments',
      'operations_vault_custody',
    ]);
  });

  it('every page is pointed at by at least one permission (no empty pages at boot)', () => {
    const used = new Set(operationsPermissions.map((p) => p.pageId));
    for (const page of operationsPages) {
      expect(used.has(page.id)).toBe(true);
    }
  });
});
