// Passkeys — sign-in with fingerprint / Face ID (ADR-035, passkey design).
//
// Two WebAuthn ceremonies. ADDING one: the signed-in person proves themselves again (password, and
// the TOTP code when they have one), the server issues a challenge bound to their session, the
// device makes a key pair and returns the public half, signed. SIGNING IN: the server issues a
// challenge to anyone, the device signs it with a key it holds for this site, the server checks the
// signature against the public key it kept — and then every barrier the password path has.
//
// What decides the security, in one place:
// - the relying party (RP ID, origin) comes from configuration, never from the request: `trust
//   proxy` makes Host and X-Forwarded-* the caller's to write;
// - every challenge is held server-side and consumed once (`take`, a GETDEL), five minutes;
// - user verification is required in both ceremonies;
// - attestation is `none`, and a response claiming any other format is refused before the library
//   sees it: the library's certificate-path code fetches revocation lists from URLs inside the
//   certificates — client-supplied ones, for android-key — which would be outbound HTTP on attacker
//   input, outside ADR-033's door. The trust anchors are emptied too, belt and braces;
// - a sign-in refusal says one thing (`AUTH_PASSKEY_INVALID`) whatever went wrong with the key or
//   the account before the signature was proven — only a spent or unknown challenge, which is
//   checked before any account is looked at, has its own uncounted answer
//   (`AUTH_PASSKEY_EXPIRED`); account states are named only after the signature, to its holder.
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { authenticator } from 'otplib';
import {
  SettingsService,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type RootCertIdentifier,
} from '@simplewebauthn/server';
import { decodeAttestationObject } from '@simplewebauthn/server/helpers';
import {
  ErrorCodes,
  PASSKEYS_PER_ACCOUNT,
  PlatformEvents,
  SettingKeys,
  type LoginResponse,
  type PasskeyAuthenticationOptionsDto,
  type PasskeyAuthenticationResponse,
  type PasskeyCreationOptionsDto,
  type PasskeyDto,
  type PasskeyRegistrationResponse,
} from '@ecms/contracts';
import { env } from '../../infrastructure/config/env';
import { getContext } from '../../infrastructure/http/request-context';
import { getCache } from '../../infrastructure/redis/cache';
import { consumeRateLimit, hashedKey } from '../../infrastructure/redis/rate-limiter';
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
} from '../../shared/errors';
import { type AuthContext } from '../../shared/types';
import { verifyPassword } from '../../shared/utils/passwords';
import { auditService } from '../audit';
import { settingsService } from '../settings';
import { userService, type UserDoc } from '../users';
import { emit } from '../kernel/event-bus';
import { authService, type IssuedTokens } from './auth.service';
import { mayUsePasskeys } from './passkey-audience';
import { passkeyStore, toPasskeyDto } from './passkey.store';
import { type PasskeyDoc } from './passkey.model';

/** How long a challenge may wait for the device, and how long the server keeps it. */
const CHALLENGE_TTL_SECONDS = 5 * 60;
const CEREMONY_TIMEOUT_MS = CHALLENGE_TTL_SECONDS * 1000;
/** ES256 and RS256 — what platform authenticators (Apple, Android, Windows Hello) produce. */
const ALGORITHMS = [-7, -257];
const RP_NAME = 'ECMS';

// Attestation `none`: nothing is ever validated against a trust anchor, and with none configured
// the library's path validation stops before it would fetch a revocation list. Set at load.
for (const identifier of [
  'apple',
  'android-key',
  'android-safetynet',
  'fido-u2f',
  'packed',
  'tpm',
  'mds',
] satisfies RootCertIdentifier[]) {
  SettingsService.setRootCertificates({ identifier, certificates: [] });
}

/** The relying party, from configuration (ADR-035 §4). */
export const relyingParty = (): { rpID: string; origin: string } => {
  const web = new URL(env.WEB_PUBLIC_URL);
  return { rpID: env.WEBAUTHN_RP_ID.trim() || web.hostname, origin: web.origin };
};

/**
 * The WebAuthn `user.id` for an account. STABLE FOREVER, so a device re-adding a passkey for the
 * same account replaces its old one instead of keeping two — and so no configuration change can
 * invalidate the passkeys already on people's phones: an earlier version keyed this with the JWT
 * signing secret, and rotating that secret (the usual answer to a suspected leak) would have broken
 * every passkey at once. A one-way hash, so the handle does not spell out the account id or when it
 * was made. It is not a secret and need not be: the credential id finds the account and the
 * signature proves it; the handle is only cross-checked.
 */
