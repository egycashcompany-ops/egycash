// Password hashing (argon2id, ADR-006) and the policy check both auth flows and
// admin resets apply. The policy VALUES come from settings (configurable).
//
// The RULES themselves moved to `@ecms/contracts` in FIX-2, so the screen that lists them for the
// person typing and the service that refuses them are reading one definition. Nothing about the
// guard changed: this function still produces the message, `assertPasswordPolicy` still resolves
// the values from settings and still throws, and every path that sets a password still goes
// through it. Only the predicates are now shared instead of duplicated.
import argon2 from 'argon2';
import { evaluatePasswordPolicy, type PasswordPolicyDto } from '@ecms/contracts';

export const hashPassword = async (password: string): Promise<string> =>
  argon2.hash(password, { type: argon2.argon2id });

export const verifyPassword = async (hash: string, password: string): Promise<boolean> => {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
};

export type PasswordPolicy = PasswordPolicyDto;

/**
 * Returns a violation message, or null when the password satisfies the policy.
 *
 * The two messages are unchanged and reported in the same order — length first, then complexity as
 * one combined sentence rather than naming the first missing character class. The client shows the
 * per-rule breakdown; this stays the API's answer, which is read by callers that have no screen.
 */
export const passwordPolicyViolation = (
  password: string,
  policy: PasswordPolicy,
): string | null => {
  const results = evaluatePasswordPolicy(password, policy);
  const failed = new Set(results.filter((result) => !result.met).map((result) => result.rule));

  if (failed.has('minLength')) {
    return `Password must be at least ${String(policy.minLength)} characters`;
  }
  if (failed.size > 0) {
    return 'Password must contain lower case, upper case, digit and symbol characters';
  }
  return null;
};
