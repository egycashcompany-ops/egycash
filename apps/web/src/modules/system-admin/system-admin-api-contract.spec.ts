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
const ROLE_CLIENT = readFileSync(resolve(HERE, 'roles/api/role-api.ts'), 'utf8');
const ROLES_LIST_PAGE = readFileSync(resolve(HERE, 'roles/pages/RolesListPage.tsx'), 'utf8');
const ROLE_DETAIL_PAGE = readFileSync(resolve(HERE, 'roles/pages/RoleDetailPage.tsx'), 'utf8');
const USER_ROLES_TAB = readFileSync(resolve(HERE, 'roles/components/UserRolesTab.tsx'), 'utf8');
const RBAC_ROUTES = read('platform/rbac/rbac.routes.ts');
const RBAC_SERVICE = read('platform/rbac/rbac.service.ts');
const RBAC_CONTRACT = readFileSync(
  resolve(HERE, '../../../../../packages/contracts/src/platform/rbac.ts'),
  'utf8',
);
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

describe('the roles client calls endpoints the RBAC routers declare', () => {
  // Both routers live in one file, so the verb+path pairs are read once and asked about together.
  const rbacEndpoints = declared(RBAC_ROUTES);

  it('mounts the three routers the roles screens target', () => {
    for (const prefix of [
      "'/platform/roles'",
      "'/platform/role-assignments'",
      "'/platform/permissions'",
    ]) {
      expect(APP, `app.ts does not mount ${prefix}`).toContain(prefix);
    }
  });

  it.each([
    ['get', '/'],
    ['get', '/:id'],
    ['post', '/'],
    ['patch', '/:id'],
    ['delete', '/:id'],
  ])('serves %s %s on the roles and assignments routers', (verb, path) => {
    expect(rbacEndpoints).toContain(`${verb} ${path}`);
  });

  // The one endpoint this phase ADDS. Without it the validity-window dialog would 404 at runtime
  // only, and the screen would look complete.
  it('declares the assignment PATCH the window dialog calls, gated by role.assign', () => {
    const block = /router\.patch\(\s*'\/:id',[\s\S]{0,300}?updateAssignment/.exec(RBAC_ROUTES)?.[0];
    expect(block, 'no PATCH /:id reaching updateAssignment').toBeDefined();
    expect(block).toContain("authorize('role.assign')");
    expect(ROLE_CLIENT).toContain('/platform/role-assignments/${id}');
  });

  it('calls no roles path the routers do not declare', () => {
    const called = [...ROLE_CLIENT.matchAll(/`\/platform\/(roles|role-assignments)(\/[^`$]*)?/g)]
      .flatMap((m) => {
        const raw = m[2];
        if (raw === undefined || raw === '') return ['/'];
        return [raw.replace(/\/\$\{id\}/, '/:id')];
      })
      .map((path) => (path.startsWith('/$') ? '/:id' : path));
    expect(called.length, 'the scan itself must not match nothing').toBeGreaterThan(4);
    const unknown = called.filter(
      (path) => ![...rbacEndpoints].some((endpoint) => endpoint.endsWith(` ${path}`)),
    );
    expect(unknown, 'the roles client calls an endpoint the API does not declare').toEqual([]);
  });

  it('sorts the roles list only by fields the service declares sortable', () => {
    // `BaseRepository.list` silently falls back to `createdAt` for an undeclared sort field, so a
    // sortable column the API cannot sort by looks interactive and does nothing.
    const listRoles = /async listRoles\([\s\S]*?\n {2}}/.exec(RBAC_SERVICE)?.[0] ?? '';
    const declaredSorts = new Set(
      (/sortableFields: \[([^\]]+)\]/.exec(listRoles)?.[1] ?? '')
        .split(',')
        .map((s) => s.trim().replace(/'/g, '')),
    );
    expect(declaredSorts.size, 'the scan found no sortable fields').toBeGreaterThan(0);
    const sortableColumns = [
      ...ROLES_LIST_PAGE.matchAll(/key: '([a-zA-Z.]+)',\s*\n\s*header:[^\n]*\n\s*sortable: true/g),
    ].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
    expect(sortableColumns.length, 'the scan itself must not match nothing').toBeGreaterThan(0);
    for (const key of sortableColumns) {
      expect(declaredSorts, `${key} is not sortable on the API`).toContain(key);
    }
  });

  // ADR-019 rule 5 again — the roles catalogue grows with every module and every administrator, so
  // a screen that asked for a bigger page to avoid paging is the pattern the ADR forbids. The
  // pickers ask for 8, which is a picker's page, not the list's.
  it('never raises the page size above the shared default', () => {
    const code = [ROLE_CLIENT, ROLES_LIST_PAGE, ROLE_DETAIL_PAGE, USER_ROLES_TAB]
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/pageSize:\s*(?:[5-9]\d|\d{3,})/);
  });

  // The whole point of decision R1: a bulk endpoint would have to re-implement the self-assignment
  // rule, the last-Super-Admin rule and the audit row, and would report one outcome for many
  // decisions. The client loops instead, and there is nothing on the server to call.
  it('has no bulk revoke endpoint to call', () => {
    for (const source of [ROLE_CLIENT, RBAC_ROUTES]) {
      expect(source).not.toMatch(/revoke-all|revokeAll\(|\/assignments['`]/);
    }
    // …and the screen that offers "revoke from everyone" drives the SINGLE revoke, in a loop.
    expect(ROLE_DETAIL_PAGE).toContain('revokeAllAssignments(');
    expect(ROLE_DETAIL_PAGE).toContain('revokeAssignment,');
    const loop = readFileSync(resolve(HERE, 'roles/lib/revoke-all.ts'), 'utf8');
    expect(loop).toContain('revokeOne(assignment.id)');
  });
});

describe('the assignment PATCH is version-checked at the contract boundary', () => {
  // The correction this phase turned on. Without `version` the endpoint is last-write-wins, and the
  // administrator whose change was overwritten is never told.
  it('requires a version in the update schema', () => {
    const schema = /export const UpdateRoleAssignmentSchema = z[\s\S]*?export type UpdateRoleAssignment/.exec(
      RBAC_CONTRACT,
    )?.[0];
    expect(schema, 'UpdateRoleAssignmentSchema not found').toBeDefined();
    expect(schema).toMatch(/version: z\.number\(\)\.int\(\)\.min\(0\)/);
    expect(schema).toContain('.strict()');
    // Not `.optional()` anywhere near the version — that would reintroduce the fallback.
    expect(schema).not.toMatch(/version:[^\n]*optional/);
  });

  it('sends the version it read, on every window change', () => {
    const dialog = readFileSync(
      resolve(HERE, 'roles/components/AssignmentWindowDialog.tsx'),
      'utf8',
    );
    expect(dialog).toContain('version: assignment.version');
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
