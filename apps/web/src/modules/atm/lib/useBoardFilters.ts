// The bank and area filters of an open board — the address-bar state, the dropdowns' options and
// the cascade that drops an area a bank change orphaned. The rules are `board-filters.ts`; this
// only wires them to the URL and to the facets query, once, for both boards.
import { useEffect, useMemo, useState } from 'react';
import { type useSearchParams } from 'react-router-dom';
import { type UseQueryResult } from '@tanstack/react-query';
import { type AtmOperationFacetsDto } from '@ecms/contracts';
import { type MultiSelectOption } from '../../../shared/ui/MultiSelect';
import {
  boardFilterLists,
  decideAreaPrune,
  facetsState,
  nextPendingBankChange,
  pendingBankChange,
  readBoardFilters,
  withBoardFilter,
  type PendingBankChange,
} from './board-filters';

export interface BoardFilterState {
  banks: string[];
  areas: string[];
  setBanks: (next: string[]) => void;
  setAreas: (next: string[]) => void;
  bankOptions: MultiSelectOption[];
  areaOptions: MultiSelectOption[];
  /** The area list for the chosen banks has not arrived yet — its dropdown says so. */
  areasLoading: boolean;
  /**
   * A bank change is settling its areas. The board holds its request meanwhile, so it never asks
   * — and never shows — the orphaned pair the prune is about to remove.
   */
  settling: boolean;
  /** Either filter narrows the board — an empty board then says so. */
  filtered: boolean;
  /**
   * Clear both filters at once — the board's reset («عايز يكون في Reset للفلتر»). The day view is
   * not a filter and stays where it is, as on the Fleet day boards.
   */
  reset: () => void;
}

export const useBoardFilters = (
  [sp, setSp]: ReturnType<typeof useSearchParams>,
  useFacets: (banks: readonly string[]) => UseQueryResult<AtmOperationFacetsDto>,
): BoardFilterState => {
  const { banks, areas } = useMemo(() => readBoardFilters(sp), [sp]);
  const facets = useFacets(banks);
  // The bank change the reader just made while areas were chosen — see `decideAreaPrune`.
  const [pending, setPending] = useState<PendingBankChange | null>(null);
  const prune = decideAreaPrune({ pending, banks, areas, facets: facetsState(facets) });

  useEffect(() => {
    const next = nextPendingBankChange(pending, banks, prune);
    if (next !== pending) setPending(next);
    // `replace`: the prune completes the bank change the reader made — one step, one history entry.
    if (prune.kind === 'prune') setSp(withBoardFilter(sp, 'areas', prune.areas), { replace: true });
  }, [pending, banks, prune, sp, setSp]);

  const lists = boardFilterLists(facets, { banks, areas });

  return {
    banks,
    areas,
    setBanks: (next) => {
      setSp(withBoardFilter(sp, 'banks', next));
      setPending(areas.length > 0 ? pendingBankChange(banks, next) : null);
    },
    setAreas: (next) => setSp(withBoardFilter(sp, 'areas', next)),
    reset: () => {
      setPending(null);
      setSp(withBoardFilter(withBoardFilter(sp, 'banks', []), 'areas', []), { replace: true });
    },
    ...lists,
    settling: prune.kind !== 'none',
    filtered: banks.length > 0 || areas.length > 0,
  };
};
