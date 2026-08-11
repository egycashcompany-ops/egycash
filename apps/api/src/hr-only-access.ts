// HR-only accounts: the reconciler that confines a named set of users to the HR module.
//
// WHY THIS EXISTS AS CODE RATHER THAN A ONE-OFF DB EDIT
// The same confinement done by hand in the admin UI is correct until the next `npm run seed`, the
// next role edit, or the next person who assigns a role without knowing the rule. Expressing it as
// an idempotent reconciliation makes it a STATE the platform re-asserts, not an event someone
// performed once — run it as often as you like and it converges.
//
// WHAT "HR ONLY" MEANS HERE, AND WHERE EACH HALF IS ENFORCED
//   • API / routes — RBAC alone. Every module route is `authorize('<key>')`-gated, so a user whose
//     effective permissions contain nothing outside `moduleId: 'hr'` is refused by the server on
//     `/fleet/*`, `/it/*` and the platform admin surfaces. Nothing here adds a per-user check to a
//     route: the confinement IS the permission set, which is why a direct API call is blocked
//     exactly as a click is.
//   • Navigation — nothing here, and nothing needed. The sidebar IS the set of applications whose
//     `permissionKey` the caller holds (see `me/effective-applications.ts`), so confining the
//     permission set confines the sidebar with it. No application grant can add a row back.
//   • TOTP — a consequence, not a special case. `isPrivileged` is "holds a system role OR holds a
//     break-glass permission", and the R13 policy forces enrollment on privileged accounts only.
//     HR declares no break-glass permission, and the role these users end up on is deliberately
//     NOT a system role — so they are unprivileged, the policy does not reach them, and clearing
//     their enrollment state leaves them with no TOTP flow at all. The organization-wide
//     `TotpEnforcedForPrivileged` setting is never touched, so no other account changes behaviour.
//
// The mixed-role case is the one that needs judgement. A role holding HR *and* non-HR permissions
// cannot simply be kept (it would leak) or revoked (it would take their HR access with it), and
// editing the role itself would change it for everyone else holding it. So the assignment is
// rewritten onto an HR-only DERIVATIVE of that same role — its HR subset, keyed on the source role
// and granted on the source assignment's own scope and validity. No permission they did not already
// hold, nothing outside HR, and no shared bucket whose contents grow as more users are confined.
import { type Types } from 'mongoose';
import { logger } from './infrastructure/logging/logger';
import {
  HR_MODULE_ID,
  HR_ONLY_ROLE_NAME,
  classifyIdentifier,
  classifyPermissionKeys,
  derivedHrRoleKey,
  hrPermissionKeysOf,
  isDerivedHrRoleKey,
  parseIdentifierList,
} from './hr-only-policy';
import { rbacService } from './platform/rbac';
import { roleAssignmentRepository, roleRepository } from './platform/rbac/rbac.repository';
import { userService } from './platform/users';
import { userRepository } from './platform/users/user.repository';
import { applicationRepository } from './platform/applications/application.repository';
import { userApplicationRepository } from './platform/user-applications/user-application.repository';
import { userApplicationService } from './platform/user-applications';

export {
  HR_MODULE_ID,
  HR_ONLY_ROLE_KEY_PREFIX,
  HR_ONLY_ROLE_NAME,
  classifyPermissionKeys,
  derivedHrRoleKey,
  isDerivedHrRoleKey,
  parseIdentifierList,
} from './hr-only-policy';

export interface HrOnlyUserReport {
  identifier: string;
  userId: string | null;
  /**
   * `reconciled`; `not-found`; `ambiguous` (an identifier matching more than one account); or
   * `name-matching-disabled` (a `name:` identifier while the fallback is off — the default).
   */
  outcome: 'reconciled' | 'not-found' | 'ambiguous' | 'name-matching-disabled';
  /** Role assignments revoked because they granted something outside HR. */
  revokedAssignments: number;
  /** HR permission keys the user ends up holding. */
  hrPermissionKeys: string[];
  /** Direct application grants removed because the application is not an HR one. */
  revokedApplications: number;
  totpCleared: boolean;
}

