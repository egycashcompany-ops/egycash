import { describe, expect, it } from 'vitest';
import {
  HR_ONLY_ROLE_KEY_PREFIX,
  classifyIdentifier,
  classifyPermissionKeys,
  derivedHrRoleKey,
  hrPermissionKeysOf,
  isDerivedHrRoleKey,
  parseIdentifierList,
} from './hr-only-policy';

const registry = new Map<string, string>([
  ['applicant.view', 'hr'],
  ['applicant.create', 'hr'],
  ['employee.view', 'hr'],
  ['fleetVehicle.view', 'fleet'],
  ['itAsset.view', 'it'],
  ['user.view', 'platform'],
]);

describe('classifyPermissionKeys', () => {
  it('calls a role holding only HR permissions hr-only', () => {
    expect(classifyPermissionKeys(['applicant.view', 'employee.view'], registry)).toBe('hr-only');
  });

  it('calls a role holding nothing from HR non-hr', () => {
    expect(classifyPermissionKeys(['fleetVehicle.view', 'user.view'], registry)).toBe('non-hr');
  });

  it('calls a role holding both mixed — the case that needs rewriting, not revoking', () => {
    expect(classifyPermissionKeys(['applicant.view', 'fleetVehicle.view'], registry)).toBe('mixed');
  });

  it('calls a role granting nothing empty', () => {
    expect(classifyPermissionKeys([], registry)).toBe('empty');
  });

  it('treats an unregistered permission key as non-HR', () => {
    // A key the registry does not know — left behind by a retired module, or a typo in a
    // hand-edited role. Counting it as HR would let an unreviewed grant survive the confinement.
    expect(classifyPermissionKeys(['ghost.view'], registry)).toBe('non-hr');
    expect(classifyPermissionKeys(['applicant.view', 'ghost.view'], registry)).toBe('mixed');
  });
});

describe('hrPermissionKeysOf', () => {
  it('keeps the HR keys and drops everything else', () => {
    expect(
      hrPermissionKeysOf(
        ['applicant.view', 'fleetVehicle.view', 'employee.view', 'user.view'],
        registry,
      ).sort(),
    ).toEqual(['applicant.view', 'employee.view']);
  });

  it('deduplicates, so a key held through two roles is granted once', () => {
    expect(hrPermissionKeysOf(['applicant.view', 'applicant.view'], registry)).toEqual([
      'applicant.view',
    ]);
  });

  it('never invents a key that was not held', () => {
    // The confinement may only ever narrow: `applicant.create` exists in the catalog but is not
    // in this role, and must not appear in its derivative.
    expect(hrPermissionKeysOf(['applicant.view', 'fleetVehicle.view'], registry)).toEqual([
      'applicant.view',
    ]);
  });
});

describe('derived role keys', () => {
  it('keys a derivative on its source role', () => {
    expect(derivedHrRoleKey('abc123')).toBe(`${HR_ONLY_ROLE_KEY_PREFIX}abc123`);
  });

  it('gives two different source roles two different derivatives', () => {
    // What stops a narrow user's access from being widened when a broader user is confined.
    expect(derivedHrRoleKey('roleA')).not.toBe(derivedHrRoleKey('roleB'));
  });

  it('recognizes its own derivatives and nothing else', () => {
    expect(isDerivedHrRoleKey(derivedHrRoleKey('abc123'))).toBe(true);
    expect(isDerivedHrRoleKey('super-admin')).toBe(false);
    expect(isDerivedHrRoleKey(null)).toBe(false);
  });
});

describe('classifyIdentifier', () => {
  it('reads a name: identifier as a name lookup, trimmed', () => {
    expect(classifyIdentifier('name: Mohamed Mustafa ')).toEqual({
      kind: 'name',
      value: 'Mohamed Mustafa',
    });
  });

  it('reads anything containing @ as an email', () => {
    expect(classifyIdentifier('samer@ecms.local')).toEqual({
      kind: 'email',
      value: 'samer@ecms.local',
    });
  });

  it('reads everything else as a username', () => {
    expect(classifyIdentifier('m.essam')).toEqual({ kind: 'username', value: 'm.essam' });
  });

  it('rejects blank and prefix-only identifiers rather than matching everyone', () => {
    expect(classifyIdentifier('   ')).toBeNull();
    expect(classifyIdentifier('name:')).toBeNull();
    expect(classifyIdentifier('name:   ')).toBeNull();
  });
});

describe('parseIdentifierList', () => {
  it('splits on commas and newlines and trims', () => {
    expect(parseIdentifierList('name:Mohamed Mustafa, samer@ecms.local\n m.essam ')).toEqual([
      'name:Mohamed Mustafa',
      'samer@ecms.local',
      'm.essam',
    ]);
  });

  it('drops blanks, so a trailing comma configures nothing extra', () => {
    expect(parseIdentifierList('a@b.local,,\n,')).toEqual(['a@b.local']);
  });

  it('returns nothing for an empty configuration', () => {
    expect(parseIdentifierList('')).toEqual([]);
    expect(parseIdentifierList('   ')).toEqual([]);
  });

  it('parses the shipped default into the four accounts it names', () => {
    expect(
      parseIdentifierList(
        'name:Mohamed Mustafa,name:Samer Mohammed,name:Mohamed Essam,name:Saif AlDin Muhammad',
      ),
    ).toEqual([
      'name:Mohamed Mustafa',
      'name:Samer Mohammed',
      'name:Mohamed Essam',
      'name:Saif AlDin Muhammad',
    ]);
  });
});
