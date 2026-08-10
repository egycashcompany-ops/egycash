// The UI→API seam, checked against the API itself.
//
// This suite exists because of the one class of bug nothing else here catches. The integration
// tests prove the backend works; the component tests prove the screens render. What neither proves
// is that the screens call the endpoints the backend actually serves — a typo in a path, a wrong
// verb, or a sort field the API rejects all typecheck, lint and render perfectly, and fail only
// when a real administrator clicks the button.
//
// It matters more for this module than for any other, because System Administration adds NO
// backend: every call it makes is to an endpoint that already exists and is owned elsewhere. A
// source-level check is the whole safety net, and it needs no database, no server and no network.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = resolve(HERE, '../../../../api/src');

const read = (path: string): string => readFileSync(resolve(API_SRC, path), 'utf8');

const CLIENT = readFileSync(resolve(HERE, 'users/api/user-api.ts'), 'utf8');
const QUERIES = readFileSync(resolve(HERE, 'users/api/user-queries.ts'), 'utf8');
const LIST_PAGE = readFileSync(resolve(HERE, 'users/pages/UsersListPage.tsx'), 'utf8');
const FORM = readFileSync(resolve(HERE, 'users/components/UserFormDialog.tsx'), 'utf8');
const USERS_CONTRACT = readFileSync(
  resolve(HERE, '../../../../../packages/contracts/src/platform/users.ts'),
  'utf8',
);
const USER_ROUTES = read('platform/users/user.routes.ts');
const EMPLOYEE_ROUTES = read('modules/hr/employee-management/employees/employee.routes.ts');
const AUDIT_ROUTES = read('platform/audit/audit.routes.ts');
const USER_SERVICE = read('platform/users/user.service.ts');
const APP = read('app.ts');

/** The verb+path pairs a router declares, e.g. `post /:id/status`. */
const declared = (routes: string): Set<string> => {
  const found = new Set<string>();
  for (const match of routes.matchAll(/router\.(get|post|patch|delete)\(\s*'([^']+)'/g)) {
    found.add(`${match[1]} ${match[2]}`);
  }
  return found;
};

describe('every endpoint the System Administration client calls exists on the API', () => {
  const userEndpoints = declared(USER_ROUTES);
  const auditEndpoints = declared(AUDIT_ROUTES);

  it('mounts the routers the client targets', () => {
    for (const prefix of ["'/platform/users'", "'/platform/timeline'"]) {
      expect(APP, `app.ts does not mount ${prefix}`).toContain(prefix);
    }
  });

  it.each([
    ['get', '/'],
    ['get', '/:id'],
    ['post', '/:id/status'],
    ['post', '/:id/reset-password'],
    ['post', '/:id/credentials/resend'],
    ['post', '/:id/totp/reset'],
    ['post', '/:id/totp/require'],
    ['delete', '/:id/sessions'],
    ['post', '/'],
    ['patch', '/:id'],
    ['post', '/:id/unlock'],
  ])('serves %s /platform/users%s', (verb, path) => {
    expect(userEndpoints).toContain(`${verb} ${path}`);
  });

  it('serves the timeline the activity tab reads', () => {
    expect(auditEndpoints).toContain('get /');
    expect(CLIENT).toContain('/platform/timeline');
  });

  // A path typed into the client that no router declares would 404 at runtime only.
  it('calls no /platform/users path the router does not declare', () => {
    const called = [...CLIENT.matchAll(/`\/platform\/users(\/[^`$]*)?/g)].flatMap((m) => {
      const raw = m[1];
      if (raw === undefined || raw === '') return [];
      // `${id}` in the template stands for the router's `:id` segment.
      return [raw.replace(/\/\$\{id\}/, '/:id')];
    });
    const unknown = called.filter(
      (path) => ![...userEndpoints].some((endpoint) => endpoint.endsWith(` ${path}`)),
    );
    expect(unknown, 'client calls an endpoint the API does not declare').toEqual([]);
  });
});

describe('the client stays inside what the API accepts', () => {
  // `BaseRepository.list` silently falls back to `createdAt` for an undeclared sort field, so a
  // sortable column the API cannot sort by looks interactive and does nothing.
  it('marks a column sortable only when the users service declares that sort field', () => {
    const declaredSorts = new Set(
      (/sortableFields: \[([^\]]+)\]/.exec(USER_SERVICE)?.[1] ?? '')
        .split(',')
        .map((s) => s.trim().replace(/'/g, '')),
    );
    const sortableColumns = [...LIST_PAGE.matchAll(/key: '([a-zA-Z]+)',\s*\n\s*header:[^\n]*\n\s*sortable: true/g)]
      .flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
    expect(sortableColumns.length, 'the scan itself must not match nothing').toBeGreaterThan(0);
    for (const key of sortableColumns) {
      expect(declaredSorts, `${key} is not a sortable field on the API`).toContain(key);
    }
  });

  // ADR-019 rule 5. The list is paginated by the server; a client that asked for a bigger page to
  // avoid paging is the exact pattern the ADR forbids, and MAX_PAGE_SIZE is 100 anyway.
  it('never raises the page size above the shared default', () => {
    const code = [CLIENT, QUERIES, LIST_PAGE].join('\n').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/pageSize:\s*(?:[5-9]\d|\d{3,})/);
    expect(code).toContain('DEFAULT_PAGE_SIZE = 25');
  });
});

