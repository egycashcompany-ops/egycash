// Every string this feature asks for exists, in both languages.
//
// WHY THIS SPEC HAS TO EXIST. `translate` falls back to returning the KEY when it finds nothing
// (`catalogs[locale][key] ?? key`), so a key added to `en` and forgotten in `ar` passes typecheck,
// passes lint, passes every other spec, and ships — and what the reader then sees on the screen is
// the literal text `hr.applicantFolders.deleteFolder`. Eight web modules carry a scan like this
// one; recruitment carried none, which is why the gap was invisible.
//
// It scans the feature's own source for the keys it uses, rather than listing them here, so the
// next string somebody adds is covered without anybody remembering to come back.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  APPLICANT_FOLDER_DELETE_BLOCKS,
  APPLICANT_FOLDER_FILE_KINDS,
  type Locale,
} from '@ecms/contracts';
import { translate } from '../../../../platform/localization/i18n';
import { APPLICANT_SUB_FOLDERS } from './components/applicant-folder-groups';

const LOCALES: Locale[] = ['en', 'ar'];
const HERE = resolve(dirname(fileURLToPath(import.meta.url)));

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.spec.') ? [full] : [];
  });

/** Every `t('hr.applicant…')` key written literally in this feature. */
const usedKeys = (): string[] => {
  const found = new Set<string>();
  for (const file of sources(HERE)) {
    for (const match of readFileSync(file, 'utf8').matchAll(
      /\bt\(\s*'(hr\.applicant[A-Za-z0-9_.]+)'/g,
    )) {
      if (match[1] !== undefined) found.add(match[1]);
    }
  }
  return [...found].sort();
};

describe('the applicant documents feature speaks both languages', () => {
  const keys = usedKeys();

  // Guard over nothing: a regex that stopped matching would otherwise pass for ever.
  it('finds the keys the feature uses', () => {
    expect(keys.length).toBeGreaterThan(25);
    expect(keys).toContain('hr.applicantFolders.deleteFolder');
    expect(keys).toContain('hr.applicantFolders.subEmpty');
  });

  for (const locale of LOCALES) {
    it(`resolves every literal key — ${locale}`, () => {
      expect(keys.filter((key) => translate(locale, key) === key)).toEqual([]);
    });
  }

  /**
   * The template keys the scan above cannot see.
   *
   * `t(\`hr.applicantFolders.sub.${id}\`)` is one literal in the source and one string per value
   * of the vocabulary behind it, so each vocabulary is walked here instead. This is the half that
   * catches a SEVENTH file kind, or a fourth reason a folder may not be deleted, arriving without
   * its two labels.
   */
  const VOCABULARIES: { prefix: string; values: readonly string[] }[] = [
    { prefix: 'hr.applicantFolders.kind', values: APPLICANT_FOLDER_FILE_KINDS },
    { prefix: 'hr.applicantFolders.sub', values: APPLICANT_SUB_FOLDERS },
    { prefix: 'hr.applicantFolders.blocked', values: APPLICANT_FOLDER_DELETE_BLOCKS },
  ];

  for (const locale of LOCALES) {
    for (const vocabulary of VOCABULARIES) {
      it(`names every ${vocabulary.prefix} — ${locale}`, () => {
        expect(vocabulary.values.length).toBeGreaterThan(2);
        const missing = vocabulary.values.filter(
          (value) =>
            translate(locale, `${vocabulary.prefix}.${value}`) === `${vocabulary.prefix}.${value}`,
        );
        expect(missing).toEqual([]);
      });
    }
  }

  /** The two drawers that can be empty each say so in their own words. */
  for (const locale of LOCALES) {
    it(`explains an empty drawer — ${locale}`, () => {
      for (const id of ['documents', 'attachments']) {
        const key = `hr.applicantFolders.subNone.${id}`;
        expect(translate(locale, key), key).not.toBe(key);
      }
    });
  }
});
