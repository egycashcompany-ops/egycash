// The catalogs' name-clash rule as a pure function (P-ORG-3 §5.4): an exact, case-insensitive match on
// the Arabic OR the English name. `catalogNameFilter` (org-catalog.service.ts) is the same rule as a
// database query; `org-catalog-names.spec.ts` feeds both the same cases so they cannot drift apart.
import { type LocalizedString } from '@ecms/contracts';

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export const catalogNameClash = <E extends { id: string; name: LocalizedString }>(
  name: LocalizedString,
  entries: readonly E[],
  excludeId?: string,
): E | null =>
  entries.find(
    (entry) => entry.id !== excludeId && (same(entry.name.ar, name.ar) || same(entry.name.en, name.en)),
  ) ?? null;