describe('the module talks only to the surfaces it is allowed to', () => {
  // Two prefixes, and the second one is a decision rather than a convenience. Decision E1 puts the
  // employee ↔ login relationship in HR's hands, so System Administration ASKS HR to write it. Any
  // other `/hr` path appearing here would be this module reaching into someone else's business
  // logic, which is exactly what E1 exists to prevent.
  it('calls the platform, plus HR for the employee link and nothing else', () => {
    const prefixes = [...CLIENT.matchAll(/`(\/[a-z-]+)\//g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    );
    expect(new Set(prefixes)).toEqual(new Set(['/platform', '/hr']));
  });

  it('uses HR only for the employee register, and only its link sub-resource', () => {
    const hrResources = new Set(
      [...CLIENT.matchAll(/`\/hr\/([a-z-]+)/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]])),
    );
    expect(hrResources, 'the scan itself must not match nothing').not.toEqual(new Set());
    expect(hrResources).toEqual(new Set(['employees']));
    // The only sub-resource: nothing here touches hiring, contracts, leave or personnel actions.
    const subResources = new Set(
      [...CLIENT.matchAll(/`\/hr\/employees\/\$\{[a-zA-Z]+\}\/([a-z-]+)/g)].flatMap((m) =>
        m[1] === undefined ? [] : [m[1]],
      ),
    );
    expect(subResources).toEqual(new Set(['user-link']));
  });

  it('serves the HR link pair the client calls', () => {
    const hrEndpoints = declared(EMPLOYEE_ROUTES);
    expect(hrEndpoints).toContain('post /:id/user-link');
    expect(hrEndpoints).toContain('delete /:id/user-link');
  });

  // Roles, sessions and effective permissions are later phases with their own endpoints; calling
  // them here would ship the phase early through the back door.
  it('does not reach for a later phase’s endpoints', () => {
    for (const path of [
      '/platform/roles',
      '/platform/role-assignments',
      '/platform/permissions',
      '/platform/settings',
      'effective-permissions',
    ]) {
      expect(CLIENT, `${path} belongs to a later phase`).not.toContain(path);
    }
  });
});

describe('the employee link is HR-owned and unwritable from here', () => {
  // The invariant decision E1 turns on. `user.employeeId` is the AUTHORITY for the link and carries
  // the unique index; if the update schema accepted it, System Administration would become a second
  // writer that knows about only one side of a two-sided fact.
  it('keeps employeeId out of the user update schema', () => {
    const schema = /export const UpdateUserSchema = z[\s\S]*?\.strict\(\)/.exec(USERS_CONTRACT)?.[0];
    expect(schema, 'UpdateUserSchema not found').toBeDefined();
    expect(schema).not.toContain('employeeId');
    // `.strict()` is what turns "not declared" into "rejected" rather than "ignored".
    expect(schema).toContain('.strict()');
  });

  it('never sends employeeId in a request body', () => {
    // Bodies are object literals. `employeeId` may appear as a parameter name and as a PATH segment
    // of the HR call — what it must never be is a key the client hands to an endpoint, because the
    // only writer of that field is HR's service.
    // The lookbehind excludes `${employeeId}` — a path interpolation, not an object key.
    const code = CLIENT.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/(?<!\$)\{\s*employeeId/);
  });

  // The two writers of `user.employeeId` are the creation path (HR provisioning passes it) and the
  // link pair. Both live in the users service, called by HR — never by a route.
  it('exposes no platform route that writes the link', () => {
    expect(USER_ROUTES).not.toContain('employee');
  });
});

describe('an account cannot be created without a way to sign in', () => {
  // The P1 review found this reachable: `CreateUserSchema` required neither identifier, so a record
  // that no `findByIdentifier` branch can ever match was creatable and looked entirely normal.
  it('requires an email or a username at the contract boundary', () => {
    const schema = /export const CreateUserSchema = z[\s\S]*?export type CreateUser/.exec(
      USERS_CONTRACT,
    )?.[0];
    expect(schema).toContain('username');
    expect(schema).toContain('.refine(hasLoginIdentifier');
  });

  it('states the same rule in the form before the round-trip', () => {
    expect(FORM).toContain('identifierRequired');
  });
});
