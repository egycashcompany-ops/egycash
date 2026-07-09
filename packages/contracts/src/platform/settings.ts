import { z } from 'zod';
import { objectId } from '../common/index.js';

// Settings hierarchy after ADR-015: user → branch → organization → code default.
export const SETTING_SCOPES = ['organization', 'branch', 'user'] as const;

/** Well-known setting keys — declared by their owning service at boot. */
export const SettingKeys = {
  PasswordMinLength: 'auth.password.minLength',
  PasswordRequireComplexity: 'auth.password.requireComplexity',
  LockoutMaxAttempts: 'auth.lockout.maxAttempts',
  LockoutMinutes: 'auth.lockout.minutes',
  TotpEnforcedForPrivileged: 'auth.totp.enforcedForPrivileged',
} as const;
export const SettingScopeSchema = z.enum(SETTING_SCOPES);
export type SettingScope = z.infer<typeof SettingScopeSchema>;

export const SetSettingSchema = z
  .object({
    key: z.string().min(1),
    scope: SettingScopeSchema,
    /** Branch/user id for branch/user scope; must be omitted for organization scope. */
    scopeRef: objectId().optional(),
    value: z.unknown(),
  })
  .strict();
export type SetSetting = z.infer<typeof SetSettingSchema>;

export interface SettingDefinitionDto {
  key: string;
  description: string;
  /** JSON-schema-ish type label for the admin UI (rendered from the Zod type). */
  type: string;
  defaultValue: unknown;
  allowedScopes: SettingScope[];
}

export interface SettingValueDto {
  key: string;
  scope: SettingScope;
  scopeRef: string | null;
  value: unknown;
}

export interface ResolvedSettingDto {
  key: string;
  value: unknown;
  /** Which layer produced the value. */
  resolvedFrom: SettingScope | 'default';
}

export interface FeatureFlagStateDto {
  key: string;
  description: string;
  owner: string;
  expiresAt: string;
  defaultValue: boolean;
  /** Effective value for the calling user after hierarchy evaluation. */
  value: boolean;
}
