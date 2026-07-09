// Password hashing (argon2id, ADR-006) and the policy check both auth flows and
// admin resets apply. The policy VALUES come from settings (configurable).
import argon2 from 'argon2';

export const hashPassword = async (password: string): Promise<string> =>
  argon2.hash(password, { type: argon2.argon2id });

export const verifyPassword = async (hash: string, password: string): Promise<boolean> => {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
};

export interface PasswordPolicy {
  minLength: number;
  requireComplexity: boolean;
}

/** Returns a violation message, or null when the password satisfies the policy. */
export const passwordPolicyViolation = (
  password: string,
  policy: PasswordPolicy,
): string | null => {
  if (password.length < policy.minLength) {
    return `Password must be at least ${policy.minLength} characters`;
  }
  if (policy.requireComplexity) {
    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasDigit = /\d/.test(password);
    const hasSymbol = /[^a-zA-Z0-9]/.test(password);
    if (!(hasLower && hasUpper && hasDigit && hasSymbol)) {
      return 'Password must contain lower case, upper case, digit and symbol characters';
    }
  }
  return null;
};
