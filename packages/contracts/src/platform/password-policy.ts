// The password rules, defined once.
//
// They used to live only in `apps/api/src/shared/utils/passwords.ts`, which was correct while
// nothing else needed them. FIX-2 puts them in front of the person typing — and a screen that
// listed the rules from its own copy of the regexes would be a second definition, free to drift
// from the one that actually refuses. So the rules move here, the server derives its refusal from
// them, and the client derives its checklist from them.
//
// **This does not move the guard.** `assertPasswordPolicy` still runs on every path that sets a
// password, still resolves the policy VALUES from settings, and is still the only thing that
// decides. What the client gets is a description of what the server will do, produced by the same
// code the server uses to do it.
import { z } from 'zod';

/** The two configurable values, resolved from `auth.password.*` at the organization level. */
export interface PasswordPolicyDto {
  minLength: number;
  /** When false, only the length rule applies — and the complexity bullets are not shown at all. */
  requireComplexity: boolean;
}

export const PasswordPolicySchema = z
  .object({
    minLength: z.number().int().min(1),
    requireComplexity: z.boolean(),
  })
  .strict();

/**
 * The rules a policy produces, in the order a person reads them.
 *
 * `minLength` is always present; the four complexity rules appear only when the policy asks for
 * them, so a deployment that has turned complexity off does not advertise requirements it will not
 * enforce.
 */
export const PASSWORD_RULES = ['minLength', 'lowercase', 'uppercase', 'digit', 'symbol'] as const;
export type PasswordRule = (typeof PASSWORD_RULES)[number];

export interface PasswordRuleResult {
  rule: PasswordRule;
  met: boolean;
  /** Carried on `minLength` so the label can name the number without importing the policy. */
  minLength?: number;
}

/** Which rules a policy asks for — the checklist, before anything has been typed. */
export const passwordRulesFor = (policy: PasswordPolicyDto): PasswordRule[] =>
  policy.requireComplexity ? [...PASSWORD_RULES] : ['minLength'];

/**
 * Evaluate a candidate password against a policy.
 *
 * Returns one entry per rule the policy asks for, so a caller can render the whole checklist and
 * colour each line. The predicates are the ones the server has always applied — a symbol is
 * anything that is not a letter or a digit, which is deliberately broader than the `!@#$` an
 * example would suggest.
 */
export const evaluatePasswordPolicy = (
  password: string,
  policy: PasswordPolicyDto,
): PasswordRuleResult[] => {
  const met: Record<PasswordRule, boolean> = {
    minLength: password.length >= policy.minLength,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    digit: /\d/.test(password),
    symbol: /[^a-zA-Z0-9]/.test(password),
  };
  return passwordRulesFor(policy).map((rule) =>
    rule === 'minLength'
      ? { rule, met: met[rule], minLength: policy.minLength }
      : { rule, met: met[rule] },
  );
};

/** True when every rule the policy asks for is satisfied. */
export const passwordSatisfiesPolicy = (password: string, policy: PasswordPolicyDto): boolean =>
  evaluatePasswordPolicy(password, policy).every((result) => result.met);
