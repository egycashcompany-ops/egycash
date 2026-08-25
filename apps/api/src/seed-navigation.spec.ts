// The seeded navigation catalog, checked WITHOUT a database.
//
// Everything this file asserts is currently only caught by `tests/integration/auth-seed-login`,
// which needs a real mongod. That suite cannot run in every environment a change is authored in —
// so the checks that need nothing but the declarations live here, where they fail on the machine
// the mistake was made on rather than eight minutes into CI.
//
// The failures it exists for are all silent ones. A row whose permission key does not exist is
// entitled to nobody: it seeds, it stores, and it renders for no one, for ever. A section naming a
// route the catalog does not seed files nothing. Neither raises anything at boot.
import { describe, expect, it } from 'vitest';
import { platformPermissions } from '@ecms/contracts';
import { moduleManifests } from './modules';
import { NAVIGATION_CATALOG } from './seed-navigation';
import { APPLICATION_SECTION_DEFAULTS } from './seed-application-sections';

const rows = NAVIGATION_CATALOG.flatMap((category) =>
  category.apps.map((app) => ({ ...app, category: category.en })),
);
const registry = new Set(
  [...platformPermissions, ...moduleManifests.flatMap((m) => m.permissions)].map((p) => p.key),
);

describe('the seeded navigation catalog', () => {
  it('names only permissions this platform declares', () => {
    // A row keyed on a permission nobody holds — a typo, or a key renamed in the manifest and not
    // here — is invisible rather than broken. Nothing fails; the page simply never appears.
    const unknown = rows
      .filter((row) => !registry.has(row.permission))
      .map((row) => `${row.route} → ${row.permission}`);
    expect(unknown).toEqual([]);
  });

  it('seeds each route once', () => {
    // Applications are keyed by route, so a duplicate is not two rows — it is one row whose
    // definition depends on which copy the seed reached last.
    const routes = rows.map((row) => row.route);
    expect(routes.length - new Set(routes).size).toBe(0);
  });

  it('files every section route to a row it actually seeds', () => {
    // A section naming a route the catalog does not carry groups nothing, and reads in the source
    // exactly like one that works.
    const routes = new Set(rows.map((row) => row.route));
    const orphans = Object.values(APPLICATION_SECTION_DEFAULTS)
      .flat()
      .flatMap((section) => section.routes)
      .filter((route) => !routes.has(route));
    expect(orphans).toEqual([]);
  });

  it('declares the row count the seeded-login integration test pins', () => {
    // `tests/integration/auth-seed-login.spec.ts` asserts the API returns exactly this many
    // applications for the super-admin, who holds the whole registry and therefore sees every row.
    // Stated here too so that ADDING a row fails on the author's machine, with the number to
    // change, instead of in the one suite that needs a database to run.
    expect(rows).toHaveLength(102);
  });
});
