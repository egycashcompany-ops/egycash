// Every string the payroll screens ask for must resolve in BOTH locales — `translate()` falls
// back to the key, so a missing label ships silently as `payroll.payItems.kind.earning`.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PAY_ITEM_CALC_BASES,
  PAY_ITEM_KINDS,
  PAYROLL_ADJUSTMENT_KINDS,
  PAYROLL_ADJUSTMENT_STATUSES,
  type Locale,
} from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';

const LOCALES: Locale[] = ['en', 'ar'];
const HERE = dirname(fileURLToPath(import.meta.url));

// Rendered through TEMPLATE keys, so the literal scan below cannot see them.
const VOCABULARIES: { name: string; prefix: string; values: readonly string[] }[] = [
  { name: 'kind', prefix: 'payroll.payItems.kind', values: PAY_ITEM_KINDS },
  { name: 'calculation basis', prefix: 'payroll.payItems.basis', values: PAY_ITEM_CALC_BASES },
  { name: 'status', prefix: 'payroll.payItems.status', values: ['active', 'archived'] as const },
  // The adjustment vocabularies, added when P-HR-06 put a queue in front of them: the statuses and
  // kinds are rendered from the CONTRACT's enums, so a value added there without a label would
  // otherwise ship as the raw key on a screen an approver reads.
  {
    name: 'adjustment status',
    prefix: 'payroll.adjustments.status',
    values: PAYROLL_ADJUSTMENT_STATUSES,
  },
  { name: 'adjustment kind', prefix: 'payroll.adjustments.kind', values: PAYROLL_ADJUSTMENT_KINDS },
  {
    name: 'adjustment queue tab',
    prefix: 'payroll.adjustments.tab',
    values: ['queue', 'all'] as const,
  },
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
    for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'(payroll\.[a-zA-Z0-9_.]+)'/g)) {
      const key = match[1];
      if (key !== undefined) found.add(key);
    }
  }
  return [...found].sort();
};

describe('payroll vocabularies are translated in every locale', () => {
  for (const locale of LOCALES) {
    for (const vocabulary of VOCABULARIES) {
      it(`${vocabulary.name} — ${locale}`, () => {
        for (const value of vocabulary.values) {
          const key = `${vocabulary.prefix}.${value}`;
          expect(translate(locale, key), key).not.toBe(key);
        }
      });
    }
  }
});

describe('every literal payroll key exists in both locales', () => {
  const keys = usedKeys();

  it('finds the keys to check', () => {
    expect(keys.length).toBeGreaterThan(20);
  });

  for (const locale of LOCALES) {
    it(`resolves all of them — ${locale}`, () => {
      expect(keys.filter((key) => translate(locale, key) === key)).toEqual([]);
    });
  }

  it('does not ship English text as the Arabic label', () => {
    expect(keys.filter((key) => translate('ar', key) === translate('en', key))).toEqual([]);
  });
});