// ── Identifier resolution ───────────────────────────────────────────────────
// Accounts are named by EMAIL or USERNAME, the two fields this system holds unique. `name:` is a
// fallback for a database whose logins are not known yet and is refused unless explicitly enabled;
// even then, a name matching MORE THAN ONE account is reported as ambiguous rather than resolved,
// because guessing which "Mohamed Mustafa" was meant is what confines the wrong person's account.

type Resolution = { id: string } | 'ambiguous' | 'name-disabled' | null;

const resolveIdentifier = async (
  identifier: string,
  allowNameIdentifiers: boolean,
): Promise<Resolution> => {
  const classified = classifyIdentifier(identifier);
  if (classified === null) return null;
  if (classified.kind === 'name') {
    if (!allowNameIdentifiers) return 'name-disabled';
    const matches = await userRepository.findByFullNameEn(classified.value);
    if (matches.length === 0) return null;
    if (matches.length > 1) return 'ambiguous';
    return { id: String(matches[0]?._id) };
  }
  const found =
    classified.kind === 'email'
      ? await userRepository.findByEmail(classified.value)
      : await userRepository.findByUsername(classified.value);
  return found === null ? null : { id: String(found._id) };
};

// ── Reconciliation ──────────────────────────────────────────────────────────

interface ReconcileDeps {
  /** Actor recorded on the audit entries the reconciliation writes. */
  actorId: string;
  /** Opt in to `name:` identifiers (off by default — emails and usernames are the identity). */
  allowNameIdentifiers?: boolean;
}

const reconcileRoles = async (
  userId: string,
  deps: ReconcileDeps,
): Promise<{ revoked: number; hrPermissionKeys: string[] }> => {
  const assignments = await roleAssignmentRepository.findActiveForUser(userId);
  const roles = await roleRepository.findByIds(assignments.map((a) => a.roleId));
  const rolesById = new Map(roles.map((role) => [String(role._id), role]));

  const moduleIds = await rbacService.moduleIdsForPermissions(
    roles.flatMap((role) => role.permissionKeys),
  );

  let revoked = 0;
  for (const assignment of assignments) {
    const role = rolesById.get(String(assignment.roleId));
    if (role === undefined) continue;
    if (isDerivedHrRoleKey(role.key)) continue; // already a confined role — left in place

    const classification = classifyPermissionKeys(role.permissionKeys, moduleIds);

    // An ordinary role granting nothing outside HR is kept exactly as it is — grants, scope and
    // validity window all untouched. A SYSTEM role is not, even when every permission in it is an
    // HR one: `isSystem` is itself half the definition of a privileged account, so keeping
    // `employee-self-service` (leave.view + leave.request — entirely HR) would leave these users
    // privileged and back inside the R13 mandatory-enrollment flow. It is replaced by an ordinary
    // role carrying the same permissions, which is the whole difference.
    if (classification === 'hr-only' && !role.isSystem) continue;

    // Whatever must go is replaced by its HR-only derivative BEFORE the original is revoked, so the
    // account is never momentarily without the HR access it is supposed to keep.
    //
    // The derivative is keyed on the SOURCE ROLE, not on the user. One shared `hr-only` role would
    // have to carry the union of every confined user's HR grants — and a union is an escalation:
    // confining a second user with broader HR access would silently widen the first user's. Keyed
    // per source role, two users on the same role land on the same derivative because they
    // genuinely had the same grants, and a user on a narrower role stays narrow.
    const hrKeys = hrPermissionKeysOf(role.permissionKeys, moduleIds);
    if (hrKeys.length > 0) {
      const derived = await rbacService.ensureManagedRole(
        derivedHrRoleKey(String(role._id)),
        {
          en: `${role.name.en} (${HR_ONLY_ROLE_NAME.en})`,
          ar: `${role.name.ar} (${HR_ONLY_ROLE_NAME.ar})`,
        },
        hrKeys,
      );
      // The original assignment's scope and validity window are carried over verbatim: a
      // department-scoped grant must not become organization-wide just because it was rewritten,
      // and an assignment that was going to expire must still expire.
      await rbacService.mirrorAssignment(assignment, String(derived._id), deps.actorId);
    }

    await rbacService.revokeAssignment(String(assignment._id), deps.actorId);
    revoked += 1;
  }

  const effective = await rbacService.getEffectivePermissions(
    userId,
    (await userRepository.findById(userId))?.security.permissionVersion ?? 0,
  );
  return { revoked, hrPermissionKeys: Object.keys(effective.permissions).sort() };
};

