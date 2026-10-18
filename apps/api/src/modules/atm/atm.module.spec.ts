// The manifest guards (the operations.module.spec precedent): the module registers cleanly, and
// its surfaces are exactly what the shipped slices claim. The pin-the-numbers block moves with
// every slice: 30 permissions, 7 pages, 9 routes, 10 collections, 2 scheduled tasks (ATM Operations
// port ATM-0…7, then the Efficiency register — docs/12-planning/atm-efficiency-register.md §7.2 —
// then the machine map — docs/12-planning/atm-map-zones.md §7.2).
// The daily report added a route and NOTHING else — it rides the existing view grants (D7).
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
      'atmMachine.locate',
      'atmMachine.manage',
      'atmMachine.moveArea',
      'atmMachine.view',
      'atmMailTicket.decide',
      'atmMailTicket.view',
      'atmMailTicket.viewLog',
      'atmMaintenance.complete',
      'atmMaintenance.create',
      'atmMaintenance.delete',
      'atmMaintenance.edit',
      'atmMaintenance.view',
      'atmMap.view',
      'atmRefLabel.create',
      'atmRefLabel.edit',
      'atmRegister.create',
      'atmRegister.delete',
      'atmRegister.edit',
      'atmRegister.export',
      'atmRegister.handover',
      'atmRegister.import',
      'atmRegister.view',
      'atmRegister.viewSecrets',
      'atmRegisterReport.view',
      'atmReplenishment.complete',
      'atmReplenishment.create',
      'atmReplenishment.delete',
      'atmReplenishment.edit',
      'atmReplenishment.view',
      'atmZone.manage',
    ]);
    expect(atmPages.map((p) => p.id)).toEqual([
      'atm.replenishments',
      'atm.maintenance',
      'atm.mail-tickets',
      'atm.machines',
      'atm.map',
      'atm.register',
      'atm.register-report',
    ]);
    expect(atmModule.routes.map((r) => r.prefix).sort()).toEqual([
      '/atm/machines',
      '/atm/mail-tickets',
      '/atm/maintenances',
      '/atm/map',
      '/atm/ref-labels',
      '/atm/register',
      '/atm/register/import',
      '/atm/replenishments',
      '/atm/reports',
    ]);
    expect(atmModule.collections.sort()).toEqual([
      'atm_machine_locations',
      'atm_machines',
      'atm_mail_tickets',
      'atm_maintenances',
      'atm_map_zone_sets',
      'atm_map_zones',
      'atm_ref_labels',
      'atm_register_entries',
      'atm_register_import_runs',
      'atm_replenishments',
    ]);
    expect((atmModule.scheduledTasks ?? []).map((t) => t.key)).toEqual([
      'atm.mailPoll',
      'atm.rotateRegisterCombinationKeys',
    ]);
  });

  it('mounts the import BEFORE the register, whose prefix contains it', () => {
    const prefixes = atmModule.routes.map((r) => r.prefix);
    expect(prefixes.indexOf('/atm/register/import')).toBeLessThan(
      prefixes.indexOf('/atm/register'),
    );
  });

  it('names no permission with a parenthesis — the CI page-registry parser counts them', () => {
    for (const permission of atmPermissions) {
      expect(`${permission.name.en}${permission.name.ar}`).not.toMatch(/[()]/);
    }
  });

  it('every page is pointed at by at least one permission (no empty pages at boot)', () => {
    const used = new Set(atmPermissions.map((p) => p.pageId));
    for (const page of atmPages) {
      expect(used.has(page.id)).toBe(true);
    }
  });
});
