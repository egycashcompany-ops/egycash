// What the settings screen is a screen OF.
//
// P8 built a surface over the settings registry without adding a single declaration to it, which
// makes the registry's contents a contract between two halves that cannot see each other: the
// screen groups by the key's first segment and labels each key from a catalog written by hand, and
// the API declares those keys in seven separate files across the platform and three modules.
//
// This file pins the API half. It clears the registry, runs every registration function the boot
// sequence runs, and asserts the result against the key objects in `@ecms/contracts` — the same
// objects the web fixture builds its rows from. A setting added to a module without a key in
// contracts fails here; a key added to contracts without a declaration fails here; and either
// failure is the one that would otherwise show up as a value nobody can configure.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  FleetSettingKeys,
  HrAttendanceSettingKeys,
  HrContractSettingKeys,
  HrLeaveSettingKeys,
  ItSettingKeys,
  SettingKeys,
  featureFlags,
} from '@ecms/contracts';
import {
  clearSettingRegistry,
  declareFeatureFlagSettings,
  declareSetting,
  listSettingDeclarations,
} from './settings.registry';
import { settingsService } from './settings.service';
import { registerAuthSettings } from '../auth/auth.settings';
import { registerAuditSettings } from '../audit/audit.settings';
import { registerNotificationSettings } from '../notifications/notification.settings';
import { registerHrContractSettings } from '../../modules/hr/contracts/contracts.settings';
import { registerHrWorkCalendarSettings } from '../../modules/hr/work-calendar/work-calendar.settings';
import { registerHrAttendanceSettings } from '../../modules/hr/attendance/attendance.settings';
import { registerItSettings } from '../../modules/it/it.settings';
import { registerFleetSettings } from '../../modules/fleet/fleet.settings';

/** Every registration the boot sequence performs, in the order it performs them. */
const registerAll = (): void => {
  registerAuthSettings();
  registerAuditSettings();
  registerNotificationSettings();
  registerHrContractSettings();
  registerHrWorkCalendarSettings();
  registerHrAttendanceSettings();
  registerItSettings();
  registerFleetSettings();
};

const EXPECTED: Record<string, string[]> = {
  auth: [
    SettingKeys.PasswordMinLength,
    SettingKeys.PasswordRequireComplexity,
    SettingKeys.LockoutMaxAttempts,
    SettingKeys.LockoutMinutes,
    SettingKeys.TotpEnforcedForPrivileged,
    SettingKeys.AuthLoginIdentifiers,
    SettingKeys.ActivationLinkTtlHours,
  ],
  audit: [
    SettingKeys.AuditRetentionActivityDays,
    SettingKeys.AuditExportMaxRows,
    SettingKeys.AuditSignalsDeniedThreshold,
    SettingKeys.AuditSignalsExportSpikeThreshold,
  ],
  notifications: [
    SettingKeys.NotificationsEmailEnabled,
    SettingKeys.NotificationsQuietHoursEnabledByDefault,
  ],
  contracts: Object.values(HrContractSettingKeys),
  hr: [...Object.values(HrLeaveSettingKeys), ...Object.values(HrAttendanceSettingKeys)],
  it: Object.values(ItSettingKeys),
  fleet: Object.values(FleetSettingKeys),
};

const ownerOf = (key: string): string => key.split('.')[0] ?? '';

beforeEach(() => {
  clearSettingRegistry();
});
afterEach(() => {
  clearSettingRegistry();
});

describe('the settings inventory the screen renders', () => {
  it('declares thirty-two settings, and no key twice', () => {
    registerAll();
    const keys = listSettingDeclarations().map((declaration) => declaration.key);
    expect(keys).toHaveLength(32);
    expect(new Set(keys).size).toBe(32);
  });

  it('declares exactly the keys the contracts name — no more, no fewer', () => {
    registerAll();
    const declared = listSettingDeclarations().map((d) => d.key).sort();
    const expected = Object.values(EXPECTED).flat().sort();
    expect(expected).toHaveLength(32);
    expect(declared).toEqual(expected);
  });

  it.each(Object.entries(EXPECTED))('groups %s under the owner the key names', (owner, keys) => {
    registerAll();
    const mine = listSettingDeclarations()
      .map((d) => d.key)
      .filter((key) => ownerOf(key) === owner)
      .sort();
    expect(mine).toEqual([...keys].sort());
  });

  // The screen writes `scope: 'organization'` and nothing else. A declaration that did not allow
  // that scope would be a row whose save the server refuses with 422 — visible only at runtime.
  it('lets every declared setting be set at the organization level', () => {
    registerAll();
    const unreachable = listSettingDeclarations()
      .filter((d) => !d.allowedScopes.includes('organization'))
      .map((d) => d.key);
    expect(unreachable, 'a setting cannot be written by the settings screen').toEqual([]);
  });

  // The screen renders one of four editors from `type`, and falls back to read-only for anything
  // else. Nothing is broken by a fifth type arriving — but it becomes uneditable, so it is worth
  // knowing the day it happens rather than the day somebody tries to change the value.
  it('reports only the four types the screen has editors for', () => {
    registerAll();
    const types = new Set(settingsService.listDefinitions().map((d) => d.type));
    expect([...types].sort()).toEqual(['array', 'boolean', 'number', 'string']);
  });

  it('carries a description for every setting, since the row prints it', () => {
    registerAll();
    const blank = listSettingDeclarations()
      .filter((d) => d.description.trim() === '')
      .map((d) => d.key);
    expect(blank).toEqual([]);
  });

  // `declareFeatureFlagSettings` registers one `flag.<key>` setting per flag, which is why the
  // screen knows the `flag` owner. The catalog is empty today; when it is not, the rows appear
  // with no further change to the screen.
  it('adds a flag setting per feature flag, and none while the catalog is empty', () => {
    registerAll();
    const before = listSettingDeclarations().length;
    declareFeatureFlagSettings(z.boolean());
    expect(listSettingDeclarations().length - before).toBe(featureFlags.length);
    expect(featureFlags).toHaveLength(0);
  });

  it('refuses a duplicate declaration rather than letting the later one win silently', () => {
    registerAll();
    expect(() =>
      declareSetting({
        key: SettingKeys.PasswordMinLength,
        description: 'a second opinion',
        schema: z.number(),
        defaultValue: 1,
        allowedScopes: ['organization'],
      }),
    ).toThrow(/duplicate setting declaration/);
  });
});