const userHandle = (userId: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(createHash('sha256').update(`ecms-passkey-user:${userId}`).digest());

/** Wrong TOTP codes at the step-up share the sign-in's per-account bucket (`/totp/challenge`). */
const TOTP_GUESS_LIMIT = { name: 'auth-totp', windowSeconds: 300, max: 10 };

const toBytes = (base64url: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(base64url, 'base64url'));

const signInKey = (challenge: string): string => `passkey:auth:${challenge}`;
const registrationKey = (sessionId: string): string => `passkey:reg:${sessionId}`;

const refused = (): UnauthenticatedError =>
  new UnauthenticatedError(ErrorCodes.AUTH_PASSKEY_INVALID, 'Passkey not accepted');

/** The challenge the device signed, read from its client data; null when it is not one. */
const challengeOf = (clientDataJSON: string): string | null => {
  try {
    const data = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')) as {
      challenge?: unknown;
    };
    return typeof data.challenge === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(data.challenge)
      ? data.challenge
      : null;
  } catch {
    return null;
  }
};

/**
 * Only `none`, or `packed` self-attestation (a signature, no certificate chain) — what browsers
 * return when attestation `none` is asked for. Anything else would send the library down its
 * certificate-path code, and refusing it costs nobody a real passkey.
 */
export const acceptableAttestation = (attestationObject: string): boolean => {
  try {
    const decoded = decodeAttestationObject(toBytes(attestationObject));
    const fmt = decoded.get('fmt');
    if (fmt === 'none') return true;
    return fmt === 'packed' && decoded.get('attStmt').get('x5c') === undefined;
  } catch {
    return false;
  }
};

/** A name the person will recognise in their list, until they rename it. */
const defaultName = (): string => {
  const agent = getContext()?.actor?.userAgent ?? '';
  if (/iPhone/i.test(agent)) return 'iPhone';
  if (/iPad/i.test(agent)) return 'iPad';
  if (/Android/i.test(agent)) return 'Android';
  if (/Macintosh|Mac OS X/i.test(agent)) return 'Mac';
  if (/Windows/i.test(agent)) return 'Windows';
  return 'Passkey';
};

const userRef = (userId: string) => ({
  moduleId: 'platform',
  entityType: 'user',
  entityId: userId,
});

// The validated request body, in the library's shape: optional members present only when sent
// (exact optional types), and no extension results — none are asked for, so none are read.
const forLibraryAuthentication = (
  response: PasskeyAuthenticationResponse,
): AuthenticationResponseJSON => ({
  id: response.id,
  rawId: response.rawId,
  type: 'public-key',
  clientExtensionResults: {},
  response: {
    clientDataJSON: response.response.clientDataJSON,
    authenticatorData: response.response.authenticatorData,
    signature: response.response.signature,
    ...(typeof response.response.userHandle === 'string'
      ? { userHandle: response.response.userHandle }
      : {}),
  },
});

const forLibraryRegistration = (
  response: PasskeyRegistrationResponse,
): RegistrationResponseJSON => {
  const sent = response.response;
  return {
    id: response.id,
    rawId: response.rawId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: sent.clientDataJSON,
      attestationObject: sent.attestationObject,
      ...(sent.authenticatorData === undefined
        ? {}
        : { authenticatorData: sent.authenticatorData }),
      ...(sent.transports === undefined
        ? {}
        : { transports: sent.transports as AuthenticatorTransportFuture[] }),
      ...(sent.publicKeyAlgorithm === undefined
        ? {}
        : { publicKeyAlgorithm: sent.publicKeyAlgorithm }),
      ...(sent.publicKey === undefined ? {} : { publicKey: sent.publicKey }),
    },
  };
};

class PasskeyService {
  /** Off means off for every route — the button vanishing is not what keeps it off. */
  private async assertEnabled(): Promise<void> {
    const enabled = await settingsService.resolve<boolean>(SettingKeys.PasskeysEnabled, {
      userId: null,
      branchId: null,
    });
    if (!enabled) {
      throw new AppError(ErrorCodes.AUTH_PASSKEYS_DISABLED, 403, 'Passkey sign-in is switched off');
    }
  }

  private assertAudience(ctx: AuthContext): void {
    if (!mayUsePasskeys(ctx.external ?? null)) {
      throw new AppError(
        ErrorCodes.AUTH_PASSKEY_NOT_ALLOWED,
        403,
        'This account may not use passkeys',
      );
    }
  }

