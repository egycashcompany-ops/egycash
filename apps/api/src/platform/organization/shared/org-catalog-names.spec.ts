import { describe, expect, it } from 'vitest';
// The organization barrel first: the catalog service sits in an import cycle that the barrel resolves.
import '../index';
import { catalogNameClash } from './org-catalog-names';
import { catalogNameFilter } from './org-catalog.service';

const entries = [
  { id: 'a', name: { ar: 'العمليات', en: 'Operations' } },
  { id: 'b', name: { ar: 'الأمن', en: 'Security' } },
];

/** Evaluate the database rule in memory, as Mongo would. */
const viaFilter = (name: { ar: string; en: string }, excludeId?: string): string | null => {
  const filter = catalogNameFilter(name) as { $or: [{ 'name.ar': RegExp }, { 'name.en': RegExp }] };
  const [ar, en] = filter.$or;
  return (
    entries.find(
      (entry) => entry.id !== excludeId && (ar['name.ar'].test(entry.name.ar) || en['name.en'].test(entry.name.en)),
    )?.id ?? null
  );
};

describe('one name rule for the catalogs, in memory and in the database', () => {
  const cases: [string, { ar: string; en: string }, string | undefined, string | null][] = [
    ['an exact Arabic match', { ar: 'العمليات', en: 'Ops' }, undefined, 'a'],
    ['an exact English match, any case', { ar: 'جديدة', en: 'security' }, undefined, 'b'],
    ['no match', { ar: 'الخزينة', en: 'Treasury' }, undefined, null],
    ['a near spelling is NOT a clash (the fold is a separate rule)', { ar: 'العمليات ', en: 'Opr' }, undefined, null],
    ['the entry being renamed does not clash with itself', { ar: 'العمليات', en: 'Operations' }, 'a', null],
  ];
  for (const [label, name, exclude, expected] of cases) {
    it(label, () => {
      expect(catalogNameClash(name, entries, exclude)?.id ?? null).toBe(expected);
      expect(viaFilter(name, exclude)).toBe(expected);
    });
  }
});
