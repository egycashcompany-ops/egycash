// Every string the customer portal asks for must resolve in BOTH locales.
//
// `translate()` answers a missing key with the key itself, so an untranslated string ships looking
// like `gold.portal.tabs.bars` on the screen rather than failing anywhere a developer would notice.
// That matters more here than on a staff screen: the people reading these words are customers, and
// nobody internal is looking at this surface daily.
//
// Two halves, the same shape the IT module uses. The source scan catches literal keys as they are
// typed; the template keys — the tab labels and the transfer direction, both built by
// interpolation — are listed explicitly, because a scan cannot see them.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { translate } from '../../platform/localization/i18n';

const LOCALES: Locale[] = ['en', 'ar'];
const HERE = dirname(fileURLToPath(import.meta.url));

/** Keys rendered through a template, which the source scan below cannot see. */
const TEMPLATE_KEYS = [
  'gold.portal.tabs.overview',
  'gold.portal.tabs.bars',
  'gold.portal.tabs.drawers',
  'gold.portal.tabs.receiving',
  'gold.portal.tabs.delivery',
  'gold.portal.tabs.transfers',
  'gold.portal.tabs.keys',
  'gold.portal.tabs.representatives',
  'gold.portal.tabs.reports',
  'gold.portal.transfers.in',
  'gold.portal.transfers.out',
  'gold.portal.receiving.empty',
  'gold.portal.delivery.empty',
  'gold.portal.reports.movement',
  'gold.portal.reports.closing',
];

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.spec.') ? [full] : [];
  });

/** Literal `t('gold.portal…')` calls across the portal and its staff screen. */
const usedKeys = (): string[] => {
  const found = new Set<string>();
  for (const file of sources(resolve(HERE))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bt\(\s*'(gold\.portal[a-zA-Z0-9_.]*)'/g)) {
      const key = match[1];
      if (key !== undefined) found.add(key);
    }
  }
  return [...found].sort();
};

describe('the customer portal speaks both languages', () => {
  const keys = [...new Set([...usedKeys(), ...TEMPLATE_KEYS])].sort();

  it('finds the keys to check (the scan itself must not silently match nothing)', () => {
    expect(keys.length).toBeGreaterThan(50);
  });

  for (const locale of LOCALES) {
    it(`resolves all of them — ${locale}`, () => {
      const missing = keys.filter((key) => translate(locale, key) === key);
      expect(missing, `untranslated in ${locale}`).toEqual([]);
    });
  }

  it('leaves no Arabic entry accidentally in English', () => {
    // The tell for a copy-paste that was never translated: an Arabic value with no Arabic letter.
    const suspicious = keys.filter((key) => !/[؀-ۿ]/.test(translate('ar', key)));
    expect(suspicious, 'Arabic values with no Arabic letters').toEqual([]);
  });
});
