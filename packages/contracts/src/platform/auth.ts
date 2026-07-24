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
  email: string;
  name: { firstName: LocalizedString; lastName: LocalizedString };
  locale: 'ar' | 'en';
  branchId: string | null;
  /** The Employee this login belongs to (ADR-017) — the self-service subject (leave C1-R). */
  employeeId: string | null;
  /** Effective permission → widest granted scope (ADR-004, ADR-015). */
  permissions: Record<string, DataScope>;
  /** Holds a protected system role or a break-glass permission — e.g. super-admin (Review R13). */
  isPrivileged: boolean;
  flags: Record<string, boolean>;
  totpEnabled: boolean;
}

export type LoginResponse =
  | { totpRequired: true; challengeToken: string; enrollmentRequired: boolean }
  | { totpRequired: false; accessToken: string; me: MeDto };

export interface RefreshResponse {
  accessToken: string;
}

export interface TotpEnrollmentDto {
  secret: string;
  otpauthUrl: string;
}

export interface TotpEnabledDto {
  enabled: true;
  backupCodes: string[];
}

export interface SessionDto {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export const ListSessionsQuerySchema = z.object({}).strict();

export const AdminResetPasswordSchema = z
  .object({ newPassword: z.string().min(8).max(128) })
  .strict();
export type AdminResetPassword = z.infer<typeof AdminResetPasswordSchema>;

export const UserIdParamSchema = z.object({ id: objectId() }).strict();

export const LocalePatchSchema = z.object({ locale: LocaleSchema }).strict();
