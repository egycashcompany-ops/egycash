// P9-B — the shape of a preferences save.
//
// The schema is the only thing standing between a self-service endpoint and the rest of the user
// record: `/auth/me/preferences` carries no permission, because the subject is always the caller,
// so `.strict()` is what stops `{ isPrivileged: true }` from riding along. That is asserted here
// rather than assumed, alongside the two properties the endpoint gained in P9-B — every field
// optional (a screen saves the one control that was touched) and an empty body refused (a save
// that changes nothing must not answer 200).
import { describe, expect, it } from 'vitest';
import {
  NAV_LAYOUTS,
  THEME_MODES,
  UpdateMyPreferencesSchema,
  type UpdateMyPreferences,
} from './auth.js';

const parse = (body: unknown) => UpdateMyPreferencesSchema.safeParse(body);

describe('each preference can be saved on its own', () => {
  it.each([
    ['navLayout', { navLayout: 'rail' }],
    ['locale', { locale: 'en' }],
    ['theme', { theme: 'dark' }],
  ])('accepts %s alone', (_field, body) => {
    expect(parse(body).success).toBe(true);
  });

  it('accepts all three together', () => {
    const result = parse({ navLayout: 'launchpad', locale: 'ar', theme: 'system' });
    expect(result.success).toBe(true);
  });

  // The pre-P9-B body, unchanged: a client that only knows about navLayout keeps working.
  it('still accepts the body shape that shipped before locale and theme existed', () => {
    expect(parse({ navLayout: 'rail' }).success).toBe(true);
  });
});

describe('what it refuses', () => {
  // A no-op that answers 200 reads as a successful save. It is not one.
  it('refuses an empty body', () => {
    expect(parse({}).success).toBe(false);
  });

  // The reason this endpoint can be permissionless: nothing outside these three fields gets in.
  it('refuses a field it does not name — the mass-assignment defence', () => {
    expect(parse({ navLayout: 'rail', isPrivileged: true }).success).toBe(false);
    expect(parse({ locale: 'en', permissions: { 'user.edit': 'organization' } }).success).toBe(
      false,
    );
    expect(parse({ theme: 'dark', passwordHash: 'x' }).success).toBe(false);
  });

  it.each([
    ['navLayout', { navLayout: 'metro' }],
    ['locale', { locale: 'fr' }],
    ['theme', { theme: 'solarized' }],
  ])('refuses an unknown %s', (_field, body) => {
    expect(parse(body).success).toBe(false);
  });

  it('refuses a value of the wrong type', () => {
    expect(parse({ theme: 1 }).success).toBe(false);
    expect(parse({ locale: null }).success).toBe(false);
  });
});

describe('the vocabularies themselves', () => {
  it('offers exactly the two shells and the three colour schemes', () => {
    expect([...NAV_LAYOUTS]).toEqual(['launchpad', 'rail']);
    expect([...THEME_MODES]).toEqual(['light', 'dark', 'system']);
  });

  // `system` is stored, not resolved: the server has no `prefers-color-scheme` to read, so it must
  // accept the intention and hand it back untouched.
  it('treats system as a storable theme value', () => {
    const result = parse({ theme: 'system' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.theme).toBe('system');
  });

  it('types every field as optional', () => {
    const onlyTheme: UpdateMyPreferences = { theme: 'light' };
    expect(onlyTheme.navLayout).toBeUndefined();
    expect(onlyTheme.locale).toBeUndefined();
  });
});
