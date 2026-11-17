// Grants copied ALONGSIDE other grants — the pure half of `rbacService.grantAlongside`.
//
// The one shape in which the platform itself adds keys to roles and delegated grants that people
// made: a module splitting one grant into several. A screen that rode another surface's key gets
// keys of its own, and the old key stops opening it — so on the day of the deploy every holder of
// the old key must be given the new ones, or the people who ran that screen yesterday lose it.
//
// It widens nobody, by construction: a holder gains a key only beside the key it already
// exercised the same power under, in the same grant — the same role, the same delegated unit, the
// same scope. And it is strictly ADDITIVE: nothing is ever removed, and a holder that already
// carries a key is not given it twice.
//
// What it never touches (ADR-026 §4): `super-admin`, which the catalog sync already gives
// everything; `platform-admin`, which holds the platform's own keys by definition and no module's;
// and the `hr-only:*` derivatives, which the HR-only reconciliation owns and re-derives from their
// source role on every boot — a second writer there would be reverted, not obeyed.
//
// No I/O here: what a holder gains, which roles take part, and what the trail records are decided
// by these functions, so the rules can be tested without a database.
import { type AuditChange } from '@ecms/contracts';
import { isDerivedHrRoleKey } from '../../hr-only-policy';
import { diffChanges } from '../../shared/utils/diff';

/** One copy rule: whoever holds `from` is given every key of `add` too, in the same grant. */
export interface GrantAlongsidePair {
  readonly from: string;
  readonly add: readonly string[];
}

/** What one holder gains under a set of pairs. */
export interface KeysGained {
  /** The keys to add — sorted, none of them already held. Empty: the holder is left alone. */
  add: string[];
  /**
   * The `from` keys that justify `add`, sorted. The write names them in its filter, so it lands
   * only while the holder still carries every one of them.
   */
  because: string[];
}

/** A role the copy changed: its keys before and after, as stored. */
export interface RoleGrantsCopied {
  roleId: string;
  name: { ar: string; en: string };
  before: string[];
  after: string[];
}

/** A delegated grant (ADR-032) the copy changed: whose, over which unit, and its keys. */
export interface DelegatedGrantsCopied {
  grantId: string;
  userId: string;
  branchId: string | null;
  departmentId: string | null;
  departmentCatalogId: string | null;
  before: string[];
  after: string[];
}

/** What `grantAlongside` changed — what `afterGrantsAlongside` audits, invalidates and announces. */
export interface GrantsAlongsideResult {
  roles: RoleGrantsCopied[];
  delegatedGrants: DelegatedGrantsCopied[];
}

/** The seeded roles a copy never writes into — see the header. */
export const ROLES_NEVER_COPIED_INTO: readonly string[] = ['super-admin', 'platform-admin'];

/** The `from` keys of a set of pairs, once each — what the candidate holders are read by. */
export const alongsideFromKeys = (pairs: readonly GrantAlongsidePair[]): string[] => [
  ...new Set(pairs.map((pair) => pair.from)),
];

/**
 * The `add` keys the registry does not know, sorted. A grant only ever holds registered keys
 * (ADR-004; ADR-032 for a delegated grant), and a copy is no exception: the caller refuses the
 * whole run rather than write a key no route will ever read.
 */
export const unregisteredAlongsideKeys = (
  pairs: readonly GrantAlongsidePair[],
  isRegistered: (key: string) => boolean,
): string[] =>
  [...new Set(pairs.flatMap((pair) => pair.add))].filter((key) => !isRegistered(key)).sort();

/** Whether a role takes part in a copy at all — see the header for the three that do not. */
export const roleTakesGrantsAlongside = (role: { key: string | null }): boolean =>
  role.key === null ||
  (!ROLES_NEVER_COPIED_INTO.includes(role.key) && !isDerivedHrRoleKey(role.key));

/** What a holder of `held` gains under `pairs` — nothing it already holds, nothing twice. */
export const keysGainedAlongside = (
  held: readonly string[],
  pairs: readonly GrantAlongsidePair[],
): KeysGained => {
  const holding = new Set(held);
  const add = new Set<string>();
  const because = new Set<string>();
  for (const pair of pairs) {
    if (!holding.has(pair.from)) continue;
    const missing = pair.add.filter((key) => !holding.has(key));
    if (missing.length === 0) continue;
    because.add(pair.from);
    for (const key of missing) add.add(key);
  }
  return { add: [...add].sort(), because: [...because].sort() };
};

/** The keys `after` holds that `before` did not, sorted — what a copy added. */
export const keysAdded = (before: readonly string[], after: readonly string[]): string[] => {
  const had = new Set(before);
  return [...new Set(after.filter((key) => !had.has(key)))].sort();
};

/**
 * A changed role's audit changes — exactly what `updateRole` records for a key edit: the
 * `permissionKeys` field, before and after, as stored.
 */
export const roleCopyAuditChanges = (role: RoleGrantsCopied): AuditChange[] =>
  diffChanges({ permissionKeys: role.before }, { permissionKeys: role.after });

/**
 * A changed delegated grant's audit changes — what the delegation service records on a write: the
 * keys before and after (sorted, joined), and the unit. A grant over one company-wide department
 * in every branch has no branch; its unit is that department, named by its catalog entry.
 */
export const delegationCopyAuditChanges = (grant: DelegatedGrantsCopied): AuditChange[] => [
  {
    field: 'delegation',
    old: [...grant.before].sort().join(', ') || null,
    new: [...grant.after].sort().join(', ') || null,
  },
  { field: 'branch', old: null, new: grant.branchId },
  {
    field: 'department',
    old: null,
    new:
      grant.departmentId ??
      (grant.departmentCatalogId === null
        ? 'whole-branch'
        : `every-branch:${grant.departmentCatalogId}`),
  },
];