/**
 * Drop the user's direct application grants for applications outside HR.
 *
 * NO LONGER LOAD-BEARING. Navigation is derived from effective permissions, so a grant cannot put a
 * row in anybody's sidebar and this changes nothing about what the account can see or reach. It is
 * kept as tidying — leaving a confined account holding grants that name Fleet and IT would make its
 * stored state read as though it still had a claim on them — and it is the one place that already
 * knows which grants are stale. The rows themselves are administrative leftovers platform-wide; a
 * general cleanup of the two grant tables is a separate migration, not this function's job.
 *
 * "Outside HR" is decided by the application's own `permissionKey` through the permission registry,
 * so it follows the catalog instead of a hardcoded route list. An application with no permission key
 * is left alone: it is invisible to everyone anyway, so removing its grant would change nothing.
 */
const reconcileApplicationGrants = async (userId: string, deps: ReconcileDeps): Promise<number> => {
  const links = await userApplicationRepository.findByUser(userId);
  const applications = await Promise.all(
    links.map(async (link) => ({
      applicationId: String(link.applicationId as Types.ObjectId),
      application: await applicationRepository.findById(String(link.applicationId)),
    })),
  );
  const keys = applications
    .map((row) => row.application?.permissionKey ?? null)
    .filter((key): key is string => key !== null);
  const moduleIds = await rbacService.moduleIdsForPermissions(keys);

  let removed = 0;
  for (const row of applications) {
    const key = row.application?.permissionKey ?? null;
    if (key === null) continue; // open page — never revoked
    if (moduleIds.get(key) === HR_MODULE_ID) continue;
    await userApplicationService.remove(userId, row.applicationId, deps.actorId);
    removed += 1;
  }
  return removed;
};

/**
 * Turn TOTP off for the account, explicitly and in both places login looks:
 *   • `security.totp.enabled` false with no secret — so no challenge step is offered,
 *   • `security.totp.required` false — the D6 admin force-on flag, so no enrollment step either.
 *
 * Combined with the account being unprivileged (see the file header), this means login never enters
 * a TOTP flow for them. Both writes go through the user service, so both are audited.
 *
 * THE ORDER IS LOAD-BEARING. `setTotp` writes the whole `security.totp` subdocument, so it drops
 * `required` along with the enrollment — clearing the flag first and the enrollment second would
 * leave the flag absent rather than false. Enrollment goes first, and the flag is written after, so
 * the stored state says `false` explicitly rather than relying on a schema default to mean it.
 *
 * Each write is skipped when it would change nothing, which is what keeps a re-run from producing a
 * stream of audit entries recording that nothing happened.
 */
const disableTotp = async (userId: string): Promise<boolean> => {
  const before = await userRepository.findById(userId);
  if (before === null) return false;
  const wasEnabled = before.security.totp.enabled || before.security.totp.secret !== null;
  if (wasEnabled) {
    await userService.setTotp(userId, { enabled: false, secret: null, backupCodeHashes: [] });
  }
  const after = wasEnabled ? await userRepository.findById(userId) : before;
  const requiredNow = after?.security.totp.required ?? null;
  if (requiredNow !== false) await userService.setTotpRequired(userId, false);
  return wasEnabled || requiredNow !== false;
};

/** Confine one already-resolved user. Exported for tests that create their own accounts. */
export const reconcileHrOnlyUser = async (
  userId: string,
  deps: ReconcileDeps,
): Promise<Omit<HrOnlyUserReport, 'identifier' | 'outcome'>> => {
  const { revoked, hrPermissionKeys } = await reconcileRoles(userId, deps);
  const revokedApplications = await reconcileApplicationGrants(userId, deps);
  const totpCleared = await disableTotp(userId);
  return {
    userId,
    revokedAssignments: revoked,
    hrPermissionKeys,
    revokedApplications,
    totpCleared,
  };
};

