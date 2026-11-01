// The category and name filters of an IT register — the address-bar state, the names dropdown's
// options and the cascade that drops a name a category change orphaned. The rules are
// `lib/category-name-filter.ts`; this only wires them to the URL and to the names query, once, for
// both screens: the asset list's «الاسم» (`name`) and the custody register's «الصنف» (`asset`).
import { useEffect, useMemo, useState } from 'react';
import { type useSearchParams } from 'react-router-dom';
import { type MultiSelectOption } from '../../../shared/ui/MultiSelect';
import { useItAssetNames } from '../api/it-queries';
import {
  capList,
  categoryKey,
  decideNamePrune,
  nameFilterList,
  namesRead,
  nextPendingCategoryChange,
  pendingCategoryChange,
  readCategoryIds,
  readChosenNames,
  writeCategoryIds,
  writeNames,
  type PendingCategoryChange,
} from '../lib/category-name-filter';

/** A names write: the list into its own parameter, and the single filter's old one cleared. */
const namesUpdate = (
  names: readonly string[],
  nameParam: string,
  legacyParam: string | undefined,
): Record<string, string | null> => ({
  [nameParam]: writeNames(names) || null,
  ...(legacyParam === undefined ? {} : { [legacyParam]: null }),
});

export interface CategoryNameFilter {
  /** The categories chosen, in the order they were picked. */
  categoryIds: string[];
  /** The names chosen, each matched exactly. */
  names: string[];
  setCategories: (next: string[]) => void;
  setNames: (next: string[]) => void;
  /** The names the chosen categories hold — every name when none is — then any chosen beyond them. */
  nameOptions: MultiSelectOption[];
  /** This choice's names are on their way — the dropdown says so. */
  namesLoading: boolean;
  /** They could not be read — the dropdown says so, rather than that nothing matched. */
  namesFailed: boolean;
  /** Ask again after a failure — called when the reader comes back to the dropdown. */
  retryNames: () => void;
  /**
   * A category change is settling its names. The register holds its request meanwhile, so it
   * never asks — and never shows — the orphaned pair the prune is about to remove.
   */
  settling: boolean;
}

export const useCategoryNameFilter = (
  [sp, setSp]: ReturnType<typeof useSearchParams>,
  /** The parameter the names live in — `name` on the asset list, `asset` on the custody register. */
  nameParam: string,
  /** The screen's own write — it drops `page`, as every filter change on the screen does. */
  patch: (updates: Record<string, string | null>) => void,
  /**
   * Where the screen's single name filter kept its one name, raw (`readChosenNames`) — read once
   * and cleared by the next write, which moves the choice to `nameParam`.
   */
  legacyParam?: string,
): CategoryNameFilter => {
  const categoryIds = useMemo(() => readCategoryIds(sp.get('category')), [sp]);
  const names = useMemo(
    () => readChosenNames(sp, nameParam, legacyParam),
    [sp, nameParam, legacyParam],
  );

  const query = useItAssetNames(categoryIds);
  // The category change the reader just made while names were chosen — see `decideNamePrune`.
  const [pending, setPending] = useState<PendingCategoryChange | null>(null);
  const prune = decideNamePrune({ pending, categoryIds, names, read: namesRead(query) });

  // Writes only when something moved: the pending change once per step, the names once per
  // change — after a prune the change is settled, so the next render decides nothing.
  useEffect(() => {
    const next = nextPendingCategoryChange(pending, categoryIds, prune);
    if (next !== pending) setPending(next);
    if (prune.kind !== 'prune') return;
    const url = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(namesUpdate(prune.names, nameParam, legacyParam))) {
      if (value === null) url.delete(key);
      else url.set(key, value);
    }
    // `replace`: the prune completes the category change the reader made — one step, one entry.
    setSp(url, { replace: true });
  }, [pending, categoryIds, prune, sp, setSp, nameParam, legacyParam]);

  const list = nameFilterList(query, names);

  return {
    categoryIds,
    names,
    setCategories: (picked) => {
      const next = capList(picked);
      // A pick past the cap leaves the categories as they were: nothing to write or settle.
      if (categoryKey(next) === categoryKey(categoryIds)) return;
      patch({ category: writeCategoryIds(next) || null });
      setPending(names.length > 0 ? pendingCategoryChange(categoryIds, next) : null);
    },
    setNames: (picked) => patch(namesUpdate(capList(picked), nameParam, legacyParam)),
    nameOptions: list.options,
    namesLoading: list.loading,
    namesFailed: list.failed,
    retryNames: () => {
      if (query.isError && !query.isFetching) void query.refetch();
    },
    settling: prune.kind !== 'none',
  };
};
