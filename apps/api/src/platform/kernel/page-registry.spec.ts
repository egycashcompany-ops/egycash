// The page registry as this repository actually declares it, across every module.
//
// `packages/contracts` can only see the platform's own pages — a module declares its own, and the
// full registry is only assembled when modules register. That assembly is what boot validates and
// what the role matrix will render, so it is asserted here where every manifest is importable.
//
// The counts are deliberately exact. A permission added without a `pageId`, or a page declared and
// never pointed at, moves a number in this file and fails with the name of what moved — which is
// the whole reason to state them rather than assert "greater than zero".
import { describe, expect, it } from 'vitest';
import { platformPages, platformPermissions, validatePageRegistry } from '@ecms/contracts';
import { fleetModule } from '../../modules/fleet/fleet.module';
import { hrModule } from '../../modules/hr/hr.module';
import { itModule } from '../../modules/it/it.module';

const MODULES = [hrModule, fleetModule, itModule];
const pages = [...platformPages, ...MODULES.flatMap((m) => m.pages ?? [])];
const permissions = [...platformPermissions, ...MODULES.flatMap((m) => m.permissions)];

describe('the assembled page registry', () => {
  it('is valid — the same call the boot makes, over every module in the repository', () => {
    expect(validatePageRegistry(pages, permissions)).toEqual([]);
  });

  it('declares 46 pages over 202 permissions', () => {
    expect(pages).toHaveLength(46);
    expect(permissions).toHaveLength(202);
  });

  it('assigns 172 permissions to a page and leaves 30 deliberately unassigned', () => {
    const assigned = permissions.filter((p) => p.pageId !== null);
    expect(assigned).toHaveLength(172);
    expect(permissions.length - assigned.length).toBe(30);
  });

  it('splits the pages across the four modules as declared', () => {
    const byModule = new Map<string, number>();
    for (const page of pages) byModule.set(page.moduleId, (byModule.get(page.moduleId) ?? 0) + 1);
    expect(Object.fromEntries(byModule)).toEqual({ platform: 11, hr: 16, fleet: 10, it: 9 });
  });

  // Named rather than counted, because "which permissions have no home" is the question a reviewer
  // actually asks — and because every one of these is a decision (D1) rather than an oversight.
  it('leaves exactly the resources with no administration screen unassigned', () => {
    const unassigned = [
      ...new Set(permissions.filter((p) => p.pageId === null).map((p) => p.resource)),
    ].sort();
    expect(unassigned).toEqual(
      [
        // Screens named in the System Administration plan and not built yet.
        'activityLog',
        'auditLog',
        'setting',
        // No administration screen at all, and never has been.
        'file',
        'fileCategory',
        'notificationTemplate',
        'scheduledTask',
        // Recruitment stages that live inside the pipeline rather than on a surface of their own.
        'drivingTest',
        'medicalCheck',
        'securityCheck',
      ].sort(),
    );
  });

  it('gives every page a name in both locales', () => {
    for (const page of pages) {
      expect(page.name.en.trim(), page.id).not.toBe('');
      expect(page.name.ar.trim(), page.id).not.toBe('');
    }
  });

  it('never lets two pages claim the same route', () => {
    const routes = pages.flatMap((p) => (p.route === undefined ? [] : [p.route]));
    expect(new Set(routes).size).toBe(routes.length);
  });

  // D3: the four catalogs with no screen of their own sit on the page that manages them, rather
  // than becoming pages that would render as a row holding a single checkbox.
  it('attaches the small catalogs to the page that administers them', () => {
    const pageOf = (key: string): string | null =>
      permissions.find((p) => p.key === key)?.pageId ?? null;
    expect(pageOf('contractType.manage')).toBe('hr.contracts');
    expect(pageOf('hiringDocumentType.manage')).toBe('hr.hiring-documents');
    expect(pageOf('itMaintenancePlan.manage')).toBe('it.maintenance');
  });

  // A page is organizational. Nothing here may grow into an authorization axis — if it ever does,
  // it stops being true that adding a page grants nobody anything (ADR-026 is unchanged by P7-A).
  it('carries no grant, scope or actor of its own', () => {
    for (const page of pages) {
      expect(Object.keys(page).sort()).toEqual(expect.arrayContaining(['id', 'moduleId', 'name']));
      for (const forbidden of ['permissions', 'scope', 'grants', 'actor', 'breakGlass']) {
        expect(page, page.id).not.toHaveProperty(forbidden);
      }
    }
  });
});
