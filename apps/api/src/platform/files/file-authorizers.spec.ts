// The registry's own contract (ADR-023), tested without a database, a request or a clock.
//
// Everything here is about the ASYMMETRY that makes the slice safe to ship: an entity type nobody
// claimed behaves exactly as before, and one that IS claimed denies on every failure mode. Getting
// that backwards in either direction is the whole risk — fail-open on a guarded type is a leak,
// fail-closed on an unguarded one breaks HR, branding and OCR on the day this merges.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTHORIZER_TIMEOUT_MS,
  authorizeFileEntity,
  clearFileEntityAuthorizers,
  hasFileEntityAuthorizer,
  registerFileEntityAuthorizer,
} from './file-authorizers';
import { type AuthContext } from '../../shared/types';

const ctx = { userId: 'u1', permissions: {} } as unknown as AuthContext;
const ref = (moduleId: string, entityType: string, entityId = 'e1') => ({
  moduleId,
  entityType,
  entityId,
});

afterEach(() => clearFileEntityAuthorizers());

describe('the file entity authorizer registry', () => {
  it('leaves unclaimed entity types alone — the promise that keeps HR working', async () => {
    expect(hasFileEntityAuthorizer('hr', 'employeeFile')).toBe(false);
    await expect(authorizeFileEntity(ctx, ref('hr', 'employeeFile'), 'read')).resolves.toBe(true);
    await expect(authorizeFileEntity(ctx, ref('hr', 'employeeFile'), 'write')).resolves.toBe(true);
  });

  it('consults the module for a claimed type, and passes the entity and intent through', async () => {
    const authorize = vi.fn().mockResolvedValue(true);
    registerFileEntityAuthorizer('it', { entityType: 'ticket', authorize });
    await expect(authorizeFileEntity(ctx, ref('it', 'ticket', 'T7'), 'read')).resolves.toBe(true);
    expect(authorize).toHaveBeenCalledWith({ ctx, entityId: 'T7', intent: 'read' });
  });

  it('denies when the module says no', async () => {
    registerFileEntityAuthorizer('it', {
      entityType: 'ticket',
      authorize: async () => false,
    });
    await expect(authorizeFileEntity(ctx, ref('it', 'ticket'), 'read')).resolves.toBe(false);
  });

  it('denies when the authorizer THROWS — a broken module must not open the door', async () => {
    registerFileEntityAuthorizer('it', {
      entityType: 'ticket',
      authorize: async () => {
        throw new Error('database is down');
      },
    });
    await expect(authorizeFileEntity(ctx, ref('it', 'ticket'), 'read')).resolves.toBe(false);
  });

  it('denies when the authorizer exceeds its budget — a slow answer is not a yes', async () => {
    registerFileEntityAuthorizer('it', {
      entityType: 'ticket',
      authorize: () =>
        new Promise((resolve) => setTimeout(() => resolve(true), AUTHORIZER_TIMEOUT_MS * 4)),
    });
    await expect(authorizeFileEntity(ctx, ref('it', 'ticket'), 'read')).resolves.toBe(false);
  });

  it('scopes registration by module, so one module cannot answer for another', async () => {
    registerFileEntityAuthorizer('it', { entityType: 'ticket', authorize: async () => false });
    expect(hasFileEntityAuthorizer('it', 'ticket')).toBe(true);
    // Same entity TYPE, different module — untouched, and therefore unguarded.
    expect(hasFileEntityAuthorizer('hr', 'ticket')).toBe(false);
    await expect(authorizeFileEntity(ctx, ref('hr', 'ticket'), 'read')).resolves.toBe(true);
  });

  it('refuses a duplicate registration at BOOT rather than silently picking one', () => {
    registerFileEntityAuthorizer('it', { entityType: 'ticket', authorize: async () => true });
    expect(() =>
      registerFileEntityAuthorizer('it', { entityType: 'ticket', authorize: async () => false }),
    ).toThrow(/duplicate/i);
  });

  it('never caches a decision — a revoked grant takes effect on the next question', async () => {
    let allowed = true;
    registerFileEntityAuthorizer('it', {
      entityType: 'ticket',
      authorize: async () => allowed,
    });
    await expect(authorizeFileEntity(ctx, ref('it', 'ticket'), 'read')).resolves.toBe(true);
    allowed = false;
    await expect(authorizeFileEntity(ctx, ref('it', 'ticket'), 'read')).resolves.toBe(false);
  });
});
