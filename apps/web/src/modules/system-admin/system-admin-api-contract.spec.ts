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
const USER_ROUTES = read('platform/users/user.routes.ts');
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

describe('this slice adds no server surface', () => {
  // The whole premise of the phase: a UI over endpoints that already exist. If a later edit needs
  // a new endpoint, that is a decision to take deliberately, not one to discover in review.
  it('calls only platform endpoints that predate this module', () => {
    const paths = [...CLIENT.matchAll(/`(\/[a-z-]+)\//g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    );
    expect(new Set(paths)).toEqual(new Set(['/platform']));
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
