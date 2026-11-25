// The module's realtime rows, proven against its query keys (ADR-029, design §9.4): a signal must
// reach exactly what the module's own writes re-read, so a supplier or a category signal refetches
// the supplier screens — their rows and records name the categories each supplier supplies — and a
// unit signal does not, since no supplier names a unit (P1b.W). The category writes themselves say
// the same thing locally, so a reader with realtime down still sees a category's new name.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { keysForTopic } from '../../platform/realtime/invalidation-registry';
import { administrationKeys, supplierKey, supplierListKey } from './api/administration-keys';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG_QUERIES = readFileSync(join(HERE, 'api/catalog-queries.ts'), 'utf8');

/** The subtrees a write hook hands `useAdministrationWrite`, by the constant it names. */
const subtreesOf = (hook: string): string => {
  const at = CATALOG_QUERIES.indexOf(`export const ${hook} = () =>`);
  expect(at, hook).toBeGreaterThan(-1);
  const body = CATALOG_QUERIES.slice(at, CATALOG_QUERIES.indexOf(');\n', at));
  return /\b([A-Z_]+_SUBTREES)\b/u.exec(body)?.[1] ?? '';
};

describe('the supplier screens’ realtime rows', () => {
  const suppliers = [...administrationKeys.suppliers];

  it('refetch on a supplier or a category signal, never on a unit signal', () => {
    expect(keysForTopic('administration.supplier')).toContainEqual(suppliers);
    expect(keysForTopic('administration.itemCategory')).toContainEqual(suppliers);
    expect(keysForTopic('administration.catalogItem')).not.toContainEqual(suppliers);
  });

  it('reach the register and every record — both keys sit under the suppliers prefix', () => {
    expect(supplierListKey({ page: 1 }).slice(0, 2)).toEqual(suppliers);
    expect(supplierKey('s-1').slice(0, 2)).toEqual(suppliers);
  });

  it('say what the category writes say: a category write re-reads the suppliers too, a unit write does not', () => {
    expect(CATALOG_QUERIES).toMatch(
      /const CATEGORY_SUBTREES = \[\s*administrationKeys\.catalogs,\s*administrationKeys\.items,\s*administrationKeys\.suppliers,?\s*\] as const;/u,
    );
    expect(subtreesOf('useCreateCategory')).toBe('CATEGORY_SUBTREES');
    expect(subtreesOf('useUpdateCategory')).toBe('CATEGORY_SUBTREES');
    expect(subtreesOf('useCreateUnit')).toBe('CATALOG_SUBTREES');
    expect(subtreesOf('useUpdateUnit')).toBe('CATALOG_SUBTREES');
    expect(CATALOG_QUERIES).toMatch(
      /const CATALOG_SUBTREES = \[administrationKeys\.catalogs, administrationKeys\.items\] as const;/u,
    );
  });
});
