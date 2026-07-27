// One selection model for every table (RW17). Selection is per-page state keyed by row id, and
// what the caller sees is always the INTERSECTION with the rows currently on screen — so after a
// filter change, a page change or a bulk action, a user can never act on a selection that no
// longer means what they saw. It is derived, not synchronised, so there is no stale window.
import { useCallback, useMemo, useState } from 'react';

export interface TableSelection {
  selectedIds: Set<string>;
  toggleRow: (id: string) => void;
  toggleAll: (checked: boolean) => void;
  clear: () => void;
  /** The selected ids, in the order the rows appear — what a bulk request sends. */
  ids: string[];
  count: number;
}

/** @param rowIds the ids currently on screen; `toggleAll` selects exactly these. */
export const useTableSelection = (rowIds: string[]): TableSelection => {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());

  const ids = useMemo(() => rowIds.filter((id) => picked.has(id)), [rowIds, picked]);
  const selectedIds = useMemo(() => new Set(ids), [ids]);

  const toggleRow = useCallback((id: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (checked: boolean) => setPicked(checked ? new Set(rowIds) : new Set()),
    [rowIds],
  );

  const clear = useCallback(() => setPicked(new Set()), []);

  return { selectedIds, toggleRow, toggleAll, clear, ids, count: ids.length };
};
