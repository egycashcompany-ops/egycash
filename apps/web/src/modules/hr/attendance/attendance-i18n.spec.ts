// Every string the Attendance screens ask for must resolve in BOTH locales.
//
// `translate()` falls back to returning the key, so a missing translation survives typecheck,
// lint and every render test — the user simply sees `attendance.dayStatus.incomplete`. Two halves,
// as elsewhere: the enum-driven half fails the moment a contracts enum grows a value with no
// label, and the source-driven half scans the screens for the literal keys they actually call.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_DAY_FLAGS,
  ATTENDANCE_DAY_STATUSES,
  ATTENDANCE_REGULARIZATION_STATUSES,
  type Locale,
} from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';

const LOCALES: Locale[] = ['en', 'ar'];
const HERE = dirname(fileURLToPath(import.meta.url));

// All three are rendered through TEMPLATE keys (`t(\`attendance.dayStatus.${s}\`)`), so the
// source scan below cannot see them — which is exactly why they are driven off the enums.
const VOCABULARIES: { name: string; prefix: string; values: readonly string[] }[] = [
  { name: 'day status', prefix: 'attendance.dayStatus', values: ATTENDANCE_DAY_STATUSES },
  { name: 'day flag', prefix: 'attendance.flag', values: ATTENDANCE_DAY_FLAGS },
  {
    name: 'regularization status',
    prefix: 'attendance.regStatus',
    values: ATTENDANCE_REGULARIZATION_STATUSES,
  },
  { name: 'queue tab', prefix: 'attendance.queue.tab', values: ['queue', 'all'] as const },
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
    for (const match of text.matchAll(/\bt\(\s*'(attendance\.[a-zA-Z0-9_.]+)'/g)) {
      const key = match[1];
      if (key !== undefined) found.add(key);
    }
  }
  return [...found].sort();
};

describe('Attendance vocabularies are translated in every locale', () => {
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

describe('every literal key the Attendance screens use exists in both locales', () => {
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

  // The profile tab is owned by the employees hub, so its label lives in that namespace — and it
  // is the one key that would go missing without anything in this module failing.
  it('labels the profile tab in both locales', () => {
    for (const locale of LOCALES) {
      expect(translate(locale, 'employees.tabs.attendance')).not.toBe('employees.tabs.attendance');
    }
  });

  // Arabic and English must differ wherever a real translation is expected: an en string copied
  // into the ar catalog resolves, passes the checks above, and still ships English to an Arabic
  // user. Codes and the CSV label are legitimately identical, so they are excluded by name.
  it('does not ship English text as the Arabic label', () => {
    const identical = keys.filter(
      (key) => translate('ar', key) === translate('en', key) && !key.endsWith('.export'),
    );
    expect(identical).toEqual([]);
  });
});
