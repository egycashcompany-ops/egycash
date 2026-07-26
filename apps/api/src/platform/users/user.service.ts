// Business rules for user accounts. Lifecycle: invite → activate → suspend → archive —
// never hard-delete (audit integrity, Platform Core §2).
import { Types } from 'mongoose';
import {
  ErrorCodes,
  PlatformEvents,
  SettingKeys,
  type ChangeUserStatus,
  type CreateUser,
  type CredentialsDeliveryResultDto,
  type ListUsersQuery,
  type Paginated,
  type UpdateUser,
  type UserDto,
  type UserStatus,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/errors';
import { type ScopeSelector } from '../../shared/types';
import { diffChanges } from '../../shared/utils/diff';
import { randomToken, sha256 } from '../../shared/utils/crypto';
import { hashPassword, passwordPolicyViolation } from '../../shared/utils/passwords';
import { getCache } from '../../infrastructure/redis/cache';
import { resolveEmployeeCode, resolveEmployeeCodeOfUser } from '../auth/identity-seams';
import { deliverCredentials } from './credentials-delivery';
import { auditService } from '../audit';
import { settingsService } from '../settings';
import { emit, nudgeOutboxRelay } from '../kernel/event-bus';
import { unitOfWork } from '../kernel/unit-of-work';
import { userRepository } from './user.repository';
import { type UserDoc } from './user.model';

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
    const username = extra.username?.toLowerCase();
    if (username !== undefined && (await userRepository.findByUsername(username)) !== null) {
      throw new ConflictError('A user with this username already exists');
    }

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
    return user;
  }

  async update(id: string, input: UpdateUser, by: string, scope?: ScopeSelector): Promise<UserDoc> {
    const before = await userRepository.getById(id, scope);
    const set: Record<string, unknown> = {};
    if (input.firstName !== undefined) set['profile.firstName'] = input.firstName;
    if (input.lastName !== undefined) set['profile.lastName'] = input.lastName;
    if (input.phone !== undefined) set.phone = input.phone;
    if (input.locale !== undefined) set.locale = input.locale;
    if (input.username !== undefined) {
      const username = input.username.toLowerCase();
      const clash = await userRepository.findByUsername(username);
      if (clash !== null && String(clash._id) !== id) {
        throw new ConflictError('A user with this username already exists');
      }
      set.username = username;
    }
    if (input.organization !== undefined) {
      for (const field of ['branchId', 'departmentId', 'sectionId', 'jobTitleId'] as const) {
        const value = input.organization[field];
        if (value !== undefined) {
          set[`organization.${field}`] = value === null ? null : new Types.ObjectId(value);
        }
      }
    }
    const after = await userRepository.updateById(id, set, { by, version: input.version, scope });

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
      invited: ['archived'],
      active: ['suspended', 'archived'],
      suspended: ['active', 'archived'],
      archived: [],
    };
    if (!allowed[before.status].includes(input.status)) {
      throw new BusinessRuleError(
        `Status change ${before.status} → ${input.status} is not allowed`,
      );
    }
    const after = await userRepository.updateById(
      id,
      { status: input.status },
      { by, version: input.version },
    );

    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: before.status, new: after.status }],
    });
    // auth reacts in-process (session revocation on suspend/archive).
    await emit(PlatformEvents.UserStatusChanged, {
      userId: id,
      email: after.email,
      status: after.status,
    });
    return after;
  }

  async softDelete(id: string, by: string, scope?: ScopeSelector): Promise<void> {
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
    if (
      user === null ||
      (user.status !== 'invited' && user.status !== 'active') ||
      user.activation.expiresAt === null ||
      user.activation.expiresAt < new Date()
    ) {
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
        'activation.tokenHash': null,
        'activation.expiresAt': null,
      },
    });
    if (updated === null) throw new NotFoundError();

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

  /** §14 — deliver the setup link over every reachable channel; outcomes only. */
  private async deliverLinkFor(
    user: UserDoc,
    setupToken: string,
    expiresAt: Date,
    mode: 'reset' | 'resend',
  ): Promise<CredentialsDeliveryResultDto[]> {
    const userId = String(user._id);
    return deliverCredentials({
      userId,
      username: user.username ?? user.email ?? userId,
      employeeCode: await resolveEmployeeCodeOfUser(userId),
      phone: user.phone,
      email: user.email,
      setupToken,
      expiresAt,
      mode,
    });
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
      },
    });
    if (updated === null) throw new NotFoundError();
    await getCache().del(`auth:user:${userId}`);
    await auditService.record({ entityRef: entityRef(userId), action: 'passwordReset' });
    return this.deliverLinkFor(user, token, expiresAt, 'reset');
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
      $set: { 'activation.tokenHash': sha256(token), 'activation.expiresAt': expiresAt },
    });
    if (updated === null) throw new NotFoundError();
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

  async assertPasswordPolicy(password: string): Promise<void> {
    const subject = { userId: null, branchId: null };
    const minLength = await settingsService.resolve<number>(SettingKeys.PasswordMinLength, subject);
    const requireComplexity = await settingsService.resolve<boolean>(
      SettingKeys.PasswordRequireComplexity,
      subject,
    );
    const violation = passwordPolicyViolation(password, { minLength, requireComplexity });
    if (violation !== null) {
      throw new BusinessRuleError(violation, ErrorCodes.AUTH_PASSWORD_POLICY);
    }
  }

  /** Seed-only: activates an account without the invite/activation flow. */
  async forceActivate(userId: string): Promise<void> {
    const updated = await userRepository.updateSecurity(userId, {
      $set: { status: 'active', 'activation.tokenHash': null, 'activation.expiresAt': null },
    });
    if (updated === null) throw new NotFoundError();
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
      totpEnabled: doc.security.totp.enabled,
      totpRequired: doc.security.totp.required ?? false,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const userService = new UserService();
