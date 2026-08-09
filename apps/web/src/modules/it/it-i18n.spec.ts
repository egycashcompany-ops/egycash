// Every string the IT screens ask for must resolve in BOTH locales.
//
// `translate()` falls back to returning the key, so a missing translation is invisible to
// typecheck, lint and every render test — the user is simply shown `it.assets.status.inStock`.
// That is a real regression this repo has already had once (the interview statuses), so IT gets
// the same guard from its first commit.
//
// Two halves, and the second is the one that keeps working as the module grows:
//   • the enum-driven half fails the moment a value is added to a contracts enum without a label;
//   • the source-driven half scans the IT screens for every `t('it.…')` they actually call, so a
//     new key typed into a page without a catalog entry fails here rather than in production.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  IT_ASSET_STATUSES,
  IT_CATALOG_KINDS,
  IT_MAINTENANCE_KINDS,
  IT_MAINTENANCE_ORDER_STATUSES,
  IT_TICKET_EVENT_TYPES,
  IT_TICKET_STATUSES,
  type Locale,
} from '@ecms/contracts';
import { translate } from '../../platform/localization/i18n';

const LOCALES: Locale[] = ['en', 'ar'];
const HERE = dirname(fileURLToPath(import.meta.url));

const VOCABULARIES: { name: string; prefix: string; values: readonly string[] }[] = [
  { name: 'asset status', prefix: 'it.assets.status', values: IT_ASSET_STATUSES },
  { name: 'catalog kind', prefix: 'it.catalogs.kind', values: IT_CATALOG_KINDS },
  // IT-3. Both are rendered through a TEMPLATE key, so the source scan below cannot see them —
  // which is exactly why they are driven off the enum instead.
  { name: 'ticket status', prefix: 'it.tickets.status', values: IT_TICKET_STATUSES },
  { name: 'ticket event type', prefix: 'it.tickets.event', values: IT_TICKET_EVENT_TYPES },
  // The SLA presentation states are DERIVED, not a contracts enum (breached is a stamp, at-risk is
  // a live comparison), so the four the indicator can render are pinned by hand.
  {
    name: 'SLA state',
    prefix: 'it.tickets.sla',
    values: ['breached', 'atRisk', 'onTrack', 'done'] as const,
  },
  // IT-4. Both rendered through TEMPLATE keys, so the source scan below cannot see them.
  {
    name: 'maintenance order status',
    prefix: 'it.maintenance.status',
    values: IT_MAINTENANCE_ORDER_STATUSES,
  },
  { name: 'maintenance kind', prefix: 'it.maintenance.kind', values: IT_MAINTENANCE_KINDS },
];

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.spec.') ? [full] : [];
  });

/** Literal `t('it.…')` calls. Template keys (`t(\`it.x.${v}\`)`) are covered by VOCABULARIES. */
const usedKeys = (): string[] => {
  const found = new Set<string>();
  for (const file of sources(resolve(HERE))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bt\(\s*'(it\.[a-zA-Z0-9_.]+)'/g)) {
      const key = match[1];
      if (key !== undefined) found.add(key);
    }
  }
  return [...found].sort();
};

describe('IT vocabularies are translated in every locale', () => {
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

describe('every literal key the IT screens use exists in both locales', () => {
  const keys = usedKeys();

  it('finds the keys to check (the scan itself must not silently match nothing)', () => {
    expect(keys.length).toBeGreaterThan(50);
  });

  for (const locale of LOCALES) {
    it(`resolves all of them — ${locale}`, () => {
      const missing = keys.filter((key) => translate(locale, key) === key);
      expect(missing, `untranslated in ${locale}`).toEqual([]);
    });
  }
});
