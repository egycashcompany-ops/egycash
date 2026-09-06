// The employee's own file: reachable by them, and by no route that names anyone else.
//
// Three properties hold this endpoint together, and each fails silently if it slips:
//
//   1. NO `authorize`. The id comes from the token, so there is nothing to authorize onto — and
//      `employee.view`, the only key that fits, is the key that opens the whole registry. Adding it
//      here would either lock every employee out of their own file or hand them everyone's.
//   2. DECLARED BEFORE `/:id`. Express matches in order, so a `/me` declared after it is dead: the
//      request lands on the detail route with the literal string `me` as an employee id.
//   3. REDACTED BY THE CALLER'S OWN PERMISSIONS. It returns the same `EmployeeDto` as the admin
//      detail route, through the same `visibility(req)` — so an employee, holding none of the three
//      viewer keys, gets no salary, no insurance file and no officer profile. A second DTO shape
//      would be a second redaction rule to keep in step with this one, which is how they drift.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
/** Comments explain these rules at length; they must not be able to satisfy them. */
const code = (file: string): string =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

describe('GET /hr/employees/me', () => {
  it('is authenticated and NOT permission-gated', () => {
    const routes = code('employee.routes.ts');
    const line = routes
      .split('\n')
      .find((l) => l.includes("'/me'"));
    expect(line, 'the route is gone').toBeDefined();
    expect(line).toContain('authenticate');
    expect(line, 'an employee holds no employee.view — gating this locks them out of their own file').not.toContain('authorize');
  });

  it('is declared BEFORE /:id, or `me` parses as an employee id', () => {
    const routes = code('employee.routes.ts');
    expect(routes.indexOf("'/me'")).toBeLessThan(routes.indexOf("'/:id'"));
  });

  it('redacts through the SAME visibility rule as the admin detail route', () => {
    const controller = code('employee.controller.ts');
    const at = controller.indexOf('getMyEmployeeProfile');
    expect(at, 'the handler is gone').toBeGreaterThan(-1);
    const body = controller.slice(at, controller.indexOf('};', at));
    expect(body, 'the caller’s own permissions decide what is in the DTO').toContain(
      'visibility(req)',
    );
    expect(body, 'the id comes from the token, never from the request').not.toContain('params');
  });

  it('resolves the employee from the TOKEN, through the shared lookup', () => {
    const service = code('employee.service.ts');
    const at = service.indexOf('async getMine(');
    expect(at, 'the service method is gone').toBeGreaterThan(-1);
    const body = service.slice(at, service.indexOf('\n  }', at));
    // The same lookup `listMine` uses for loans — one answer to "which employee is this account".
    expect(body).toContain('findByUserIdSystem');
    // A login that is not an employee gets a 404, not an empty file.
    expect(body).toContain('NotFoundError');
  });
});

describe('the self-profile SCREEN', () => {
  const WEB = resolve(HERE, '../../../../../../web/src');
  const web = (file: string): string => readFileSync(resolve(WEB, file), 'utf8');

  it('sits outside the employee.view guard', () => {
    // The route subtree below it IS the registry. A self page inside that guard is unreachable by
    // the people it is for.
    const routes = web('modules/hr/employee-management/routes.tsx');
    expect(routes.indexOf('path="me"')).toBeLessThan(routes.indexOf('permission="employee.view"'));
  });

  it('reads /me, so there is no id in it to point at somebody else', () => {
    const page = web('modules/hr/employee-management/employees/pages/MyProfilePage.tsx');
    expect(page).toContain('useMyEmployeeProfile()');
    expect(page).not.toContain('useParams');
  });

  it('passes the server’s redaction flag through instead of deciding for itself', () => {
    const page = web('modules/hr/employee-management/employees/pages/MyProfilePage.tsx');
    expect(page).toContain('compensationVisible={employee.compensationVisible}');
  });
});
