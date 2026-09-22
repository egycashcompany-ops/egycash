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
    // The same number as `SEEDED_APPLICATIONS` in `tests/integration/auth-seed-login.spec.ts`,
    // which asserts the API RETURNS this many for the super-admin — they hold the whole registry,
    // so they see every row. That one proves the seeding and the visibility; this one proves the
    // declarations, and needs no database.
    //
    // So adding a row fails HERE first, on the author's machine, naming the number to change —
    // rather than eight minutes into CI in the one suite that cannot run without a mongod.
    expect(rows).toHaveLength(118);
  });
});

describe('the Fleet rail reads as the work the company actually does', () => {
  // «ظبط الايقونات بتاعت شاشات الحركه على حسب المهام اللى بتقوم بيها الشركه». A rail is read at a
  // glance, by shape before word — so a glyph that says the wrong thing, or the same thing twice,
  // costs a reader the moment the rail exists to save. None of this fails at boot; it just
  // quietly misleads.
  const fleet = NAVIGATION_CATALOG.find((category) => category.en === 'Fleet');
  const iconOf = (route: string): string | undefined =>
    fleet?.apps.find((app) => app.route === route)?.icon;

  it('gives every screen its own glyph', () => {
    const icons = (fleet?.apps ?? []).map((app) => app.icon);
    // السائقون and الطقم الثابت both wore `users`, which told a reader the two screens held the
    // same thing. Two rows, two shapes — no exceptions, or the rule is not a rule.
    const repeated = icons.filter((icon, i) => icons.indexOf(icon) !== i);
    expect(repeated, 'no glyph appears on two Fleet rows').toEqual([]);
  });

  it('puts the hazard triangle on the crashes, not on the maintenance alarms', () => {
    // A حادث is a hazard — the triangle is what a road sign uses for exactly this. An إنذار is a
    // thing that RINGS at you, which is a bell. They had these the other way round, and the
    // accidents row wore a shield-with-a-tick, which reads «protected» — the opposite of a crash.
    expect(iconOf('/fleet/accidents')).toBe('alert');
    expect(iconOf('/fleet/maintenance-alarms')).toBe('bell');
    expect(iconOf('/fleet/accidents'), 'never the shield again').not.toBe('shield');
  });

  it('keeps the glyphs that were already right', () => {
    // The meter, the spanner and the truck each name their screen exactly; a tidy-up that moves
    // them is a tidy-up that costs a reader something for nothing.
    expect(iconOf('/fleet/odometer')).toBe('gauge');
    expect(iconOf('/fleet/maintenance')).toBe('wrench');
    expect(iconOf('/fleet/vehicles')).toBe('truck');
    expect(iconOf('/fleet/drivers')).toBe('users');
    expect(iconOf('/fleet')).toBe('home');
  });

  it('corrects a live installation only while it still wears the old default', () => {
    // `syncNavigationCatalog` does not rewrite rows that exist — rightly, since an admin may have
    // chosen the icon in the Applications catalog. `previousIcon` is what makes the correction
    // safe: it is compared before anything is written, so a deliberate choice survives the boot.
    const corrected = (fleet?.apps ?? []).filter((app) => app.previousIcon !== undefined);
    expect(corrected.length, 'the rows this change touches').toBe(4);
    for (const app of corrected) {
      expect(app.previousIcon, `${app.route} must actually change`).not.toBe(app.icon);
    }
  });
});
