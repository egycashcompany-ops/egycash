import { z } from 'zod';
import { objectId, LocaleSchema, type DataScope, type LocalizedString } from '../common/index.js';

// API input is strict (mass-assignment defense, Security Architecture §4).

// Login accepts a username OR an email (ADR-017). `identifier` is the forward-looking field;
// `email` is retained for backward compatibility. At least one must be present.
export const LoginSchema = z
  .object({
    identifier: z.string().min(1).optional(),
    email: z.string().email().optional(),
    password: z.string().min(1),
  })
  .strict()
  .refine((v) => v.identifier !== undefined || v.email !== undefined, {
    message: 'username or email is required',
    path: ['identifier'],
  });
export type Login = z.infer<typeof LoginSchema>;

export const TotpChallengeSchema = z
  .object({
    challengeToken: z.string().min(1),
    code: z.string().regex(/^\d{6}$|^[A-Za-z0-9-]{10,}$/, 'TOTP code or backup code'),
  })
  .strict();
export type TotpChallenge = z.infer<typeof TotpChallengeSchema>;

export const TotpVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export type TotpVerify = z.infer<typeof TotpVerifySchema>;

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
  })
  .strict();
export type ChangePassword = z.infer<typeof ChangePasswordSchema>;

/**
 * Which navigation shell the user works in. Both are the same navigation data and the same
 * permissions — only the shape differs, so this is a personal preference and nothing more:
 *   • `launchpad` — one column scoped to the current module, switched from the full-screen launcher;
 *   • `rail` — the two-part shell: a slim strip of module icons beside the module's page panel.
 */
export const NAV_LAYOUTS = ['launchpad', 'rail'] as const;
export type NavLayout = (typeof NAV_LAYOUTS)[number];

/**
 * The colour scheme the user works in.
 *
 * `system` is a VALUE, not a fallback: the account stores the intention "follow this device", and
 * only the client can resolve it, because `prefers-color-scheme` is a browser fact the server has
 * no way to read. So the server stores and returns `system` unchanged and never tries to answer it.
 */
export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/**
 * The user's own presentation preferences, all three of them, on one endpoint.
 *
 * Every field is optional so a screen can save the one control the user touched without restating
 * the other two — but `.strict()` still rejects anything not named here (mass-assignment defence,
 * Security Architecture §4), and the refinement rejects an empty body, which would otherwise be a
 * silent no-op that looks like a successful save.
 */
export const UpdateMyPreferencesSchema = z
  .object({
    navLayout: z.enum(NAV_LAYOUTS).optional(),
    locale: LocaleSchema.optional(),
    theme: z.enum(THEME_MODES).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'at least one preference is required',
  });
export type UpdateMyPreferences = z.infer<typeof UpdateMyPreferencesSchema>;

export const ActivateAccountSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8).max(128),
  })
  .strict();
export type ActivateAccount = z.infer<typeof ActivateAccountSchema>;

// ── Responses ───────────────────────────────────────────────────────────────

export interface MeDto {
  id: string;
  email: string | null;
  /** Second login identifier (defaults to the Employee Code); null for email-only accounts. */
  username: string | null;
  /** Server-enforced first-login gate (design 4.2) — true until the password is changed. */
  mustChangePassword: boolean;
  name: { firstName: LocalizedString; lastName: LocalizedString };
  /**
   * The account's language — the source of truth for the UI locale AND for the language the
   * server writes in (notification email, `AuthContext.locale`). One value, both sides.
   */
  locale: 'ar' | 'en';
  /** Personal choice of navigation shell — presentation only, never a permission boundary. */
  navLayout: NavLayout;
  /** Personal colour scheme; `system` is resolved by the client against the device. */
  theme: ThemeMode;
  branchId: string | null;
  /**
   * Every branch the account's active grants reach — its own plus any added to it. Empty for an
   * organization-wide account (which reaches all of them) and for one confined to its own branch.
   * The command bar's branch switcher lists exactly these, so a manager given a second branch to
   * follow can narrow to either without being offered a third they cannot see.
   */
  branchIds: string[];
  /** The Employee this login belongs to (ADR-017) — the self-service subject (leave C1-R). */
  employeeId: string | null;
  /** Effective permission → widest granted scope (ADR-004, ADR-015). */
  permissions: Record<string, DataScope>;
  /** Holds a protected system role or a break-glass permission — e.g. super-admin (Review R13). */
  isPrivileged: boolean;
  flags: Record<string, boolean>;
  totpEnabled: boolean;
  /**
   * Set only for an account belonging to someone OUTSIDE the company — a vault customer today.
   * `label` is what to call that record on screen; null when the owning module cannot answer.
   * The client uses this to decide it is looking at a customer, and to greet them by their
   * organisation rather than by their own name.
   */
  external: { moduleId: string; subjectType: string; subjectId: string; label: string | null } | null;
}

