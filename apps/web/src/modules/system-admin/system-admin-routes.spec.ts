// Structural invariants for the System Administration surface. All three guard mistakes that no
// render test catches, because the broken version renders perfectly well.
//
// 1. **Every screen is permission-gated.** A page reachable without its permission is not cosmetic:
//    the API refuses the data anyway, so the user gets a screen of errors instead of a clean "no
//    access" — and a reviewer reading the routes cannot tell which surfaces are protected.
// 2. **Navigation never links to a route that does not exist**, and — the mirror failure this
//    module is most exposed to — **no route ships ahead of its phase**. The owner rule carried from
//    the Fleet FW-1 review is that no unshipped surface is reachable, and this module has five
//    later phases whose names are already public in the plan.
// 3. **The nav row is gated on the same permission as the route.** Since PR #157 the sidebar is a
//    projection of RBAC (`effective-applications.ts`), so a catalogued row with the wrong key —
//    or no key — either advertises a screen the caller cannot open or hides one they can.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = readFileSync(resolve(HERE, 'routes.tsx'), 'utf8');
const APP = readFileSync(resolve(HERE, '../../platform/app/App.tsx'), 'utf8');
const SEED = readFileSync(resolve(HERE, '../../../../api/src/seed-navigation.ts'), 'utf8');

/** `path="x"` → the declared child paths of the /system subtree, wildcards excluded. */
const declaredPaths = (): string[] =>
  [...ROUTES.matchAll(/path="([^"*]+)"/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));

describe('System Administration routes', () => {
  const paths = declaredPaths();

  it('declares exactly the shipped surface', () => {
    // `:id` is declared twice — once under users, once under roles — so the comparison is on the
    // SET of segments; which parent each belongs to is checked by the guard tests below.
    expect([...new Set(paths)].sort()).toEqual(
      ['users', 'roles', 'permissions', 'settings', ':id'].sort(),
    );
  });

  // Every later phase is named in the approved plan, which makes an early route a very easy
  // mistake to make and a very hard one to notice.
  //
  // `settings` left this list in P8 — deliberately, in the same change that routed the screen and
  // added its page to the registry. That is the only way it may ever leave: the guard is not
  // relaxed in advance to make room for work, it is relaxed by the work.
  it('ships no route belonging to a later phase', () => {
    for (const path of ['appearance', 'color-rules', 'audit']) {
      expect(paths, `${path} belongs to a later phase`).not.toContain(path);
    }
  });

  // Roles are created and edited in a dialog, accounts likewise. A form ROUTE would be reachable by
  // URL even with nothing linking to it, and would need its own guard.
  it('routes no create or edit form', () => {
    for (const path of ['new', ':id/edit', 'users/new', 'roles/new']) {
      expect(paths, `${path} is not routed`).not.toContain(path);
    }
  });

  it('gates each subtree behind the permission its API enforces', () => {
    for (const permission of ['user.view', 'role.view', 'permission.view', 'setting.view']) {
      expect(ROUTES).toContain(`<RequirePermission permission="${permission}">`);
    }
  });

  // A page component routed before the first guard would be unprotected. Every screen must sit
  // inside one of the three guards.
  it('routes no page component outside a permission guard', () => {
    const guardIndex = ROUTES.indexOf('<RequirePermission');
    for (const page of [
      '<UsersListPage />',
      '<UserDetailPage />',
      '<RolesListPage />',
      '<RoleDetailPage />',
      '<PermissionCatalogPage />',
      '<SettingsPage />',
    ]) {
      expect(ROUTES.indexOf(page), `${page} is routed before the guard`).toBeGreaterThan(guardIndex);
    }
  });

  // The registry is a separate gate on purpose: reading what a key MEANS and reading who HOLDS it
  // are different authorities, and collapsing them here would hand out the wider one.
  it('does not gate the permission registry on role.view', () => {
    const block = /path="permissions"[\s\S]{0,200}?permission="([^"]+)"/.exec(ROUTES)?.[1];
    expect(block).toBe('permission.view');
  });

  it('uses only permissions the platform actually declares', () => {
    const used = new Set(
      [...ROUTES.matchAll(/<RequirePermission permission="([^"]+)">/g)].map((m) => m[1]),
    );
    for (const permission of used) {
      expect(permission, 'SA routes gate on a platform RBAC resource').toMatch(
        /^(user|role|permission|setting)\./,
      );
    }
  });

  it('is lazy-loaded as its own chunk and sits behind RequireAuth', () => {
    expect(APP).toContain("lazy(() => import('../../modules/system-admin/routes'))");
    expect(APP).toContain('path="/system/*"');
    const routeIndex = APP.indexOf('path="/system/*"');
    // The <RequireAuth> wrapper opens immediately after the route's element prop.
    expect(APP.slice(routeIndex, routeIndex + 200)).toContain('<RequireAuth>');
  });
});

describe('System Administration navigation matches the routes that exist', () => {
  const navRoutes = [...SEED.matchAll(/route:\s*'(\/system[^']*)'/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );

  it('seeds the shipped rows', () => {
    expect(navRoutes).toEqual([
      '/system/users',
      '/system/roles',
      '/system/permissions',
      '/system/settings',
    ]);
  });

  it('points every row at a declared route', () => {
    const declared = new Set(declaredPaths().map((p) => `/system/${p}`));
    const dangling = navRoutes.filter((route) => !declared.has(route));
    expect(dangling, 'navigation links to a route that does not exist').toEqual([]);
  });

  // Since #157 a row with no permission key is offered to EVERY user it is granted to. A row keyed
  // differently from its route either advertises a screen the caller cannot open, or hides one they
  // can — both are silent.
  it.each([
    ['/system/users', 'user.view'],
    ['/system/roles', 'role.view'],
    ['/system/permissions', 'permission.view'],
    ['/system/settings', 'setting.view'],
  ])('gates %s on the same permission as the route', (route, permission) => {
    const row = new RegExp(`route: '${route}',[\\s\\S]{0,200}?permission: '([^']+)'`).exec(SEED)?.[1];
    expect(row).toBe(permission);
  });
});
