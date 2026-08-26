// The resolver seam, and the property it exists to protect.
//
// A sign-in screen that answers differently for "no such person" and "that person was refused" is
// a screen anybody can use to ask the company whether a national ID belongs to somebody who
// applied here and was turned down. The platform is kept structurally incapable of telling them
// apart: the resolver returns a user or null, and every kind of nothing looks the same.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPortalIdentityResolvers,
  registerPortalIdentityResolver,
  resolvePortalIdentity,
} from './portal-identities';
import { type UserDoc } from '../users';

const someUser = { _id: 'u1' } as unknown as UserDoc;

describe('resolving a portal identity', () => {
  beforeEach(() => clearPortalIdentityResolvers());

  it('asks the module that registered the subject type', async () => {
    registerPortalIdentityResolver('applicant', async (q) =>
      q.identifier === '29001011234567' && q.phone === '01012345678' ? someUser : null,
    );
    expect(
      await resolvePortalIdentity('applicant', {
        identifier: '29001011234567',
        phone: '01012345678',
      }),
    ).toBe(someUser);
  });

  it('answers null for a subject type nobody registered — fail closed', async () => {
    expect(await resolvePortalIdentity('applicant', { identifier: 'x', phone: 'y' })).toBeNull();
  });

  it('answers null when the module says no', async () => {
    registerPortalIdentityResolver('applicant', async () => null);
    expect(await resolvePortalIdentity('applicant', { identifier: 'x', phone: 'y' })).toBeNull();
  });

  it('answers null when the module THROWS — a broken module must not change what the screen says', async () => {
    registerPortalIdentityResolver('applicant', async () => {
      throw new Error('the database is on fire');
    });
    await expect(
      resolvePortalIdentity('applicant', { identifier: 'x', phone: 'y' }),
    ).resolves.toBeNull();
  });

  it('gives every kind of nothing the same shape', async () => {
    // Unregistered, refused, and broken are three different worlds inside the module and exactly
    // one answer out here. That is the leak this seam is built to prevent.
    registerPortalIdentityResolver('refused', async () => null);
    registerPortalIdentityResolver('broken', async () => {
      throw new Error('boom');
    });
    const q = { identifier: 'x', phone: 'y' };
    const answers = await Promise.all([
      resolvePortalIdentity('unregistered', q),
      resolvePortalIdentity('refused', q),
      resolvePortalIdentity('broken', q),
    ]);
    expect(answers).toEqual([null, null, null]);
  });

  it('keeps subject types apart', async () => {
    registerPortalIdentityResolver('applicant', async () => someUser);
    expect(await resolvePortalIdentity('goldCompany', { identifier: 'x', phone: 'y' })).toBeNull();
  });
});
