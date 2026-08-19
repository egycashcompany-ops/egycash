// The customer portal's shape, asserted against its own source.
//
// These are structural tests on purpose. The behavioural half — that customer A never sees customer
// B's metal — needs a database and lives in `tests/integration/gold-portal.spec.ts`. What is
// checkable without one is the set of properties that a future edit could quietly lose, and each of
// them is load-bearing:
//
//   · the router has no write route to be reached, even if the platform gate ever changed;
//   · every route is guarded by both the grant and the customer binding;
//   · the confinement type is minted in exactly one place;
//   · nothing a customer receives carries a field that belongs to us or to another customer.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = join(process.cwd(), 'apps/api/src/modules/gold');
const read = (relative: string): string => readFileSync(join(here, relative), 'utf8');

const routes = read('portal/portal.routes.ts');
const reads = read('portal/portal.reads.ts');
const mappers = read('portal/portal.mappers.ts');
const contracts = readFileSync(
  join(process.cwd(), 'packages/contracts/src/modules/gold-portal.ts'),
  'utf8',
);

/** Strip comments so a rule is never satisfied — or broken — by prose about it. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the portal router is read-only', () => {
  it('declares no write route at all', () => {
    expect(code(routes)).not.toMatch(/router\.(post|put|patch|delete)\s*\(/);
  });

  it('declares only GETs — `use` for the guards, `get` for everything else', () => {
    const verbs = [...code(routes).matchAll(/router\.([a-z]+)\s*\(/g)].map((m) => m[1]);
    expect(verbs.length).toBeGreaterThan(0);
    expect([...new Set(verbs)].sort()).toEqual(['get', 'use']);
  });
});

describe('every portal route is guarded', () => {
  it('applies authenticate, the portal grant and the customer binding, in that order', () => {
    expect(code(routes)).toMatch(
      /router\.use\(\s*authenticate,\s*authorize\('goldPortal\.view'\),\s*requireGoldPortal,?\s*\)/,
    );
  });

  it('guards them on the router, not per route — so a new route cannot be added unguarded', () => {
    const perRoute = code(routes).match(/router\.get\([^)]*authenticate/g) ?? [];
    expect(perRoute).toHaveLength(0);
  });
});

describe('the confinement type has one producer', () => {
  it('is cast nowhere but in the middleware that proves the binding', () => {
    const scope = code(read('portal/portal-scope.ts'));
    expect([...scope.matchAll(/as PortalCompany/g)]).toHaveLength(1);
  });

  it('is what every read takes as its first parameter', () => {
    const exported = [...code(reads).matchAll(/export const (\w+) = async (?:<T>)?\(([^)]*)\)/gs)];
    expect(exported.length).toBeGreaterThan(5);
    for (const [, name, params] of exported) {
      expect(params, name).toMatch(/company: PortalCompany/);
    }
  });
});

describe('the reads cannot be widened', () => {
  it('composes the company clause with $and, never by spreading the caller filter', () => {
    expect(code(reads)).toMatch(/\$and:\s*\[\s*\{\s*isDeleted: false, companyId:/);
    expect(code(reads)).not.toMatch(/\.\.\.extra/);
  });

  it('shows confirmed documents only', () => {
    expect(code(reads)).toMatch(/const CONFIRMED = \{ status: 'confirmed' \}/);
    // Every document list uses it; the three that must are receiving, delivery and transfers.
    expect([...code(reads).matchAll(/CONFIRMED/g)].length).toBeGreaterThanOrEqual(4);
  });
});

describe('what a customer receives', () => {
  /**
   * The fields gold's portal handed out because it returned whole documents. Each one is either
   * ours (how WE handled the paper), or another customer's.
   */
  const FORBIDDEN = [
    'supervisor1',
    'supervisor2',
    'teamLeader',
    'vehicleId',
    'vehiclePlate',
    'printCount',
    'createdBy',
    'updatedBy',
    'branchId',
    'notes',
    'history',
    'deliveredByUs',
  ];

  it('names none of the fields that belong to us or to somebody else', () => {
    const surface = code(contracts);
    for (const field of FORBIDDEN) {
      expect(surface, field).not.toMatch(new RegExp(`\\b${field}\\b\\s*[?:]`));
    }
  });

  it('builds its DTOs field by field rather than spreading a document outward', () => {
    expect(code(mappers)).not.toMatch(/\.\.\.doc/);
  });

  it('never declares a company, fund or branch parameter a caller could send', () => {
    // Sliced from the RAW file — the section markers are comments, and `code()` strips those.
    const start = contracts.indexOf('// ── Queries');
    const end = contracts.indexOf('// ── Portal account administration');
    expect(start, 'query section marker').toBeGreaterThan(-1);
    expect(end, 'account section marker').toBeGreaterThan(start);
    // The staff-side schemas below the second marker DO take a companyId; only the customer's own
    // query schemas are in scope here.
    expect(code(contracts.slice(start, end))).not.toMatch(/companyId|funds|branchId/);
  });
});
