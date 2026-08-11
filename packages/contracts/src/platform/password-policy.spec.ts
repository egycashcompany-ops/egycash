// The password rules — the definition both the server's refusal and the client's checklist read.
//
// These used to live only in the API, where they were tested through `passwordPolicyViolation`'s
// message. Now that a screen lists them, each rule needs to be right ON ITS OWN: a checklist that
// turns a line green while the server still refuses is worse than no checklist, and only a per-rule
// assertion catches that.
import { describe, expect, it } from 'vitest';
import {
  PASSWORD_RULES,
  evaluatePasswordPolicy,
  passwordRulesFor,
  passwordSatisfiesPolicy,
  type PasswordPolicyDto,
  type PasswordRule,
} from './password-policy.js';

const strict: PasswordPolicyDto = { minLength: 10, requireComplexity: true };
const lengthOnly: PasswordPolicyDto = { minLength: 10, requireComplexity: false };

const met = (password: string, policy = strict): Record<string, boolean> =>
  Object.fromEntries(evaluatePasswordPolicy(password, policy).map((r) => [r.rule, r.met]));

describe('which rules a policy asks for', () => {
  it('asks for all five when complexity is required', () => {
    expect(passwordRulesFor(strict)).toEqual([...PASSWORD_RULES]);
  });

  // A screen must not list a requirement the server will not enforce.
  it('asks for length alone when complexity is off', () => {
    expect(passwordRulesFor(lengthOnly)).toEqual(['minLength']);
  });

  it('evaluates only the rules it asks for', () => {
    expect(evaluatePasswordPolicy('short', lengthOnly).map((r) => r.rule)).toEqual(['minLength']);
  });
});

describe('each rule, on its own', () => {
  // Every case holds the other four satisfied, so a failure names exactly one rule.
  it.each([
    ['minLength', 'Ab1!efgh', false], // 8 characters, policy wants 10
    ['minLength', 'Ab1!efghij', true], // exactly 10
    ['lowercase', 'AB1!EFGHIJ', false],
    ['lowercase', 'aB1!EFGHIJ', true],
    ['uppercase', 'ab1!efghij', false],
    ['uppercase', 'Ab1!efghij', true],
    ['digit', 'Abc!efghij', false],
    ['digit', 'Ab1!efghij', true],
    ['symbol', 'Abc1efghij', false],
    ['symbol', 'Ab1!efghij', true],
  ] as [PasswordRule, string, boolean][])('%s on %o → %s', (rule, password, expected) => {
    expect(met(password)[rule]).toBe(expected);
  });

  it('counts a symbol as anything that is neither a letter nor a digit', () => {
    // Broader than the `!@#$` an example suggests — which is what the server has always applied.
    for (const symbol of ['!', '@', '#', '$', '_', ' ', 'é', '—', '،']) {
      expect(met(`Abcdefghi1${symbol}`).symbol, symbol).toBe(true);
    }
  });

  it('does not accept a letter or a digit as a symbol', () => {
    expect(met('Abcdefghi1').symbol).toBe(false);
  });

  it('reads length in characters, so an empty password fails everything', () => {
    expect(met('')).toEqual({
      minLength: false,
      lowercase: false,
      uppercase: false,
      digit: false,
      symbol: false,
    });
  });
});

describe('minLength tracks the policy rather than a constant', () => {
  it.each([
    [8, 'Ab1!efgh', true],
    [10, 'Ab1!efgh', false],
    [12, 'Ab1!efghij', false],
    [12, 'Ab1!efghijkl', true],
    [1, 'A', true], // a one-character minimum is met by one character
  ])('minLength %i against %o', (minLength, password, lengthMet) => {
    const results = evaluatePasswordPolicy(password, { minLength, requireComplexity: true });
    expect(results.find((r) => r.rule === 'minLength')?.met).toBe(lengthMet);
  });

  // The label needs the number, and taking it from the policy is what keeps the sentence honest.
  it('carries the required length so a label can name it', () => {
    const result = evaluatePasswordPolicy('x', { minLength: 14, requireComplexity: false })[0];
    expect(result?.rule).toBe('minLength');
    expect(result?.minLength).toBe(14);
  });

  it('carries no length on the other rules', () => {
    const complexity = evaluatePasswordPolicy('x', strict).filter((r) => r.rule !== 'minLength');
    expect(complexity.every((r) => r.minLength === undefined)).toBe(true);
  });
});

describe('passwordSatisfiesPolicy', () => {
  it('accepts a password meeting every rule the policy asks for', () => {
    expect(passwordSatisfiesPolicy('Ab1!efghij', strict)).toBe(true);
  });

  it.each([
    ['too short', 'Ab1!efgh'],
    ['no lower', 'AB1!EFGHIJ'],
    ['no upper', 'ab1!efghij'],
    ['no digit', 'Abc!efghij'],
    ['no symbol', 'Abc1efghij'],
  ])('refuses one that is %s', (_why, password) => {
    expect(passwordSatisfiesPolicy(password, strict)).toBe(false);
  });

  // With complexity off, a long enough password of one character class is acceptable — and the
  // server agrees, which is the whole reason the client must not assume the stricter rules.
  it('accepts a length-only password when complexity is off', () => {
    expect(passwordSatisfiesPolicy('aaaaaaaaaa', lengthOnly)).toBe(true);
    expect(passwordSatisfiesPolicy('aaaaaaaaa', lengthOnly)).toBe(false);
  });
});