export type LoginResponse =
  | { totpRequired: true; challengeToken: string; enrollmentRequired: boolean }
  | {
      totpRequired: false;
      accessToken: string;
      me: MeDto;
      mustChangePassword: boolean;
      /** How long a session may sit untouched before it is closed. See `RefreshResponse`. */
      idleMinutes: number;
    };

export interface RefreshResponse {
  accessToken: string;
  /**
   * Minutes of inactivity after which the server closes this session; `0` means never.
   *
   * It travels with the token rather than being configured in the browser because the SERVER is
   * what enforces it: a client counting to a different number either signs the user out while
   * their session is still good, or leaves a dead session on screen until the next save fails.
   * Sent on every refresh, so a deployment that changes the window is obeyed within one cycle.
   */
  idleMinutes: number;
}

export interface TotpEnrollmentDto {
  secret: string;
  otpauthUrl: string;
}

export interface TotpEnabledDto {
  enabled: true;
  backupCodes: string[];
}

/** How a session was opened (ADR-035). Sessions from before the field read as `password`. */
export const SESSION_METHODS = ['password', 'passkey', 'portalChallenge'] as const;
export type SessionMethod = (typeof SESSION_METHODS)[number];

export interface SessionDto {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
  method: SessionMethod;
}

// ── Passkeys: sign-in with fingerprint / Face ID (ADR-035) ──────────────────

/**
 * WebAuthn's JSON encoding of binary fields. Bounded so a request cannot carry megabytes into the
 * verifier; the real check is cryptographic and happens on the server.
 */
const base64url = (max = 4096) => z.string().min(1).max(max).regex(/^[A-Za-z0-9_-]+$/, 'base64url');
const clientExtensionResults = z.record(z.string(), z.unknown());
/** WebAuthn allows a credential id of up to 1023 bytes: 1364 characters of unpadded base64url. */
const CREDENTIAL_ID_MAX = 1364;
const authenticatorAttachment = z.enum(['platform', 'cross-platform']).nullable().optional();

/** What the browser returns from `navigator.credentials.get()`, in WebAuthn JSON. */
export const PasskeyAuthenticationResponseSchema = z
  .object({
    id: base64url(CREDENTIAL_ID_MAX),
    rawId: base64url(CREDENTIAL_ID_MAX),
    type: z.literal('public-key'),
    response: z
      .object({
        clientDataJSON: base64url(),
        authenticatorData: base64url(),
        signature: base64url(),
        userHandle: base64url(512).nullable().optional(),
      })
      .strict(),
    clientExtensionResults,
    authenticatorAttachment,
  })
  .strict();
export type PasskeyAuthenticationResponse = z.infer<typeof PasskeyAuthenticationResponseSchema>;

export const PasskeyAuthenticationVerifySchema = z
  .object({ response: PasskeyAuthenticationResponseSchema })
  .strict();
export type PasskeyAuthenticationVerify = z.infer<typeof PasskeyAuthenticationVerifySchema>;

/** What the browser returns from `navigator.credentials.create()`, in WebAuthn JSON. */
export const PasskeyRegistrationResponseSchema = z
  .object({
    id: base64url(CREDENTIAL_ID_MAX),
    rawId: base64url(CREDENTIAL_ID_MAX),
    type: z.literal('public-key'),
    response: z
      .object({
        clientDataJSON: base64url(),
        attestationObject: base64url(16384),
        authenticatorData: base64url(8192).optional(),
        transports: z.array(z.string().max(32)).max(10).optional(),
        publicKeyAlgorithm: z.number().int().optional(),
        publicKey: base64url(4096).optional(),
      })
      .strict(),
    clientExtensionResults,
    authenticatorAttachment,
  })
  .strict();
export type PasskeyRegistrationResponse = z.infer<typeof PasskeyRegistrationResponseSchema>;

/**
 * Adding a passkey proves the person again (ADR-035 §5): the current password, and the TOTP code
 * when the account has one. A session alone is not enough — a stolen one must not be able to plant
 * a key that outlives a password change.
 */
