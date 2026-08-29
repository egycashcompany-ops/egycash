// The shape of the separation closeout, held by source (P-HR-SEP D1–D6).
//
// WHAT THIS PROVES THAT THE INTEGRATION SPEC CANNOT. `hr-separation-closeout.spec.ts` drives the
// three subscribers against a database and asserts what happens to a row. It cannot assert what
// DOESN'T exist — that no fourth consumer quietly appeared, that the contract sweep never learned
// to terminate, that the training closeout never reaches the nomination. Those are the decisions
// most likely to be undone by somebody being helpful, and each of them looks like an improvement
// at the moment it is made.
//
// It also holds the wiring. A subscriber that is written and never registered is the failure mode
// with no symptom at all: every unit test passes, the service works when called, and the exit
// silently closes nothing.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const HR = resolve(HERE, '..');
const read = (file: string): string => readFileSync(resolve(HR, file), 'utf8');

/** Comments are stripped before scanning, or a spec trips on its own explanation of the rule. */
const strip = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const MODULE = strip(read('hr.module.ts'));
const CONTRACT_SERVICE = strip(read('contracts/contracts/contract.service.ts'));
const REVIEW_SERVICE = strip(read('performance/reviews/performance-review.service.ts'));
const REVIEW_REPOSITORY = strip(read('performance/performance.repository.ts'));
const NOMINATION_SERVICE = strip(read('training/nominations/training-nomination.service.ts'));
const NOMINATION_REPOSITORY = strip(read('training/nominations/training-nomination.repository.ts'));
const SEPARATION = strip(read('shared/separation.ts'));

/**
 * The slice of a file between a declaration and whatever is declared next.
 *
 * BOUNDED, and this is the fourth time in this codebase that matters. A guard that slices to the
 * end of the file passes today and then fails on correct code the moment somebody appends a method
 * below it — for a reason nobody can act on, which makes deleting the guard the obvious fix.
 */
const bodyOf = (source: string, declaration: string, next: RegExp): string => {
  const from = source.indexOf(declaration);
  expect(from, `${declaration} exists`).toBeGreaterThan(-1);
  const rest = source.slice(from + declaration.length);
  const match = next.exec(rest);
  return match === null ? rest : rest.slice(0, match.index);
};

describe('the exit reaches all seven consumers', () => {
  /**
   * Five live in HR — leave, loans, attendance, and the two this phase adds — and two live outside
   * it. Counted rather than listed one by one, because the NUMBER is what a reader checks against
   * the audit: `employee-separation-closeout.md` §2 names five consumers and §5 adds two more (the
   * contract fix is a query change, not a subscriber, which is exactly D3). An eighth appearing
   * with no row in either is the thing this catches.
   */
  it('registers five subscriptions inside HR', () => {
    const subscriptions = MODULE.match(/event: 'hr\.employee\.exited'/g) ?? [];
    expect(subscriptions).toHaveLength(5);
  });

  /**
   * And the two outside it still listen. Held here rather than in each module because the failure
   * this catches is a change to the EVENT — a rename, a payload split — and the symptom of that is
   * two modules going quiet, in different directories, with nothing failing.
   */
  it('leaves the two consumers outside HR listening', () => {
    const fleet = readFileSync(resolve(HR, '../fleet/fleet.module.ts'), 'utf8');
    const it = readFileSync(resolve(HR, '../it/it.module.ts'), 'utf8');
    expect(fleet).toContain("event: 'hr.employee.exited'");
    expect(it).toContain("event: 'hr.employee.exited'");
  });

  it('wires the performance closeout by handler id and calls the service', () => {
    expect(MODULE).toContain("handlerId: 'performance.excuseReviewsOfExitedEmployee'");
    expect(MODULE).toContain('performanceReviewService.onEmployeeExited(');
  });

  it('wires the training closeout by handler id and calls the service', () => {
    expect(MODULE).toContain("handlerId: 'training.releaseSeatsOfExitedEmployee'");
    expect(MODULE).toContain('trainingNominationService.onEmployeeExited(');
  });
});

