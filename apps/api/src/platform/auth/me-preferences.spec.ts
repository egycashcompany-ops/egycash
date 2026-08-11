// P9-B — what `/auth/me` says about an account that predates the preference it is being asked for.
//
// This is the backward-compatibility guard and nothing else. `preferences.theme` was added to the
// schema by this phase, which means EVERY account in an existing deployment was written before the
// path existed — and a Mongoose `default` does not fill a path on a `.lean()` read of a document
// that never had it. So the `??` in `buildMe` is the thing that actually answers for those rows,
// and if it were dropped the whole estate would receive `theme: undefined` and the client would
// have to invent a value. That is the failure this file exists to catch.
//
// Rendered against the real `buildMe`, with only its two collaborators stubbed: RBAC and settings
// each perform I/O that has nothing to do with the question, and stubbing them keeps this a unit
// test of the guard rather than a slow re-test of permission resolution.
import { describe, expect, it, vi } from 'vitest';
import { type MeDto } from '@ecms/contracts';

vi.mock('../rbac', () => ({
  rbacService: {
    getEffectivePermissions: async () => ({ permissions: {}, isPrivileged: false }),
  },
}));
vi.mock('../settings', () => ({
  settingsService: { getFlagsFor: async () => ({}) },
}));

const { authService } = await import('./auth.service');
type UserDocLike = Parameters<typeof authService.buildMe>[0];

/** A stored account. `preferences` is passed through exactly as given, absences included. */
const user = (preferences?: unknown, locale: 'ar' | 'en' = 'ar'): UserDocLike =>
  ({
    _id: 'u-1',
    email: 'someone@ecms.local',
    username: null,
    employeeId: null,
    locale,
    preferences,
    profile: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
    organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    security: { permissionVersion: 1, mustChangePassword: false, totp: { enabled: false } },
  }) as unknown as UserDocLike;

const me = (preferences?: unknown, locale: 'ar' | 'en' = 'ar'): Promise<MeDto> =>
  authService.buildMe(user(preferences, locale));

describe('accounts written before the preference existed', () => {
  // The estate on the day this ships: every row, no exceptions.
  it('answers `system` for a row with no preferences object at all', async () => {
    expect((await me(undefined)).theme).toBe('system');
  });

  it('answers `system` for a row that has navLayout but no theme', async () => {
    expect((await me({ navLayout: 'rail' })).theme).toBe('system');
  });

  // The guard must not swallow the value it was given alongside the one it is filling in.
  it('keeps the stored navLayout while filling in the theme', async () => {
    const result = await me({ navLayout: 'rail' });
    expect(result.navLayout).toBe('rail');
    expect(result.theme).toBe('system');
  });

  it('still answers `launchpad` for a row with no preferences — the P7 guard, unmoved', async () => {
    expect((await me(undefined)).navLayout).toBe('launchpad');
  });
});

describe('accounts that have chosen', () => {
  it.each(['light', 'dark', 'system'] as const)('returns the stored theme %s', async (theme) => {
    expect((await me({ navLayout: 'launchpad', theme })).theme).toBe(theme);
  });

  // `system` is an intention, not a resolved colour: only the browser knows the device setting, so
  // the server must hand it back untouched rather than guessing light or dark on the user's behalf.
  it('does not resolve `system` into a concrete scheme', async () => {
    const result = await me({ navLayout: 'launchpad', theme: 'system' });
    expect(result.theme).toBe('system');
    expect(['light', 'dark']).not.toContain(result.theme);
  });
});

describe('locale', () => {
  // Unchanged by this phase — it comes off the record, not out of `preferences`. Asserted because
  // P9-B is the change that makes anything READ it, and a regression here would be silent.
  it.each(['ar', 'en'] as const)('reports the account language %s', async (locale) => {
    expect((await me({ navLayout: 'rail', theme: 'dark' }, locale)).locale).toBe(locale);
  });

  it('reports it even for a row with no preferences', async () => {
    expect((await me(undefined, 'en')).locale).toBe('en');
  });
});
