// Every rule this refuses is a rule that would have been SILENT.
//
// That is the whole reason this layer exists. A rule saved against a mistyped event, filtered on a
// field the event never sends, or pointed at a payload path that does not exist, is enabled and
// green and produces nothing at all — no error, no log line, no failed run. The person who wrote
// it believes it works; the person waiting for the notification concludes the system does not send
// one. Neither ever files a bug, because from both sides nothing happened.
//
// So these tests are written against the REAL event catalogue rather than a fixture. A fixture
// would prove the function reads a field list; using the catalogue proves it reads THE field list
// that the running platform will hand it.
import { describe, expect, it } from 'vitest';
import { eventCatalogEntry } from '@ecms/contracts';
import { ruleErrors, ruleProblems } from './rule-validation';

// Chosen because it is exactly the rule somebody writes first: "when leave is decided, tell the
// person whose leave it was". Its declared fields are asserted here so that a payload change in
// HR breaks this file loudly rather than making the tests below quietly meaningless.
const EVENT = 'hr.leave.decided';
const PERMISSIONS = ['employee.view', 'announcement.send'];

const rule = (over: Partial<Parameters<typeof ruleProblems>[0]> = {}) => ({
  event: EVENT,
  filters: [],
  audience: { kind: 'everyone' as const },
  ...over,
});

describe('the catalogue these tests stand on', () => {
  it('still declares the fields the cases below name', () => {
    const entry = eventCatalogEntry(EVENT);
    expect(entry?.payloadDeclared).toBe(true);
    expect(entry?.fields.map((field) => field.path)).toEqual(
      expect.arrayContaining(['employeeId', 'decision']),
    );
  });
});

describe('a rule that could never fire', () => {
  it('is refused for an event nothing publishes', () => {
    const errors = ruleErrors(rule({ event: 'hr.leave.decidedd' }), PERMISSIONS);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe('event');
  });

  it('is refused for a notification event, however real that event is', () => {
    // `platform.notification.created` IS cataloged and IS published — which is the danger. A rule
    // on it answers its own output, at machine speed, on real people's phones.
    const errors = ruleErrors(rule({ event: 'platform.notification.created' }), PERMISSIONS);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('own output');
  });

  it('is refused for a filter on a field the event does not send', () => {
    const errors = ruleErrors(
      rule({ filters: [{ field: 'stauts', op: 'eq', value: 'approved' }] }),
      PERMISSIONS,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe('filters[0].field');
    // The available names are in the message, because the fix is a spelling and the author needs
    // to see it rather than go looking for the payload schema.
    expect(errors[0]?.message).toContain('employeeId');
  });

  it('is refused for a value outside a declared enum', () => {
    const errors = ruleErrors(
      rule({ filters: [{ field: 'decision', op: 'eq', value: 'approvd' }] }),
      PERMISSIONS,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe('filters[0].value');
  });

  it('names the workflow path prefix nowhere — a rule has no trigger object', () => {
    const errors = ruleErrors(
      rule({ filters: [{ field: 'nope', op: 'eq', value: 1 }] }),
      PERMISSIONS,
    );
    expect(errors[0]?.path.startsWith('trigger.')).toBe(false);
  });

  it('is accepted when the event and every filter check out', () => {
    expect(
      ruleErrors(rule({ filters: [{ field: 'decision', op: 'eq', value: 'approved' }] }), PERMISSIONS),
    ).toEqual([]);
  });
});

describe('a rule that could never tell anybody', () => {
  it('is refused for a subject path the event does not send', () => {
    const errors = ruleErrors(
      rule({ audience: { kind: 'subject', path: 'employee.id', includeManager: false } }),
      PERMISSIONS,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe('audience.path');
  });

  it('is accepted for a subject path the event does send', () => {
    expect(
      ruleErrors(
        rule({ audience: { kind: 'subject', path: 'employeeId', includeManager: true } }),
        PERMISSIONS,
      ),
    ).toEqual([]);
  });

  it('is refused for a permission key the platform does not declare', () => {
    const errors = ruleErrors(
      rule({ audience: { kind: 'permission', permission: 'employee.viewAll' } }),
      PERMISSIONS,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe('audience.permission');
  });

  it('is accepted for one it does', () => {
    expect(
      ruleErrors(rule({ audience: { kind: 'permission', permission: 'employee.view' } }), PERMISSIONS),
    ).toEqual([]);
  });
});

describe('how the problems are reported', () => {
  it('reports every mistake at once rather than the first', () => {
    // A form that reveals one mistake per save is a form people give up on.
    const errors = ruleErrors(
      rule({
        filters: [
          { field: 'nope', op: 'eq', value: 1 },
          { field: 'decision', op: 'eq', value: 'approvd' },
        ],
        audience: { kind: 'permission', permission: 'not.areal' },
      }),
      PERMISSIONS,
    );
    expect(errors.map((error) => error.path)).toEqual([
      'filters[0].field',
      'filters[1].value',
      'audience.permission',
    ]);
  });

  it('does not judge a subject path against an event that does not exist', () => {
    // There is no field list to check it against, so the only honest answer is the one already
    // given: fix the event first. Complaining about both invites fixing the wrong one.
    //
    // Asserted over `ruleProblems` rather than `ruleErrors` on purpose: an unknown event makes the
    // path check emit a WARNING, so an errors-only assertion would pass whether the gate is there
    // or not — a test that names this behaviour without testing it.
    const problems = ruleProblems(
      rule({
        event: 'hr.leave.nonsense',
        audience: { kind: 'subject', path: 'employeeId', includeManager: false },
      }),
      PERMISSIONS,
    );
    expect(problems.map((problem) => problem.path)).toEqual(['event']);
  });

  it('still checks a permission audience when the event is wrong — the two are independent', () => {
    const errors = ruleErrors(
      rule({ event: 'hr.leave.nonsense', audience: { kind: 'permission', permission: 'not.areal' } }),
      PERMISSIONS,
    );
    expect(errors.map((error) => error.path)).toEqual(['event', 'audience.permission']);
  });

  it('separates what blocks a save from what merely deserves a look', () => {
    const problems = ruleProblems(rule(), PERMISSIONS);
    expect(problems.filter((problem) => problem.severity === 'error')).toEqual([]);
  });
});