/**
 * The consumer that searching for `hr.employee.exited` does not find, and the one that matters
 * most (§2, «A sixth consumer, reached through the login»).
 *
 *   exit → login suspended → `platform.user.statusChanged` → the leaver's workflows are suspended
 *
 * Automation says why in its own words: offboarding has to actually stop what somebody set in
 * motion, or automation becomes a way for a revoked account to keep acting. So the automatic
 * suspension is not only an access decision — it is the ONLY thing that stops a leaver's scheduled
 * workflows, and it is two events away from anything an exit test would think to look at.
 */
describe('the exit still reaches automation through the login', () => {
  /**
   * UNCONDITIONAL. The suspension sits inside `applyExit` with no flag and no payload key — unlike
   * `suspend`, whose caller may pass `disableLogin: false`. That difference is the whole property:
   * an exit that could be told to leave the login alone would silently leave the workflows running
   * with it.
   */
  it('suspends the login as part of the exit, with nothing to switch it off', () => {
    const actions = strip(read('employee-management/employee-actions/employee-action.service.ts'));
    const exit = bodyOf(actions, 'private async applyExit(', /\n {2}private async \w+\(/);
    expect(exit).toContain('this.suspendLogin(');
    expect(exit).not.toContain('disableLogin');
  });

  it('leaves automation listening for the status change', () => {
    const automation = readFileSync(resolve(HR, '../automation/automation.module.ts'), 'utf8');
    expect(automation).toContain('PlatformEvents.UserStatusChanged');
    expect(automation).toContain("handlerId: 'workflows.suspendOnOwnerDeactivated'");
  });
});

/**
 * D3 — the sharpest line in this phase, and the easiest to cross by accident.
 *
 * Terminating a contract records a person, a date and a required reason, and emits an event. It is
 * a legal act on a document that may be produced in a dispute. A sweep may stop the system from
 * saying something untrue; it may not sign.
 */
describe('the contract sweeps skip leavers and change nothing', () => {
  const expireBody = (): string =>
    bodyOf(CONTRACT_SERVICE, 'async expireOverdue(', /\n {2}async \w+\(/);
  const notifyBody = (): string =>
    bodyOf(CONTRACT_SERVICE, 'async notifyExpiring(', /\n {2}(async |private |toDto)/);

  it('asks who has exited before expiring anything', () => {
    expect(expireBody()).toContain('exitedHolders(');
  });

  it('asks who has exited before sending a notice', () => {
    expect(notifyBody()).toContain('exitedHolders(');
  });

  /**
   * The direction of the question is the guard (see the repository). «Who is employed» would treat
   * an unresolvable id as somebody to skip, and a reminder system that goes quiet on a data fault
   * is one nobody discovers is broken.
   */
  it('reads the exited subset, not the employed one', () => {
    expect(CONTRACT_SERVICE).toContain('listExitedIdsSystem(');
    expect(CONTRACT_SERVICE).not.toContain('listEmployedSystem(');
  });

  it('never terminates from a sweep', () => {
    expect(expireBody()).not.toContain('terminated');
    expect(notifyBody()).not.toContain('terminated');
  });

  /**
   * The skipped contract keeps its notice marker. Stamping it would mean a rehire's contract could
   * never be noticed again — asserted here because the cheap version of this fix is to write the
   * marker for everybody and filter afterwards.
   */
  it('does not consume the notice marker for the rows it skips', () => {
    const body = notifyBody();
    const skip = body.indexOf('.filter(');
    const stamp = body.indexOf('expiryNoticeSentAt');
    expect(skip, 'the sweep filters').toBeGreaterThan(-1);
    expect(stamp, 'the sweep stamps').toBeGreaterThan(-1);
    expect(stamp, 'it stamps AFTER filtering, inside the loop').toBeGreaterThan(skip);
  });
});

/**
 * D4 — only a draft is excused. A submitted review holds a real evaluation of work the person did.
 */
describe('the performance closeout reaches only unwritten reviews', () => {
  it('filters on draft, not on the repository write condition', () => {
    const body = bodyOf(
      REVIEW_REPOSITORY,
      'async excuseDraftForEmployeeSystem(',
      /\n {2}(async |protected |\/\*\*)/,
    );
    expect(body).toContain("status: 'draft'");
    expect(body).not.toContain('$nin');
  });

  /**
   * `status: 'draft'` sits in the FILTER of the update, not in a check before it — so a redelivered
   * event or a concurrent human decision loses cleanly instead of overwriting.
   */
  it('carries the status in the write filter rather than a pre-check', () => {
    const body = bodyOf(
      REVIEW_REPOSITORY,
      'async excuseDraftForEmployeeSystem(',
      /\n {2}(async |protected |\/\*\*)/,
    );
    const filter = body.indexOf("status: 'draft'");
    const update = body.indexOf('$set');
    expect(filter).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(filter);
  });

  /** Nobody excused these; the exit did. */
  it('names no person as the excuser', () => {
    expect(REVIEW_REPOSITORY).toContain('excusedBy: null');
  });

  it('states the exit as the reason, from the shared constant', () => {
    const body = bodyOf(REVIEW_SERVICE, 'async onEmployeeExited(', /\n {2}(async |private |\})/);
    expect(body).toContain('EXITED_REASON');
    expect(body).not.toContain("'employee exited'");
  });
});

/**
 * D5 and D6 — the seat is released; the nomination is a decision that was taken.
 */
describe('the training closeout reaches the seat and not the nomination', () => {
  const closeout = (): string =>
    bodyOf(NOMINATION_SERVICE, 'async onEmployeeExited(', /\n {2}(async |private )/);

  it('cancels seats and never touches a nomination', () => {
    const body = closeout();
    expect(body).toContain('cancelBookedSeatSystem(');
    expect(body).not.toContain('withdrawn');
    expect(body).not.toContain('nominationRepository');
  });

  /** Only a booking. The four marks made when a session ran are facts about a room. */
  it('reaches enrolled seats only', () => {
    const body = bodyOf(
      NOMINATION_REPOSITORY,
      'async listBookedForEmployeeSystem(',
      /\n {2}(async |\/\*\*)/,
    );
    expect(body).toContain("status: 'enrolled'");
    for (const mark of ['attended', 'absent', 'completed']) {
      expect(body, mark).not.toContain(mark);
    }
  });

  /**
   * D6 — the cutoff is the session's end, not the exit date. A spec is the only thing that keeps
   * these apart, because passing the exit date instead would look more careful, not less.
   */
  it('cuts off at the session end rather than at the exit', () => {
    const body = closeout();
    expect(body).toContain('listUnfinishedIdsSystem(');
    expect(body).toContain('new Date()');
    expect(body).not.toContain('effectiveDate');
    expect(body).not.toContain('exitDate');
  });

  it('states the exit as the reason, from the shared constant', () => {
    const body = closeout();
    expect(body).toContain('EXITED_REASON');
    expect(body).not.toContain("'employee exited'");
  });
});

/**
 * D2 — one phrasing, in one place.
 *
 * «employee exited», «employee left» and «exited» in three collections would read like three
 * different things having happened to somebody who did one thing.
 */
describe('every automatic closeout says the same words', () => {
  it('declares the reason once', () => {
    expect(SEPARATION).toContain("EXITED_REASON = 'employee exited'");
  });

  /** Leave got here first and wrote the literal; the constant names what it already says. */
  it('matches the wording Leave has been writing since R12', () => {
    const leave = read('leave-management/leave-requests/leave-request.service.ts');
    expect(leave).toContain("'employee exited'");
  });
});
