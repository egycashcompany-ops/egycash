// Authentication (ADR-006, Security Architecture §1): argon2id verification,
// 15-min JWT access tokens, rotating refresh tokens with reuse detection (family
// revocation on replay), lockout with settings-driven policy, and TOTP 2FA
// enforced for privileged accounts (Review R13).
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { authenticator } from 'otplib';
import {
  ErrorCodes,
  PlatformEvents,
  SettingKeys,
  type EventEnvelope,
  type LoginResponse,
  type MeDto,
  type SessionDto,
  type TotpEnabledDto,
  type TotpEnrollmentDto,
} from '@ecms/contracts';
import { env } from '../../infrastructure/config/env';
import { logger } from '../../infrastructure/logging/logger';
import { getCache } from '../../infrastructure/redis/cache';
import { getContext } from '../../infrastructure/http/request-context';
import { BusinessRuleError, NotFoundError, UnauthenticatedError } from '../../shared/errors';
import { type AuthContext } from '../../shared/types';
import { randomBackupCode, randomToken, sha256 } from '../../shared/utils/crypto';
import { verifyPassword } from '../../shared/utils/passwords';
import { auditService } from '../audit';
import { rbacService } from '../rbac';
import { settingsService } from '../settings';
import { userService, type UserDoc } from '../users';
import { emit, subscribe } from '../kernel/event-bus';
import { SessionModel, type SessionDoc } from './session.model';

const USED_HASHES_KEPT = 20;
const CHALLENGE_TTL_SECONDS = 5 * 60;
const PENDING_TOTP_TTL_SECONDS = 10 * 60;
const USER_SNAPSHOT_TTL_SECONDS = 60;

interface AccessClaims {
  sub: string;
  sid: string;
  pv: number;
  typ: 'access';
}

interface ChallengeClaims {
  sub: string;
  typ: 'totp-challenge' | 'totp-enroll';
}

interface UserSnapshot {
  status: string;
  permissionVersion: number;
  branchId: string | null;
  departmentId: string | null;
  sectionId: string | null;
  locale: 'ar' | 'en';
  totpEnabled: boolean;
}

const userEntityRef = (userId: string) => ({
  moduleId: 'platform',
  entityType: 'user',
  entityId: userId,
});

const actorOf = (user: UserDoc | null) => {
  const context = getContext();
  return {
    userId: user === null ? null : String(user._id),
    ip: context?.actor?.ip ?? null,
    userAgent: context?.actor?.userAgent ?? null,
  };
};

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

class AuthService {
  // ── Token primitives ──────────────────────────────────────────────────────

