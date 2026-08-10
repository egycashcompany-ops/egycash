// The account boundary, checked at the schema — the layer that decides what a caller may even ask
// for.
//
// The rule under test was reachable until SA-2: `CreateUserSchema` required neither identifier, so
// a record that no `findByIdentifier` branch can ever match was creatable through the public API
// and looked entirely normal in every list. A schema is the right place for it on CREATE, because
// the answer depends only on the request; on UPDATE it cannot live here at all, and the paired
// service test proves that half.
import { describe, expect, it } from 'vitest';
import { CreateUserSchema, UpdateUserSchema } from './users.js';

const NAMES = {
  firstName: { ar: 'أحمد', en: 'Ahmed' },
  lastName: { ar: 'علي', en: 'Ali' },
};

describe('CreateUserSchema — an account must be reachable', () => {
  it('accepts a username alone', () => {
    const parsed = CreateUserSchema.safeParse({ ...NAMES, username: 'ahmed.ali' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.username).toBe('ahmed.ali');
  });

  it('accepts an email alone', () => {
    expect(CreateUserSchema.safeParse({ ...NAMES, email: 'a@ecms.local' }).success).toBe(true);
  });

  it('accepts both', () => {
    expect(
      CreateUserSchema.safeParse({ ...NAMES, email: 'a@ecms.local', username: 'ahmed' }).success,
    ).toBe(true);
  });

  it('refuses neither, and says which field to fill', () => {
    const parsed = CreateUserSchema.safeParse(NAMES);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(['username']);
      expect(parsed.error.issues[0]?.message).toMatch(/login identifier/);
    }
  });

  it('still enforces the username shape', () => {
    // Three characters minimum, starting alphanumeric — the login resolver and the unique index
    // both depend on this being a stable, comparable string.
    expect(CreateUserSchema.safeParse({ ...NAMES, username: 'ab' }).success).toBe(false);
    expect(CreateUserSchema.safeParse({ ...NAMES, username: '.leading' }).success).toBe(false);
    expect(CreateUserSchema.safeParse({ ...NAMES, username: 'a b' }).success).toBe(false);
  });

  it('defaults the placement to nothing rather than inventing one', () => {
    const parsed = CreateUserSchema.parse({ ...NAMES, username: 'ahmed.ali' });
    expect(parsed.organization).toEqual({
      branchId: null,
      departmentId: null,
      sectionId: null,
      jobTitleId: null,
    });
  });

  it('rejects an unknown key rather than ignoring it', () => {
    expect(
      CreateUserSchema.safeParse({ ...NAMES, username: 'ahmed.ali', status: 'active' }).success,
    ).toBe(false);
  });
});

describe('UpdateUserSchema', () => {
  it('allows clearing the email — whether that is legal depends on stored state', () => {
    // The schema cannot know whether a username exists, so it permits the shape and the service
    // refuses the ones that would leave the account unreachable.
    expect(UpdateUserSchema.safeParse({ email: null, version: 0 }).success).toBe(true);
  });

  it('does not allow clearing the username', () => {
    // Asymmetric on purpose: an account reached only by email keeps working when the username is
    // absent, and there is no case for removing one — only for changing it.
    expect(UpdateUserSchema.safeParse({ username: null, version: 0 }).success).toBe(false);
  });

  it('rejects employeeId — the employee link is HR’s to write, not this endpoint’s', () => {
    const parsed = UpdateUserSchema.safeParse({
      employeeId: '64b1f0dddddddddddddddd01',
      version: 0,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects the fields that have their own endpoints', () => {
    for (const body of [
      { status: 'active', version: 0 },
      { passwordHash: 'x', version: 0 },
      { totpEnabled: true, version: 0 },
    ]) {
      expect(UpdateUserSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('requires the version — an edit without one cannot be concurrency-checked', () => {
    expect(UpdateUserSchema.safeParse({ locale: 'ar' }).success).toBe(false);
  });
});
