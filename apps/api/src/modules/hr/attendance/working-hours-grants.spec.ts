// «ساعات العمل» — who may open it, and who actually holds that key on the day it deploys.
//
// The screen is new (22 November). It authorizes on `attendance.manageWorkingHours`, a key of its
// own rather than the shift catalog's `attendance.manageShifts`, and that choice has a consequence
// this file exists to hold still: a brand-new key is held by NOBODY until something grants it.
//
// Two failures are possible and both are silent. Grant it nowhere and the tab ships invisible to
// every account, the owner's included, with three routes answering 403 to the whole company. Grant
// it too widely — copy it onto every role holding `attendance.manageShifts` — and every shift
// administrator silently gains a control that re-prices a department's unfrozen days and feeds
// payroll. The decisions below pick the narrow middle, and this spec is where they are asserted
// rather than remembered.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HR_SETTINGS_HUB } from '@ecms/contracts';
import { hrPermissions } from '../hr.module';
import {
  HR_WORKING_HOURS_GRANTS_MARK,
  HR_WORKING_HOURS_GRANT_PAIRS,
} from '../go-live/working-hours-grants';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');

const KEY = 'attendance.manageWorkingHours';
const SHIFTS = 'attendance.manageShifts';

describe('the working-hours permission', () => {
  it('is declared, and names the page the hub tab opens', () => {
    // `validatePageRegistry` refuses a page no permission administers (`empty-page`), and the hub
    // refuses a tab with no page. The key and the page arrive together or neither works.
    const def = hrPermissions.find((permission) => permission.key === KEY);
    expect(def, 'the working-hours key is not declared').toBeDefined();
    expect(def?.pageId).toBe('hr.working-hours');
  });

  it('is what the tab, and therefore the web route guard, asks for', () => {
    // One source: `HR_SETTINGS_HUB` decides the tab, the sidebar row the API serves, and the
    // `<RequirePermission>` the web wraps the screen in (hr/settings/routes.tsx).
    const tab = HR_SETTINGS_HUB.tabs.find((candidate) => candidate.key === 'working-hours');
    expect(tab?.permission).toBe(KEY);
  });

  it('guards all three routes, and the shift key opens none of them', () => {
    const routes = read('working-hours/working-hours.routes.ts');
    expect([...routes.matchAll(/authorize\('([^']+)'\)/g)].map((m) => m[1])).toEqual([
      KEY,
      KEY,
      KEY,
    ]);
    // GET /, GET /history and PUT / — the read, the log and the save.
    expect(routes).not.toContain(SHIFTS);
  });

  it('reaches an INSTALLED database, where no later boot widens super-admin by itself', () => {
    // `ensureSystemRole` returns an existing role untouched, so the seeded `super-admin` carries
    // the registry as it stood at the FIRST seed. A fresh database hides this completely — it is
    // built from the current registry — which is why this assertion reads the widen, not a role.
    const migration = read('attendance.migration.ts');
    expect(migration).toContain(KEY);
    expect(migration).toContain("addSystemRoleGrants(\n    'super-admin',");
  });

  it('the widen actually RUNS — a grant nobody calls is not a grant', () => {
    expect(read('../hr.seed.ts')).toContain('migrateAttendance()');
  });

  it('is copied onto every holder of the shift key, once, by the go-live step', () => {
    // «ساعات العمل» replaces what HR set through the shift catalog, so the holders of the shift key
    // must not lose the working day on the day of the deploy. The copy itself is proved against a
    // real database in `tests/integration/hr-go-live-working-hours-grants.spec.ts`; here it is the
    // mapping and its wiring. It widens nobody: a holder gains the key only beside the key it
    // already exercised the same power under, in the same grant and the same scope.
    expect(HR_WORKING_HOURS_GRANT_PAIRS).toEqual([
      { from: SHIFTS, add: [KEY] },
    ]);
    // Versioned, so a key an administrator removes after the run stays removed.
    expect(HR_WORKING_HOURS_GRANTS_MARK).toMatch(/:v\d+$/u);
  });

  it('leaves the shift catalog on its own key', () => {
    // The two are separate powers, which is the whole reason for the split: editing the hours
    // re-derives a department's unfrozen days; editing the catalog does not.
    const shifts = hrPermissions.find((permission) => permission.key === SHIFTS);
    expect(shifts?.pageId).toBe('hr.attendance-shifts');
  });
});
