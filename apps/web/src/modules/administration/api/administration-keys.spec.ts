// The module's query keys against what re-reads them (design §13.6 A, ADR-013): every key a screen
// reads sits under the prefix the realtime rows invalidate for its topic, so a write elsewhere
// reaches it; each write re-reads exactly the subtrees its row is shown in; and a save refused for
// a moved `version` re-reads them too, while any other refusal re-reads nothing. The realtime rows
// repeat the prefixes as literals (the registry imports no module), so this is what ties the two.
import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { ErrorCodes } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { keysForTopic } from '../../../platform/realtime/invalidation-registry';
import {
  administrationKeys,
  catalogListKey,
  departmentNamesKey,
  departmentOptionsKey,
  itemKey,
  itemListKey,
  warehouseBranchOptionsKey,
  warehouseKey,
  warehouseListKey,
  wholeCatalogKey,
} from './administration-keys';
import { CATALOG_SUBTREES, ITEM_SUBTREES, writeCallbacks } from './catalog-queries';
import { WAREHOUSE_SUBTREES } from './warehouses-queries';

const under = (key: readonly unknown[], prefix: readonly unknown[]): boolean =>
  prefix.every((part, index) => key[index] === part);

const reachedBy = (topic: string, key: readonly unknown[]): boolean =>
  keysForTopic(topic).some((prefix) => under(key, prefix));

describe('the module’s query keys', () => {
  it('sit under the prefixes the realtime rows invalidate for their topics', () => {
    const catalogReads = [
      catalogListKey({ kind: 'unit', page: 1 }),
      catalogListKey({ kind: 'category', page: 1 }),
      wholeCatalogKey('unit'),
      wholeCatalogKey('category'),
    ];
    for (const key of catalogReads) {
      expect(reachedBy('administration.catalogItem', key), JSON.stringify(key)).toBe(true);
      expect(reachedBy('administration.itemCategory', key), JSON.stringify(key)).toBe(true);
    }
    // A unit or a category is named on every item row and record, so their signals reach items.
    for (const key of [itemListKey({ page: 1 }), itemKey('i-1')]) {
      expect(reachedBy('administration.item', key), JSON.stringify(key)).toBe(true);
      expect(reachedBy('administration.catalogItem', key), JSON.stringify(key)).toBe(true);
      expect(reachedBy('administration.itemCategory', key), JSON.stringify(key)).toBe(true);
    }
    for (const key of [warehouseListKey({ page: 1 }), warehouseKey('w-1')]) {
      expect(reachedBy('administration.warehouse', key), JSON.stringify(key)).toBe(true);
    }
  });

  it('keep the reads no write changes out of the written subtrees', () => {
    // What a key reaches per branch, and which departments exist, move with no warehouse write.
    for (const key of [warehouseBranchOptionsKey(), departmentOptionsKey(), departmentNamesKey()]) {
      expect(reachedBy('administration.warehouse', key), JSON.stringify(key)).toBe(false);
      for (const subtree of WAREHOUSE_SUBTREES) expect(under(key, subtree)).toBe(false);
    }
    // The retired departments' read refreshes with the active one's.
    expect(under(departmentNamesKey(), departmentOptionsKey())).toBe(true);
  });

  it('re-read, on each write, exactly the subtrees its row is shown in', () => {
    expect(CATALOG_SUBTREES).toEqual([administrationKeys.catalogs, administrationKeys.items]);
    expect(ITEM_SUBTREES).toEqual([administrationKeys.items]);
    expect(WAREHOUSE_SUBTREES).toEqual([administrationKeys.warehouses]);
    expect(administrationKeys).toEqual({
      catalogs: ['administration', 'catalogs'],
      items: ['administration', 'items'],
      warehouses: ['administration', 'warehouses'],
    });
  });
});

describe('a write’s answer', () => {
  const spied = (): { qc: QueryClient; reread: () => unknown[] } => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
    return { qc, reread: () => spy.mock.calls.map(([filters]) => filters?.queryKey) };
  };

  it('re-reads every subtree on a success', () => {
    const { qc, reread } = spied();
    writeCallbacks(qc, CATALOG_SUBTREES).onSuccess();
    expect(reread()).toEqual([administrationKeys.catalogs, administrationKeys.items]);
  });

  it('re-reads them on a stale refusal, so the screen behind the form shows the row as it is', () => {
    const { qc, reread } = spied();
    writeCallbacks(qc, ITEM_SUBTREES).onError(
      new ApiError(ErrorCodes.STALE_DOCUMENT, 'moved', 409),
    );
    expect(reread()).toEqual([administrationKeys.items]);
  });

  it('re-reads nothing on any other refusal — nothing was written', () => {
    const { qc, reread } = spied();
    const callbacks = writeCallbacks(qc, WAREHOUSE_SUBTREES);
    callbacks.onError(new ApiError(ErrorCodes.ADMINISTRATION_DUPLICATE, 'taken', 409));
    callbacks.onError(new Error('offline'));
    expect(reread()).toEqual([]);
  });
});
