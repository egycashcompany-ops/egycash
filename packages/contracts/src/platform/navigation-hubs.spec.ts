// The hub list both sides read. The API's own spec checks every key against the permission
// registry it can see; these hold the shape a route and a sidebar row can be built from.
import { describe, expect, it } from 'vitest';
import { HR_SETTINGS_HUB, NAVIGATION_HUBS, hubPermissions } from './navigation-hubs.js';

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
      'applicant.view',
      'interviewStage.manage',
      'evaluationPhase.manage',
      'announcement.send',
      'notificationRule.view',
    ]);
    expect(hubPermissions('/applicants')).toEqual([]);
    expect(hubPermissions('/hr-settings/announcements')).toEqual([]);
  });
});
