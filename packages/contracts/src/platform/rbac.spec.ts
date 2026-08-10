// Contract-boundary rules for role assignments.
//
// The PATCH is where an optimistic-concurrency mistake would be invisible. A validity window is
// exactly the field two administrators reach for at the same moment — one extending a grant that is
// about to lapse, the other ending it early — and without a version the second write silently
// undoes the first, leaving no trace that anything was overwritten. So `version` is REQUIRED here,
// not optional-with-a-fallback: a client that forgets it is rejected at the boundary rather than
// served a last-write-wins update.
//
// The other half is what the PATCH refuses to accept. Changing the role, the account or the reach
// is not an edit to a grant — it is a different grant, which is a revocation and a new assignment
// — and `.strict()` is what turns "not declared" into "rejected" rather than "silently ignored".
import { describe, expect, it } from 'vitest';
import { CreateRoleAssignmentSchema, UpdateRoleAssignmentSchema } from './rbac.js';

const OID = '507f1f77bcf86cd799439011';

describe('UpdateRoleAssignmentSchema — moving a window is version-checked', () => {
  it('accepts a window change carrying the version it was read at', () => {
    const parsed = UpdateRoleAssignmentSchema.safeParse({ validTo: '2030-01-01', version: 4 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.version).toBe(4);
  });

  it('rejects a body with no version — the last-write-wins shape', () => {
    expect(UpdateRoleAssignmentSchema.safeParse({ validTo: '2030-01-01' }).success).toBe(false);
  });

  it('rejects a negative or fractional version', () => {
    expect(UpdateRoleAssignmentSchema.safeParse({ validTo: null, version: -1 }).success).toBe(false);
    expect(UpdateRoleAssignmentSchema.safeParse({ validTo: null, version: 1.5 }).success).toBe(false);
  });

  it('accepts null to clear a bound — an open-ended grant is expressible', () => {
    const parsed = UpdateRoleAssignmentSchema.safeParse({ validTo: null, version: 0 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.validTo).toBeNull();
  });

  it('rejects a body that changes nothing rather than accepting a silent no-op', () => {
    expect(UpdateRoleAssignmentSchema.safeParse({ version: 2 }).success).toBe(false);
  });

  it.each([['roleId'], ['userId'], ['scope'], ['branchId']])(
    'refuses %s — that is a different grant, not an edit',
    (field) => {
      const body: Record<string, unknown> = { validTo: '2030-01-01', version: 1 };
      body[field] = field === 'scope' ? 'organization' : OID;
      expect(UpdateRoleAssignmentSchema.safeParse(body).success).toBe(false);
    },
  );
});

describe('CreateRoleAssignmentSchema — a grant’s window must be a window', () => {
  it('refuses an end date at or before the start', () => {
    const body = { userId: OID, roleId: OID, scope: 'own', validFrom: '2030-06-01', validTo: '2030-01-01' };
    expect(CreateRoleAssignmentSchema.safeParse(body).success).toBe(false);
  });

  it('accepts an open-ended grant', () => {
    expect(
      CreateRoleAssignmentSchema.safeParse({ userId: OID, roleId: OID, scope: 'branch' }).success,
    ).toBe(true);
  });

  it('refuses an unknown scope', () => {
    expect(
      CreateRoleAssignmentSchema.safeParse({ userId: OID, roleId: OID, scope: 'everything' }).success,
    ).toBe(false);
  });
});
