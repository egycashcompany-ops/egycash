// The hub list both sides read. The API's own spec checks every key against the permission
// registry it can see; these hold the shape a route and a sidebar row can be built from.
import { describe, expect, it } from 'vitest';
import {
  HR_SETTINGS_HUB,
  NAVIGATION_HUBS,
  OPERATIONS_BANK_REPORT_KEYS,
  SHARED_NAVIGATION_ROWS,
  hubPermissions,
  navigationRowKeys,
} from './navigation-hubs.js';

describe('navigation hubs', () => {
  it('gives every tab its own path segment', () => {
    for (const hub of NAVIGATION_HUBS) {
      const keys = hub.tabs.map((tab) => tab.key);
      expect(new Set(keys).size, hub.route).toBe(keys.length);
      for (const key of keys) expect(key).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it('keeps each group together, so the bar draws one divider per change of group', () => {
    for (const hub of NAVIGATION_HUBS) {
      const runs = hub.tabs.map((tab) => tab.group).filter((g, i, all) => i === 0 || all[i - 1] !== g);
      expect(new Set(runs).size, hub.route).toBe(runs.length);
    }
  });

  it('opens a hub row with any tab key, and nothing else with one', () => {
    expect(hubPermissions(HR_SETTINGS_HUB.route)).toEqual([
      'recruitmentForm.manage',
      'insuranceJobTitle.manage',
      'applicant.view',
      'interviewStage.manage',
      'evaluationPhase.manage',
      'announcement.send',
      'notificationRule.view',
    ]);
    expect(hubPermissions('/applicants')).toEqual([]);
    expect(hubPermissions('/hr-settings/announcements')).toEqual([]);
  });

  it('opens a shared row with any of its keys, and an ordinary row with none beyond its own', () => {
    // Round 14 — «تقرير البنوك» is the screen «تجميع الخزينة» was, so it shows to the vault's readers
    // as well as the shipments' (they each had one of the two rows).
    expect(navigationRowKeys('/operations/reports/banks')).toEqual([
      'operationsShipment.view',
      'operationsVault.view',
    ]);
    expect(navigationRowKeys('/operations/reports/banks')).toEqual([...OPERATIONS_BANK_REPORT_KEYS]);
    // A hub's keys come through the same door.
    expect(navigationRowKeys(HR_SETTINGS_HUB.route)).toEqual(hubPermissions(HR_SETTINGS_HUB.route));
    expect(navigationRowKeys('/operations/reports/captains')).toEqual([]);
    // The retired «تجميع الخزينة» address opens nothing — it only redirects now.
    expect(navigationRowKeys('/operations/reports/vault')).toEqual([]);
  });

  it('declares each shared route once, and never as a hub too', () => {
    const routes = SHARED_NAVIGATION_ROWS.map((row) => row.route);
    expect(new Set(routes).size).toBe(routes.length);
    for (const route of routes) expect(hubPermissions(route), route).toEqual([]);
    for (const row of SHARED_NAVIGATION_ROWS) expect(row.permissions.length, row.route).toBeGreaterThan(1);
  });
});
