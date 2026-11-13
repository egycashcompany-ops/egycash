// Passkey ceremonies (ADR-035), against the real WebAuthn verification.
//
// The device is a software authenticator with a real P-256 key (tests/integration/helpers), so a
// refused signature, origin or counter is refused by the library's own checks — nothing here mocks
// the cryptography. What is stubbed is the I/O around it: the passkey and user stores, audit,
// settings and the session issuer. The challenge cache is the real in-memory one the test runtime
// uses, so single use is exercised for real.
import { Types } from 'mongoose';
import { authenticator } from 'otplib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes, PASSKEYS_PER_ACCOUNT } from '@ecms/contracts';
import {
  SoftAuthenticator,
  strayChallenge,
} from '../../../tests/integration/helpers/soft-authenticator';
import { runWithContext } from '../../infrastructure/http/request-context';
import { env } from '../../infrastructure/config/env';
import { hashPassword } from '../../shared/utils/passwords';
import { type AuthContext } from '../../shared/types';
import { type UserDoc } from '../users';
import { type PasskeyDoc } from './passkey.model';
import type * as PasskeyStoreModule from './passkey.store';
import type * as WebAuthnServer from '@simplewebauthn/server';

const world = vi.hoisted(() => ({
  passkeys: [] as PasskeyDoc[],
  users: new Map<string, unknown>(),
  enabled: true,
  audit: [] as { action: string; changes?: { field: string; new: unknown }[] }[],
  completed: [] as { userId: string; passkeyId: string }[],
  failedPasswords: [] as string[],
  duplicateOnCreate: false,
}));

vi.mock('../settings', () => ({
  settingsService: { resolve: async () => world.enabled },
}));
vi.mock('../audit', () => ({
  auditService: {
    record: async (row: { action: string; changes?: { field: string; new: unknown }[] }) => {
      world.audit.push(row);
    },
  },
}));
vi.mock('../kernel/event-bus', () => ({ emit: async () => undefined }));
vi.mock('../users', () => ({
  userService: {
    findByIdSystem: async (id: string) => world.users.get(id) ?? null,
    getById: async (id: string) => {
      const user = world.users.get(id);
      if (user === undefined) throw new Error('not found');
      return user;
    },
  },
}));
vi.mock('./auth.service', () => ({
  authService: {
    completePasskeyLogin: async (user: { _id: unknown }, passkeyId: string) => {
      world.completed.push({ userId: String(user._id), passkeyId });
      return { response: { totpRequired: false }, tokens: {} };
    },
    countFailedPassword: async (user: { _id: unknown }) => {
      world.failedPasswords.push(String(user._id));
    },
  },
}));
// The library itself, passed through — wrapped only so a test can see whether it was reached.
vi.mock('@simplewebauthn/server', async () => {
  const actual = await vi.importActual<typeof WebAuthnServer>('@simplewebauthn/server');
  return { ...actual, verifyRegistrationResponse: vi.fn(actual.verifyRegistrationResponse) };
});
vi.mock('./passkey.store', async () => {
  const { toPasskeyDto } = await vi.importActual<typeof PasskeyStoreModule>('./passkey.store');
  const same = (a: unknown, b: unknown) => String(a) === String(b);
  return {
    toPasskeyDto,
    passkeyStore: {
      findByCredentialId: async (credentialId: string) =>
        world.passkeys.find((p) => p.credentialId === credentialId) ?? null,
      listForUser: async (userId: string) => world.passkeys.filter((p) => same(p.userId, userId)),
      countForUser: async (userId: string) =>
        world.passkeys.filter((p) => same(p.userId, userId)).length,
      create: async (doc: Omit<PasskeyDoc, '_id'>) => {
        if (
          world.duplicateOnCreate ||
          world.passkeys.some((p) => p.credentialId === doc.credentialId)
        ) {
          throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
        }
        const created = { ...doc, _id: new Types.ObjectId() };
        world.passkeys.push(created);
        return created;
      },
      recordUse: async (id: Types.ObjectId, counter: number, backedUp: boolean) => {
        const found = world.passkeys.find((p) => same(p._id, id));
        if (found !== undefined)
          Object.assign(found, { counter, backedUp, lastUsedAt: new Date() });
      },
      findOwn: async (userId: string, id: string) =>
        world.passkeys.find((p) => same(p._id, id) && same(p.userId, userId)) ?? null,
      rename: async (id: Types.ObjectId, name: string) => {
        const found = world.passkeys.find((p) => same(p._id, id));
        if (found === undefined) return null;
        found.name = name;
        return found;
      },
      removeOne: async (id: Types.ObjectId) => {
        world.passkeys = world.passkeys.filter((p) => !same(p._id, id));
      },
    },
  };
});

