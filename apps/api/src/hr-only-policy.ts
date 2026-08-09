// The decision half of the HR-only confinement (see `hr-only-access.ts` for the reconciliation that
// applies it). Pure functions, no I/O and no imports — which is what lets the rules that decide
// whether a role leaks be tested directly, without a database standing in the way.

/** The module every confined account is restricted to. */
export const HR_MODULE_ID = 'hr';

export const HR_ONLY_ROLE_NAME = { en: 'HR Only', ar: 'الموارد البشرية فقط' };

/** Key prefix of the non-system roles that carry a confined user's HR grants. */
export const HR_ONLY_ROLE_KEY_PREFIX = 'hr-only:';

/**
 * The HR-only derivative of a role, keyed on the SOURCE ROLE rather than on the user.
 *
 * Keying it per user would mint a role per person; keying it once for everybody would force the
 * single role to carry the union of every confined user's HR grants, which widens the narrowest
 * user's access every time a broader one is confined. Per source role, the derivative means exactly
 * "this role, minus everything outside HR" — the same answer for anyone who held it.
 */
export const derivedHrRoleKey = (sourceRoleId: string): string =>
  `${HR_ONLY_ROLE_KEY_PREFIX}${sourceRoleId}`;

/** Whether a role key is one of the derivatives above (such roles are left alone on re-runs). */
export const isDerivedHrRoleKey = (key: string | null): boolean =>
  key !== null && key.startsWith(HR_ONLY_ROLE_KEY_PREFIX);

/**
 * Identifiers of this form are matched against `firstName.en lastName.en`.
 *
 * OFF BY DEFAULT, and deliberately so. A person's identity in this system is their email or their
 * username — both unique and both enforced unique; a display name is neither. Confining an account
 * is a restriction applied to a specific human being, and resolving "which human" through a field
 * that two people can share is the one way this can go wrong quietly. The name form remains as a
 * fallback for a database where the logins genuinely are not known yet, and enabling it is an
 * explicit, deliberate act (`HR_ONLY_ALLOW_NAME_IDENTIFIERS`) rather than something you get by not
 * thinking about it.
 */
export const NAME_IDENTIFIER_PREFIX = 'name:';

export type RoleClassification = 'hr-only' | 'non-hr' | 'mixed' | 'empty';

/**
 * What a role grants, in module terms.
 *
 * A permission key the registry does not know is counted as NON-HR. An unrecognized grant is exactly
 * the kind of thing a confinement must not wave through — a key left behind by a retired module, or
 * a typo in a hand-edited role — and the safe reading of "unknown" is "not the one module we are
 * allowing". The cost of being wrong that way is a revoked assignment; the cost of the opposite is
 * an unnoticed hole.
 */
export const classifyPermissionKeys = (
  permissionKeys: readonly string[],
  moduleIds: ReadonlyMap<string, string>,
): RoleClassification => {
  if (permissionKeys.length === 0) return 'empty';
  let hr = 0;
  let other = 0;
  for (const key of permissionKeys) {
    if (moduleIds.get(key) === HR_MODULE_ID) hr += 1;
    else other += 1;
  }
  if (hr > 0 && other > 0) return 'mixed';
  return hr > 0 ? 'hr-only' : 'non-hr';
};

/** The HR subset of a set of permission keys — the ceiling on what a confined user keeps. */
export const hrPermissionKeysOf = (
  permissionKeys: readonly string[],
  moduleIds: ReadonlyMap<string, string>,
): string[] => [...new Set(permissionKeys.filter((key) => moduleIds.get(key) === HR_MODULE_ID))];

/** Split a comma/newline-separated identifier list, dropping blanks. */
export const parseIdentifierList = (raw: string): string[] =>
  raw
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

export type IdentifierKind =
  | { kind: 'name'; value: string }
  | { kind: 'email'; value: string }
  | { kind: 'username'; value: string };

/**
 * How an identifier should be looked up: `name:<full English name>`, anything containing `@` as an
 * email, everything else as a username.
 *
 * Classification only — whether a `name:` identifier is ALLOWED to be resolved is a separate
 * decision (see `NAME_IDENTIFIER_PREFIX`), taken by the caller so that a refusal can be reported
 * against the identifier that caused it instead of silently reading as "no such account".
 */
export const classifyIdentifier = (identifier: string): IdentifierKind | null => {
  const value = identifier.trim();
  if (value === '') return null;
  if (value.toLowerCase().startsWith(NAME_IDENTIFIER_PREFIX)) {
    const name = value.slice(NAME_IDENTIFIER_PREFIX.length).trim();
    return name === '' ? null : { kind: 'name', value: name };
  }
  return value.includes('@') ? { kind: 'email', value } : { kind: 'username', value };
};
