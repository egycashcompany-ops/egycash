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
import {
  HR_SETTINGS_HUB,
  NAVIGATION_HUBS,
  SHARED_NAVIGATION_ROWS,
  hubPermissions,
  platformPermissions,
} from '@ecms/contracts';
import { moduleManifests } from './modules';
import { NAVIGATION_CATALOG } from './seed-navigation';
import { hrPages } from './modules/hr/hr.module';
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
    //
    // 139 → 137: the two batch rows (security check, driving test) left the sidebar — each phase's
    // page links to its own batches — and are RETIRED on live installations (see below).
    // 137 → 132: six HR rows became the tabs of one «الإعدادات» row (−6 +1).
    // 132 → 133: «المستخدمون النشطون» joined Administration, beside System Users.
    // 133 → 134: «فحص أجهزة السيارة» joined IT, last in its list (it-vehicle-checks-design.md).
    // 134 → 135: «فحص أجهزة السيارات», IT's dashboard over those reports, right before the form.
    // 135 → 136: «سجل الشحنات», Operations' day board over a range, right beneath the day board.
    // 136 → 138: «توزيع المحصنات» beneath the secured screen and «تسليم المحصنات» beneath the vault's
    //   receive screen (Operations, Round 12).
    // 138 → 138: «تجميع الخزينة» left Operations — its content is «تقرير البنوك» now, and the row is
    //   RETIRED on live installations — and «إدارات العمليات» joined it beneath the roster (−1 +1).
    expect(rows).toHaveLength(138);
  });

  /**
   * A RETIRED ROUTE IS ONE THE CATALOG NO LONGER SEEDS. Retiring a row it still creates would switch
   * it off on every live installation while a fresh one keeps showing it, and filing one into a
   * section would put a group heading over a row nobody sees.
   */
  it('retires only rows it no longer seeds, and files none of them', () => {
    const seeded = new Set(rows.map((row) => row.route));
    const filed = new Set(
      Object.values(APPLICATION_SECTION_DEFAULTS)
        .flat()
        .flatMap((section) => section.routes),
    );
    const retired = NAVIGATION_CATALOG.flatMap((c) => c.retired ?? []).flatMap((e) => e.routes);
    expect(retired.filter((route) => seeded.has(route))).toEqual([]);
    expect(retired.filter((route) => filed.has(route))).toEqual([]);
  });

  /** Revisions only climb: a lower one would never be applied on a tile that took a higher one. */
  it("numbers each module's retirements upward, from 1", () => {
    for (const category of NAVIGATION_CATALOG) {
      const revisions = (category.retired ?? []).map((entry) => entry.revision);
      expect(revisions, category.en).toEqual(revisions.map((_, i) => i + 1));
    }
  });

  it('retires the six screens that became «الإعدادات» tabs, and seeds the one row over them', () => {
    const hr = NAVIGATION_CATALOG.find((c) => c.en === 'HR');
    const tabRoutes = [
      '/recruitment-form',
      '/applicant-sources',
      '/interviews/stages',
      '/evaluations/phases',
      '/announcements',
      '/notification-rules',
    ];
    expect(hr?.retired?.find((e) => e.revision === 2)?.routes).toEqual(tabRoutes);
    const hub = hr?.apps[0];
    expect(hub?.route).toBe(HR_SETTINGS_HUB.route);
    expect(hub?.ar).toBe('الإعدادات');
    // The row's own key is one of the tabs', so it never opens for somebody who holds no tab.
    expect(hubPermissions(HR_SETTINGS_HUB.route)).toContain(hub?.permission);
  });

  /** The role matrix links each settings screen to where it lives now, not to a redirect. */
  it('documents each settings screen at its tab', () => {
    const tabRoutes = HR_SETTINGS_HUB.tabs.map((tab) => `${HR_SETTINGS_HUB.route}/${tab.key}`);
    const documented = hrPages.flatMap((page) => (page.route === undefined ? [] : [page.route]));
    expect(documented).toEqual(expect.arrayContaining(tabRoutes));
    for (const retired of NAVIGATION_CATALOG.flatMap((c) => c.retired ?? []).flatMap(
      (e) => e.routes,
    )) {
      expect(documented, retired).not.toContain(retired);
    }
  });

  /**
   * A shared row (Round 14, «تقرير البنوك») is one the catalog SEEDS, keyed on one of its own keys,
   * and every key it lists is declared — otherwise "any of" would quietly be "none of" for somebody.
   */
  it('seeds every shared row, on one of its keys, each key declared', () => {
    for (const shared of SHARED_NAVIGATION_ROWS) {
      const row = rows.find((r) => r.route === shared.route);
      expect(row, shared.route).toBeDefined();
      expect(shared.permissions, shared.route).toContain(row?.permission);
      for (const key of shared.permissions) expect(registry.has(key), key).toBe(true);
    }
  });

  /** A tab keyed on a permission nobody declares shows to nobody — and opens the row for nobody. */
  it('keys every hub tab on a permission this platform declares', () => {
    const unknown = NAVIGATION_HUBS.flatMap((hub) => hub.tabs)
      .filter((tab) => !registry.has(tab.permission))
      .map((tab) => `${tab.key} → ${tab.permission}`);
    expect(unknown).toEqual([]);
  });

  it('retires the two batch rows from HR', () => {
    const hr = NAVIGATION_CATALOG.find((c) => c.en === 'HR');
    expect(hr?.retired?.flatMap((e) => e.routes)).toEqual(
      expect.arrayContaining([
        '/evaluation-batches/phase/securityCheck',
        '/evaluation-batches/phase/drivingTest',
      ]),
    );
  });

  it('offers the consumables right under the mobile lines, on the asset grants', () => {
    // «شاشة تانية تحت خطوط المحمول تكون للمستهلكات» — under the lines, and keyed like them: the
    // store has no permission of its own («same permissions as assets»).
    const itRows = rows.filter((row) => row.route.startsWith('/it'));
    const consumables = itRows.find((row) => row.route === '/it/consumables');
    expect(consumables?.permission).toBe('itAsset.view');
    expect(itRows.indexOf(consumables as (typeof itRows)[number])).toBe(
      itRows.findIndex((row) => row.route === '/it/mobile-lines') + 1,
    );
    // The movements screen nests under it and has no row of its own.
    expect(rows.some((row) => row.route === '/it/consumables/movements')).toBe(false);
  });

  it('offers the vehicle checks dashboard right before the phone form, on the read grant', () => {
    // «الـ Dashboard مش هتكون عند الحركة .. هتبقي عند الـ IT»: an IT row, keyed to reading the
    // reports — so a reporter holding only the form sees the form and not the dashboard.
    const itRows = rows.filter((row) => row.route.startsWith('/it'));
    const board = itRows.find((row) => row.route === '/it/vehicle-checks');
    expect(board).toMatchObject({
      en: 'Vehicle device checks',
      ar: 'فحص أجهزة السيارات',
      icon: 'gauge',
      permission: 'itVehicleCheck.view',
    });
    expect(itRows.indexOf(board as (typeof itRows)[number])).toBe(
      itRows.findIndex((row) => row.route === '/it/vehicle-checks/new') - 1,
    );
    // The form keeps its row, its glyph and its own grant.
    expect(itRows.find((row) => row.route === '/it/vehicle-checks/new')).toMatchObject({
      icon: 'vehicle',
      permission: 'itVehicleCheck.create',
    });
  });

  it('offers the machine map right after the machine list, behind its own key', () => {
    // docs/12-planning/atm-map-zones.md §7.3: the row sits under «كل الماكينات» and is entitled
    // to `atmMap.view` alone; the unlocated screen nests under it and has no row of its own.
    const atm = rows.filter((row) => row.route.startsWith('/atm'));
    const map = atm.find((row) => row.route === '/atm/map');
    expect(map?.permission).toBe('atmMap.view');
    expect(map?.icon).toBe('pin');
    expect(atm.indexOf(map as (typeof atm)[number])).toBe(
      atm.findIndex((row) => row.route === '/atm/machines') + 1,
    );
    expect(rows.some((row) => row.route === '/atm/map/unlocated')).toBe(false);
  });

  it('offers the four settlement rows after the Data Report, in this order, each behind its page key', () => {
    // docs/12-planning/atm-settlements-phase1.md §7.3: each row's key equals the web route guard;
    // the import page nests under the layouts and has no row of its own.
    const atm = rows.filter((row) => row.route.startsWith('/atm'));
    const report = atm.findIndex((row) => row.route === '/atm/register/report');
    expect(
      atm.slice(report + 1, report + 5).map((row) => [row.route, row.permission, row.icon]),
    ).toEqual([
      ['/atm/settlements/plans', 'atmSettlementPlan.view', 'receipt'],
      ['/atm/settlements/layouts', 'atmCassetteLayout.view', 'layers'],
      ['/atm/preparation', 'atmPreparation.view', 'qr'],
      ['/atm/control', 'atmControl.view', 'truck'],
    ]);
    expect(rows.some((row) => row.route === '/atm/settlements/layouts/import')).toBe(false);
  });

  it('renames a row only where the name actually changes — Round 12’s two vault screens', () => {
    // `previousName` mirrors `previousIcon`: the boot renames a live row only while it still wears
    // the old default, so a correction naming the value it already holds would be a no-op that
    // reads like a fix. «وعاوز اغير اسم صرف الخزينة ل محصنات الخزينة», and «جرد الخزينة» became
    // «سجل الخزينة».
    const renamed = rows.filter((row) => row.previousName !== undefined);
    for (const row of renamed) {
      expect(
        row.previousName?.ar !== row.ar || row.previousName.en !== row.en,
        `${row.route} must actually change`,
      ).toBe(true);
    }
    const byRoute = (route: string) => rows.find((row) => row.route === route);
    expect(byRoute('/operations/vault/dispatch')).toMatchObject({
      ar: 'محصنات الخزينة',
      en: 'Vault Shipments',
      previousName: { ar: 'صرف الخزينة', en: 'Vault Dispatch' },
    });
    expect(byRoute('/operations/vault')).toMatchObject({
      ar: 'سجل الخزينة',
      en: 'Vault History',
      previousName: { ar: 'جرد الخزينة', en: 'Vault Inventory' },
    });
  });

  it('corrects a permission only where the key actually changes', () => {
    // `previousPermission` mirrors `previousIcon`: a correction that names the value it already
    // holds would be a no-op that reads like a fix. The one shipped today is the data-edit split
    // (docs/12-planning/atm-efficiency-register.md §7.3): Machine Data is the Operations page now.
    const corrected = rows.filter((row) => row.previousPermission !== undefined);
    for (const row of corrected) {
      expect(row.previousPermission, `${row.route} must actually change`).not.toBe(row.permission);
    }
    const dataEdit = rows.find((row) => row.route === '/atm/data-edit');
    expect(dataEdit?.previousPermission).toBe('atmMachine.manage');
    expect(dataEdit?.permission).toBe('atmRefLabel.create');
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

  // Batch 2 adds three screens, each directly under the screen its work starts from, behind the
  // grant that screen's own data answers to. `syncNavigationCatalog` places a new row halfway
  // between its stored neighbours, so the position declared here is the position a live
  // installation gets — and no existing row is rewritten.
  const routes = (fleet?.apps ?? []).map((app) => app.route);
  const rowOf = (route: string) => fleet?.apps.find((app) => app.route === route);
  const placedAfter = (route: string, anchor: string) => {
    expect(routes.indexOf(anchor), `${anchor} is still on the rail`).toBeGreaterThan(-1);
    expect(routes.indexOf(route), `${route} sits right after ${anchor}`).toBe(
      routes.indexOf(anchor) + 1,
    );
  };

  it('lists the custody expenses right under the custody fund, on the fund’s own grant', () => {
    // «مصروفات العهدة» is what the fund paid, read from the same ledger — no new key to hand out.
    placedAfter('/fleet/custody-expenses', '/fleet/custody');
    expect(rowOf('/fleet/custody-expenses')?.ar).toBe('مصروفات العهدة');
    expect(iconOf('/fleet/custody-expenses')).toBe('tag');
    expect(rowOf('/fleet/custody-expenses')?.permission).toBe('fleetCustody.view');
  });

  it('lists the card-sheet reconciliation right under the card charging, on its grant', () => {
    // Matching the company's sheet against the cards' balances is part of moving card money.
    placedAfter('/fleet/fuel-cards/reconcile', '/fleet/fuel-cards/charging');
    expect(rowOf('/fleet/fuel-cards/reconcile')?.ar).toBe('مطابقة أرصدة الكروت');
    expect(iconOf('/fleet/fuel-cards/reconcile')).toBe('link');
    expect(rowOf('/fleet/fuel-cards/reconcile')?.permission).toBe('fleetFuelCharge.view');
  });

  it('lists the vehicle supply contracts right under the licensing, behind their own key', () => {
    // A screen of its own grants (`fleetVehicleContract.*`), given to no role by default.
    placedAfter('/fleet/vehicle-contracts', '/fleet/licensing');
    expect(rowOf('/fleet/vehicle-contracts')?.ar).toBe('عقود توريد السيارات');
    expect(iconOf('/fleet/vehicle-contracts')).toBe('offer');
    expect(rowOf('/fleet/vehicle-contracts')?.permission).toBe('fleetVehicleContract.view');
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
