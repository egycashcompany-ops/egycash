// What the server will accept, listed while it is being typed.
//
// Every rule here comes from `evaluatePasswordPolicy` in the contracts — the same function
// `passwordPolicyViolation` derives the API's refusal from — against a policy fetched from the
// server. There is no list of rules written in this file and no default assumed: when the policy
// cannot be read the component renders nothing rather than inventing a checklist, and the person
// finds out from the server as they did before.
//
// When `requireComplexity` is off the four character rules are not shown at all, because a screen
// that lists a requirement the server will not enforce is worse than one that lists none.
import { evaluatePasswordPolicy, type PasswordPolicyDto } from '@ecms/contracts';
import { useT } from '../localization/useT';

/**
 * Rendered as a list with a per-item state, not as coloured text alone: colour is the fast signal
 * for most people and the only signal for none — each row carries an icon and its own
 * `data-met`, and the group is `aria-live` so a screen reader hears a rule turn green rather than
 * having to re-read the list.
 */
export const PasswordRequirements = ({
  password,
  policy,
  id,
}: {
  password: string;
  policy: PasswordPolicyDto | undefined;
  id?: string;
}): JSX.Element | null => {
  const t = useT();
  // No policy, no checklist. The server remains the authority either way.
  if (policy === undefined) return null;

  const results = evaluatePasswordPolicy(password, policy);

  return (
    <ul id={id} className="mt-2 space-y-1" aria-live="polite">
      {results.map((result) => (
        <li
          key={result.rule}
          data-met={result.met}
          className={
            result.met
              ? 'flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400'
              : 'flex items-center gap-2 text-xs text-red-600 dark:text-red-400'
          }
        >
          <span aria-hidden="true" className="text-[0.7rem] leading-none">
            {result.met ? '●' : '○'}
          </span>
          <span>
            {t(`common.password.rule.${result.rule}`, {
              count: result.minLength ?? 0,
            })}
          </span>
          {/* The state in words, for anyone who cannot use the colour. */}
          <span className="sr-only">
            {t(result.met ? 'common.password.ruleMet' : 'common.password.ruleUnmet')}
          </span>
        </li>
      ))}
    </ul>
  );
};
