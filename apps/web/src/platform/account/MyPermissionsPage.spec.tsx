// «صلاحياتي», at the two places it can go wrong.
//
// The grouping is the screen's whole argument — a person reads by screen, not by module id — so it
// is tested directly. The menu entry is the other half: Ehab's rule is that an account holding
// nothing must not see the row AT ALL, which is a condition in the source rather than something a
// pure function can be asked about. The web suite runs with `environment: 'node'` and carries no
// jsdom, so that half is asserted structurally, against the source it lives in.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type MyPermissionDto, type PageDto } from '@ecms/contracts';
import { groupByScreen } from './MyPermissionsPage';

const row = (key: string, pageId: string | null, moduleId: string | null = 'hr'): MyPermissionDto => ({
  key,
  name: { ar: key, en: key },
  moduleId,
  pageId,
  breakGlass: false,
  scope: 'department',
  sources: [],
});

const page = (id: string, moduleId: string, sortOrder: number): PageDto => ({
  id,
  moduleId,
  name: { ar: id, en: id },
  route: null,
  sortOrder,
});

describe('the list is read by screen', () => {
  it('files each permission under the screen it opens, in the registry’s order', () => {
    const groups = groupByScreen(
      [row('leave.approve', 'hr.leave'), row('vehicle.view', 'fleet.vehicles'), row('leave.view', 'hr.leave')],
      [page('fleet.vehicles', 'fleet', 1), page('hr.leave', 'hr', 1)],
    );
    expect(groups.map((g) => g.page?.id)).toEqual(['fleet.vehicles', 'hr.leave']);
    expect(groups[1]?.rows.map((r) => r.key)).toEqual(['leave.approve', 'leave.view']);
  });

  it('prints no heading for a screen the reader holds nothing on', () => {
    // The server already sends only the pages in play; this keeps the rule true on the client too,
    // so a wider response can never turn into an empty card advertising a screen.
    const groups = groupByScreen(
      [row('leave.view', 'hr.leave')],
      [page('hr.leave', 'hr', 1), page('fleet.vehicles', 'fleet', 1)],
    );
    expect(groups.map((g) => g.page?.id)).toEqual(['hr.leave']);
  });

  // A role outlives the module that declared its key; the holder still has the permission. A row
  // that disappeared for being unclaimed would be the one thing this screen must never do.
  it('keeps a permission no screen claims, grouped by module and placed last', () => {
    const groups = groupByScreen(
      [row('orphan.view', null, 'hr'), row('leave.view', 'hr.leave')],
      [page('hr.leave', 'hr', 1)],
    );
    expect(groups.map((g) => g.key)).toEqual(['page:hr.leave', 'module:hr']);
    expect(groups[1]?.rows.map((r) => r.key)).toEqual(['orphan.view']);
  });

  it('answers nothing for an account that holds nothing', () => {
    expect(groupByScreen([], [])).toEqual([]);
  });
});

const source = (path: string): string =>
  readFileSync(join(__dirname, path), 'utf8');

describe('an account holding nothing is offered no entry', () => {
  const topbar = source('../layout/Topbar.tsx');

  it('draws the menu row only behind the permission-count test', () => {
    // «ولو مفيش ولا صلاحية متظهرش خالص» — an entry that opens on «لا تملك أي صلاحية» invites the
    // click and then reports nothing, which is worse than no entry.
    const at = topbar.indexOf("navigate('/account/permissions')");
    expect(at).toBeGreaterThan(-1);
    const guard = topbar.lastIndexOf('Object.keys(me.permissions).length > 0', at);
    expect(guard).toBeGreaterThan(-1);
    // Nothing else may sit between the test and the row it guards — one menu item in that span,
    // and it is this one. A second would mean the condition has crept over a neighbour.
    const between = topbar.slice(guard, at);
    expect(between.split('role="menuitem"')).toHaveLength(2);
  });

  it('places it after Security, which is where it was asked for', () => {
    expect(topbar.indexOf("navigate('/account/security')")).toBeLessThan(
      topbar.indexOf("navigate('/account/permissions')"),
    );
  });
});

describe('the page is reachable without holding a permission', () => {
  it('carries no RequirePermission — the gate would lock out exactly the readers it is for', () => {
    const routes = source('./routes.tsx');
    expect(routes).toContain('path="permissions"');
    expect(routes).not.toContain('<RequirePermission');
  });
});
