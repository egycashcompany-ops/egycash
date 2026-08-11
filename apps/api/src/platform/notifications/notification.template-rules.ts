// The two rules that apply to a template as a whole: which ones may not be withdrawn, and when one
// is usable at all.
//
// Both exist because P10 put the catalog on a screen. Before that, `status` could only be changed
// by code and the protected set could not be changed at all; now both are a click.
//
// They live in their own module because three different places need them and a cycle would form
// otherwise: `notification.seeds` creates them through the service, `notification.events` dispatches
// two of them, and the service itself has to refuse deactivating any of them. A file that only
// declares constants can be imported by all three.
//
// **It imports nothing.** `CREDENTIALS_TEMPLATE_KEY` used to live in `users/credentials-delivery`
// and was read from there; once that file also needed `isSendableTemplate` from here, the pair
// formed a cycle and the constant was read before it was initialised — every runtime entrypoint
// died at import. The key moved here, which is where a value both sides need belongs.
//
// **The list is the code's own dependency, written down.** Adding a `notify()` call on a new
// built-in key without adding it here leaves that path deactivatable — which is the failure this
// list exists to prevent, so a new built-in template belongs in both places or in neither.

/** Admin-editable account-setup message (auth design §13 R15) — seeded create-if-missing at boot. */
export const CREDENTIALS_TEMPLATE_KEY = 'platform.credentialsDelivery';

export const SECURITY_ALERT_TEMPLATE_KEY = 'platform.securityAlertRaised';
export const ROLE_ASSIGNMENT_CHANGED_TEMPLATE_KEY = 'platform.roleAssignmentChanged';

/**
 * Templates that may not be deactivated.
 *
 * Deactivation is not a soft delete here — `notify()` REFUSES a template whose latest version is
 * inactive, so switching one of these off silently stops the thing that sends it: security alerts,
 * role-change notices, or (through its own path) the account setup message. Editing the wording
 * stays open; only the off switch is closed, because wording is what the catalog is for.
 */
export const PROTECTED_TEMPLATE_KEYS: readonly string[] = [
  CREDENTIALS_TEMPLATE_KEY,
  SECURITY_ALERT_TEMPLATE_KEY,
  ROLE_ASSIGNMENT_CHANGED_TEMPLATE_KEY,
];

export const isProtectedTemplateKey = (key: string): boolean =>
  PROTECTED_TEMPLATE_KEYS.includes(key);

/**
 * Whether a template may be used to compose a message.
 *
 * Named once because it has two callers who disagreed about it. `notify()` has always refused an
 * inactive template; the credentials-delivery path never looked at `status` at all, so deactivating
 * `platform.credentialsDelivery` withdrew it everywhere except the one place it was used. One
 * question, one answer — what each caller DOES about a `false` still differs, and should: `notify()`
 * refuses, while credentials-delivery falls back to its built-in wording rather than strand an
 * account that is being issued.
 */
export const isSendableTemplate = (
  template: { status: string } | null | undefined,
): boolean => template !== null && template !== undefined && template.status === 'active';
