// Duplicating a role: what may be copied, and when the answer is "not by you".
//
// **There is no duplicate endpoint, and there must not be one.** A duplicate is a CREATE with a
// pre-filled form — `POST /platform/roles` — which means it passes through `assertKnownPermissionKeys`
// and `assertKeysHeld` exactly as a hand-built role does. A dedicated endpoint would have to
// re-implement both guards, and the copy is the one operation where re-implementing them is most
// tempting and most dangerous: the whole point is to reproduce a set of authorities in one click.
//
// So the server remains the authority and this file only decides what the SCREEN offers. Its job is
// to refuse early and say why, never to make a refusal unnecessary by quietly trimming the payload.
import { type PermissionDto, type RoleDto } from '@ecms/contracts';

/** Why a role cannot be duplicated. `null` means it can. */
export interface DuplicateBlocker {
  reason: 'unknown-keys' | 'keys-not-held';
  keys: string[];
}

/**
 * The two ways a duplicate is refused — **wholly**, never partially.
 *
 * Copying only the grantable subset would be the worst possible behaviour: it succeeds, it looks
 * like it worked, and it produces a role that shares a name with the original and does less than
 * it. An administrator would have to diff two permission sets to discover that. So a role carrying
 * anything the actor cannot grant is not duplicable BY THEM, and the screen says so before they
 * start rather than after the server answers 422.
 *
 * `unknown-keys` is the other refusal, and it is not about the actor at all. A key the registry no
 * longer declares cannot be re-granted to anything — `assertKnownPermissionKeys` refuses the whole
 * create — and dropping it silently would turn "duplicate" into "duplicate, minus the parts I could
 * not carry". The original keeps such a key (it is removable there, never re-addable); the copy
 * simply cannot be made until the original is cleaned up.
 *
 * Order matters: an unknown key is reported first because it blocks EVERY actor, so telling an
 * administrator they lack a permission that no longer exists would send them to ask for a grant
 * nobody can give.
 */
export const duplicateBlocker = (
  role: Pick<RoleDto, 'permissionKeys'>,
  catalog: readonly PermissionDto[],
  canGrant: (key: string) => boolean,
): DuplicateBlocker | null => {
  // An EMPTY catalog does not mean "the registry knows nothing" — it means this screen could not
  // read it: the query is still in flight, or the administrator holds `role.create` without
  // `permission.view`, which the platform allows. Treating that as "every key is unknown" is how
  // this check turned into a permanent refusal for exactly those administrators, and a refusal that
  // blamed the role for carrying permissions nobody defines. The unknown check simply cannot run
  // without the registry, so it does not run, and `assertKnownPermissionKeys` on the server stays
  // what actually decides.
  if (catalog.length > 0) {
    const known = new Set(catalog.map((permission) => permission.key));
    const unknown = role.permissionKeys.filter((key) => !known.has(key));
    if (unknown.length > 0) return { reason: 'unknown-keys', keys: [...unknown].sort() };
  }
  // This one always runs: it asks the actor's own permission set, which the screen always has.
  const missing = role.permissionKeys.filter((key) => !canGrant(key));
  if (missing.length > 0) return { reason: 'keys-not-held', keys: [...missing].sort() };
  return null;
};

/**
 * The copy's starting name.
 *
 * Suffixed rather than left identical, because two roles with the same name in a list is a support
 * call waiting to happen — and editable, because the suffix is a starting point and not a naming
 * convention. Appended in each locale's own words; nothing here parses a name it did not write, so
 * duplicating a copy simply appends again, which is honest about what happened.
 */
export const duplicateName = (name: string, suffix: string): string => `${name} ${suffix}`.trim();

/**
 * What a duplicate actually sends: the source's grants and description, and nothing else.
 *
 * **Assignments are not here, and cannot be.** `CreateRole` has no field for them — a role and the
 * grants OF that role to people are different records, and duplicating "who holds it" would hand a
 * set of accounts an authority nobody decided to give them. The copy starts held by nobody, which
 * is also what makes it deletable if it turns out to be a mistake.
 *
 * `key`, `isSystem` and therefore `managed` are not here either: the server sets `key: null` and
 * `isSystem: false` on every create, so a duplicate of a system or `hr-only:*` role is an ordinary
 * unmanaged role. That is the correct outcome — the copy is not the thing the platform seeds or the
 * reconciliation owns — and it is safe because the key guard already refused anything the actor
 * could not grant.
 */
export const duplicatePayload = (
  role: Pick<RoleDto, 'permissionKeys' | 'description'>,
): { permissionKeys: string[]; description: string } => ({
  permissionKeys: [...role.permissionKeys],
  description: role.description ?? '',
});
