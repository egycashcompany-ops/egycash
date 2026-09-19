// Every string the delegation panel asks for must resolve in BOTH locales — `translate()` falls
// back to the key, so a missing label survives typecheck and lint and reaches the user as
// `delegation.save`.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { translate } from '../../localization/i18n';

const LOCALES: Locale[] = ['en', 'ar'];
const HERE = dirname(fileURLToPath(import.meta.url));

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
    for (const match of text.matchAll(/\bt\(\s*'((?:delegation|common)\.[a-zA-Z0-9_.]+)'/g)) {
      const key = match[1];
      if (key !== undefined) found.add(key);
    }
  }
  return [...found].sort();
};

describe('every literal key the delegation panel uses exists in both locales', () => {
  const keys = usedKeys();

  it('finds the keys to check', () => {
    expect(keys.length).toBeGreaterThan(10);
  });

  for (const locale of LOCALES) {
    it(`resolves all of them — ${locale}`, () => {
      const missing = keys.filter((key) => translate(locale, key) === key);
      expect(missing, `untranslated in ${locale}`).toEqual([]);
    });
  }

  it('labels the profile tab and the direct-grant badge in both locales', () => {
    for (const locale of LOCALES) {
      for (const key of ['employees.tabs.permissions', 'systemAdmin.effective.delegated']) {
        expect(translate(locale, key), `${key} in ${locale}`).not.toBe(key);
      }
    }
  });

  it('does not ship English text as the Arabic label', () => {
    const identical = keys.filter((key) => translate('en', key) === translate('ar', key));
    expect(identical).toEqual([]);
  });
});
