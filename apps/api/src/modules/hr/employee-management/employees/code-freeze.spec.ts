// The Employee Code is composed ONCE, AT HIRE, AND NEVER REWRITTEN (ADR-017). This file is what
// keeps that true, and it is worth being precise about why it is written this way.
//
// A frozen code is not enforced by a type or a schema — `code` is a plain string field, and any
// line anywhere may assign to it. The rule lives in prose in `employee-number.ts`, and prose does
// not fail a build. Worse, breaking it is SILENT: re-deriving a code produces a perfectly valid
// string, the request succeeds, and the damage — a person renamed on a document somebody was
// handed — only surfaces when a human notices their badge number changed.
//
// So this reads the SOURCE of the paths that used to do the rewriting and asserts they no longer
// can. It is deliberately about the write, not about a value: a test that hired someone and checked
// their code would pass while a transfer quietly renamed them tomorrow.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildEmployeeCode, formatEmployeeNumber } from './employee-number';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Code only — a comment that mentions `employee.code` must not fail an assertion about writes. */
const code = (file: string): string =>
  readFileSync(resolve(HERE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const ACTIONS = code('../employee-actions/employee-action.service.ts');
const SERVICE = code('./employee.service.ts');

describe('the Employee Code is frozen once issued', () => {
  /**
   * The personnel-action engine is where the two rewrites lived — `applyTransfer` re-derived the
   * code from the destination branch, and `applyRehire` from the branch somebody returned into.
   * Neither may assign to `code` again, under any action type.
   */
  it('the personnel-action engine never assigns employee.code', () => {
    const assignments = [...ACTIONS.matchAll(/employee\.code\s*=/g)];
    expect(assignments).toHaveLength(0);
  });

  /**
   * The sharper form of the same rule, and the one that catches a rewrite dressed up differently:
   * composing a code needs a BRANCH CODE, and the only way to get one in the actions engine is
   * `branchService`. Denying it the import closes the whole family of ways to re-derive, including
   * ones that assign through a local variable this file would not otherwise see.
   */
  it('the personnel-action engine cannot even reach a branch code', () => {
    expect(ACTIONS).not.toMatch(/\bbranchService\b/);
    expect(ACTIONS).not.toMatch(/\bbuildEmployeeCode\b/);
  });

  /**
   * Composition is legitimate exactly twice — the two ways an employee is first created (hire from
   * an accepted offer, and direct registration). If this count ever rises, a third path is issuing
   * codes and needs to be looked at; if it falls, hiring has stopped composing one at all.
   */
  it('only the two hire paths compose a code', () => {
    const composed = [...SERVICE.matchAll(/buildEmployeeCode\(/g)];
    expect(composed).toHaveLength(2);
  });

  /**
   * And the composition itself still reproduces what the company already issued on paper. The
   * go-live workforce is 2,699 codes of exactly this shape; if this fails, every one of them is
   * wrong and the import would rename the entire company.
   */
  it('composes the company’s own code shape', () => {
    expect(buildEmployeeCode('010', formatEmployeeNumber(4))).toBe('0100004');
    expect(buildEmployeeCode('070', formatEmployeeNumber(2717))).toBe('0702717');
  });
});
