// A declared page reaches a real screen, and a real screen is reachable.
//
// THE DEFECT THIS PREVENTS is one nothing else catches: a page id in the module manifest, a
// navigation row in the seed, and a routed component in the web are three separate declarations in
// three separate packages, and TypeScript never puts them in the same room. `hr.employee-loans`
// once named a page nobody could open, and the row would have rendered a 404 to whoever clicked it.
//
// Both directions matter. A page with no screen is a menu entry that leads nowhere; a screen with
// no navigation row is a feature nobody can find. The owner rule carried from Fleet FW-1 adds a
// third: nothing UNSHIPPED may be reachable, so T3's and T4's surfaces must not appear yet.
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

const SCREENS = [
  { page: 'hr.training-sessions', route: '/training/sessions', path: 'sessions' },
  { page: 'hr.training-nominations', route: '/training/nominations', path: 'nominations' },
  { page: 'hr.training-courses', route: '/training/courses', path: 'courses' },
] as const;

describe('every declared training page reaches a screen', () => {
  it.each(SCREENS)('$page is declared with its route', ({ page, route }) => {
    expect(MANIFEST).toContain(`id: '${page}'`);
    expect(MANIFEST).toContain(`route: '${route}'`);
  });

  it.each(SCREENS)('$route is routed in the web', ({ path }) => {
    expect(ROUTES).toContain(`path="${path}"`);
  });

  /** The subtree is mounted, or every route inside it is unreachable however well declared. */
  it('the subtree is mounted in the app router', () => {
    expect(APP).toContain('path="/training/*"');
    expect(APP).toContain("import('../../modules/hr/training/routes')");
  });

  it.each(SCREENS)('$route has a navigation row', ({ route }) => {
    expect(SEED).toContain(`route: '${route}'`);
  });

  /** A row in no group renders outside the sidebar's sections — visible, but homeless. */
  it.each(SCREENS)('$route belongs to a sidebar group', ({ route }) => {
    expect(SECTIONS).toContain(`'${route}'`);
  });
});

describe('each screen is gated by the key that matches what it does', () => {
  /**
   * The catalogue is NOT gated on the server — somebody scheduling a delivery must be able to pick
   * a course — but the SCREEN is administration, and offering it to somebody who cannot save
   * anything would be a page of disabled buttons.
   */
  it('the catalogue screen asks for the manage key', () => {
    expect(ROUTES).toContain('permission="trainingCourse.manage"');
    expect(SEED).toContain("permission: 'trainingCourse.manage'");
  });

  /** The sessions row is on `view`: everybody who takes part in running training reads it. */
  it('the sessions screen asks for the view key', () => {
    expect(ROUTES).toContain('permission="trainingSession.view"');
    expect(SEED).toContain("permission: 'trainingSession.view'");
  });

  /**
   * The queue is on `view` and the DECISION buttons inside it on `decide` (D3). Gating the whole
   * screen on `decide` would hide from a nominator the answer to what they asked — and gating the
   * buttons on `view` would put the two-person rule entirely in the server's hands, where the
   * person clicking would learn about it only from a refusal.
   */
  it('the nominations screen asks for view, and its decisions for decide', () => {
    expect(ROUTES).toContain('permission="trainingNomination.view"');
    expect(SEED).toContain("permission: 'trainingNomination.view'");
    const page = read('pages/TrainingNominationsPage.tsx');
    expect(page).toContain('permission="trainingNomination.decide"');
  });
});

/**
 * FW-1 — nothing unshipped is reachable.
 *
 * T3 and T4 bring nominations, enrollment, attendance, completion and certificates. A route or a
 * navigation row for any of them today would lead to a screen that does not exist, and the fastest
 * way for that to happen is somebody adding the row while the API is still in flight.
 */
describe('no surface exists for a phase that has not shipped', () => {
  it.each(['certificates', 'records', 'history'])(
    'nothing routes to /training/%s',
    (unshipped) => {
      expect(ROUTES).not.toContain(`path="${unshipped}"`);
      expect(SEED).not.toContain(`/training/${unshipped}`);
    },
  );
});
