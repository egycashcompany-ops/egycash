// Every string the System Administration screens ask for must resolve in BOTH locales.
//
// `translate()` falls back to returning the key, so a missing translation is invisible to
// typecheck, lint and every render test — the administrator is simply shown
// `systemAdmin.users.actions.disable` on a button. The IT module carries the same guard from its
// first commit for exactly this reason.
//
// Two halves, and the second is the one that keeps working as the module grows:
//   • the enum-driven half fails the moment a value is added to a contracts enum without a label;
//   • the source-driven half scans the screens for every literal `t('systemAdmin.…')` they call, so
//     a key typed into a page without a catalog entry fails here rather than in production.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_STATUSES,
  DATA_SCOPES,
  PERMISSION_STATES,
  ROLE_MANAGEMENT,
  TIMELINE_SOURCES,
  USER_STATUSES,
  type Locale,
} from '@ecms/contracts';
import { translate } from '../../platform/localization/i18n';

const LOCALES: Locale[] = ['en', 'ar'];
const HERE = dirname(fileURLToPath(import.meta.url));

/** Rendered through TEMPLATE keys, so the source scan below cannot see them. */
const VOCABULARIES: { name: string; prefix: string; values: readonly string[] }[] = [
  { name: 'lifecycle status', prefix: 'systemAdmin.users.status', values: USER_STATUSES },
  { name: 'account status', prefix: 'systemAdmin.users.accountStatus', values: ACCOUNT_STATUSES },
  { name: 'account kind', prefix: 'systemAdmin.users.kind', values: ['employee', 'system'] },
  {
    name: 'detail tab',
    prefix: 'systemAdmin.users.tabs',
    values: ['overview', 'roles', 'permissions', 'security', 'activity'],
  },
  { name: 'role tab', prefix: 'systemAdmin.roles.tabs', values: ['permissions', 'users'] },
  { name: 'role management', prefix: 'systemAdmin.roles.managed', values: ROLE_MANAGEMENT },
  // The reach of a grant. Driven by the contracts enum, so a new scope cannot ship unlabelled.
  { name: 'assignment scope', prefix: 'systemAdmin.assignments.scopes', values: DATA_SCOPES },
  // Whether a grant applies right now. Driven by the contracts enum (SA-4).
  { name: 'permission state', prefix: 'systemAdmin.effective.state', values: PERMISSION_STATES },
  { name: 'locale', prefix: 'systemAdmin.users.locale', values: ['ar', 'en'] },
  { name: 'delivery channel', prefix: 'systemAdmin.users.channel', values: ['whatsapp', 'email'] },
  { name: 'timeline stream', prefix: 'systemAdmin.users.activity.stream', values: TIMELINE_SOURCES },
];

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.spec.') ? [full] : [];
  });

const usedKeys = (): string[] => {
  const found = new Set<string>();
  for (const file of sources(resolve(HERE))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bt\(\s*'(systemAdmin\.[a-zA-Z0-9_.]+)'/g)) {
      const key = match[1];
      if (key !== undefined) found.add(key);
    }
  }
  return [...found].sort();
};

/**
 * The audited acts the activity tab translates. The component keeps this set precisely so an
 * unknown action renders its raw code rather than a broken-looking key — but every action IN the
 * set must actually have a label, which is what this checks.
 */
const translatedActions = (): string[] => {
  const source = readFileSync(
    resolve(HERE, 'users/components/UserActivityTab.tsx'),
    'utf8',
  );
  const block = /TRANSLATED_ACTIONS = new Set\(\[([\s\S]*?)\]\)/.exec(source)?.[1] ?? '';
  return [...block.matchAll(/'([a-zA-Z]+)'/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
};

describe('System Administration vocabularies are translated in every locale', () => {
  for (const locale of LOCALES) {
    for (const vocabulary of VOCABULARIES) {
      it(`${vocabulary.name} — ${locale}`, () => {
        for (const value of vocabulary.values) {
          const key = `${vocabulary.prefix}.${value}`;
          const label = translate(locale, key);
          expect(label, `${key} has no ${locale} label`).not.toBe(key);
          expect(label.trim()).not.toBe('');
        }
      });
    }
  }
});

describe('every audited action the activity tab claims to translate has a label', () => {
  const actions = translatedActions();

  it('finds the action list (the scan itself must not silently match nothing)', () => {
    expect(actions.length).toBeGreaterThan(20);
  });

  for (const locale of LOCALES) {
    it(`resolves all of them — ${locale}`, () => {
      const missing = actions.filter(
        (action) =>
          translate(locale, `systemAdmin.users.audit.${action}`) ===
          `systemAdmin.users.audit.${action}`,
      );
      expect(missing, `untranslated in ${locale}`).toEqual([]);
    });
  }
});

describe('every literal key the System Administration screens use exists in both locales', () => {
  const keys = usedKeys();

  it('finds the keys to check (the scan itself must not silently match nothing)', () => {
    expect(keys.length).toBeGreaterThan(40);
  });

  for (const locale of LOCALES) {
    it(`resolves all of them — ${locale}`, () => {
      const missing = keys.filter((key) => translate(locale, key) === key);
      expect(missing, `untranslated in ${locale}`).toEqual([]);
    });
  }
});
