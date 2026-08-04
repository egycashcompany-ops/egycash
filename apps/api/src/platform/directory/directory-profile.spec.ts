import { describe, expect, it } from 'vitest';
import { DIRECTORY_PROFILE_KEYS } from '@ecms/contracts';

// The deny-list, enforced. A field added to the user model must require a decision to appear on
// this card; asserting the exact key set is what turns "widened by accident" into a failing test.
describe('directory profile shape', () => {
  it('exposes exactly the display fields and nothing else', () => {
    expect([...DIRECTORY_PROFILE_KEYS].sort()).toEqual(
      ['active', 'avatarFileId', 'branch', 'department', 'displayName', 'jobTitle', 'userId', 'workEmail'].sort(),
    );
  });

  it('carries none of the sensitive fields the users API has', () => {
    for (const forbidden of ['permissions', 'roles', 'phone', 'passwordHash', 'preferences', 'security', 'status']) {
      expect(DIRECTORY_PROFILE_KEYS).not.toContain(forbidden);
    }
  });
});
