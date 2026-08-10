// The controller must hand the caller's identity to the service on EVERY mutating path.
//
// This is the regression test for the one way the SA-3 escalation guards could be defeated without
// anybody noticing. The service's `actor` parameter is optional — deliberately, so the HR-only
// confinement reconciliation and the seeds can act as the SYSTEM, which has no request behind it
// and no human authority to exceed. The cost of that optionality is that a handler which simply
// FORGETS to pass `ctx` still compiles, still returns 200, and silently runs unguarded: an
// administrator could then mint a role carrying every key in the registry and assign it to
// themselves, and every integration test would still pass because they all go through the
// controller that does pass it.
//
// So each handler is invoked directly with a fake request and a fake context, and what is asserted
// is the argument the service actually received — not that the call succeeded.
import { type Request, type Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthContext } from '../../shared/types';

const ACTOR: AuthContext = {
  userId: '507f1f77bcf86cd799439011',
  sessionId: 'sess-1',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'en',
  permissions: { 'role.assign': 'organization', 'role.create': 'organization' },
  permissionVersion: 3,
  isPrivileged: false,
};

const roleDoc = { _id: 'role-1', roleId: 'role-1', userId: 'user-1' };

const createRole = vi.fn().mockResolvedValue(roleDoc);
const updateRole = vi.fn().mockResolvedValue(roleDoc);
const assignRole = vi.fn().mockResolvedValue(roleDoc);
const updateAssignment = vi.fn().mockResolvedValue(roleDoc);
const revokeAssignment = vi.fn().mockResolvedValue(undefined);

vi.mock('./rbac.service', () => ({
  rbacService: {
    createRole: (...args: unknown[]) => createRole(...args),
    updateRole: (...args: unknown[]) => updateRole(...args),
    assignRole: (...args: unknown[]) => assignRole(...args),
    updateAssignment: (...args: unknown[]) => updateAssignment(...args),
    revokeAssignment: (...args: unknown[]) => revokeAssignment(...args),
    getRole: vi.fn().mockResolvedValue(roleDoc),
    toRoleDto: (doc: unknown) => doc,
    toAssignmentDto: (doc: unknown) => doc,
  },
}));

vi.mock('../auth', () => ({ authContext: () => ACTOR }));

const controller = await import('./rbac.controller');

/** `validated()` reads what the validate middleware parked on the request. */
const req = (parts: { body?: unknown; params?: unknown; query?: unknown }): Request =>
  ({ validated: { body: parts.body, params: parts.params, query: parts.query } }) as unknown as Request;

/** Just enough of a response for `respond.ts` to write into; nothing here is asserted. */
const res = (): Response => {
  const sink = {
    status: () => sink,
    json: () => sink,
    location: () => sink,
    setHeader: () => sink,
    send: () => sink,
    end: () => sink,
  };
  return sink as unknown as Response;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('every mutating RBAC handler passes the authenticated actor to the service', () => {
  it('createRole', async () => {
    await controller.createRole(
      req({ body: { name: { ar: 'د', en: 'R' }, permissionKeys: ['user.view'] } }),
      res(),
    );
    expect(createRole).toHaveBeenCalledTimes(1);
    // (input, by, actor) — the third argument is the guard's input.
    expect(createRole.mock.calls[0]?.[2]).toBe(ACTOR);
    expect(createRole.mock.calls[0]?.[1]).toBe(ACTOR.userId);
  });

  it('updateRole', async () => {
    await controller.updateRole(req({ body: { version: 0 }, params: { id: 'role-1' } }), res());
    expect(updateRole).toHaveBeenCalledTimes(1);
    expect(updateRole.mock.calls[0]?.[3]).toBe(ACTOR);
  });

  it('createAssignment', async () => {
    await controller.createAssignment(
      req({ body: { userId: 'user-1', roleId: 'role-1', scope: 'own' } }),
      res(),
    );
    expect(assignRole).toHaveBeenCalledTimes(1);
    expect(assignRole.mock.calls[0]?.[2]).toBe(ACTOR);
  });

  it('updateAssignment', async () => {
    await controller.updateAssignment(
      req({ body: { validTo: null, version: 0 }, params: { id: 'assignment-1' } }),
      res(),
    );
    expect(updateAssignment).toHaveBeenCalledTimes(1);
    expect(updateAssignment.mock.calls[0]?.[3]).toBe(ACTOR);
  });

  it('revokeAssignment', async () => {
    await controller.revokeAssignment(req({ params: { id: 'assignment-1' } }), res());
    expect(revokeAssignment).toHaveBeenCalledTimes(1);
    expect(revokeAssignment.mock.calls[0]?.[2]).toBe(ACTOR);
  });

  // The optionality exists for the SYSTEM, not for a principal. A handler that decided to skip the
  // actor for some caller — a super-admin, a service account — would reopen exactly the hole the
  // guards close, so no handler may pass anything but the context it was given.
  it('passes no substitute for the actor on any path', async () => {
    await controller.createRole(
      req({ body: { name: { ar: 'د', en: 'R' }, permissionKeys: ['user.view'] } }),
      res(),
    );
    await controller.createAssignment(
      req({ body: { userId: 'user-1', roleId: 'role-1', scope: 'own' } }),
      res(),
    );
    for (const call of [...createRole.mock.calls, ...assignRole.mock.calls]) {
      expect(call[2], 'a mutating handler reached the service without the caller').not.toBeUndefined();
      expect(call[2]).toBe(ACTOR);
    }
  });
});
