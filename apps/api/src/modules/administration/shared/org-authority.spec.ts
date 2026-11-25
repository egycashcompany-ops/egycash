// The master-data writes' authority (design §6.7, OD-04 A): only an organization-scope holder of
// the key passes; every narrower scope, and a key not held at all, is the shared check's 403 —
// asserted by its exact message, so a module-local copy of the rule would fail here.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DataScope } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { ADMINISTRATION_ORG_KEYS, assertAdministrationOrgAuthority } from './org-authority';

const HERE = dirname(fileURLToPath(import.meta.url));

const context = (permissions: Record<string, DataScope>): AuthContext => ({
  userId: '64a0000000000000000000aa',
  sessionId: 's',
  branchId: '64a000000000000000000001',
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions,
  permissionVersion: 1,
  isPrivileged: false,
});

const refusal = (run: () => void): ForbiddenError => {
  try {
    run();
  } catch (error) {
    return error as ForbiddenError;
  }
  throw new Error('expected a refusal');
};

describe('assertAdministrationOrgAuthority', () => {
  it('names the master-data write keys shipped so far: the catalog, and the items’ (P1a.2)', () => {
    expect(ADMINISTRATION_ORG_KEYS).toEqual([
      'administrationCatalog.manage',
      'administrationItem.create',
      'administrationItem.edit',
    ]);
  });

  it('passes an organization-scope holder', () => {
    expect(() =>
      assertAdministrationOrgAuthority(
        context({ 'administrationCatalog.manage': 'organization' }),
        'administrationCatalog.manage',
      ),
    ).not.toThrow();
  });

  it.each<DataScope>(['branch', 'department', 'section', 'own'])(
    'refuses %s scope with a 403',
    (scope) => {
      const error = refusal(() =>
        assertAdministrationOrgAuthority(
          context({ 'administrationCatalog.manage': scope }),
          'administrationCatalog.manage',
        ),
      );
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.httpStatus).toBe(403);
    },
  );

  it('judges each key on its own scope: an item creator company-wide is not an item editor', () => {
    const ctx = context({
      'administrationItem.create': 'organization',
      'administrationItem.edit': 'branch',
    });
    expect(() => assertAdministrationOrgAuthority(ctx, 'administrationItem.create')).not.toThrow();
    expect(
      refusal(() => assertAdministrationOrgAuthority(ctx, 'administrationItem.edit')),
    ).toBeInstanceOf(ForbiddenError);
  });

  it('refuses a key not held, through the shared check and its message', () => {
    const error = refusal(() =>
      assertAdministrationOrgAuthority(context({}), 'administrationCatalog.manage'),
    );
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toBe(
      'administrationCatalog.manage must be held at organization scope — master data is one register for the whole company',
    );
  });

  it('is a wrapper of the shared rule, not a copy of it', () => {
    const source = readFileSync(join(HERE, 'org-authority.ts'), 'utf8');
    expect(source).toContain("from '../../../shared/base/org-authority'");
    expect(source).not.toContain('scopeOf(');
  });
});
