// The manifest guards (the operations.module.spec precedent): the module registers cleanly, and
// its surfaces are exactly what the shipped slices claim. The pin-the-numbers block moves with
// every slice: 15 permissions, 4 pages, 5 routes, 5 collections (ATM Operations port, ATM-0…5).
import { describe, expect, it } from 'vitest';
import { platformSatisfies, validateManifest } from '../../platform/kernel/module-registry';
import { atmModule, atmPages, atmPermissions } from './atm.module';

describe('atm module manifest (ATM Operations port)', () => {
  it('passes kernel manifest validation', () => {
    expect(() => {
      validateManifest(atmModule);
    }).not.toThrow();
  });

  it('targets a platform version this kernel satisfies', () => {
    expect(platformSatisfies(atmModule.requiresPlatform)).toBe(true);
  });

  it('pins the current surface', () => {
    expect(atmModule.id).toBe('atm');
    expect(atmPermissions.map((p) => p.key).sort()).toEqual([
      'atmMachine.manage',
      'atmMachine.view',
      'atmMailTicket.decide',
      'atmMailTicket.view',
      'atmMailTicket.viewLog',
      'atmMaintenance.complete',
      'atmMaintenance.create',
      'atmMaintenance.delete',
      'atmMaintenance.edit',
      'atmMaintenance.view',
      'atmReplenishment.complete',
      'atmReplenishment.create',
      'atmReplenishment.delete',
      'atmReplenishment.edit',
      'atmReplenishment.view',
    ]);
    expect(atmPages.map((p) => p.id)).toEqual([
      'atm.replenishments',
      'atm.maintenance',
      'atm.mail-tickets',
      'atm.machines',
    ]);
    expect(atmModule.routes.map((r) => r.prefix).sort()).toEqual([
      '/atm/machines',
      '/atm/mail-tickets',
      '/atm/maintenances',
      '/atm/ref-labels',
      '/atm/replenishments',
    ]);
    expect(atmModule.collections.sort()).toEqual([
      'atm_machines',
      'atm_mail_tickets',
      'atm_maintenances',
      'atm_ref_labels',
      'atm_replenishments',
    ]);
  });

  it('every page is pointed at by at least one permission (no empty pages at boot)', () => {
    const used = new Set(atmPermissions.map((p) => p.pageId));
    for (const page of atmPages) {
      expect(used.has(page.id)).toBe(true);
    }
  });
});