  signAccessToken(userId: string, sessionId: string, permissionVersion: number): string {
    const claims: AccessClaims = {
      sub: userId,
      sid: sessionId,
      pv: permissionVersion,
      typ: 'access',
    };
    return jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL_SECONDS });
  }

  verifyAccessToken(token: string): AccessClaims {
    try {
      const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessClaims;
      if (decoded.typ !== 'access') throw new UnauthenticatedError(ErrorCodes.AUTH_TOKEN_INVALID);
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthenticatedError(ErrorCodes.AUTH_TOKEN_EXPIRED, 'Access token expired');
      }
      if (error instanceof UnauthenticatedError) throw error;
      throw new UnauthenticatedError(ErrorCodes.AUTH_TOKEN_INVALID, 'Access token invalid');
    }
  }

  private signChallengeToken(userId: string, typ: ChallengeClaims['typ']): string {
    const claims: ChallengeClaims = { sub: userId, typ };
    return jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: CHALLENGE_TTL_SECONDS });
  }

  private verifyChallengeToken(token: string): ChallengeClaims {
    try {
      const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as ChallengeClaims;
      if (decoded.typ !== 'totp-challenge' && decoded.typ !== 'totp-enroll') {
        throw new UnauthenticatedError(ErrorCodes.AUTH_TOKEN_INVALID);
      }
      return decoded;
    } catch (error) {
      if (error instanceof UnauthenticatedError) throw error;
      throw new UnauthenticatedError(ErrorCodes.AUTH_TOKEN_INVALID, 'Challenge token invalid');
    }
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  private async createSession(user: UserDoc): Promise<IssuedTokens & { sessionId: string }> {
    const refreshToken = randomToken();
    const context = getContext();
    const now = new Date();
    const refreshExpiresAt = new Date(now.getTime() + env.REFRESH_TTL_DAYS * 86_400_000);
    const [session] = await SessionModel.create([
      {
        userId: user._id,
        family: randomUUID(),
        currentTokenHash: sha256(refreshToken),
        usedTokenHashes: [],
        device: {
          userAgent: context?.actor?.userAgent ?? null,
          ip: context?.actor?.ip ?? null,
        },
        createdAt: now,
        lastUsedAt: now,
        expiresAt: refreshExpiresAt,
      },
    ]);
    if (session === undefined) throw new NotFoundError('session create failed');
    const accessToken = this.signAccessToken(
      String(user._id),
      String(session._id),
      user.security.permissionVersion,
    );
    return { accessToken, refreshToken, refreshExpiresAt, sessionId: String(session._id) };
  }

  private async denylistSession(sessionId: string): Promise<void> {
    await getCache().set(`denylist:${sessionId}`, '1', env.JWT_ACCESS_TTL_SECONDS + 30);
  }

  async isSessionDenylisted(sessionId: string): Promise<boolean> {
    return (await getCache().get(`denylist:${sessionId}`)) !== null;
  }

  private async revokeSession(session: SessionDoc, reason: string): Promise<void> {
    await SessionModel.updateOne(
      { _id: session._id },
      { $set: { revokedAt: new Date(), revokedReason: reason } },
    ).exec();
    await this.denylistSession(String(session._id));
  }

  async revokeAllSessionsForUser(userId: string, reason: string): Promise<void> {
    const sessions = await SessionModel.find({
      userId: new Types.ObjectId(userId),
      revokedAt: null,
    })
      .lean<SessionDoc[]>()
      .exec();
    for (const session of sessions) await this.revokeSession(session, reason);
    if (sessions.length > 0) {
      await auditService.record({
        entityRef: userEntityRef(userId),
        action: 'sessionRevoked',
        changes: [{ field: 'reason', old: null, new: reason }],
      });
      await emit(PlatformEvents.AuthSessionRevoked, { userId, reason });
    }
  }

  async listSessions(ctx: AuthContext): Promise<SessionDto[]> {
    const sessions = await SessionModel.find({
      userId: new Types.ObjectId(ctx.userId),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ lastUsedAt: -1 })
      .lean<SessionDoc[]>()
      .exec();
    return sessions.map((session) => ({
      id: String(session._id),
      userAgent: session.device.userAgent,
      ip: session.device.ip,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt.toISOString(),
      current: String(session._id) === ctx.sessionId,
    }));
  }

  async revokeOwnSession(ctx: AuthContext, sessionId: string): Promise<void> {
    const session = await SessionModel.findOne({
      _id: new Types.ObjectId(sessionId),
      userId: new Types.ObjectId(ctx.userId),
    })
      .lean<SessionDoc>()
      .exec();
    if (session === null) throw new NotFoundError();
    await this.revokeSession(session, 'user-revoked');
    await auditService.record({ entityRef: userEntityRef(ctx.userId), action: 'sessionRevoked' });
  }

  // ── Login pipeline ────────────────────────────────────────────────────────

  private async loginPolicy(): Promise<{
    maxAttempts: number;
    lockMinutes: number;
    totpEnforced: boolean;
  }> {
    const subject = { userId: null, branchId: null };
    return {
      maxAttempts: await settingsService.resolve<number>(SettingKeys.LockoutMaxAttempts, subject),
      lockMinutes: await settingsService.resolve<number>(SettingKeys.LockoutMinutes, subject),
      totpEnforced: await settingsService.resolve<boolean>(
        SettingKeys.TotpEnforcedForPrivileged,
        subject,
      ),
    };
  }

  async login(
    identifier: string,
    password: string,
  ): Promise<{ response: LoginResponse; tokens?: IssuedTokens }> {
    const policy = await this.loginPolicy();
    // Accepts a username or an email (ADR-017); existing email logins are unaffected.
    const user = await userService.findByUsernameOrEmail(identifier);

    if (user === null || user.passwordHash === null) {
      await auditService.record({
        entityRef: { moduleId: 'platform', entityType: 'user', entityId: identifier },
        action: 'loginFailed',
        actor: actorOf(null),
      });
      await emit(PlatformEvents.AuthLoginFailed, { email: identifier, reason: 'unknown-user' });
      throw new UnauthenticatedError(ErrorCodes.AUTH_INVALID_CREDENTIALS, 'Invalid credentials');
    }

    if (user.security.lockedUntil !== null && user.security.lockedUntil > new Date()) {
      throw new UnauthenticatedError(ErrorCodes.AUTH_ACCOUNT_LOCKED, 'Account temporarily locked');
    }
    if (user.status !== 'active') {
      throw new UnauthenticatedError(ErrorCodes.AUTH_ACCOUNT_NOT_ACTIVE, 'Account is not active');
    }

    const passwordOk = await verifyPassword(user.passwordHash, password);
    if (!passwordOk) {
      const { locked } = await userService.recordFailedLogin(
        String(user._id),
        policy.maxAttempts,
        policy.lockMinutes,
      );
      await auditService.record({
        entityRef: userEntityRef(String(user._id)),
        action: locked ? 'lockout' : 'loginFailed',
        actor: actorOf(user),
      });
      await emit(PlatformEvents.AuthLoginFailed, {
        userId: String(user._id),
        email: user.email,
        reason: locked ? 'locked' : 'bad-password',
      });
      throw new UnauthenticatedError(ErrorCodes.AUTH_INVALID_CREDENTIALS, 'Invalid credentials');
    }

    await userService.resetLoginFailures(String(user._id));

    // 2FA step (Review R13): enrolled users always verify; privileged users MUST enroll.
    const effective = await rbacService.getEffectivePermissions(
      String(user._id),
      user.security.permissionVersion,
    );
    if (user.security.totp.enabled) {
      return {
        response: {
          totpRequired: true,
          challengeToken: this.signChallengeToken(String(user._id), 'totp-challenge'),
          enrollmentRequired: false,
        },
      };
    }
    if (policy.totpEnforced && effective.isPrivileged) {
      return {
        response: {
          totpRequired: true,
          challengeToken: this.signChallengeToken(String(user._id), 'totp-enroll'),
          enrollmentRequired: true,
        },
      };
    }

    return this.completeLogin(user);
  }

  private async completeLogin(
    user: UserDoc,
  ): Promise<{ response: LoginResponse; tokens: IssuedTokens }> {
    const { accessToken, refreshToken, refreshExpiresAt, sessionId } =
      await this.createSession(user);
    await auditService.record({
      entityRef: userEntityRef(String(user._id)),
      action: 'login',
      actor: actorOf(user),
    });
    await emit(PlatformEvents.AuthLoggedIn, {
      userId: String(user._id),
      email: user.email,
      sessionId,
    });
    const me = await this.buildMe(user);
    return {
      response: { totpRequired: false, accessToken, me },
      tokens: { accessToken, refreshToken, refreshExpiresAt },
    };
  }

  // ── TOTP (Review R13) ─────────────────────────────────────────────────────

  private pendingTotpKey(userId: string): string {
    return `totp:pending:${userId}`;
  }

  /** Start enrollment — authenticated user, or enrollment challenge from login. */
  async startTotpEnrollment(userId: string): Promise<TotpEnrollmentDto> {
    const user = await userService.getById(userId);
    if (user.security.totp.enabled) {
      throw new BusinessRuleError('TOTP is already enabled', ErrorCodes.AUTH_TOTP_ALREADY_ENABLED);
    }
    const secret = authenticator.generateSecret();
    await getCache().set(this.pendingTotpKey(userId), secret, PENDING_TOTP_TTL_SECONDS);
    return {
      secret,
      otpauthUrl: authenticator.keyuri(user.email, 'ECMS', secret),
    };
  }

  async startTotpEnrollmentWithChallenge(challengeToken: string): Promise<TotpEnrollmentDto> {
    const claims = this.verifyChallengeToken(challengeToken);
    if (claims.typ !== 'totp-enroll') {
      throw new UnauthenticatedError(ErrorCodes.AUTH_TOKEN_INVALID, 'Wrong challenge type');
    }
    return this.startTotpEnrollment(claims.sub);
  }

  private async enableTotp(userId: string, code: string): Promise<TotpEnabledDto> {
    const secret = await getCache().get(this.pendingTotpKey(userId));
    if (secret === null) {
      throw new BusinessRuleError('No pending TOTP enrollment', ErrorCodes.AUTH_TOTP_INVALID);
    }
    if (!authenticator.verify({ token: code, secret })) {
      throw new UnauthenticatedError(ErrorCodes.AUTH_TOTP_INVALID, 'Invalid TOTP code');
    }
    const backupCodes = Array.from({ length: 10 }, () => randomBackupCode());
    await userService.setTotp(userId, {
      enabled: true,
      secret,
      backupCodeHashes: backupCodes.map((c) => sha256(c)),
    });
    await getCache().del(this.pendingTotpKey(userId));
    await getCache().del(`auth:user:${userId}`);
    return { enabled: true, backupCodes };
  }

  /** Enrollment confirmation for an authenticated user. */
  async verifyTotpEnrollment(userId: string, code: string): Promise<TotpEnabledDto> {
    return this.enableTotp(userId, code);
  }

  /** Second login step: verify a TOTP code (or backup code), then issue tokens. */
  async completeTotpChallenge(
    challengeToken: string,
    code: string,
  ): Promise<{ response: LoginResponse; tokens: IssuedTokens; backupCodes?: string[] }> {
    const claims = this.verifyChallengeToken(challengeToken);
    const user = await userService.getById(claims.sub);
    if (user.status !== 'active') {
      throw new UnauthenticatedError(ErrorCodes.AUTH_ACCOUNT_NOT_ACTIVE, 'Account is not active');
    }

    if (claims.typ === 'totp-enroll') {
      const enabled = await this.enableTotp(claims.sub, code);
      const completed = await this.completeLogin(await userService.getById(claims.sub));
      return { ...completed, backupCodes: enabled.backupCodes };
    }

    const totp = user.security.totp;
    if (!totp.enabled || totp.secret === null) {
      throw new BusinessRuleError('TOTP is not enabled', ErrorCodes.AUTH_TOTP_INVALID);
    }
    const isTotpCode = /^\d{6}$/.test(code);
    const valid = isTotpCode
      ? authenticator.verify({ token: code, secret: totp.secret })
      : await userService.consumeBackupCode(claims.sub, sha256(code.toUpperCase()));
    if (!valid) {
      await auditService.record({
        entityRef: userEntityRef(claims.sub),
        action: 'loginFailed',
        changes: [{ field: 'step', old: null, new: 'totp' }],
      });
      throw new UnauthenticatedError(ErrorCodes.AUTH_TOTP_INVALID, 'Invalid TOTP code');
    }
    return this.completeLogin(user);
  }

  /** Disabling requires a valid current code; privileged users cannot disable while enforced. */
  async disableTotp(ctx: AuthContext, code: string): Promise<void> {
    const policy = await this.loginPolicy();
    if (policy.totpEnforced && ctx.isPrivileged) {
      throw new BusinessRuleError('TOTP is enforced for privileged accounts (Review R13)');
    }
    const user = await userService.getById(ctx.userId);
    if (!user.security.totp.enabled || user.security.totp.secret === null) {
      throw new BusinessRuleError('TOTP is not enabled', ErrorCodes.AUTH_TOTP_INVALID);
    }
    if (!authenticator.verify({ token: code, secret: user.security.totp.secret })) {
      throw new UnauthenticatedError(ErrorCodes.AUTH_TOTP_INVALID, 'Invalid TOTP code');
    }
    await userService.setTotp(ctx.userId, { enabled: false, secret: null, backupCodeHashes: [] });
    await getCache().del(`auth:user:${ctx.userId}`);
  }

  // ── Refresh rotation with reuse detection (ADR-006) ───────────────────────

  async refresh(presentedToken: string): Promise<IssuedTokens> {
    const presentedHash = sha256(presentedToken);
    const now = new Date();

    const session = await SessionModel.findOne({ currentTokenHash: presentedHash })
      .lean<SessionDoc>()
      .exec();

    if (session === null) {
      // Not the current token — a match on a USED hash proves theft/replay.
      const replayed = await SessionModel.findOne({ usedTokenHashes: presentedHash })
        .lean<SessionDoc>()
        .exec();
      if (replayed !== null) {
        await this.revokeSession(replayed, 'refresh-reuse');
        const requestActor = actorOf(null);
        await auditService.record({
          entityRef: userEntityRef(String(replayed.userId)),
          action: 'refreshReuse',
          actor: {
            userId: String(replayed.userId),
            ip: requestActor.ip,
            userAgent: requestActor.userAgent,
          },
        });
        await emit(PlatformEvents.AuthRefreshReuseDetected, {
          userId: String(replayed.userId),
          sessionId: String(replayed._id),
        });
        logger.warn({ sessionId: String(replayed._id) }, 'SECURITY: refresh token reuse detected');
        throw new UnauthenticatedError(ErrorCodes.AUTH_SESSION_REVOKED, 'Session revoked');
      }
      throw new UnauthenticatedError(ErrorCodes.AUTH_TOKEN_INVALID, 'Refresh token invalid');
    }

    if (session.revokedAt !== null) {
      throw new UnauthenticatedError(ErrorCodes.AUTH_SESSION_REVOKED, 'Session revoked');
    }
    if (session.expiresAt <= now) {
      throw new UnauthenticatedError(ErrorCodes.AUTH_TOKEN_EXPIRED, 'Session expired');
    }

    const user = await userService.getById(String(session.userId));
    if (user.status !== 'active') {
      await this.revokeSession(session, 'user-not-active');
      throw new UnauthenticatedError(ErrorCodes.AUTH_ACCOUNT_NOT_ACTIVE, 'Account is not active');
    }

    // Rotate: current → used (bounded), new token becomes current; sliding expiry.
    const newRefreshToken = randomToken();
    const refreshExpiresAt = new Date(now.getTime() + env.REFRESH_TTL_DAYS * 86_400_000);
    const rotated = await SessionModel.findOneAndUpdate(
      { _id: session._id, currentTokenHash: presentedHash },
      {
        $set: {
          currentTokenHash: sha256(newRefreshToken),
          lastUsedAt: now,
          expiresAt: refreshExpiresAt,
        },
        $push: { usedTokenHashes: { $each: [presentedHash], $slice: -USED_HASHES_KEPT } },
      },
      { new: true },
    )
      .lean<SessionDoc>()
      .exec();
    if (rotated === null) {
      // Concurrent rotation race — treat like reuse to be safe.
      throw new UnauthenticatedError(ErrorCodes.AUTH_SESSION_REVOKED, 'Session revoked');
    }

    const accessToken = this.signAccessToken(
      String(user._id),
      String(session._id),
      user.security.permissionVersion,
    );
    return { accessToken, refreshToken: newRefreshToken, refreshExpiresAt };
  }

  async logout(ctx: AuthContext): Promise<void> {
    const session = await SessionModel.findOne({ _id: new Types.ObjectId(ctx.sessionId) })
      .lean<SessionDoc>()
      .exec();
    if (session !== null) await this.revokeSession(session, 'logout');
    await auditService.record({ entityRef: userEntityRef(ctx.userId), action: 'logout' });
  }

  // ── Passwords ─────────────────────────────────────────────────────────────

  async changePassword(
    ctx: AuthContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await userService.getById(ctx.userId);
    if (user.passwordHash === null || !(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new UnauthenticatedError(
        ErrorCodes.AUTH_INVALID_CREDENTIALS,
        'Current password is wrong',
      );
    }
    await userService.setPassword(ctx.userId, newPassword, 'passwordChanged');
    // Kill every other device; the current session stays.
    const sessions = await SessionModel.find({
      userId: new Types.ObjectId(ctx.userId),
      revokedAt: null,
      _id: { $ne: new Types.ObjectId(ctx.sessionId) },
    })
      .lean<SessionDoc[]>()
      .exec();
    for (const session of sessions) await this.revokeSession(session, 'password-changed');
  }

  // ── Request identity (used by the authenticate middleware) ───────────────

  private async userSnapshot(userId: string): Promise<UserSnapshot> {
    const cache = getCache();
    const key = `auth:user:${userId}`;
    const cached = await cache.get(key);
    if (cached !== null) return JSON.parse(cached) as UserSnapshot;
    const user = await userService.getById(userId);
    const org = user.organization;
    const snapshot: UserSnapshot = {
      status: user.status,
      permissionVersion: user.security.permissionVersion,
      branchId: org.branchId === null ? null : String(org.branchId),
      departmentId: org.departmentId === null ? null : String(org.departmentId),
      sectionId: org.sectionId === null ? null : String(org.sectionId),
      locale: user.locale,
      totpEnabled: user.security.totp.enabled,
    };
    await cache.set(key, JSON.stringify(snapshot), USER_SNAPSHOT_TTL_SECONDS);
    return snapshot;
  }

  async buildAuthContext(accessToken: string): Promise<AuthContext> {
    const claims = this.verifyAccessToken(accessToken);
    if (await this.isSessionDenylisted(claims.sid)) {
      throw new UnauthenticatedError(ErrorCodes.AUTH_SESSION_REVOKED, 'Session revoked');
    }
    let snapshot: UserSnapshot;
    try {
      snapshot = await this.userSnapshot(claims.sub);
    } catch {
      throw new UnauthenticatedError(ErrorCodes.AUTH_TOKEN_INVALID, 'User no longer exists');
    }
    if (snapshot.status !== 'active') {
      throw new UnauthenticatedError(ErrorCodes.AUTH_ACCOUNT_NOT_ACTIVE, 'Account is not active');
    }
    // Permissions are resolved against the CURRENT version — role changes take
    // effect within the snapshot TTL, not the token lifetime.
    const effective = await rbacService.getEffectivePermissions(
      claims.sub,
      snapshot.permissionVersion,
    );
    return {
      userId: claims.sub,
      sessionId: claims.sid,
      branchId: snapshot.branchId,
      departmentId: snapshot.departmentId,
      sectionId: snapshot.sectionId,
      locale: snapshot.locale,
      permissions: effective.permissions,
      permissionVersion: snapshot.permissionVersion,
      isPrivileged: effective.isPrivileged,
    };
  }

  async buildMe(user: UserDoc): Promise<MeDto> {
    const effective = await rbacService.getEffectivePermissions(
      String(user._id),
      user.security.permissionVersion,
    );
    const flags = await settingsService.getFlagsFor({
      userId: String(user._id),
      branchId: user.organization.branchId === null ? null : String(user.organization.branchId),
    });
    return {
      id: String(user._id),
      email: user.email,
      name: { firstName: user.profile.firstName, lastName: user.profile.lastName },
      locale: user.locale,
      branchId: user.organization.branchId === null ? null : String(user.organization.branchId),
      permissions: effective.permissions,
      isPrivileged: effective.isPrivileged,
      flags,
      totpEnabled: user.security.totp.enabled,
    };
  }

  async me(ctx: AuthContext): Promise<MeDto> {
    return this.buildMe(await userService.getById(ctx.userId));
  }
}

export const authService = new AuthService();

/** In-process reactions: suspend/archive revokes sessions and drops caches. */
export const registerAuthEventHandlers = (): void => {
  subscribe(
    PlatformEvents.UserStatusChanged,
    'auth.session-revocation',
    async (envelope: EventEnvelope) => {
      const payload = envelope.payload as { userId: string; status: string };
      await getCache().del(`auth:user:${payload.userId}`);
      if (payload.status === 'suspended' || payload.status === 'archived') {
        await authService.revokeAllSessionsForUser(payload.userId, `user-${payload.status}`);
      }
    },
  );
};
