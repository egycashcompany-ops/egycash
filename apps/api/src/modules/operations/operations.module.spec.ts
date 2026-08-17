// The manifest guards: the module registers cleanly, and its surfaces are exactly what the
// shipped slices claim. The pin-the-numbers block (pages.spec precedent) moves with every slice:
// 14 permissions, 5 pages, 9 routes, 8 collections — unchanged by OP-7, which added the captain's
// execution mutations under the route prefix and the permission OP-6 already declared for them.
import { describe, expect, it } from 'vitest';
import { platformSatisfies, validateManifest } from '../../platform/kernel/module-registry';
import { operationsModule, operationsPages, operationsPermissions } from './operations.module';

describe('operations module manifest (OP-7)', () => {
  it('passes kernel manifest validation', () => {
    expect(() => {
      validateManifest(operationsModule);
    }).not.toThrow();
  });

  it('targets a platform version this kernel satisfies', () => {
    expect(platformSatisfies(operationsModule.requiresPlatform)).toBe(true);
  });

  it('pins the OP-7 surface', () => {
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
      '/operations/secured',
      '/operations/shipments',
    ]);
    expect(operationsModule.collections.sort()).toEqual([
      'operations_bank_branches',
      'operations_banks',
      'operations_crew_assignments',
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
