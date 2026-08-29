// D15 — the employee sees their own FINALIZED review, and nothing before it.
//
// This is the decision most likely to be undone by a helpful change, because every step toward
// undoing it looks like an improvement: «let them see it's in progress», «show the draft so they
// can prepare», «add a status filter like every other list has». Each would turn an assessment
// into a negotiation, and the person being assessed is the one reader who cannot un-see an early
// draft of what somebody thinks of them.
//
// A rule that was deliberately not given has no code to point at. This is where it is pointed at.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const strip = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const SERVICE = strip(read('performance-review.service.ts'));
const CONTROLLER = strip(read('../performance.controller.ts'));

/**
 * The REVIEWS router only.
 *
 * The file holds three builders, and the first version of this spec compared `/me` against the
 * CYCLES router's `/:id` — which sits above it in the file and made the ordering assertion fail on
 * correct code. A guard that reads the wrong block is worse than none: it fails for a reason
 * nobody can act on, and the fix people reach for is deleting it.
 */
const ROUTES = ((): string => {
  const all = strip(read('../performance.routes.ts'));
  const from = all.indexOf('buildPerformanceReviewsRouter');
  return all.slice(from, all.indexOf('buildPerformanceGoalsRouter', from));
})();

/** `listMine` alone — an assertion over the whole file would pass on any other method's text. */
const listMine = (): string => {
  const from = SERVICE.indexOf('async listMine(');
  expect(from, 'listMine exists').toBeGreaterThan(-1);
  return SERVICE.slice(from, SERVICE.indexOf('async getById(', from));
};

describe('the self-service read shows finalized reviews only', () => {
  it('names the status itself', () => {
    expect(listMine()).toContain("status: ['finalized']");
  });

  /**
   * HARDCODED, NOT DEFAULTED, and this is the assertion that matters. A default is a thing a query
   * parameter overrides — `?status=draft` would be one URL away from showing somebody an unfinished
   * assessment of themselves. `listMine` must not take a status at all.
   */
  it('accepts no status from its caller', () => {
    const method = listMine();
    expect(method).not.toContain('query.status');
    expect(method).not.toMatch(/status\?:/);
    expect(method).not.toMatch(/status\s*[,)]/);
  });

  /** And it narrows by the TOKEN's employee, never by an id the request supplied. */
  it('narrows by the caller and not by a requested employee', () => {
    const method = listMine();
    expect(method).toContain('callerEmployeeId(userId)');
    expect(method).not.toContain('query.employeeId');
  });
});

describe('the route is reachable by every employee login', () => {
  /** No `authorize`: requiring the view key would gate self-service behind reading everybody. */
  it('carries no permission key', () => {
    const from = ROUTES.indexOf("'/me'");
    expect(from, 'the /me route exists').toBeGreaterThan(-1);
    const block = ROUTES.slice(from, ROUTES.indexOf('router.get(', from + 1));
    expect(block).toContain('authenticate');
    expect(block).not.toContain('authorize(');
  });

  /**
   * DECLARED BEFORE `/:id`. Express matches in order, so a `/:id` above this would swallow `me` as
   * an object id and answer 404 — which is exactly what `/platform/job-titles/options` did to two
   * shipped screens before it was found.
   */
  it('is declared before the id route', () => {
    const me = ROUTES.indexOf("'/me'");
    const byId = ROUTES.indexOf("'/:id'");
    expect(me).toBeGreaterThan(-1);
    expect(byId).toBeGreaterThan(-1);
    expect(me).toBeLessThan(byId);
  });

  /** The controller drops what arrived rather than forwarding it — see its own note for why. */
  it('forwards no filter from the request', () => {
    const from = CONTROLLER.indexOf('listMyPerformanceReviews');
    const block = CONTROLLER.slice(from, CONTROLLER.indexOf('export const', from + 1));
    for (const forbidden of ['query.status', 'query.employeeId', 'query.cycleId', 'query.search']) {
      expect(block, forbidden).not.toContain(forbidden);
    }
  });
});
