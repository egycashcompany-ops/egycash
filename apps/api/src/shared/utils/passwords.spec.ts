import { describe, expect, it } from 'vitest';
import { hashPassword, passwordPolicyViolation, verifyPassword } from './passwords';

describe('passwordPolicyViolation', () => {
  const policy = { minLength: 10, requireComplexity: true };

  it('accepts a compliant password', () => {
    expect(passwordPolicyViolation('Str0ng#Pass!', policy)).toBeNull();
  });

  it('rejects short passwords', () => {
    expect(passwordPolicyViolation('S#0rt', policy)).toMatch(/at least 10/);
  });

  it.each([
    ['no digits', 'NoDigits##Here'],
    ['no symbols', 'NoSymbols123AB'],
    ['no upper case', 'nouppercase#123'],
    ['no lower case', 'NOLOWERCASE#123'],
  ])('rejects %s', (_label, password) => {
    expect(passwordPolicyViolation(password, policy)).toMatch(/must contain/);
  });

  it('skips complexity when disabled', () => {
    expect(
      passwordPolicyViolation('alllowercase', { minLength: 10, requireComplexity: false }),
    ).toBeNull();
  });
});

describe('argon2id hashing (ADR-006)', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('Str0ng#Pass!');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'Str0ng#Pass!')).toBe(true);
    expect(await verifyPassword(hash, 'WrongPass#1')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});
