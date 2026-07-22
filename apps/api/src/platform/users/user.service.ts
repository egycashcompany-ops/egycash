// Business rules for user accounts. Lifecycle: invite → activate → suspend → archive —
// never hard-delete (audit integrity, Platform Core §2).
import { Types } from 'mongoose';
import {
  ErrorCodes,
  PlatformEvents,
  SettingKeys,
  type ChangeUserStatus,
  type CreateUser,
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
    const existing = await userRepository.findByEmail(input.email);
    if (existing !== null) throw new ConflictError('A user with this email already exists');
    const username = extra.username?.toLowerCase();
    if (username !== undefined && (await userRepository.findByUsername(username)) !== null) {
      throw new ConflictError('A user with this username already exists');
    }

    const activationToken = randomToken();
    const user = await unitOfWork(async (session) => {
      const created = await userRepository.create(
        {
          email: input.email,
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
    if (
      user === null ||
      user.status !== 'invited' ||
      user.activation.expiresAt === null ||
      user.activation.expiresAt < new Date()
    ) {
      throw new BusinessRuleError(
        'Activation token is invalid or expired',
        ErrorCodes.AUTH_ACTIVATION_TOKEN_INVALID,
      );
    }
    await this.assertPasswordPolicy(password);
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

    await auditService.record({
      entityRef: entityRef(String(user._id)),
      action: 'statusChange',
      changes: [{ field: 'status', old: 'invited', new: 'active' }],
      actor: { userId: String(user._id), ip: null, userAgent: null },
    });
    await emit(PlatformEvents.UserStatusChanged, {
      userId: String(user._id),
      email: updated.email,
      status: 'active',
    });
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
      },
    });
    if (updated === null) throw new NotFoundError();
    await auditService.record({ entityRef: entityRef(userId), action });
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
      totpEnabled: doc.security.totp.enabled,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const userService = new UserService();
