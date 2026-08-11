// Business rules for user accounts. Lifecycle: invite → activate → suspend → archive —
// never hard-delete (audit integrity, Platform Core §2).
import { Types, type ClientSession } from 'mongoose';
import {
  ErrorCodes,
  PlatformEvents,
  SettingKeys,
  type AccountStatus,
  type ChangeUserStatus,
  type CreateUser,
  type CredentialsDeliveryResultDto,
  type ListUsersQuery,
  type Paginated,
  type UpdateMyPreferences,
  type UpdateUser,
  type UserDto,
  type PasswordPolicyDto,
  type UserStatus,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/errors';
import { type ScopeSelector } from '../../shared/types';
import { diffChanges } from '../../shared/utils/diff';
import { randomToken, sha256 } from '../../shared/utils/crypto';
import { hashPassword, passwordPolicyViolation } from '../../shared/utils/passwords';
import { getCache } from '../../infrastructure/redis/cache';
import { resolveEmployeeCode, resolveEmployeeCodeOfUser } from '../auth/identity-seams';
import { deliverCredentials, setupLinkUrl } from './credentials-delivery';
import { auditService } from '../audit';
import { settingsService } from '../settings';
import { emit, nudgeOutboxRelay } from '../kernel/event-bus';
import { unitOfWork } from '../kernel/unit-of-work';
import { departmentRepository } from '../organization/departments/department.repository';
import { roleAssignmentRepository, roleRepository } from '../rbac/rbac.repository';
import { sectionRepository } from '../organization/sections/section.repository';
import { userRepository } from './user.repository';
import { type UserDoc } from './user.model';

/** The seeded role whose last holder must never be retired — the account that can fix everything. */
const SUPER_ADMIN_ROLE_KEY = 'super-admin';

const ACTIVATION_TTL_DAYS = 7;

const entityRef = (userId: string) => ({
  moduleId: 'platform',
  entityType: 'user',
  entityId: userId,
});

const auditSnapshot = (doc: UserDoc): Record<string, unknown> => ({
  email: doc.email,
  username: doc.username,
  employeeId: doc.employeeId,
  phone: doc.phone,
  'profile.firstName': doc.profile.firstName,
  'profile.lastName': doc.profile.lastName,
  locale: doc.locale,
  status: doc.status,
  'organization.branchId': doc.organization.branchId,
  'organization.departmentId': doc.organization.departmentId,
  'organization.sectionId': doc.organization.sectionId,
  'organization.jobTitleId': doc.organization.jobTitleId,
});

class UserService {
  async create(
    input: CreateUser,
    by: string | null,
    extra: { username?: string; employeeId?: string } = {},
  ): Promise<{ user: UserDoc; activationToken: string }> {
    if (input.email !== undefined) {
      const existing = await userRepository.findByEmail(input.email);
      if (existing !== null) throw new ConflictError('A user with this email already exists');
    }
    // `extra.username` wins: HR's provisioning path derives it from the Employee Code and passes it
    // out of band, while an administrator supplies it in the body. Both normalize the same way,
    // because the uniqueness index is on the stored (lowercased) value.
    const username = (extra.username ?? input.username)?.toLowerCase();
    if (username !== undefined && (await userRepository.findByUsername(username)) !== null) {
      throw new ConflictError('A user with this username already exists');
    }
    // The schema's own refinement covers the admin path. This catches the INTERNAL callers, which
    // pass `Omit<CreateUser, 'email'>`-shaped objects the schema never validated — an account with
    // no identifier can never sign in, and it is not a state worth being able to reach at all.
    if (input.email === undefined && username === undefined) {
      throw new BusinessRuleError(
        'an account needs at least one login identifier — an email or a username',
      );
    }

    const oid = (value: string | null): Types.ObjectId | null =>
      value === null ? null : new Types.ObjectId(value);
    await this.assertPlacementConsistent({
      branchId: oid(input.organization.branchId),
      departmentId: oid(input.organization.departmentId),
      sectionId: oid(input.organization.sectionId),
    });

    const activationToken = randomToken();
    const user = await unitOfWork(async (session) => {
      const created = await userRepository.create(
        {
          email: input.email ?? null,
          username: username ?? null,
          employeeId: extra.employeeId === undefined ? null : new Types.ObjectId(extra.employeeId),
          phone: input.phone ?? null,
          profile: { firstName: input.firstName, lastName: input.lastName },
          locale: input.locale,
          status: 'invited',
          organization: {
            branchId:
              input.organization.branchId === null
                ? null
                : new Types.ObjectId(input.organization.branchId),
            departmentId:
              input.organization.departmentId === null
                ? null
                : new Types.ObjectId(input.organization.departmentId),
            sectionId:
              input.organization.sectionId === null
                ? null
                : new Types.ObjectId(input.organization.sectionId),
            jobTitleId:
              input.organization.jobTitleId === null
                ? null
                : new Types.ObjectId(input.organization.jobTitleId),
          },
          activation: {
            tokenHash: sha256(activationToken),
            expiresAt: new Date(Date.now() + ACTIVATION_TTL_DAYS * 86_400_000),
            sentAt: new Date(),
            delivery: null,
          },
        },
        { by, session },
      );
      await emit(
        PlatformEvents.UserCreated,
        { userId: String(created._id), email: created.email, status: created.status },
        { reliable: true, session },
      );
      return created;
    });
    nudgeOutboxRelay();

    await auditService.record({
      entityRef: entityRef(String(user._id)),
      action: 'create',
      changes: diffChanges({}, auditSnapshot(user)),
    });
    await auditService.record({
      entityRef: entityRef(String(user._id)),
      action: 'invitationCreated',
      changes: [{ field: 'mode', old: null, new: 'invite' }],
    });
    return { user, activationToken };
  }

  /**
   * Auto-provisioned account (frozen auth design 4.1 + §14): INVITED with a one-time
   * activation token — no password exists until the employee chooses one at the setup
   * link. Used by the HR employee lifecycle.
   */
  async createProvisioned(
    input: Omit<CreateUser, 'email'> & { email?: string },
    by: string | null,
    extra: {
      username: string;
      employeeId: string;
      activationToken: string;
      activationExpiresAt: Date;
    },
  ): Promise<UserDoc> {
    const username = extra.username.toLowerCase();
    if ((await userRepository.findByUsername(username)) !== null) {
      throw new ConflictError('A user with this username already exists');
    }
    if (input.email !== undefined && (await userRepository.findByEmail(input.email)) !== null) {
      throw new ConflictError('A user with this email already exists');
    }
    const user = await unitOfWork(async (session) => {
      const created = await userRepository.create(
        {
          email: input.email ?? null,
          username,
          employeeId: new Types.ObjectId(extra.employeeId),
          phone: input.phone ?? null,
          profile: { firstName: input.firstName, lastName: input.lastName },
          locale: input.locale,
          status: 'invited',
          organization: {
            branchId:
              input.organization.branchId === null
                ? null
                : new Types.ObjectId(input.organization.branchId),
            departmentId:
              input.organization.departmentId === null
                ? null
                : new Types.ObjectId(input.organization.departmentId),
            sectionId:
              input.organization.sectionId === null
                ? null
                : new Types.ObjectId(input.organization.sectionId),
            jobTitleId:
              input.organization.jobTitleId === null
                ? null
                : new Types.ObjectId(input.organization.jobTitleId),
          },
          activation: {
            tokenHash: sha256(extra.activationToken),
            expiresAt: extra.activationExpiresAt,
            sentAt: new Date(),
            delivery: null,
          },
        },
        { by, session },
      );
      await emit(
        PlatformEvents.UserCreated,
        { userId: String(created._id), email: created.email, status: created.status },
        { reliable: true, session },
      );
      return created;
    });
    nudgeOutboxRelay();
    await auditService.record({
      entityRef: entityRef(String(user._id)),
      action: 'accountAutoCreated',
      changes: [{ field: 'username', old: null, new: username }],
    });
    await auditService.record({
      entityRef: entityRef(String(user._id)),
      action: 'invitationCreated',
      changes: [{ field: 'mode', old: null, new: 'initial' }],
    });
    return user;
  }

  /**
   * A placement must be a real path down the organization tree (SA-3 / decision R6).
   *
   * The four fields are independent nullable ids with no derivation, so nothing stopped an account
   * from carrying a department belonging to another branch, or a section belonging to another
   * department. That is not a cosmetic inconsistency: a `department`-scoped grant resolves against
   * `user.organization.departmentId` and the repository filters other collections by the same id,
   * so a mismatched placement silently grants reach into a branch the account does not belong to.
   *
   * The org tree already carries the answer — `departments.branchId` and `sections.departmentId` are
   * both required columns — so this reads it rather than inventing a second source of truth.
   * Validated against the RESULTING placement, because a partial edit changes only some of it.
   *
   * What it refuses is a CONTRADICTION, not an incomplete path. An account placed in a department
   * with no branch names no branch it does not belong to — and the platform already provisions such
   * accounts (HR's confinement fixtures among them). It also fails closed where it matters: a
   * branch-scoped grant to an account with no branch is refused by `assignRole`, not silently
   * widened. Demanding the branch as well would be asking the caller to restate a fact the
   * department already carries, and would reject placements that were never wrong.
   */
  private async assertPlacementConsistent(next: {
    branchId: Types.ObjectId | null;
    departmentId: Types.ObjectId | null;
    sectionId: Types.ObjectId | null;
  }): Promise<void> {
    if (next.departmentId !== null) {
      const department = await departmentRepository.findById(String(next.departmentId));
      if (department === null) throw new BusinessRuleError('unknown department');
      if (next.branchId !== null && String(department.branchId) !== String(next.branchId)) {
        throw new BusinessRuleError('the department does not belong to the selected branch');
      }
    }
    if (next.sectionId !== null) {
      const section = await sectionRepository.findById(String(next.sectionId));
      if (section === null) throw new BusinessRuleError('unknown section');
      if (next.departmentId !== null && String(section.departmentId) !== String(next.departmentId)) {
        throw new BusinessRuleError('the section does not belong to the selected department');
      }
      if (next.branchId !== null && String(section.branchId) !== String(next.branchId)) {
        throw new BusinessRuleError('the section does not belong to the selected branch');
      }
    }
  }

  async update(id: string, input: UpdateUser, by: string, scope?: ScopeSelector): Promise<UserDoc> {
    const before = await userRepository.getById(id, scope);
    const set: Record<string, unknown> = {};
    if (input.firstName !== undefined) set['profile.firstName'] = input.firstName;
    if (input.lastName !== undefined) set['profile.lastName'] = input.lastName;
    if (input.phone !== undefined) set.phone = input.phone;
    if (input.locale !== undefined) set.locale = input.locale;
    if (input.email !== undefined) {
      const email = input.email === null ? null : input.email.toLowerCase();
      if (email !== null) {
        const clash = await userRepository.findByEmail(email);
        if (clash !== null && String(clash._id) !== id) {
          throw new ConflictError('A user with this email already exists');
        }
      }
      set.email = email;
    }
    if (input.username !== undefined) {
      const username = input.username.toLowerCase();
      const clash = await userRepository.findByUsername(username);
      if (clash !== null && String(clash._id) !== id) {
        throw new ConflictError('A user with this username already exists');
      }
      set.username = username;
    }
    // The create-time invariant, applied to the RESULT of this edit rather than to its input:
    // clearing the email is fine for an account that signs in by username, and locks out an account
    // that does not. Only the stored state can tell the two apart.
    const nextEmail = 'email' in set ? (set.email as string | null) : before.email;
    const nextUsername = 'username' in set ? (set.username as string | null) : before.username;
    if (nextEmail === null && nextUsername === null) {
      throw new BusinessRuleError(
        'an account needs at least one login identifier — an email or a username',
      );
    }
    if (input.organization !== undefined) {
      for (const field of ['branchId', 'departmentId', 'sectionId', 'jobTitleId'] as const) {
        const value = input.organization[field];
        if (value !== undefined) {
          set[`organization.${field}`] = value === null ? null : new Types.ObjectId(value);
        }
      }
      const resulting = <K extends 'branchId' | 'departmentId' | 'sectionId'>(
        field: K,
      ): Types.ObjectId | null =>
        `organization.${field}` in set
          ? (set[`organization.${field}`] as Types.ObjectId | null)
          : before.organization[field];
      await this.assertPlacementConsistent({
        branchId: resulting('branchId'),
        departmentId: resulting('departmentId'),
        sectionId: resulting('sectionId'),
      });
    }
    const after = await userRepository.updateById(id, set, { by, version: input.version, scope });

    // Two fields of this edit are cached in the auth snapshot, so both have to drop it.
    //
    // A placement is not a display field: `AuthContext.branchId/departmentId/sectionId` come from
    // the cached auth snapshot, and `scopeFilter` builds every scoped query out of them. Left
    // cached, an account moved out of a branch would keep reading that branch for the rest of the
    // snapshot's TTL. Dropped here, the next request rebuilds it from the record.
    //
    // `locale` joined the snapshot after this line was written and was never added to it — so an
    // administrator switching someone's language left `AuthContext.locale` stale for up to the
    // TTL, which is the language the notification email and the IT display names are written in.
    if (input.organization !== undefined || before.locale !== after.locale) {
      await getCache().del(`auth:user:${id}`);
    }

    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(auditSnapshot(before), auditSnapshot(after)),
    });
    if (input.username !== undefined && before.username !== after.username) {
      await auditService.record({
        entityRef: entityRef(id),
        action: 'usernameChanged',
        changes: [{ field: 'username', old: before.username, new: after.username }],
      });
    }
    await emit(PlatformEvents.UserUpdated, {
      userId: id,
      email: after.email,
      status: after.status,
    });
    return after;
  }

  async changeStatus(id: string, input: ChangeUserStatus, by: string): Promise<UserDoc> {
    const before = await userRepository.getById(id);
    const allowed: Record<UserStatus, UserStatus[]> = {
      // §15.5 — a never-activated login can be disabled (exit/admin) before first use.
      invited: ['suspended', 'archived'],
      active: ['suspended', 'archived'],
      suspended: ['active', 'archived'],
      archived: [],
    };
    if (!allowed[before.status].includes(input.status)) {
      throw new BusinessRuleError(
        `Status change ${before.status} → ${input.status} is not allowed`,
      );
    }
    // Archiving is terminal — `archived: []` above — so it is the MORE final of the two retirements,
    // not the softer one. Deleting is at least reversible by someone with database access;
    // archiving an account is reversible by nobody through any API this platform offers. Both doors
    // therefore carry the same two refusals.
    if (input.status === 'archived') await this.assertRetirable(id, by, 'archive');
    // §15.5 — disabling an account kills any pending setup link in the same operation.
    const revokeInvitation =
      (input.status === 'suspended' || input.status === 'archived') &&
      before.activation.tokenHash !== null;
    const after = await userRepository.updateById(
      id,
      revokeInvitation
        ? { status: input.status, 'activation.tokenHash': null, 'activation.expiresAt': null }
        : { status: input.status },
      { by, version: input.version },
    );

    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: before.status, new: after.status }],
    });
    if (revokeInvitation) {
      await auditService.record({
        entityRef: entityRef(id),
        action: 'invitationRevoked',
        changes: [{ field: 'reason', old: null, new: `user-${input.status}` }],
      });
    }
    // auth reacts in-process (session revocation on suspend/archive).
    await emit(PlatformEvents.UserStatusChanged, {
      userId: id,
      email: after.email,
      status: after.status,
    });
    return after;
  }

  /**
   * The two accounts an administrator must not be able to retire, whichever door they use.
   *
   * Both mirror the rules SA-3 already applies to a role ASSIGNMENT (ADR-026 §5), for the same
   * reason and with the same shape: retiring your own account locks you out of the screen you would
   * need to undo it, and retiring the last Super Admin leaves a system nobody can administer. The
   * difference is that these are worse — a revoked grant can be re-granted by anyone with
   * `role.assign`, while `archived` is a terminal status with no transition out of it, and a
   * soft-deleted account is invisible to every read the API offers.
   *
   * `by` is the ACTOR, not the subject — the same argument every write in this service already
   * carries, so the check needs nothing new plumbed through.
   */
  private async assertRetirable(id: string, by: string, what: string): Promise<void> {
    if (id === by) {
      throw new BusinessRuleError(`You cannot ${what} your own account`);
    }
    // The REPOSITORIES, not `rbacService`: that service imports this one, so reaching for it here
    // would close a module cycle. These two are leaves — the same reason the department and section
    // repositories are imported directly a few lines above — and the query is the one
    // `rbacService.userIdsWithSystemRole('super-admin')` runs, which is why it is safe to restate.
    const superAdminRole = await roleRepository.findByKey(SUPER_ADMIN_ROLE_KEY);
    const holders =
      superAdminRole === null
        ? []
        : await roleAssignmentRepository.distinctUserIdsForRole(String(superAdminRole._id));
    // Holding the grant is not the same as being able to USE it. `distinctUserIdsForRole` counts
    // assignments, and an archived or suspended account keeps its assignments by design (archiving
    // is not a revocation) — so counting holders would let the last USABLE Super Admin be retired
    // as long as a retired one still carried the role. The question this guard asks is "would
    // anybody be able to sign in and administer the system afterwards", so it counts accounts that
    // can actually sign in.
    const superAdmins = await userRepository.activeIdsAmong(holders);
    if (superAdmins.length <= 1 && superAdmins.includes(id)) {
      throw new BusinessRuleError(
        `This is the last Super Admin — grant the role to another account before you ${what} this one`,
      );
    }
  }

  /**
   * A soft delete, deliberately: `isDeleted` is set and the row stays. Every read in the system
   * goes through `BaseRepository.baseFilter`, which adds `isDeleted: false`, so the account
   * disappears from lists and answers 404 — while the audit trail, which lives in its own
   * collection and joins on nothing, survives intact. That is what makes deletion reviewable after
   * the fact, and it is why SA-5 exposes this call rather than replacing it.
   */
  async softDelete(id: string, by: string, scope?: ScopeSelector): Promise<void> {
    // Scoped read FIRST: an account the caller cannot see answers 404, never a rule violation that
    // would confirm it exists.
    const before = await userRepository.getById(id, scope);
    await this.assertRetirable(id, by, 'delete');
    // §15.5 — a pending setup link dies with the account.
    if (before.activation.tokenHash !== null) {
      await userRepository.updateSecurity(id, {
        $set: { 'activation.tokenHash': null, 'activation.expiresAt': null },
      });
      await auditService.record({
        entityRef: entityRef(id),
        action: 'invitationRevoked',
        changes: [{ field: 'reason', old: null, new: 'user-deleted' }],
      });
    }
    const doc = await userRepository.softDeleteById(id, { by, scope });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
    await emit(PlatformEvents.UserStatusChanged, {
      userId: id,
      email: doc.email,
      status: 'archived',
    });
  }

  async getById(id: string, scope?: ScopeSelector): Promise<UserDoc> {
    return userRepository.getById(id, scope);
  }

  async findByEmail(email: string): Promise<UserDoc | null> {
    return userRepository.findByEmail(email);
  }

  /**
   * The user's own presentation preferences. Self-service by construction — the caller can only
   * ever name themselves — so it carries no permission and no audit entry: which navigation shell
   * someone prefers is not an act on the business record.
   */
  async updateMyPreferences(userId: string, input: UpdateMyPreferences): Promise<UserDoc> {
    const updated = await userRepository.updateSecurity(userId, {
      $set: { 'preferences.navLayout': input.navLayout },
    });
    if (updated === null) throw new NotFoundError('User');
    return updated;
  }

  /** Login resolution: an identifier is matched against username first, then email (ADR-017). */
  async findByUsernameOrEmail(identifier: string): Promise<UserDoc | null> {
    const normalized = identifier.toLowerCase().trim();
    return (
      (await userRepository.findByUsername(normalized)) ??
      (await userRepository.findByEmail(normalized))
    );
  }

  /**
   * Configurable login resolution (design 4.3): the enabled identifier kinds come from the
   * `auth.loginIdentifiers` org setting; `employeeCode` resolves through the HR seam so the
   * printed code keeps working even after an admin changes the username.
   */
  async findByIdentifier(identifier: string): Promise<UserDoc | null> {
    const normalized = identifier.toLowerCase().trim();
    const kinds = await settingsService.resolve<string[]>(SettingKeys.AuthLoginIdentifiers, {
      userId: null,
      branchId: null,
    });
    if (kinds.includes('username')) {
      const byUsername = await userRepository.findByUsername(normalized);
      if (byUsername !== null) return byUsername;
    }
    if (kinds.includes('email')) {
      const byEmail = await userRepository.findByEmail(normalized);
      if (byEmail !== null) return byEmail;
    }
    if (kinds.includes('employeeCode')) {
      const userId = await resolveEmployeeCode(identifier.trim().toUpperCase());
      if (userId !== null) return userRepository.findById(userId);
    }
    return null;
  }

  async list(query: ListUsersQuery, scope: ScopeSelector): Promise<Paginated<UserDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.branchId !== undefined)
      filter['organization.branchId'] = new Types.ObjectId(query.branchId);
    const search = query.search === undefined ? {} : userRepository.searchFilter(query.search);
    return userRepository.list({
      filter: { ...filter, ...search },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['email', 'status', 'createdAt'],
      scope,
    });
  }

  // ── Credential/security state (called by auth flows) ──────────────────────

  async activateWithToken(token: string, password: string): Promise<UserDoc> {
    const user = await userRepository.findByActivationTokenHash(sha256(token));
    // §14: a valid token completes FIRST setup (invited) or a post-reset re-setup (active) —
    // token possession is the authorization either way. Suspended/archived accounts refuse.
    const eligible = user !== null && (user.status === 'invited' || user.status === 'active');
    const expired =
      user !== null &&
      (user.activation.expiresAt === null || user.activation.expiresAt < new Date());
    if (user === null || !eligible || expired) {
      // §15.7 — an attempt that matched a user is attributable; unknown tokens are not
      // (they carry no identity) and are covered by the route's strict rate limit.
      if (user !== null) {
        await auditService.record({
          entityRef: entityRef(String(user._id)),
          action: 'invitationAttemptInvalid',
          changes: [
            { field: 'reason', old: null, new: eligible ? 'expired' : 'account-not-eligible' },
          ],
        });
      }
      throw new BusinessRuleError(
        'Activation token is invalid or expired',
        ErrorCodes.AUTH_ACTIVATION_TOKEN_INVALID,
      );
    }
    await this.assertPasswordPolicy(password);
    const wasInvited = user.status === 'invited';
    const updated = await userRepository.updateSecurity(String(user._id), {
      $set: {
        passwordHash: await hashPassword(password),
        status: 'active',
        'security.passwordChangedAt': new Date(),
        // §16.5 — first activation only; a post-reset re-setup keeps the original date.
        ...((user.security.activatedAt ?? null) === null
          ? { 'security.activatedAt': new Date() }
          : {}),
        'activation.tokenHash': null,
        'activation.expiresAt': null,
      },
    });
    if (updated === null) throw new NotFoundError();

    // §15.7 — the one-time link was consumed successfully (§15.1: it is now dead).
    await auditService.record({
      entityRef: entityRef(String(user._id)),
      action: 'invitationUsed',
      actor: { userId: String(user._id), ip: null, userAgent: null },
    });
    if (wasInvited) {
      await auditService.record({
        entityRef: entityRef(String(user._id)),
        action: 'statusChange',
        changes: [{ field: 'status', old: 'invited', new: 'active' }],
        actor: { userId: String(user._id), ip: null, userAgent: null },
      });
      // §14: the first authenticated use of the account's credential.
      await auditService.record({
        entityRef: entityRef(String(user._id)),
        action: 'firstLogin',
        actor: { userId: String(user._id), ip: null, userAgent: null },
      });
      await emit(PlatformEvents.UserStatusChanged, {
        userId: String(user._id),
        email: updated.email,
        status: 'active',
      });
    } else {
      await auditService.record({
        entityRef: entityRef(String(user._id)),
        action: 'passwordChanged',
        actor: { userId: String(user._id), ip: null, userAgent: null },
      });
    }
    return updated;
  }

  async setPassword(
    userId: string,
    password: string,
    action: 'passwordChanged' | 'passwordReset',
  ): Promise<void> {
    await this.assertPasswordPolicy(password);
    const updated = await userRepository.updateSecurity(userId, {
      $set: {
        passwordHash: await hashPassword(password),
        'security.passwordChangedAt': new Date(),
        'security.failedLogins': 0,
        'security.lockedUntil': null,
        // A successful change is the ONLY thing that clears the first-login gate (design 4.2).
        'security.mustChangePassword': false,
      },
    });
    if (updated === null) throw new NotFoundError();
    await getCache().del(`auth:user:${userId}`); // the gate lives on the auth snapshot
    await auditService.record({ entityRef: entityRef(userId), action });
  }

  /** One-time setup token — a dedicated seam so tests can capture the delivered secret. */
  generateActivationToken(): string {
    return randomToken();
  }

  /** End of the validity window for a setup link issued right now (§14). */
  async activationLinkExpiry(): Promise<Date> {
    const ttlHours = await settingsService.resolve<number>(SettingKeys.ActivationLinkTtlHours, {
      userId: null,
      branchId: null,
    });
    return new Date(Date.now() + ttlHours * 3_600_000);
  }

  /** §16.5 — persist the per-channel outcome of the latest invitation delivery. */
  async recordDeliveryOutcomes(
    userId: string,
    delivery: CredentialsDeliveryResultDto[],
  ): Promise<void> {
    await userRepository.updateSecurity(userId, { $set: { 'activation.delivery': delivery } });
  }

  /** §14 — deliver the setup link over every reachable channel; outcomes only. */
  private async deliverLinkFor(
    user: UserDoc,
    setupToken: string,
    expiresAt: Date,
    mode: 'reset' | 'resend',
  ): Promise<CredentialsDeliveryResultDto[]> {
    const userId = String(user._id);
    const delivery = await deliverCredentials({
      userId,
      username: user.username ?? user.email ?? userId,
      employeeCode: await resolveEmployeeCodeOfUser(userId),
      phone: user.phone,
      email: user.email,
      setupToken,
      expiresAt,
      mode,
    });
    await this.recordDeliveryOutcomes(userId, delivery);
    return delivery;
  }

  /**
   * Admin reset (design §14.4): lock the account out — password hash cleared, a fresh
   * one-time setup link delivered. The user re-establishes their own password at the link.
   * (Session revocation happens at the route so audit/order match the other admin ops.)
   */
  async resetViaSetupLink(userId: string): Promise<CredentialsDeliveryResultDto[]> {
    const user = await userRepository.getById(userId);
    const token = this.generateActivationToken();
    const expiresAt = await this.activationLinkExpiry();
    const updated = await userRepository.updateSecurity(userId, {
      $set: {
        passwordHash: null,
        'security.failedLogins': 0,
        'security.lockedUntil': null,
        'activation.tokenHash': sha256(token),
        'activation.expiresAt': expiresAt,
        'activation.sentAt': new Date(),
      },
    });
    if (updated === null) throw new NotFoundError();
    await getCache().del(`auth:user:${userId}`);
    await auditService.record({ entityRef: entityRef(userId), action: 'passwordReset' });
    await auditService.record({
      entityRef: entityRef(userId),
      action: 'invitationCreated',
      changes: [{ field: 'mode', old: null, new: 'reset' }],
    });
    return this.deliverLinkFor(user, token, expiresAt, 'reset');
  }

  /**
   * P9-A — issue a setup link and RETURN it, so an administrator can deliver it by hand.
   *
   * **Why this exists.** `WHATSAPP_PROVIDER` defaults to `disabled` and `SMTP_HOST` to a local
   * dev mailbox, and `deliverCredentials` never throws — it records `ok: false` and moves on. On a
   * deployment where neither transport is wired, an account can therefore be created and never
   * activated, because the link is generated, handed to the transports, and forgotten. This is the
   * only path that lets a human carry it instead.
   *
   * **Why it is not `resendSetupLink` with a flag.** Sending a link to the account's own phone and
   * email, and reading that link yourself, are different acts with different consequences: the
   * second is account takeover. They are separate methods behind separate permissions so the audit
   * trail can tell them apart, and so the stronger one can be withheld.
   *
   * **Why an activated account is refused.** For an account that already has a password, issuing a
   * link would have to clear it — that is a reset, it is what `resetViaSetupLink` is for, and it
   * delivers rather than reveals. Allowing it here would turn "help someone get started" into "lock
   * this person out and take their account", which is not the capability that was approved. The
   * refusal is a business rule (422), not a permission failure: the actor may hold the key and
   * still be told no.
   *
   * Nothing is sent. `activation.delivery` is emptied rather than left holding the outcomes of a
   * previous send, which would describe this link as having been emailed when it was not.
   */
  async issueSetupLinkForCopy(userId: string): Promise<{ url: string; expiresAt: Date }> {
    const user = await userRepository.getById(userId);
    // The test is "does this account already have a password", not the DERIVED `accountStatus`.
    // `accountStatusOf` answers `locked` first for a temporary lockout, so an activated account
    // that had just tripped the failed-login counter would not read as `activated` — and
    // `POST /auth/activate` accepts an `active` account holding a valid token (§14.4), so the link
    // would have let its holder choose a new password for somebody who already had one. That is
    // precisely the takeover this refusal exists to prevent, reachable through a state nobody
    // would have thought to try.
    if (user.passwordHash !== null) {
      throw new BusinessRuleError(
        'this account is already activated — a setup link would let its holder replace the password, which is a reset',
      );
    }
    if (user.status === 'suspended' || user.status === 'archived') {
      throw new BusinessRuleError('a retired account cannot be given a setup link');
    }

    const token = this.generateActivationToken();
    const expiresAt = await this.activationLinkExpiry();
    const updated = await userRepository.updateSecurity(userId, {
      $set: {
        'activation.tokenHash': sha256(token),
        'activation.expiresAt': expiresAt,
        'activation.sentAt': new Date(),
        'activation.delivery': [],
      },
    });
    if (updated === null) throw new NotFoundError();

    // Recorded as an invitation like any other, distinguished by mode so the trail can answer
    // "who took this link into their own hands" without a new audit action.
    await auditService.record({
      entityRef: entityRef(userId),
      action: 'invitationCreated',
      changes: [{ field: 'mode', old: null, new: 'copied' }],
    });
    return { url: setupLinkUrl(token), expiresAt };
  }

  /**
   * Re-deliver the setup link (§14.3): allowed only while a link is PENDING — a fresh token
   * replaces (and instantly invalidates) the previous one, with a fresh validity window.
   */
  async resendSetupLink(userId: string): Promise<CredentialsDeliveryResultDto[]> {
    const user = await userRepository.getById(userId);
    if (user.activation.tokenHash === null) {
      throw new BusinessRuleError(
        'no setup link is pending for this account — use reset instead',
      );
    }
    const token = this.generateActivationToken();
    const expiresAt = await this.activationLinkExpiry();
    const updated = await userRepository.updateSecurity(userId, {
      $set: {
        'activation.tokenHash': sha256(token),
        'activation.expiresAt': expiresAt,
        'activation.sentAt': new Date(),
      },
    });
    if (updated === null) throw new NotFoundError();
    // §15.7 — the replacement token invalidated its predecessor (§15.5).
    await auditService.record({ entityRef: entityRef(userId), action: 'invitationResent' });
    return this.deliverLinkFor(user, token, expiresAt, 'resend');
  }

  /** D6 admin force-on/off: force ON clears any enrolled secret — the user re-enrolls. */
  async setTotpRequired(userId: string, required: boolean): Promise<void> {
    const update = required
      ? {
          $set: {
            'security.totp': { enabled: false, secret: null, backupCodeHashes: [], required: true },
          },
        }
      : { $set: { 'security.totp.required': false } };
    const updated = await userRepository.updateSecurity(userId, update);
    if (updated === null) throw new NotFoundError();
    await auditService.record({
      entityRef: entityRef(userId),
      action: 'totpRequiredChanged',
      changes: [{ field: 'required', old: !required, new: required }],
    });
  }

  /** Admin TOTP reset (D6): wipes enrollment, keeps the `required` flag as-is. */
  async resetTotp(userId: string): Promise<void> {
    const current = await userRepository.getById(userId);
    const updated = await userRepository.updateSecurity(userId, {
      $set: {
        'security.totp': {
          enabled: false,
          secret: null,
          backupCodeHashes: [],
          required: current.security.totp.required,
        },
      },
    });
    if (updated === null) throw new NotFoundError();
    await auditService.record({ entityRef: entityRef(userId), action: 'totpReset' });
  }

  /**
   * The policy in force, resolved at the ORGANIZATION level — both keys declare
   * `allowedScopes: ['organization']`, so there is no per-caller answer to give and no per-caller
   * answer to leak. FIX-2 reads this from a public endpoint so the activation screen, which has no
   * session, can list the rules the server is about to apply.
   */
  async passwordPolicy(): Promise<PasswordPolicyDto> {
    const subject = { userId: null, branchId: null };
    return {
      minLength: await settingsService.resolve<number>(SettingKeys.PasswordMinLength, subject),
      requireComplexity: await settingsService.resolve<boolean>(
        SettingKeys.PasswordRequireComplexity,
        subject,
      ),
    };
  }

  async assertPasswordPolicy(password: string): Promise<void> {
    // The same read the public endpoint serves, so the checklist a user was shown and the rule
    // that refuses them cannot describe different policies.
    const violation = passwordPolicyViolation(password, await this.passwordPolicy());
    if (violation !== null) {
      throw new BusinessRuleError(violation, ErrorCodes.AUTH_PASSWORD_POLICY);
    }
  }

  /**
   * §15.7 hourly sweep: expired pending links are REVOKED (stale secrets never linger) and
   * `invitationExpired` is audited once per invitation. Re-issue afterwards is an admin reset.
   */
  async sweepExpiredInvitations(): Promise<number> {
    const expired = await userRepository.findExpiredActivations(new Date());
    let swept = 0;
    for (const user of expired) {
      // Guarded by the same hash so a concurrent resend/activation is never clobbered.
      const cleared = await userRepository.clearActivationByHash(
        String(user._id),
        user.activation.tokenHash ?? '',
      );
      if (!cleared) continue;
      swept += 1;
      await auditService.record({
        entityRef: entityRef(String(user._id)),
        action: 'invitationExpired',
      });
    }
    return swept;
  }

  /** Seed-only: activates an account without the invite/activation flow. */
  async forceActivate(userId: string): Promise<void> {
    const updated = await userRepository.updateSecurity(userId, {
      $set: {
        status: 'active',
        'security.activatedAt': new Date(),
        'activation.tokenHash': null,
        'activation.expiresAt': null,
      },
    });
    if (updated === null) throw new NotFoundError();
  }

  /** §16.5 — stamp the last completed login (called by the auth pipeline only). */
  async recordLogin(userId: string): Promise<void> {
    await userRepository.updateSecurity(userId, { $set: { 'security.lastLoginAt': new Date() } });
  }

  async recordFailedLogin(
    userId: string,
    lockAfter: number,
    lockMinutes: number,
  ): Promise<{ locked: boolean }> {
    const updated = await userRepository.updateSecurity(userId, {
      $inc: { 'security.failedLogins': 1 },
    });
    if (updated === null) return { locked: false };
    if (updated.security.failedLogins >= lockAfter) {
      await userRepository.updateSecurity(userId, {
        $set: {
          'security.lockedUntil': new Date(Date.now() + lockMinutes * 60_000),
          'security.failedLogins': 0,
        },
      });
      return { locked: true };
    }
    return { locked: false };
  }

  async resetLoginFailures(userId: string): Promise<void> {
    await userRepository.updateSecurity(userId, {
      $set: { 'security.failedLogins': 0, 'security.lockedUntil': null },
    });
  }

  /**
   * Administrative unlock (SA-2): clear the automatic lockout the failed-login counter armed.
   *
   * It reuses `resetLoginFailures` — the same two fields a SUCCESSFUL login clears — rather than
   * introducing a second notion of "unlocked", and it deliberately does NOT touch `status`: an
   * account can be both suspended and locked out, and clearing the lockout must not quietly
   * re-enable a disabled account.
   *
   * The scoped read is the authorization boundary, exactly as it is for update and delete: an
   * administrator who cannot see the account cannot unlock it, and gets a 404 rather than a hint
   * that it exists.
   *
   * Audited unconditionally, including when nothing was locked. The row records that an
   * administrator took the action, and "it turned out to be unnecessary" is a fact about the
   * account, not a reason to lose who did it.
   */
  async unlock(id: string, by: string, scope?: ScopeSelector): Promise<UserDoc> {
    const before = await userRepository.getById(id, scope);
    await this.resetLoginFailures(id);
    await getCache().del(`auth:user:${id}`);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'unlock',
      changes: [
        {
          field: 'security.lockedUntil',
          old: before.security.lockedUntil?.toISOString() ?? null,
          new: null,
        },
        { field: 'security.failedLogins', old: before.security.failedLogins, new: 0 },
      ],
    });
    return userRepository.getById(id, scope);
  }

  // ── Employee linkage (written by the HR module ONLY — ADR-017) ─────────────
  //
  // `user.employeeId` is the AUTHORITY for the link and carries the unique index that makes "one
  // login per employee" true; `employee.userId` is its denormalized back-reference. HR owns the
  // relationship, so these two writers exist for HR's service to call and are reachable from
  // nowhere else: no route, no update schema field, no controller. Both are conditional updates
  // guarded by the CURRENT value — the `clearActivationByHash` pattern — so two concurrent links
  // cannot both believe they won.

  async linkEmployee(userId: string, employeeId: string, session?: ClientSession): Promise<void> {
    const linked = await userRepository.linkEmployee(userId, employeeId, session);
    if (!linked) {
      throw new ConflictError('this login is already linked to an employee');
    }
  }

  async unlinkEmployee(userId: string, employeeId: string, session?: ClientSession): Promise<void> {
    const unlinked = await userRepository.unlinkEmployee(userId, employeeId, session);
    if (!unlinked) {
      throw new ConflictError('this login is not linked to that employee');
    }
  }

  async bumpPermissionVersion(userId: string): Promise<number> {
    const updated = await userRepository.updateSecurity(userId, {
      $inc: { 'security.permissionVersion': 1 },
    });
    if (updated === null) throw new NotFoundError();
    return updated.security.permissionVersion;
  }

  async setTotp(
    userId: string,
    totp: { enabled: boolean; secret: string | null; backupCodeHashes: string[] },
  ): Promise<void> {
    const updated = await userRepository.updateSecurity(userId, {
      $set: { 'security.totp': totp },
    });
    if (updated === null) throw new NotFoundError();
    await auditService.record({
      entityRef: entityRef(userId),
      action: totp.enabled ? 'totpEnrolled' : 'totpDisabled',
    });
  }

  async consumeBackupCode(userId: string, codeHash: string): Promise<boolean> {
    return userRepository.consumeBackupCode(userId, codeHash);
  }

  /** §15.4 — derived, never stored. First matching rule wins. */
  accountStatusOf(doc: UserDoc): AccountStatus {
    if (doc.status === 'suspended' || doc.status === 'archived') return 'locked';
    if (doc.security.lockedUntil !== null && doc.security.lockedUntil > new Date()) {
      return 'locked';
    }
    // Awaiting a setup link: never activated, or credential cleared by an admin reset.
    if (doc.status === 'invited' || doc.passwordHash === null) {
      const linkValid =
        doc.activation.tokenHash !== null &&
        doc.activation.expiresAt !== null &&
        doc.activation.expiresAt > new Date();
      return linkValid ? 'invitationSent' : 'expired';
    }
    return 'activated';
  }

  toDto(doc: UserDoc): UserDto {
    return {
      id: String(doc._id),
      email: doc.email,
      username: doc.username,
      employeeId: doc.employeeId === null ? null : String(doc.employeeId),
      phone: doc.phone,
      firstName: doc.profile.firstName,
      lastName: doc.profile.lastName,
      locale: doc.locale,
      status: doc.status,
      organization: {
        branchId: doc.organization.branchId === null ? null : String(doc.organization.branchId),
        departmentId:
          doc.organization.departmentId === null ? null : String(doc.organization.departmentId),
        sectionId: doc.organization.sectionId === null ? null : String(doc.organization.sectionId),
        jobTitleId:
          doc.organization.jobTitleId === null ? null : String(doc.organization.jobTitleId),
      },
      mustChangePassword: doc.security.mustChangePassword ?? false,
      setupLinkPending: doc.activation.tokenHash !== null,
      accountStatus: this.accountStatusOf(doc),
      invitationSentAt: (doc.activation.sentAt ?? null)?.toISOString() ?? null,
      invitationExpiresAt: (doc.activation.expiresAt ?? null)?.toISOString() ?? null,
      activatedAt: (doc.security.activatedAt ?? null)?.toISOString() ?? null,
      lastLoginAt: (doc.security.lastLoginAt ?? null)?.toISOString() ?? null,
      passwordChangedAt: (doc.security.passwordChangedAt ?? null)?.toISOString() ?? null,
      lastDelivery: doc.activation.delivery ?? null,
      totpEnabled: doc.security.totp.enabled,
      totpRequired: doc.security.totp.required ?? false,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const userService = new UserService();
