// A route with a path parameter must go through `validate()`.
//
// This is not a style rule. `validated(req)` returns `req.validated`, and only the `validate()`
// middleware puts it there — so a handler that reads `const { params } = validated(req)` on a route
// without the middleware destructures `undefined` and throws. Every call answers 500. Nothing else
// in the build notices: the route compiles, the types are honest about what the handler WANTS, and
// no other route is affected, so a passing suite proves nothing about this one.
//
// That is how DELETE /hr/recruitment-form/links/:sourceId shipped broken — revoking an application
// link showed "Unexpected error" every time. It was the only one of 182 path-parameter routes
// missing the middleware; the convention was already unanimous, it just had no way to be enforced.
//
// Scanning the source is the check that matches the failure: the defect lives in the ROUTE TABLE,
// not in any behaviour a request-level test would reach without knowing to look here.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const routeFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name.endsWith('.routes.ts') ? [full] : [];
  });

/** One `router.<method>('<path>', ...);` registration. */
const REGISTRATION = /router\.(get|post|patch|put|delete)\(\s*'([^']*)'([\s\S]*?)\n\s*\);/g;

interface Route {
  where: string;
  method: string;
  path: string;
  handlers: string;
}

const routes: Route[] = routeFiles(SRC).flatMap((file) => {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(REGISTRATION)].map((m) => ({
    where: `${relative(SRC, file)}:${text.slice(0, m.index).split('\n').length}`,
    method: (m[1] ?? '').toUpperCase(),
    path: m[2] ?? '',
    handlers: m[3] ?? '',
  }));
});

describe('routes that take a path parameter', () => {
  it('are found at all — a scan that matches nothing would pass silently', () => {
    expect(routes.length).toBeGreaterThan(200);
    expect(routes.filter((r) => r.path.includes(':')).length).toBeGreaterThan(100);
  });

  it('every one of them validates that parameter', () => {
    const unvalidated = routes
      .filter((r) => r.path.includes(':') && !r.handlers.includes('validate('))
      .map((r) => `${r.where}  ${r.method} ${r.path}`);
    expect(unvalidated, 'these hand `undefined` to `validated(req)` and answer 500').toEqual([]);
  });

  it('including the one this spec was written for', () => {
    const revoke = routes.find(
      (r) => r.method === 'DELETE' && r.path === '/links/:sourceId',
    );
    expect(revoke, 'the revoke route moved or was renamed').toBeDefined();
    expect(revoke?.handlers).toContain('validate({ params: RecruitmentFormSourceParamSchema })');
  });
});
