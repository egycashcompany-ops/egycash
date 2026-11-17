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
   * Composition is legitimate exactly three times, and the three are not the same kind of act.
   *
   * TWO ISSUE a code — the two ways an employee is HIRED: from an accepted offer, and by direct
   * registration. Each composes ONCE, at creation, and never re-derives.
   *
   * ONE PREVIEWS one — a candidate's papers (A28) print the code the hire will compose from the
   * number kept for them. It writes nothing, which is what makes composing there harmless, so that
   * is asserted rather than assumed.
   *
   * AND ONE CREATION PATH COMPOSES NOTHING AT ALL: `registerExternal`. An external person's code is
   * typed by HR and may carry letters («واسمح ان الكود يتكتب فيه حروف انجليزي»), so it is a name,
   * not an issued code — nothing may compose one for them, and nothing may read a branch or a
   * number back out of it. That absence is asserted here, because it is the kind of thing a later
   * change "fixes" by quietly composing a code when the typed one is missing.
   *
   * This count has moved twice in a week, and each time the guard was the thing that noticed: up to
   * four when external registration first issued composed codes alongside the candidate preview,
   * and back to three when those codes became typed. A bare count would have hidden both — it
   * passes for a rewrite dressed as a creation path, and passes again if the preview starts saving.
   * So each call is pinned to its method, the preview is pinned to writing nothing, and the one
   * path that must not compose is pinned to not composing.
   */
  it('two paths issue a code, one previews one, and external registration composes none', () => {
    const composed = [...SERVICE.matchAll(/buildEmployeeCode\(/g)];
    expect(composed).toHaveLength(3);

    const bodyOf = (method: string): string => {
      const start = SERVICE.indexOf(`async ${method}(`);
      expect(start, method).toBeGreaterThan(-1);
      const next = SERVICE.slice(start + 1).search(/\n {2}(private )?async [a-zA-Z]+\(/);
      return next === -1 ? SERVICE.slice(start) : SERVICE.slice(start, start + 1 + next);
    };

    for (const method of ['create', 'registerDirect']) {
      expect([...bodyOf(method).matchAll(/buildEmployeeCode\(/g)], method).toHaveLength(1);
    }

    // An external person's code is typed, never minted: this path composes nothing, and takes the
    // code from the request instead.
    const external = bodyOf('registerExternal');
    expect(external).not.toContain('buildEmployeeCode(');
    expect(external).toContain('const code = input.code;');

    // The third is the candidate's preview — built, returned, never saved.
    const preview = bodyOf('candidateFromOffer');
    expect(preview).toContain('buildEmployeeCode(');
    expect(preview).not.toMatch(/employeeRepository\.(create|update)/);
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
