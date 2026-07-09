// Auth-owned configurable values, declared into the settings registry at boot
// (Platform Core §1: password policy is settings-driven).
import { z } from 'zod';
import { SettingKeys } from '@ecms/contracts';
import { declareSetting } from '../settings';

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
    key: SettingKeys.TotpEnforcedForPrivileged,
    description:
      'Enforce TOTP 2FA for privileged accounts (system roles / break-glass permissions) — Review R13',
    schema: z.boolean(),
    defaultValue: true,
    allowedScopes: ['organization'],
  });
};
