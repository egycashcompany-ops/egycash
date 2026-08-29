// A declared page reaches a real screen, and a real screen is reachable.
//
// THE DEFECT THIS PREVENTS is one nothing else catches: a page id in the module manifest, a
// navigation row in the seed, and a routed component in the web are three separate declarations in
// three separate packages, and TypeScript never puts them in the same room. `hr.employee-loans`
// once named a page nobody could open, and the row would have rendered a 404 to whoever clicked it.
//
// Both directions matter. A page with no screen is a menu entry that leads nowhere; a screen with
// no navigation row is a feature nobody can find. The owner rule carried from Fleet FW-1 adds a
// third: nothing UNSHIPPED may be reachable, which for this module is most of it — P3, P4 and P5
// are goals, the assessment itself, and history.
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
  { page: 'hr.performance-cycles', route: '/performance/cycles', path: 'cycles' },
  { page: 'hr.performance-reviews', route: '/performance/reviews', path: 'reviews' },
] as const;

describe('every declared performance page reaches a screen', () => {
  it.each(SCREENS)('$page is declared with its route', ({ page, route }) => {
    expect(MANIFEST).toContain(`id: '${page}'`);
    expect(MANIFEST).toContain(`route: '${route}'`);
  });

  it.each(SCREENS)('$route is routed in the web', ({ path }) => {
    expect(ROUTES).toContain(`path="${path}"`);
  });

  /** The subtree is mounted, or every route inside it is unreachable however well declared. */
  it('the subtree is mounted in the app router', () => {
    expect(APP).toContain('path="/performance/*"');
    expect(APP).toContain("import('../../modules/hr/performance/routes')");
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
   * A ROUND and a ROW ARE DIFFERENT PERMISSIONS. Somebody who may see that «H1 2026» exists is not
   * thereby somebody who may see who is being assessed and by whom — so the reviews screen is not
   * gated on the cycle's key, and the seed row agrees with the route.
   */
  it('the cycles screen asks for the cycle key', () => {
    expect(ROUTES).toContain('permission="performanceCycle.view"');
    expect(SEED).toContain("permission: 'performanceCycle.view'");
  });

  it('the reviews screen asks for the review key', () => {
    expect(ROUTES).toContain('permission="performanceReview.view"');
    expect(SEED).toContain("permission: 'performanceReview.view'");
  });

  /**
   * Opening, closing and assigning all carry `conduct` INSIDE the screens rather than gating them.
   * Gating the cycles screen on `conduct` would hide the list from everybody who may only read it;
   * leaving the buttons on `view` would put the whole rule in the server's hands, where the person
   * clicking learns about it from a refusal.
   */
  it('the acts inside the screens carry the conduct key', () => {
    expect(read('pages/PerformanceCyclesPage.tsx')).toContain(
      'permission="performanceCycle.conduct"',
    );
    expect(read('pages/PerformanceReviewsPage.tsx')).toContain(
      'permission="performanceCycle.conduct"',
    );
  });
});

/**
 * FW-1 — nothing unshipped is reachable.
 *
 * P3 brings goals, P4 the assessment, P5 history. A route or a navigation row for any of them today
 * would lead to a screen that does not exist, and the fastest way for that to happen is somebody
 * adding the row while the API is still in flight.
 */
describe('no surface exists for a phase that has not shipped', () => {
  it.each(['goals', 'results', 'history'])('nothing routes to /performance/%s', (unshipped) => {
    expect(ROUTES).not.toContain(`path="${unshipped}"`);
    expect(SEED).not.toContain(`/performance/${unshipped}`);
  });

  /**
   * And no INPUT for an assessment. The rating column renders what the server holds and there is
   * no field that writes one — a form posting to an endpoint that does not exist would lose
   * somebody's work, silently, with the toast saying it saved.
   */
  it('the reviews screen writes no rating', () => {
    const page = read('pages/PerformanceReviewsPage.tsx');
    expect(page).not.toContain('useSubmitPerformanceReview');
    expect(page).not.toContain('useFinalizePerformanceReview');
    expect(page.toLowerCase()).not.toContain('setrating');
  });

  /**
   * P3's dialog shows a goal's two numbers and never a figure computed FROM them. A progress bar
   * here would be the module's first invented number, arriving as a UI nicety — and the API-side
   * absence spec cannot see this file, so the ban is repeated where the temptation lives.
   */
  it('the goals dialog computes nothing from the numbers', () => {
    // CODE ONLY — the file's own comments explain in prose what it deliberately does not do, and
    // a sentence saying «no percentage» contains the word it bans.
    const dialog = read('components/GoalsDialog.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/(^|\s)\/\/.*$/gm, '')
      .toLowerCase();
    for (const forbidden of ['progresspercent', 'completionrate', 'progressbar', 'percentage']) {
      expect(dialog, forbidden).not.toContain(forbidden);
    }
    // No division of current by target anywhere — the arithmetic itself, not just its name.
    expect(dialog).not.toMatch(/currentvalue\s*\/\s*(goal\.)?targetvalue/);
  });
});