export const PasskeyRegistrationOptionsSchema = z
  .object({
    password: z.string().min(1).max(256),
    totpCode: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict();
export type PasskeyRegistrationOptions = z.infer<typeof PasskeyRegistrationOptionsSchema>;

const passkeyName = z.string().trim().min(1).max(60);

export const PasskeyRegistrationVerifySchema = z
  .object({ response: PasskeyRegistrationResponseSchema, name: passkeyName.optional() })
  .strict();
export type PasskeyRegistrationVerify = z.infer<typeof PasskeyRegistrationVerifySchema>;

export const RenamePasskeySchema = z.object({ name: passkeyName }).strict();
export type RenamePasskey = z.infer<typeof RenamePasskeySchema>;

export const PasskeyIdParamSchema = z.object({ id: objectId() }).strict();
export type PasskeyIdParam = z.infer<typeof PasskeyIdParamSchema>;

/** A person's own passkey, as the Security page lists it. Never the key material. */
export interface PasskeyDto {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Kept in the person's cloud keychain (iCloud, Google) and so on their other devices too. */
  backedUp: boolean;
}

/**
 * `meta` of GET /auth/passkeys. The list answers whether or not passkeys are switched on
 * (`auth.passkeys.enabled`), so a person can always see their devices and remove one; `enabled`
 * says whether adding, renaming and signing in are available.
 */
export interface PasskeyListMetaDto {
  enabled: boolean;
}

/** The most passkeys one account may hold. */
export const PASSKEYS_PER_ACCOUNT = 10;

/**
 * A sign-in challenge, in the WebAuthn JSON the browser's `get()` takes — plus `origin`, the one
 * page address the server accepts answers from, so a screen opened anywhere else offers no button
 * that could only fail. `origin` is not passed to the browser.
 */
export interface PasskeyAuthenticationOptionsDto {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: 'required';
  allowCredentials: [];
  origin: string;
}

/** A registration challenge, in the WebAuthn JSON the browser's `create()` takes. */
export interface PasskeyCreationOptionsDto {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout: number;
  excludeCredentials: { id: string; type: 'public-key'; transports?: string[] }[];
  authenticatorSelection: {
    residentKey: 'required';
    requireResidentKey: true;
    userVerification: 'required';
  };
  attestation: 'none';
}

export const ListSessionsQuerySchema = z.object({}).strict();

/**
 * Admin reset (design §12 R6): no body — a new random temporary password is generated
 * server-side, delivered to the employee (WhatsApp + email), all sessions are revoked and
 * the change gate re-arms. Passwords are never supplied by nor returned to admins (R11).
 */
export const AdminResetPasswordSchema = z.object({}).strict();
export type AdminResetPassword = z.infer<typeof AdminResetPasswordSchema>;

/** Per-channel outcome of a transient credentials delivery (design §12 R3). */
export interface CredentialsDeliveryResultDto {
  channel: 'whatsapp' | 'email';
  ok: boolean;
  detail: string | null;
}

/**
 * A setup link handed to an administrator to deliver by hand (P9-A).
 *
 * **Returned once and never again.** The token behind `url` is stored as a SHA-256 hash and
 * nothing else, exactly as every other setup link is, so there is no endpoint that can read it
 * back — losing it means issuing a new one, which invalidates this one. That is what keeps the
 * hash-only-at-rest invariant (auth design §14.6) intact while still letting an administrator
 * onboard someone on a deployment where WhatsApp and SMTP are not wired up.
 *
 * `url` carries a single-use, time-boxed capability to CHOOSE a password — never a password, and
 * never anything that can be exchanged for one.
 */
export interface SetupLinkDto {
  /** `{WEB_PUBLIC_URL}/activate?token=…` — the same link the delivery channels would have sent. */
  url: string;
  /** End of the validity window, from `auth.activationLink.ttlHours`. */
  expiresAt: string;
}

export interface AdminResetPasswordResultDto {
  delivery: CredentialsDeliveryResultDto[];
}

/** D6 force-on/off: force ON clears any enrolled secret; the user re-enrolls at next login. */
export const TotpRequireSchema = z.object({ required: z.boolean() }).strict();
export type TotpRequire = z.infer<typeof TotpRequireSchema>;

export const UserIdParamSchema = z.object({ id: objectId() }).strict();