  // ── Signing in ────────────────────────────────────────────────────────────

  async authenticationOptions(): Promise<PasskeyAuthenticationOptionsDto> {
    await this.assertEnabled();
    const { rpID } = relyingParty();
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: [],
      userVerification: 'required',
      timeout: CEREMONY_TIMEOUT_MS,
    });
    await getCache().set(signInKey(options.challenge), '1', CHALLENGE_TTL_SECONDS);
    return {
      challenge: options.challenge,
      rpId: rpID,
      origin: relyingParty().origin,
      timeout: CEREMONY_TIMEOUT_MS,
      userVerification: 'required',
      allowCredentials: [],
    };
  }

  /** A refused sign-in, written down; the error itself is thrown by the caller. */
  private async recordRefusal(
    reason: string,
    user: UserDoc | null,
    credentialId: string,
  ): Promise<void> {
    await auditService.record({
      entityRef: userRef(user === null ? `passkey:${credentialId.slice(0, 64)}` : String(user._id)),
      action: 'loginFailed',
      changes: [
        { field: 'method', old: null, new: 'passkey' },
        { field: 'reason', old: null, new: reason },
      ],
      actor: {
        userId: user === null ? null : String(user._id),
        ip: getContext()?.actor?.ip ?? null,
        userAgent: getContext()?.actor?.userAgent ?? null,
      },
    });
    if (user !== null) {
      await emit(PlatformEvents.AuthLoginFailed, {
        userId: String(user._id),
        email: user.email,
        reason: `passkey-${reason}`,
      });
    }
  }

  async verifyAuthentication(
    response: PasskeyAuthenticationResponse,
  ): Promise<{ response: LoginResponse; tokens: IssuedTokens }> {
    await this.assertEnabled();
    const { rpID, origin } = relyingParty();

    // 1. The challenge the device signed — issued here, unexpired, and not used before. Consumed
    //    now, whatever follows: a second try at the same challenge is a replay. Its own answer, and
    //    not a counted failure: it is checked before any account is looked at, so it reveals
    //    nothing and guesses at nothing — and a sign-in page left open past five minutes must not
    //    use up an office's failed-sign-in allowance.
    const challenge = challengeOf(response.response.clientDataJSON);
    if (challenge === null || (await getCache().take(signInKey(challenge))) === null) {
      await this.recordRefusal('challenge', null, response.id);
      throw new UnauthenticatedError(ErrorCodes.AUTH_PASSKEY_EXPIRED, 'Challenge expired or used');
    }

    // 2. The key it claims to be.
    const passkey =
      response.id === response.rawId ? await passkeyStore.findByCredentialId(response.id) : null;
    const user = passkey === null ? null : await userService.findByIdSystem(String(passkey.userId));
    if (passkey === null || user === null) {
      await this.recordRefusal('unknown-credential', null, response.id);
      throw refused();
    }
    const handle = response.response.userHandle ?? null;
    if (
      handle !== null &&
      handle !== Buffer.from(userHandle(String(user._id))).toString('base64url')
    ) {
      await this.recordRefusal('user-handle', user, response.id);
      throw refused();
    }

    // 3. Proof of possession: signature, origin, RP ID, user verification, counter.
    let verified: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verified = await verifyAuthenticationResponse({
        response: forLibraryAuthentication(response),
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: passkey.credentialId,
          publicKey: toBytes(passkey.publicKey),
          counter: passkey.counter,
          transports: passkey.transports as AuthenticatorTransportFuture[],
        },
        requireUserVerification: true,
      });
    } catch {
      verified = { verified: false } as typeof verified;
    }
    if (!verified.verified) {
      await this.recordRefusal('verification', user, response.id);
      throw refused();
    }

    // 4. Every barrier the password path has (ADR-035 §7) — named now, to the key's holder only.
    if (user.security.lockedUntil !== null && user.security.lockedUntil > new Date()) {
      throw new UnauthenticatedError(ErrorCodes.AUTH_ACCOUNT_LOCKED, 'Account temporarily locked');
    }
    if (user.status === 'invited') {
      throw new UnauthenticatedError(
        ErrorCodes.AUTH_ACCOUNT_NOT_ACTIVATED,
        'Account has not been activated',
      );
    }
    if (user.status !== 'active') {
      throw new UnauthenticatedError(ErrorCodes.AUTH_ACCOUNT_NOT_ACTIVE, 'Account is not active');
    }
    // An administrator's reset clears the password to lock the account out; it removes passkeys
    // too, and this holds even for one that survived somehow.
    if (user.passwordHash === null) {
      await this.recordRefusal('no-credential', user, response.id);
      throw refused();
    }
    if (!mayUsePasskeys(externalOf(user))) {
      await this.recordRefusal('audience', user, response.id);
      throw refused();
    }

    await passkeyStore.recordUse(
      passkey._id,
      verified.authenticationInfo.newCounter,
      verified.authenticationInfo.credentialBackedUp,
    );
    // The passkey is the second factor (owner decision, ADR-035 §2): no TOTP step follows.
    return authService.completePasskeyLogin(user, String(passkey._id));
  }

  // ── Managing one's own passkeys ───────────────────────────────────────────

  async list(ctx: AuthContext): Promise<PasskeyDto[]> {
    await this.assertEnabled();
    this.assertAudience(ctx);
    return (await passkeyStore.listForUser(ctx.userId)).map(toPasskeyDto);
  }

  /**
   * Prove the person again, then a registration challenge bound to this session (ADR-035 §5). A
   * wrong password counts toward the account lockout exactly as at the sign-in page — otherwise
   * this would be a way to try passwords that the lockout does not see.
   */
  async registrationOptions(
    ctx: AuthContext,
    proof: { password: string; totpCode?: string | undefined },
  ): Promise<PasskeyCreationOptionsDto> {
    await this.assertEnabled();
    this.assertAudience(ctx);
    const user = await userService.getById(ctx.userId);
    // A locked account is locked here too: otherwise, once the lockout tripped, this screen would
    // go on checking passwords that the sign-in page has stopped checking.
    if (user.security.lockedUntil !== null && user.security.lockedUntil > new Date()) {
      throw new UnauthenticatedError(ErrorCodes.AUTH_ACCOUNT_LOCKED, 'Account temporarily locked');
    }
    if (user.passwordHash === null || !(await verifyPassword(user.passwordHash, proof.password))) {
      if (user.passwordHash !== null)
        await authService.countFailedPassword(user, 'passkey-step-up');
      throw new UnauthenticatedError(
        ErrorCodes.AUTH_INVALID_CREDENTIALS,
        'Current password is wrong',
      );
    }
    const totp = user.security.totp;
    if (totp.enabled && totp.secret !== null) {
      // Ten codes per account per five minutes, in the same bucket as the sign-in's TOTP step —
      // keyed on the account, not the access token, which every renewal replaces.
      const guess = await consumeRateLimit(TOTP_GUESS_LIMIT, hashedKey(`account:${ctx.userId}`));
      if (!guess.allowed) throw new RateLimitedError(guess.retryAfter);
      const code = proof.totpCode ?? '';
      if (!/^\d{6}$/.test(code) || !authenticator.verify({ token: code, secret: totp.secret })) {
        await auditService.record({
          entityRef: userRef(ctx.userId),
          action: 'loginFailed',
          changes: [{ field: 'step', old: null, new: 'passkey-step-up-totp' }],
        });
        throw new UnauthenticatedError(ErrorCodes.AUTH_TOTP_INVALID, 'Invalid TOTP code');
      }
    }

    const existing = await passkeyStore.listForUser(ctx.userId);
    if (existing.length >= PASSKEYS_PER_ACCOUNT) {
      throw new BusinessRuleError('Passkey limit reached', ErrorCodes.AUTH_PASSKEY_LIMIT);
    }
    const { rpID } = relyingParty();
    const accountName = user.username ?? user.email ?? String(user._id);
    const displayName = [user.profile.firstName.ar, user.profile.lastName.ar]
      .filter((part) => part.trim() !== '')
      .join(' ');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: accountName,
      userDisplayName: displayName === '' ? accountName : displayName,
      userID: userHandle(ctx.userId),
      timeout: CEREMONY_TIMEOUT_MS,
      attestationType: 'none',
      excludeCredentials: existing.map((passkey) => ({
        id: passkey.credentialId,
        transports: passkey.transports as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      supportedAlgorithmIDs: ALGORITHMS,
    });
    await getCache().set(
      registrationKey(ctx.sessionId),
      JSON.stringify({ challenge: options.challenge, userId: ctx.userId }),
      CHALLENGE_TTL_SECONDS,
    );
    return {
      challenge: options.challenge,
      rp: { id: rpID, name: RP_NAME },
      user: { id: options.user.id, name: options.user.name, displayName: options.user.displayName },
      pubKeyCredParams: ALGORITHMS.map((alg) => ({ type: 'public-key' as const, alg })),
      timeout: CEREMONY_TIMEOUT_MS,
      excludeCredentials: (options.excludeCredentials ?? []).map((credential) => ({
        id: credential.id,
        type: 'public-key' as const,
        ...(credential.transports === undefined ? {} : { transports: credential.transports }),
      })),
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      attestation: 'none',
    };
  }

  async verifyRegistration(
    ctx: AuthContext,
    response: PasskeyRegistrationResponse,
    name: string | undefined,
  ): Promise<PasskeyDto> {
    await this.assertEnabled();
    this.assertAudience(ctx);
    const invalid = (): BusinessRuleError =>
      new BusinessRuleError('Passkey not accepted', ErrorCodes.AUTH_PASSKEY_INVALID);

    // The challenge this session was given after proving itself — once. None left (five minutes
    // passed, or it was used) is its own answer: prove yourself again.
    const pendingRaw = await getCache().take(registrationKey(ctx.sessionId));
    const pending =
      pendingRaw === null
        ? null
        : (JSON.parse(pendingRaw) as { challenge: string; userId: string });
    if (pending === null) {
      throw new BusinessRuleError('Challenge expired or used', ErrorCodes.AUTH_PASSKEY_EXPIRED);
    }
    if (pending.userId !== ctx.userId) throw invalid();
    if (!acceptableAttestation(response.response.attestationObject)) throw invalid();

    const { rpID, origin } = relyingParty();
    let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verified = await verifyRegistrationResponse({
        response: forLibraryRegistration(response),
        expectedChallenge: pending.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        supportedAlgorithmIDs: ALGORITHMS,
      });
    } catch {
      throw invalid();
    }
    if (!verified.verified) throw invalid();
    const info = verified.registrationInfo;

    if ((await passkeyStore.countForUser(ctx.userId)) >= PASSKEYS_PER_ACCOUNT) {
      throw new BusinessRuleError('Passkey limit reached', ErrorCodes.AUTH_PASSKEY_LIMIT);
    }
    let created: PasskeyDoc;
    try {
      created = await passkeyStore.create({
        userId: new Types.ObjectId(ctx.userId),
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
        counter: info.credential.counter,
        transports: info.credential.transports ?? response.response.transports ?? [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        name: name ?? defaultName(),
        createdAt: new Date(),
        lastUsedAt: null,
        createdSessionId: Types.ObjectId.isValid(ctx.sessionId)
          ? new Types.ObjectId(ctx.sessionId)
          : null,
      });
    } catch (error) {
      // The unique credential index: this key is already registered (here or elsewhere).
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictError('This passkey is already registered');
      }
      throw error;
    }
    await auditService.record({
      entityRef: userRef(ctx.userId),
      action: 'passkeyRegistered',
      changes: [
        { field: 'name', old: null, new: created.name },
        { field: 'backedUp', old: null, new: created.backedUp },
      ],
    });
    return toPasskeyDto(created);
  }

  async rename(ctx: AuthContext, id: string, name: string): Promise<PasskeyDto> {
    await this.assertEnabled();
    this.assertAudience(ctx);
    const own = await passkeyStore.findOwn(ctx.userId, id);
    if (own === null) throw new NotFoundError();
    const renamed = await passkeyStore.rename(own._id, name);
    if (renamed === null) throw new NotFoundError();
    await auditService.record({
      entityRef: userRef(ctx.userId),
      action: 'passkeyRenamed',
      changes: [{ field: 'name', old: own.name, new: renamed.name }],
    });
    return toPasskeyDto(renamed);
  }

  /** Removing one's own passkey works even with the feature off: nobody is ever stuck with one. */
  async remove(ctx: AuthContext, id: string): Promise<void> {
    const own = await passkeyStore.findOwn(ctx.userId, id);
    if (own === null) throw new NotFoundError();
    await passkeyStore.removeOne(own._id);
    await auditService.record({
      entityRef: userRef(ctx.userId),
      action: 'passkeyRemoved',
      changes: [{ field: 'name', old: own.name, new: null }],
    });
  }
}

/** `?? null`: the field postdates existing documents and every read is lean. */
const externalOf = (user: UserDoc): { moduleId: string; subjectType: string } | null => {
  const subject = user.externalSubject ?? null;
  return subject === null ? null : { moduleId: subject.moduleId, subjectType: subject.subjectType };
};

export const passkeyService = new PasskeyService();
