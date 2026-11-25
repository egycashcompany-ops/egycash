// Every string the Administrative Affairs screens ask for must resolve in BOTH locales.
//
// `translate()` falls back to returning the key, so a missing translation is invisible to
// typecheck, lint and every render test — the reader is simply shown `administration.…`. Two halves,
// as IT's guard has (`it/it-i18n.spec.ts`):
//   • the vocabulary half fails the moment a value is added to a contracts enum, or a tab or a
//     refusal word to the module, without its label — those are asked through TEMPLATE keys;
//   • the source half scans the module for every literal `'administration.…'` its sources hold —
//     a `t('…')` call, a key kept in a table, or one picked by a ternary inside `t(…)`.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADMINISTRATION_WAREHOUSE_TYPES, type Locale } from '@ecms/contracts';
import { translate } from '../../platform/localization/i18n';
import { REFUSAL_FIELD_KEYS } from './lib/refusals';
import { CATALOG_TABS } from './pages/CatalogsPage';

const LOCALES: Locale[] = ['en', 'ar'];
const HERE = dirname(fileURLToPath(import.meta.url));

const VOCABULARIES: { name: string; keys: readonly string[] }[] = [
  {
    name: 'warehouse kind',
    keys: ADMINISTRATION_WAREHOUSE_TYPES.map((type) => `administration.warehouses.type.${type}`),
  },
  { name: 'catalogs tab', keys: CATALOG_TABS.map((tab) => `administration.catalogs.tab.${tab}`) },
  // Each tab's own add, edit and empty words (`administration.catalogs.${kind}.…`).
  ...(['add', 'edit', 'empty'] as const).map((word) => ({
    name: `catalogs tab ${word}`,
    keys: CATALOG_TABS.map((tab) => `administration.catalogs.${tab}.${word}`),
  })),
  { name: 'a refusal beside its field', keys: REFUSAL_FIELD_KEYS },
  // The status words every register and the item's record show, picked by a ternary.
  {
    name: 'status',
    keys: ['active', 'inactive', 'filterActive', 'filterInactive', 'filterAll'].map(
      (word) => `administration.status.${word}`,
    ),
  },
  // The sidebar rows' labels are the page titles (the routes spec holds them word for word).
  {
    name: 'nav row',
    keys: ['home', 'warehouses', 'items', 'catalogs'].map((page) => `administration.nav.${page}`),
  },
];

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/u.test(entry.name) && !entry.name.includes('.spec.') ? [full] : [];
  });

/**
 * Every literal `'administration.…'` in the module's sources: a `t('…')` call, a key held in a
 * table and handed to `t()` later (the home's tiles, the level labels), or one picked by a ternary
 * inside `t(…)` (the status words). In this module such a literal is only ever a catalog key — a
 * permission is `administrationX.…` and a path `/administration/…`. Template keys are covered by
 * VOCABULARIES.
 */
const usedKeys = (): string[] => {
  const found = new Set<string>();
  for (const file of sources(resolve(HERE))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/'(administration\.[a-zA-Z0-9_.]+)'/gu)) {
      if (match[1] !== undefined) found.add(match[1]);
    }
  }
  return [...found].sort();
};

describe('the module’s vocabularies are translated in every locale', () => {
  for (const locale of LOCALES) {
    for (const vocabulary of VOCABULARIES) {
      it(`${vocabulary.name} — ${locale}`, () => {
        for (const key of vocabulary.keys) {
          const label = translate(locale, key);
          expect(label, `${key} has no ${locale} label`).not.toBe(key);
          expect(label.trim()).not.toBe('');
        }
      });
    }
  }
});

describe('every literal key the module’s screens use exists in both locales', () => {
  const keys = usedKeys();

  it('finds the keys to check (the scan itself must not silently match nothing)', () => {
    expect(keys.length).toBeGreaterThan(100);
    // A key reached only through a ternary is found too.
    expect(keys).toEqual(
      expect.arrayContaining(['administration.status.active', 'administration.status.inactive']),
    );
  });

  for (const locale of LOCALES) {
    it(`resolves all of them — ${locale}`, () => {
      expect(
        keys.filter((key) => translate(locale, key) === key),
        `untranslated in ${locale}`,
      ).toEqual([]);
    });
  }

  it('words the Arabic in Arabic — no Arabic label is the English one', () => {
    const same = keys.filter(
      (key) =>
        translate('ar', key) === translate('en', key) && /[A-Za-z]{3}/u.test(translate('en', key)),
    );
    expect(same).toEqual([]);
  });
});
