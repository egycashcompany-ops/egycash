// Auth-owned configurable values, declared into the settings registry at boot
// (Platform Core §1: password policy is settings-driven).
import { z } from 'zod';
import { SettingKeys } from '@ecms/contracts';
import { declareSetting } from '../settings';

/**
 * The inactivity window, in minutes: a session nobody has used for this long is closed at its next
 * renewal (`auth.service.ts`, `refresh`; ADR-039).
 *
 * Changing it is safe while screens are open. A renewal is judged by the longer of the current
 * value and the one that session's screen was last told (`sessions.idleMinutesTold`), so a lowered
 * value never closes a session before its screen has counted down to the number it showed.
 *
 * THE FLOOR IS TEN. A working browser renews every half window, but never less often than every
 * five minutes (`RENEW_AT_MOST_EVERY_MS`, web `idle-session.ts`). At ten or more, every allowed
 * window renews on that same five-minute cadence, and the server's clock for a person at work is
 * never more than half the window old. It is also the old default; below it the one-minute warning
 * would be a large part of the window. A web test holds the floor to the cadence.
 *
 * NO OFF SWITCH. The deployment variable this replaced took `0` to switch the control off; a
 * settings page is reachable by every holder of `setting.edit`, and the rule is a security control,
 * like the lockout, whose floor is likewise above zero. 1440 minutes (a day) is the ceiling.
 */
export const SESSION_IDLE_MINUTES = { min: 10, max: 24 * 60, default: 30 } as const;

export const registerAuthSettings = (): void => {
  declareSetting({
    key: SettingKeys.PasswordMinLength,
    description: 'Minimum password length',
    schema: z.number().int().min(8).max(64),
    defaultValue: 10,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: SettingKeys.PasswordRequireComplexity,
    description: 'Require lower/upper/digit/symbol characters in passwords',
    schema: z.boolean(),
    defaultValue: true,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: SettingKeys.LockoutMaxAttempts,
    description: 'Failed logins before the account locks',
    schema: z.number().int().min(3).max(20),
    defaultValue: 5,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: SettingKeys.LockoutMinutes,
    description: 'Lockout duration in minutes',
    schema: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
    defaultValue: 15,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: SettingKeys.SessionIdleMinutes,
    description:
      'Minutes without use before a session is signed out (security architecture §1). An active user is never signed out.',
    schema: z.number().int().min(SESSION_IDLE_MINUTES.min).max(SESSION_IDLE_MINUTES.max),
    defaultValue: SESSION_IDLE_MINUTES.default,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: SettingKeys.AuthLoginIdentifiers,
    description: 'Enabled login identifier kinds (auth design 4.3)',
    schema: z.array(z.enum(['username', 'email', 'employeeCode'])).min(1),
    defaultValue: ['username', 'email', 'employeeCode'],
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: SettingKeys.ActivationLinkTtlHours,
    description: 'Activation/setup-link validity window in hours (auth design §14)',
    schema: z.number().int().min(1).max(336),
    defaultValue: 48,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: SettingKeys.TotpEnforcedForPrivileged,
    description:
      'Enforce TOTP 2FA for privileged accounts (system roles / break-glass permissions) — Review R13',
    schema: z.boolean(),
    defaultValue: true,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: SettingKeys.PasskeysEnabled,
    description:
      'Allow sign-in with a passkey (fingerprint / Face ID) — ADR-035, ADR-036. Off refuses signing in, adding and renaming; people can still list and remove their own.',
    schema: z.boolean(),
    defaultValue: true,
    allowedScopes: ['organization'],
  });
};