/**
 * Confine every configured account. Idempotent — a second run finds nothing left to change.
 *
 * Every identifier gets an entry in the report, whatever happened to it. An identifier that resolves
 * to nothing is REPORTED rather than thrown: the same configuration is applied to environments that
 * legitimately do not have all of these people (a fresh dev database has none of them), and failing
 * the seed there would be noise rather than a signal. What must never happen quietly is the
 * opposite — an account confined that was not meant to be — which is why every path that could not
 * identify exactly one person declines instead of picking.
 */
export const reconcileHrOnlyUsers = async (
  identifiers: string[],
  deps: ReconcileDeps,
): Promise<HrOnlyUserReport[]> => {
  const reports: HrOnlyUserReport[] = [];
  const skipped = (
    identifier: string,
    outcome: Exclude<HrOnlyUserReport['outcome'], 'reconciled'>,
  ): HrOnlyUserReport => ({
    identifier,
    userId: null,
    outcome,
    revokedAssignments: 0,
    hrPermissionKeys: [],
    revokedApplications: 0,
    totpCleared: false,
  });

  for (const identifier of identifiers) {
    const resolved = await resolveIdentifier(identifier, deps.allowNameIdentifiers === true);
    if (resolved === 'name-disabled') {
      logger.error(
        { identifier },
        'hr-only: name identifiers are disabled — configure the email or username, or set HR_ONLY_ALLOW_NAME_IDENTIFIERS=true',
      );
      reports.push(skipped(identifier, 'name-matching-disabled'));
      continue;
    }
    if (resolved === null) {
      logger.warn({ identifier }, 'hr-only: no account matches this identifier — skipped');
      reports.push(skipped(identifier, 'not-found'));
      continue;
    }
    if (resolved === 'ambiguous') {
      logger.error(
        { identifier },
        'hr-only: identifier matches more than one account — skipped, use the email or username',
      );
      reports.push(skipped(identifier, 'ambiguous'));
      continue;
    }
    const result = await reconcileHrOnlyUser(resolved.id, deps);
    logger.info({ identifier, ...result }, 'hr-only: account confined to the HR module');
    reports.push({ identifier, outcome: 'reconciled', ...result });
  }
  return reports;
};

/**
 * Re-assert the confinement on every API start, from the configured identifier list.
 *
 * The seed is not enough on its own. Boot itself hands roles out: the Leave module's migration
 * re-grants `employee-self-service` to every employed person with a login, on every start (leave
 * design L7). For a confined user who is also an employee, that would quietly restore a system role
 * — and with it the privileged status the R13 policy forces TOTP enrollment on — some time after
 * `npm run seed` had removed it. Running here, AFTER the module seeds and migrations, is what makes
 * the confinement a state the platform maintains rather than one it periodically loses.
 *
 * Never throws: a confinement that cannot be applied is a serious operational signal, but taking
 * the API down over it would turn a restricted account into an outage for everybody.
 */
export const syncHrOnlyAccounts = async (): Promise<HrOnlyUserReport[]> => {
  const { env } = await import('./infrastructure/config/env');
  const identifiers = parseIdentifierList(env.HR_ONLY_USER_IDENTIFIERS);
  if (identifiers.length === 0) return []; // unconfigured — the default, and it does nothing

  // Audited under a super-admin, the way the navigation catalog sync attributes its own writes.
  const adminIds = await rbacService.userIdsWithSystemRole('super-admin');
  const actorId = adminIds[0];
  if (actorId === undefined) return []; // pre-seed boot — the seed covers it

  try {
    return await reconcileHrOnlyUsers(identifiers, {
      actorId,
      allowNameIdentifiers: env.HR_ONLY_ALLOW_NAME_IDENTIFIERS,
    });
  } catch (error) {
    logger.error({ err: error }, 'hr-only: reconciliation failed — accounts may be unconfined');
    return [];
  }
};
