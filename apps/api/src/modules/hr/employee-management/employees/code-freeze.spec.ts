// The Employee Code is composed ONCE, AT HIRE, AND NEVER REWRITTEN BY THE SYSTEM (ADR-017). This
// file is what keeps that true, and it is worth being precise about why it is written this way.
//
// AMENDED 2026-11-01 — «عايزك تعمل إمكانية تغيير كود الموظف». A PERSON may now change a code by
// hand: behind `employee.changeCode`, with a reason on the record. That is not the thing this file
// guards against. What it guards against is a code changing as a SIDE EFFECT of something else —
// a transfer, a rehire — which is how people used to be renamed without anybody deciding to.
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
   * Composition is legitimate exactly three times — the three ways a person first enters the
   * registry: hire from an accepted offer, direct registration, and registering an EXTERNAL person
   * (تعيين خارجى), who is not hired at all but still carries a code, because everything that hands
   * somebody a laptop names an employee by one.
   *
   * This rose from two when external registration arrived, and the tripwire did its job: a third
   * path HAD appeared and was looked at. It composes once, at creation, and never re-derives — the
   * same rule as the other two, which is what makes it legitimate rather than a fourth rewrite.
   *
   * A bare count would pass for a rewrite dressed as a creation path, so each call is pinned to the
   * method it belongs in. If one of these falls to zero, that path has stopped issuing a code; if
   * the total rises, something new is minting them.
   */
  it('only the three paths that create a person compose a code', () => {
    const composed = [...SERVICE.matchAll(/buildEmployeeCode\(/g)];
    expect(composed).toHaveLength(3);
    const bodyOf = (method: string): string => {
      const start = SERVICE.indexOf(`async ${method}(`);
      expect(start, method).toBeGreaterThan(-1);
      const next = SERVICE.slice(start + 1).search(/\n {2}(private )?async [a-zA-Z]+\(/);
      return next === -1 ? SERVICE.slice(start) : SERVICE.slice(start, start + 1 + next);
    };
    for (const method of ['create', 'registerDirect', 'registerExternal']) {
      expect([...bodyOf(method).matchAll(/buildEmployeeCode\(/g)], method).toHaveLength(1);
    }
  });

  /**
   * THE ONE DOOR, AND A PERSON STANDS AT IT. After hire, a code changes through `changeCode` and
   * nowhere else: behind its own permission (not `editPersonal` — a code is on badges, on contracts,
   * and is how the roster file names a person), recording old, new and why. It composes nothing, so
   * the count of composing paths above does not move.
   */
  it('a code changes after hire only by hand, behind its own permission, with the reason recorded', () => {
    const ROUTES = code('./employee.routes.ts');
    expect(ROUTES).toMatch(/'\/:id\/code',\s*authenticate,\s*authorize\('employee\.changeCode'\)/);
    const start = SERVICE.indexOf('async changeCode(');
    const method = SERVICE.slice(start, SERVICE.indexOf('async updateOfficer(', start));
    expect(method).toContain("{ field: 'code', old: before.code, new: code }");
    expect(method).toContain("field: 'codeChangeReason'");
    expect(method).not.toMatch(/buildEmployeeCode|branchService/);
    // And it is the only method that writes `{ code }` after hire.
    expect([...SERVICE.matchAll(/\{ code \},/g)]).toHaveLength(1);
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
