// The overlap map is a MIRROR of the engine, and this is what holds the mirror straight (HR3-B).
//
// `ACTION_AFFECTED_FIELDS` claims to say what each personnel action writes. A hand-written claim
// about somebody else's code rots the first time that code changes — and it rots SILENTLY here,
// because a wrong entry does not break a build or fail a request: it produces a warning about a
// collision that cannot happen, or, worse, silence about one that can.
//
// So this file does not test the map against a second hand-written list. It reads the engine's
// SOURCE and compares both ways: nothing in the map that the engine does not write, nothing the
// engine writes that the map does not carry.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EMPLOYEE_ACTION_TYPES, type EmployeeActionType } from '@ecms/contracts';
import { ACTION_AFFECTED_FIELDS, overlappingFields } from './action-fields';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Code only — the header explains the rule in prose, and prose must not satisfy an assertion. */
const code = (file: string): string =>
  readFileSync(resolve(HERE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

/**
 * Every field the engine records as a CHANGE ENTRY.
 *
 * `from` is the discriminator, and deliberately so: an employee change entry is
 * `{ field, from, to }` (or `{ field: 'status', from, to }` in shorthand), while an AUDIT entry
 * is `{ field, old, new }`. Matching on `from` picks out exactly the first kind, so the audit
 * trail's own vocabulary ('type', 'effectiveDate', 'scheduled', …) cannot leak in and look like
 * an employment field.
 */
const writtenFields = (source: string): Set<string> =>
  new Set([...source.matchAll(/field: '([^']+)',\s*from/g)].map((m) => m[1] as string));

const ENGINE = writtenFields(code('./employee-action.service.ts'));
// `hire` is recorded here rather than by the engine's switch — it is not created through an
// endpoint, it is stamped when the employee is.
const HIRE = writtenFields(code('./employee-action.repository.ts'));

const mapped = new Set(Object.values(ACTION_AFFECTED_FIELDS).flat());

describe('the map covers the engine, and only the engine', () => {
  it('has an entry for every action type — a missing one would silently never warn', () => {
    expect(Object.keys(ACTION_AFFECTED_FIELDS).sort()).toEqual([...EMPLOYEE_ACTION_TYPES].sort());
  });

  it('names no field the engine does not actually write', () => {
    const known = new Set([...ENGINE, ...HIRE]);
    expect([...mapped].filter((field) => !known.has(field)).sort()).toEqual([]);
  });

  /**
   * The direction that catches a FUTURE change: someone teaches the engine to write a new field
   * and does not tell the map, so two actions that now collide stop warning about it.
   */
  it('and carries every field the engine writes', () => {
    const known = [...ENGINE, ...HIRE];
    expect(known.filter((field) => !mapped.has(field)).sort()).toEqual([]);
  });

  it('lists no field twice within one type', () => {
    for (const [type, fields] of Object.entries(ACTION_AFFECTED_FIELDS)) {
      expect(new Set(fields).size, type).toBe(fields.length);
    }
  });
});

describe('what overlaps what', () => {
  // The example the design is about: a scheduled raise and a promotion that also raises.
  it('a promotion meets a scheduled salary change on the salary', () => {
    expect(overlappingFields('promotion', 'salaryChange')).toEqual(['employment.salary']);
  });

  it('and a promotion does NOT meet a manager change — different fields entirely', () => {
    expect(overlappingFields('promotion', 'managerChange')).toEqual([]);
  });

  // A transfer moves the manager too when asked to, so these two can genuinely collide.
  it('a transfer meets a manager change on the manager', () => {
    expect(overlappingFields('transfer', 'managerChange')).toEqual(['employment.managerId']);
  });

  it('every status-writing action meets every other one', () => {
    expect(overlappingFields('suspend', 'leaveStart')).toContain('status');
    expect(overlappingFields('resignation', 'reinstate')).toContain('status');
  });

  // The five exit types share one code path, so they must share one answer.
  it('the exit types are interchangeable', () => {
    const exits: EmployeeActionType[] = [
      'resignation',
      'termination',
      'endOfContract',
      'retirement',
      'death',
    ];
    for (const exit of exits) {
      expect(ACTION_AFFECTED_FIELDS[exit], exit).toEqual(ACTION_AFFECTED_FIELDS.resignation);
    }
  });

  it('is symmetric — which one is being created cannot change whether they meet', () => {
    for (const a of EMPLOYEE_ACTION_TYPES) {
      for (const b of EMPLOYEE_ACTION_TYPES) {
        expect(overlappingFields(a, b).sort(), `${a} × ${b}`).toEqual(
          overlappingFields(b, a).sort(),
        );
      }
    }
  });

  it('every type overlaps itself — creating a second one of the same kind always warns', () => {
    for (const type of EMPLOYEE_ACTION_TYPES) {
      expect(overlappingFields(type, type).length, type).toBeGreaterThan(0);
    }
  });
});