const { acceptableAttestation, passkeyService, relyingParty } = await import('./passkey.service');
const { verifyRegistrationResponse } = await import('@simplewebauthn/server');
const { allowPasskeysFor } = await import('./passkey-audience');
const { isFailedSignIn } = await import('./failed-sign-ins');

const PASSWORD = 'Str0ng#Pass!';
const passwordHash = await hashPassword(PASSWORD);
const { origin } = relyingParty();

type Bag = Record<string, unknown>;
const makeUser = (over: Bag = {}, security: Bag = {}): UserDoc => {
  const user = {
    _id: new Types.ObjectId(),
    email: 'someone@ecms.local',
    username: 'someone',
    status: 'active',
    passwordHash,
    externalSubject: null,
    profile: { firstName: { ar: 'أحمد', en: 'Ahmed' }, lastName: { ar: 'علي', en: 'Ali' } },
    security: { lockedUntil: null, totp: { enabled: false, secret: null }, ...security },
    ...over,
  } as unknown as UserDoc;
  world.users.set(String(user._id), user);
  return user;
};

const ctxOf = (user: UserDoc, over: Partial<AuthContext> = {}): AuthContext =>
  ({
    userId: String(user._id),
    sessionId: String(new Types.ObjectId()),
    external:
      user.externalSubject === null
        ? null
        : {
            moduleId: user.externalSubject.moduleId,
            subjectType: user.externalSubject.subjectType,
            subjectId: String(user.externalSubject.subjectId),
          },
    ...over,
  }) as unknown as AuthContext;

/** Add a passkey the way the Security page does: step-up, prompt, verify. */
const enrol = async (user: UserDoc, device = new SoftAuthenticator(), ctx = ctxOf(user)) => {
  const options = await passkeyService.registrationOptions(ctx, { password: PASSWORD });
  const dto = await passkeyService.verifyRegistration(
    ctx,
    device.register(options, origin),
    undefined,
  );
  return { device, dto, ctx };
};

const signIn = async (
  device: SoftAuthenticator,
  bend: Parameters<SoftAuthenticator['authenticate']>[2] = {},
) => {
  const options = await passkeyService.authenticationOptions();
  return passkeyService.verifyAuthentication(device.authenticate(options, origin, bend));
};

/** A six-digit code that is not the current one. */
const wrongCode = (secret: string): string =>
  String((Number(authenticator.generate(secret)) + 1) % 1_000_000).padStart(6, '0');

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    return (error as { code: string }).code;
  }
  throw new Error('expected a refusal');
};

beforeEach(() => {
  world.passkeys = [];
  world.users.clear();
  world.enabled = true;
  world.audit = [];
  world.completed = [];
  world.failedPasswords = [];
  world.duplicateOnCreate = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(verifyRegistrationResponse).mockClear();
});

