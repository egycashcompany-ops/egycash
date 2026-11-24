// Organization-scope authority: only an organization-scope holder of the key passes; every other
// scope, and a key not held at all, is a 403 whose message names the key and the reason.
import { type DataScope } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../errors';
import { type AuthContext } from '../types';
import { assertOrganizationScope } from './org-authority';

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

describe('assertOrganizationScope', () => {
  it('passes an organization-scope holder', () => {
    expect(() =>
      assertOrganizationScope(context({ 'x.manage': 'organization' }), 'x.manage', 'r'),
    ).not.toThrow();
  });

  it.each<DataScope>(['branch', 'department', 'section', 'own'])('refuses %s scope', (scope) => {
    expect(() => assertOrganizationScope(context({ 'x.manage': scope }), 'x.manage', 'r')).toThrow(
      ForbiddenError,
    );
  });

  it('refuses a key not held, naming the key and the reason', () => {
    let thrown: unknown;
    try {
      assertOrganizationScope(context({}), 'x.manage', 'a catalog is company-wide');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ForbiddenError);
    expect((thrown as ForbiddenError).httpStatus).toBe(403);
    expect((thrown as ForbiddenError).message).toBe(
      'x.manage must be held at organization scope — a catalog is company-wide',
    );
  });
});
