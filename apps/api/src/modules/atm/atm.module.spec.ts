// The manifest guards (the operations.module.spec precedent): the module registers cleanly, and
// its surfaces are exactly what the shipped slices claim. The pin-the-numbers block moves with
// every slice: 44 permissions, 11 pages, 13 routes, 21 collections, 2 scheduled tasks (ATM
// Operations port ATM-0…7, then the Efficiency register — docs/12-planning/atm-efficiency-register.md
// §7.2 — then the machine map — docs/12-planning/atm-map-zones.md §7.2 — then settlements phase 1 —
// docs/12-planning/atm-settlements-phase1.md §7.2 — then the bank catalog, DEC-35: two keys, one
// route, one collection, and no page of its own).
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
      'atmBank.create',
      'atmBank.edit',
      'atmCassetteLayout.import',
      'atmCassetteLayout.manage',
      'atmCassetteLayout.view',
      'atmControl.manage',
      'atmControl.print',
      'atmControl.view',
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
      'atmPreparation.capture',
      'atmPreparation.view',
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
      'atmSettlementPlan.export',
      'atmSettlementPlan.manage',
      'atmSettlementPlan.print',
      'atmSettlementPlan.view',
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
      'atm.settlement-plans',
      'atm.cassette-layouts',
      'atm.preparation',
      'atm.control',
    ]);
    expect(atmModule.routes.map((r) => r.prefix).sort()).toEqual([
      '/atm/banks',
      '/atm/control',
      '/atm/machines',
      '/atm/mail-tickets',
      '/atm/maintenances',
      '/atm/map',
      '/atm/preparation',
      '/atm/ref-labels',
      '/atm/register',
      '/atm/register/import',
      '/atm/replenishments',
      '/atm/reports',
      '/atm/settlements',
    ]);
    expect(atmModule.collections.sort()).toEqual([
      'atm_banks',
      'atm_cassette_layout_versions',
      'atm_cassette_layouts',
      'atm_dispatch_routes',
      'atm_layout_import_runs',
      'atm_line_preparations',
      'atm_machine_locations',
      'atm_machines',
      'atm_mail_tickets',
      'atm_maintenances',
      'atm_map_zone_sets',
      'atm_map_zones',
      'atm_note_counters',
      'atm_plan_lines',
      'atm_ref_labels',
      'atm_register_entries',
      'atm_register_import_runs',
      'atm_replenishment_plans',
      'atm_replenishments',
      'atm_route_assignments',
      'atm_standard_loads',
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

  // DEC-35: a bank is company-wide, so its keys sit on the register's page (the catalog belongs to
  // Efficiency and the administrators) and GET /atm/banks takes ANY ATM key — derived from this
  // very list, so a key added to the manifest reads the catalog without anyone remembering to.
  it('puts the bank keys on the register page', () => {
    for (const key of ['atmBank.create', 'atmBank.edit']) {
      expect(atmPermissions.find((p) => p.key === key)?.pageId).toBe('atm.register');
    }
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
