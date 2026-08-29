// A declared page reaches a real screen, and the clinical screens are gated by the medical key —
// only by the medical key (P-HR-MED D3, D5).
//
// The usual reachability half of this spec is the same one every module has. The interesting half
// is the SECOND describe: this is the one feature in HR where the danger is a screen being too
// easy to reach, and every route, row and section entry here is checked against the key that must
// gate it rather than merely against existing.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(HERE, path), 'utf8');

const ROUTES = read('routes.tsx');
const APP = read('../../../platform/app/App.tsx');
const MANIFEST = read('../../../../../api/src/modules/hr/hr.module.ts');
const SEED = read('../../../../../api/src/seed-navigation.ts');
const SECTIONS = read('../../../../../api/src/seed-application-sections.ts');

describe('the declared medical page reaches a screen', () => {
  it('is declared with its route', () => {
    expect(MANIFEST).toContain("id: 'hr.medical-profiles'");
    expect(MANIFEST).toContain("route: '/medical/profiles'");
  });

  it('is routed in the web', () => {
    expect(ROUTES).toContain('path="profiles"');
  });

  it('the subtree is mounted in the app router', () => {
    expect(APP).toContain('path="/medical/*"');
    expect(APP).toContain("import('../../modules/hr/medical/routes')");
  });

  it('has a navigation row and a sidebar group', () => {
    expect(SEED).toContain("route: '/medical/profiles'");
    expect(SECTIONS).toContain("'/medical/profiles'");
  });
});

/**
 * D3 — the key gates, and no other key opens the door.
 *
 * Three declarations have to agree, and they live in three packages TypeScript never puts in the
 * same room: the route's `RequirePermission`, the seed row's `permission`, and the server's
 * `authorize`. A row keyed on `employee.view` would advertise this screen to everybody who can
 * read a personnel file, and nothing else in the build would notice.
 */
describe('every clinical surface is gated by the medical key alone', () => {
  it('the records route asks for medicalRecord.view', () => {
    expect(ROUTES).toContain('permission="medicalRecord.view"');
  });

  it('the navigation row carries the same key', () => {
    const from = SEED.indexOf("route: '/medical/profiles'");
    expect(from).toBeGreaterThan(-1);
    const row = SEED.slice(Math.max(0, from - 300), from + 200);
    expect(row).toContain("permission: 'medicalRecord.view'");
  });

  /** No employee key anywhere in the subtree — not on a route, not on a button. */
  it.each(['routes.tsx', 'pages/MedicalProfilesPage.tsx', 'pages/MyMedicalPage.tsx'])(
    '%s names no employee permission',
    (file) => {
      const source = read(file);
      for (const forbidden of ['"employee.view"', "'employee.view'", '"employee.edit"']) {
        expect(source, forbidden).not.toContain(forbidden);
      }
    },
  );
});

/**
 * D5 — the self-service screen is the one route here with NO permission, and that is as deliberate
 * as every gate above it. Reading your own health record must not require being able to read
 * everybody's.
 */
describe('the employee reaches their own record without a key', () => {
  it('is routed without a permission wrapper', () => {
    const from = ROUTES.indexOf('path="me"');
    expect(from, 'the me route exists').toBeGreaterThan(-1);
    const block = ROUTES.slice(from, from + 200);
    expect(block).toContain('MyMedicalPage');
    expect(block).not.toContain('RequirePermission');
  });

  /** And it is advertised by nothing — self-service, like My Attendance and My Performance. */
  it('has no navigation row and no page id', () => {
    expect(SEED).not.toContain('/medical/me');
    expect(MANIFEST).not.toContain("route: '/medical/me'");
  });

  /** READ-ONLY: what is recorded was recorded by whoever was told, not by the subject. */
  it('offers no way to edit', () => {
    const page = read('pages/MyMedicalPage.tsx');
    expect(page).not.toContain('useUpsertMedicalProfile');
    expect(page).not.toContain('<Input');
    expect(page).not.toContain('<Textarea');
  });
});

/**
 * FW-1 — nothing unshipped is reachable. M3 brings medical events, M4 insurance.
 */
describe('no surface exists for a phase that has not shipped', () => {
  it.each(['events', 'insurance', 'certificates'])('nothing routes to /medical/%s', (unshipped) => {
    expect(ROUTES).not.toContain(`path="${unshipped}"`);
    expect(SEED).not.toContain(`/medical/${unshipped}`);
  });

  /**
   * And the list screen offers no clinical search (D12, D13). «Who here is diabetic» has no
   * legitimate HR answer, and a filter that offered it would make this a screening tool whatever
   * the API allowed.
   */
  it('the list filters by person and not by condition', () => {
    const page = read('pages/MedicalProfilesPage.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/(^|\s)\/\/.*$/gm, '')
      .toLowerCase();
    for (const forbidden of ['conditionfilter', 'filterbycondition', 'hasdisabilityfilter']) {
      expect(page, forbidden).not.toContain(forbidden);
    }
  });
});