describe('signing in with a passkey', () => {
  it('signs in with a passkey added from the Security page, and records its use', async () => {
    const user = makeUser();
    const { device, dto } = await enrol(user);
    await signIn(device);
    expect(world.completed).toEqual([{ userId: String(user._id), passkeyId: dto.id }]);
    expect(world.passkeys[0]?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('offers a challenge that names no account and expects the configured relying party', async () => {
    const options = await passkeyService.authenticationOptions();
    expect(options.allowCredentials).toEqual([]);
    expect(options.userVerification).toBe('required');
    expect(options.rpId).toBe(new URL(origin).hostname);
    // The one page address answers are accepted from, so a screen elsewhere offers no button.
    expect(options.origin).toBe(origin);
  });

  it('refuses the same answer twice — the challenge is spent by the first', async () => {
    const user = makeUser();
    const { device } = await enrol(user);
    const options = await passkeyService.authenticationOptions();
    const answer = device.authenticate(options, origin);
    await passkeyService.verifyAuthentication(answer);
    expect(await codeOf(passkeyService.verifyAuthentication(answer))).toBe(
      ErrorCodes.AUTH_PASSKEY_EXPIRED,
    );
    expect(world.completed).toHaveLength(1);
  });

  it('refuses a challenge the server never issued', async () => {
    const { device } = await enrol(makeUser());
    const answer = device.authenticate({ challenge: strayChallenge(), rpId: 'localhost' }, origin);
    expect(await codeOf(passkeyService.verifyAuthentication(answer))).toBe(
      ErrorCodes.AUTH_PASSKEY_EXPIRED,
    );
    expect(world.completed).toHaveLength(0);
  });

  it('refuses a credential nobody registered', async () => {
    expect(await codeOf(signIn(new SoftAuthenticator()))).toBe(ErrorCodes.AUTH_PASSKEY_INVALID);
  });

  it('refuses a signature made with another key (the credential id is not a secret)', async () => {
    const { device } = await enrol(makeUser());
    const impostor = new SoftAuthenticator();
    expect(await codeOf(signIn(device, { signWith: impostor.privateKey }))).toBe(
      ErrorCodes.AUTH_PASSKEY_INVALID,
    );
    expect(world.completed).toHaveLength(0);
    expect(world.audit.at(-1)?.action).toBe('loginFailed');
  });

  it.each([
    ['another origin (phishing site)', { origin: 'https://ecms.egycash.com.eg.evil.example' }],
    ['another relying party', { rpId: 'evil.example' }],
    ['no user verification (no fingerprint, face or PIN)', { noUserVerification: true }],
    ['a registration answer replayed as a sign-in', { type: 'webauthn.create' }],
  ])('refuses %s', async (_label, bend) => {
    const { device } = await enrol(makeUser());
    expect(await codeOf(signIn(device, bend))).toBe(ErrorCodes.AUTH_PASSKEY_INVALID);
    expect(world.completed).toHaveLength(0);
  });

  it('refuses a user handle that is not the owner’s', async () => {
    const { device } = await enrol(makeUser());
    expect(await codeOf(signIn(device, { userHandle: 'c29tZW9uZS1lbHNl' }))).toBe(
      ErrorCodes.AUTH_PASSKEY_INVALID,
    );
  });

  it('accepts an answer with no user handle (the credential id finds the owner)', async () => {
    const { device } = await enrol(makeUser());
    await signIn(device, { userHandle: null });
    expect(world.completed).toHaveLength(1);
  });

  it('refuses a device-bound key whose counter went backwards (a cloned authenticator)', async () => {
    const { device } = await enrol(makeUser(), new SoftAuthenticator(false));
    await signIn(device);
    await signIn(device);
    expect(world.passkeys[0]?.counter).toBe(2);
    expect(await codeOf(signIn(device, { counter: 1 }))).toBe(ErrorCodes.AUTH_PASSKEY_INVALID);
  });

  it('counts a refused passkey as a failed sign-in for the address limit', async () => {
    const error = await signIn(new SoftAuthenticator()).catch((caught: unknown) => caught);
    expect(isFailedSignIn(error)).toBe(true);
  });

  it('does not count an expired challenge — a page left open proves nothing', async () => {
    const { device } = await enrol(makeUser());
    const answer = device.authenticate({ challenge: strayChallenge(), rpId: 'localhost' }, origin);
    const error = await passkeyService
      .verifyAuthentication(answer)
      .catch((caught: unknown) => caught);
    expect(isFailedSignIn(error)).toBe(false);
  });

  it('keeps every passkey working when the JWT signing secret is rotated', async () => {
    const { device } = await enrol(makeUser());
    const before = env.JWT_ACCESS_SECRET;
    try {
      env.JWT_ACCESS_SECRET = 'a-freshly-rotated-signing-secret-0123456789';
      await signIn(device);
    } finally {
      env.JWT_ACCESS_SECRET = before;
    }
    expect(world.completed).toHaveLength(1);
  });

  describe('the account’s own barriers, after the signature is proven', () => {
    it('keeps a locked account locked', async () => {
      const user = makeUser();
      const { device } = await enrol(user);
      (user.security as { lockedUntil: Date | null }).lockedUntil = new Date(Date.now() + 60_000);
      expect(await codeOf(signIn(device))).toBe(ErrorCodes.AUTH_ACCOUNT_LOCKED);
    });

    it.each([
      ['invited', ErrorCodes.AUTH_ACCOUNT_NOT_ACTIVATED],
      ['suspended', ErrorCodes.AUTH_ACCOUNT_NOT_ACTIVE],
      ['archived', ErrorCodes.AUTH_ACCOUNT_NOT_ACTIVE],
    ])('refuses an account that is %s', async (status, code) => {
      const user = makeUser();
      const { device } = await enrol(user);
      (user as { status: string }).status = status;
      expect(await codeOf(signIn(device))).toBe(code);
      expect(world.completed).toHaveLength(0);
    });

    it('refuses an account whose password an administrator cleared', async () => {
      const user = makeUser();
      const { device } = await enrol(user);
      (user as { passwordHash: string | null }).passwordHash = null;
      expect(await codeOf(signIn(device))).toBe(ErrorCodes.AUTH_PASSKEY_INVALID);
    });

    it('names no account state to someone without the key', async () => {
      const user = makeUser({ status: 'suspended' });
      const device = new SoftAuthenticator();
      world.passkeys.push({
        _id: new Types.ObjectId(),
        userId: user._id,
        credentialId: device.id,
        publicKey: 'AA',
        counter: 0,
        transports: [],
        deviceType: 'multiDevice',
        backedUp: true,
        name: 'x',
        createdAt: new Date(),
        lastUsedAt: null,
        createdSessionId: null,
      });
      expect(await codeOf(signIn(device))).toBe(ErrorCodes.AUTH_PASSKEY_INVALID);
    });
  });

  describe('who may use passkeys', () => {
    const external = (moduleId: string, subjectType: string) =>
      makeUser({ externalSubject: { moduleId, subjectType, subjectId: new Types.ObjectId() } });

    it('refuses an applicant-portal account at registration', async () => {
      const applicant = external('hr', 'applicant');
      expect(
        await codeOf(passkeyService.registrationOptions(ctxOf(applicant), { password: PASSWORD })),
      ).toBe(ErrorCodes.AUTH_PASSKEY_NOT_ALLOWED);
      // Its list is refused too, whatever the switch says: the Security card shows no passkeys there.
      expect(await codeOf(passkeyService.list(ctxOf(applicant)))).toBe(
        ErrorCodes.AUTH_PASSKEY_NOT_ALLOWED,
      );
    });

    it('refuses an applicant-portal account at sign-in even holding a valid key', async () => {
      const applicant = external('hr', 'applicant');
      const device = new SoftAuthenticator();
      // Enrolled as staff, then the account became external: the sign-in still checks.
      const staffShape = { ...applicant, externalSubject: null } as unknown as UserDoc;
      world.users.set(String(applicant._id), staffShape);
      await enrol(staffShape, device);
      world.users.set(String(applicant._id), applicant);
      expect(await codeOf(signIn(device))).toBe(ErrorCodes.AUTH_PASSKEY_INVALID);
    });

    it('lets a module opt its customers in (the gold portal)', async () => {
      allowPasskeysFor('gold', 'goldCompany');
      const customer = external('gold', 'goldCompany');
      const { device } = await enrol(customer);
      await signIn(device);
      expect(world.completed).toEqual([expect.objectContaining({ userId: String(customer._id) })]);
    });
  });

  describe('the organization switch', () => {
    it('refuses every ceremony while switched off, but still lists the passkeys so one can be removed', async () => {
      const user = makeUser();
      const { device, dto, ctx } = await enrol(user);
      world.enabled = false;
      expect(await codeOf(passkeyService.authenticationOptions())).toBe(
        ErrorCodes.AUTH_PASSKEYS_DISABLED,
      );
      expect(
        await codeOf(
          passkeyService.verifyAuthentication(
            device.authenticate({ challenge: strayChallenge(), rpId: 'localhost' }, origin),
          ),
        ),
      ).toBe(ErrorCodes.AUTH_PASSKEYS_DISABLED);
      expect(await codeOf(passkeyService.registrationOptions(ctx, { password: PASSWORD }))).toBe(
        ErrorCodes.AUTH_PASSKEYS_DISABLED,
      );
      expect(await codeOf(passkeyService.rename(ctx, dto.id, 'هاتفي'))).toBe(
        ErrorCodes.AUTH_PASSKEYS_DISABLED,
      );
      // …but a person can always see their own, told the switch is off, and remove one.
      const listed = await passkeyService.list(ctx);
      expect(listed.enabled).toBe(false);
      expect(listed.items.map((p) => p.id)).toEqual([dto.id]);
      await passkeyService.remove(ctx, dto.id);
      expect(world.passkeys).toHaveLength(0);
      expect(await passkeyService.list(ctx)).toEqual({ items: [], enabled: false });
    });
  });
});

describe('adding a passkey', () => {
  it('asks for the password again, and counts a wrong one toward the lockout', async () => {
    const user = makeUser();
    expect(
      await codeOf(passkeyService.registrationOptions(ctxOf(user), { password: 'wrong-password' })),
    ).toBe(ErrorCodes.AUTH_INVALID_CREDENTIALS);
    expect(world.failedPasswords).toEqual([String(user._id)]);
  });

  it('asks for the TOTP code too when the account has one', async () => {
    // The clock stands still, mid-way through a 30-second step: the password is checked first
    // (argon2), and on a busy CI runner that took long enough for the step to turn between making
    // the code and checking it — «Invalid TOTP code» for the right one (2026-11-13). Only `Date` is
    // frozen; argon2 and the timers run as ever.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 13, 9, 0, 15));
    const secret = authenticator.generateSecret();
    const user = makeUser({}, { totp: { enabled: true, secret } });
    const ctx = ctxOf(user);
    expect(await codeOf(passkeyService.registrationOptions(ctx, { password: PASSWORD }))).toBe(
      ErrorCodes.AUTH_TOTP_INVALID,
    );
    expect(
      await codeOf(
        passkeyService.registrationOptions(ctx, {
          password: PASSWORD,
          totpCode: wrongCode(secret),
        }),
      ),
    ).toBe(ErrorCodes.AUTH_TOTP_INVALID);
    const options = await passkeyService.registrationOptions(ctx, {
      password: PASSWORD,
      totpCode: authenticator.generate(secret),
    });
    expect(options.challenge).not.toBe('');
    expect(world.audit.filter((row) => row.action === 'loginFailed')).toHaveLength(2);
  });

  it('limits TOTP guesses per account, whatever access token asks', async () => {
    const secret = authenticator.generateSecret();
    const user = makeUser({}, { totp: { enabled: true, secret } });
    for (let i = 0; i < 10; i += 1) {
      // A fresh session — a fresh access token — each time: the bucket is the account's.
      expect(
        await codeOf(
          passkeyService.registrationOptions(ctxOf(user), {
            password: PASSWORD,
            totpCode: wrongCode(secret),
          }),
        ),
      ).toBe(ErrorCodes.AUTH_TOTP_INVALID);
    }
    expect(
      await codeOf(
        passkeyService.registrationOptions(ctxOf(user), {
          password: PASSWORD,
          totpCode: authenticator.generate(secret),
        }),
      ),
    ).toBe(ErrorCodes.RATE_LIMITED);
  });

  it('refuses the step-up while the account is locked, without checking the password', async () => {
    const user = makeUser({}, { lockedUntil: new Date(Date.now() + 60_000) });
    expect(
      await codeOf(passkeyService.registrationOptions(ctxOf(user), { password: 'wrong-password' })),
    ).toBe(ErrorCodes.AUTH_ACCOUNT_LOCKED);
    expect(
      await codeOf(passkeyService.registrationOptions(ctxOf(user), { password: PASSWORD })),
    ).toBe(ErrorCodes.AUTH_ACCOUNT_LOCKED);
    expect(world.failedPasswords).toEqual([]);
  });

  it('asks the device for a discoverable, user-verified key with no attestation', async () => {
    const user = makeUser();
    const options = await passkeyService.registrationOptions(ctxOf(user), { password: PASSWORD });
    expect(options.authenticatorSelection).toEqual({
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    });
    expect(options.attestation).toBe('none');
    expect(options.user.name).toBe('someone');
    expect(options.user.displayName).toBe('أحمد علي');
    // The WebAuthn user id is not the account id.
    expect(Buffer.from(options.user.id, 'base64url').toString('hex')).not.toContain(
      String(user._id),
    );
  });

  it('stores the key, names it after the device, and audits it', async () => {
    const user = makeUser();
    const ctx = ctxOf(user);
    const device = new SoftAuthenticator();
    const options = await passkeyService.registrationOptions(ctx, { password: PASSWORD });
    const dto = await runWithContext(
      {
        requestId: 'r',
        actor: {
          userId: ctx.userId,
          ip: null,
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)',
        },
      },
      () => passkeyService.verifyRegistration(ctx, device.register(options, origin), undefined),
    );
    expect(dto).toMatchObject({ name: 'iPhone', backedUp: true, lastUsedAt: null });
    expect(world.passkeys[0]).toMatchObject({ credentialId: device.id, deviceType: 'multiDevice' });
    expect(world.audit.at(-1)?.action).toBe('passkeyRegistered');
  });

  it('excludes the keys the account already has, so a device is not added twice', async () => {
    const user = makeUser();
    const { device } = await enrol(user);
    const options = await passkeyService.registrationOptions(ctxOf(user), { password: PASSWORD });
    expect(options.excludeCredentials.map((c) => c.id)).toEqual([device.id]);
  });

  it('refuses an answer with no challenge from this session', async () => {
    const user = makeUser();
    const ctx = ctxOf(user);
    const options = await passkeyService.registrationOptions(ctx, { password: PASSWORD });
    const answer = new SoftAuthenticator().register(options, origin);
    // Another session of the same person did not prove itself: it holds no challenge.
    expect(await codeOf(passkeyService.verifyRegistration(ctxOf(user), answer, undefined))).toBe(
      ErrorCodes.AUTH_PASSKEY_EXPIRED,
    );
    // Nor did another account presenting this session's id.
    const stranger = makeUser({ username: 'stranger' });
    expect(
      await codeOf(
        passkeyService.verifyRegistration(
          ctxOf(stranger, { sessionId: ctx.sessionId }),
          answer,
          undefined,
        ),
      ),
    ).toBe(ErrorCodes.AUTH_PASSKEY_INVALID);
    expect(world.passkeys).toHaveLength(0);
    // The refusals above spent it; the real session starts again and uses its challenge once.
    const again = await passkeyService.registrationOptions(ctx, { password: PASSWORD });
    const fresh = new SoftAuthenticator().register(again, origin);
    await passkeyService.verifyRegistration(ctx, fresh, undefined);
    expect(await codeOf(passkeyService.verifyRegistration(ctx, fresh, undefined))).toBe(
      ErrorCodes.AUTH_PASSKEY_EXPIRED,
    );
  });
  it.each([
    [
      'a certificate chain (packed with x5c)',
      { fmt: 'packed', x5c: [new Uint8Array([48, 3, 2, 1, 1])] },
    ],
    ['android-key attestation', { fmt: 'android-key', x5c: [new Uint8Array([48, 3, 2, 1, 1])] }],
    ['tpm attestation', { fmt: 'tpm' }],
  ])(
    'refuses %s before the library sees it — and makes no outbound request',
    async (_label, bend) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const user = makeUser();
      const ctx = ctxOf(user);
      const options = await passkeyService.registrationOptions(ctx, { password: PASSWORD });
      const answer = new SoftAuthenticator().register(options, origin, bend);
      expect(await codeOf(passkeyService.verifyRegistration(ctx, answer, undefined))).toBe(
        ErrorCodes.AUTH_PASSKEY_INVALID,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(verifyRegistrationResponse).not.toHaveBeenCalled();
      expect(world.passkeys).toHaveLength(0);
    },
  );

  it('lets through only `none` and `packed` self-attestation', () => {
    const options = { challenge: strayChallenge(), rp: { id: 'localhost' }, user: { id: 'dQ' } };
    const attestation = (bend: Parameters<SoftAuthenticator['register']>[2]) =>
      new SoftAuthenticator().register(options, origin, bend).response.attestationObject;
    expect(acceptableAttestation(attestation({}))).toBe(true);
    expect(acceptableAttestation(attestation({ fmt: 'packed' }))).toBe(true);
    expect(acceptableAttestation(attestation({ fmt: 'packed', x5c: [new Uint8Array([48])] }))).toBe(
      false,
    );
    expect(acceptableAttestation(attestation({ fmt: 'android-key' }))).toBe(false);
    expect(acceptableAttestation(attestation({ fmt: 'apple' }))).toBe(false);
    expect(acceptableAttestation('not-cbor')).toBe(false);
  });

  it.each([
    ['another origin', { origin: 'https://evil.example' }],
    ['another relying party', { rpId: 'evil.example' }],
    ['no user verification', { noUserVerification: true }],
  ])('refuses a key made for %s', async (_label, bend) => {
    const user = makeUser();
    const ctx = ctxOf(user);
    const options = await passkeyService.registrationOptions(ctx, { password: PASSWORD });
    const answer = new SoftAuthenticator().register(options, origin, bend);
    expect(await codeOf(passkeyService.verifyRegistration(ctx, answer, undefined))).toBe(
      ErrorCodes.AUTH_PASSKEY_INVALID,
    );
  });

  it(`stops at ${PASSKEYS_PER_ACCOUNT} passkeys`, async () => {
    const user = makeUser();
    for (let i = 0; i < PASSKEYS_PER_ACCOUNT; i += 1) await enrol(user);
    expect(
      await codeOf(passkeyService.registrationOptions(ctxOf(user), { password: PASSWORD })),
    ).toBe(ErrorCodes.AUTH_PASSKEY_LIMIT);
  });

  it('answers a conflict for a key already registered', async () => {
    const user = makeUser();
    const ctx = ctxOf(user);
    const options = await passkeyService.registrationOptions(ctx, { password: PASSWORD });
    world.duplicateOnCreate = true;
    expect(
      await codeOf(
        passkeyService.verifyRegistration(
          ctx,
          new SoftAuthenticator().register(options, origin),
          undefined,
        ),
      ),
    ).toBe(ErrorCodes.DUPLICATE);
  });
});

describe('managing one’s own passkeys', () => {
  it('renames and removes only the caller’s own', async () => {
    const owner = makeUser();
    const other = makeUser({ username: 'other' });
    const { dto, ctx } = await enrol(owner);
    expect(await codeOf(passkeyService.rename(ctxOf(other), dto.id, 'Mine now'))).toBe(
      ErrorCodes.NOT_FOUND,
    );
    expect(await codeOf(passkeyService.remove(ctxOf(other), dto.id))).toBe(ErrorCodes.NOT_FOUND);
    expect((await passkeyService.rename(ctx, dto.id, 'هاتفي')).name).toBe('هاتفي');
    const listed = await passkeyService.list(ctx);
    expect(listed.enabled).toBe(true);
    expect(listed.items.map((p) => p.name)).toEqual(['هاتفي']);
    await passkeyService.remove(ctx, dto.id);
    expect(await passkeyService.list(ctx)).toEqual({ items: [], enabled: true });
    expect(world.audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(['passkeyRenamed', 'passkeyRemoved']),
    );
  });
});
