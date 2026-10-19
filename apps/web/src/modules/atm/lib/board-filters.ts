// The open boards' bank and area filters, as plain functions — the replenishment board and the
// maintenance board ask the same two questions in the same way, and the part that can be wrong
// (WHEN a chosen area has to go) is a decision a suite can reach without a DOM.
//
// THE CASCADE. The area list depends on the banks chosen: no bank → every open row's area, banks →
// those banks' areas (the API's facets). So changing the banks can leave a chosen area that the
// new banks do not have — pick NBE and «Sidi Gaber», switch to CIB, and the board asked «CIB in
// Sidi Gaber» and came up empty with nothing on screen to say why. A bank change now drops the
// areas the new list no longer offers — the cascade the placement filters already follow
// (`hr/.../placement-filters.ts`) — but only once that list has ARRIVED: pruning against a list
// still loading, or one being re-read, would erase a perfectly good choice.
//
// A CHOICE THE BOARD DOES NOT OFFER. Outside a bank change nothing is dropped. A remembered or
// linked area whose rows are all closed right now is still the desk's question — the next row
// opened there belongs on its board — so it stays chosen, stays LISTED (ticked) in its dropdown so
// it can be seen and unticked, and an empty board says the filter matched nothing. That is what
// every server-backed filter in the app does with a value its list has moved past (`MultiSelect`'s
// `optionLabel`; the vehicle-code filter narrows to nothing rather than dropping the pick).
import { joinAtmNameList, splitAtmNameList, type AtmOperationFacetsDto } from '@ecms/contracts';
import { type MultiSelectOption } from '../../../shared/ui/MultiSelect';

export type BoardFilterKey = 'banks' | 'areas';

export interface BoardFilters {
  banks: string[];
  areas: string[];
}

/**
 * The board's filters out of its address bar. A name may hold a comma; the list escapes it
 * (`joinAtmNameList`), and a list written before the escape existed reads exactly as it did.
 */
export const readBoardFilters = (sp: URLSearchParams): BoardFilters => ({
  banks: splitAtmNameList(sp.get('banks') ?? ''),
  areas: splitAtmNameList(sp.get('areas') ?? ''),
});

/** The address bar with one filter changed — every other parameter kept, an empty one removed. */
export const withBoardFilter = (
  sp: URLSearchParams,
  key: BoardFilterKey,
  values: readonly string[],
): URLSearchParams => {
  const next = new URLSearchParams(sp);
  if (values.length === 0) next.delete(key);
  else next.set(key, joinAtmNameList(values));
  return next;
};

/** The two filters as the API reads them — absent when not narrowed, never an empty list. */
export const boardQuery = (filters: {
  banks: readonly string[];
  areas: readonly string[];
}): { banks?: string; areas?: string } => ({
  ...(filters.banks.length > 0 ? { banks: joinAtmNameList(filters.banks) } : {}),
  ...(filters.areas.length > 0 ? { areas: joinAtmNameList(filters.areas) } : {}),
});

/** One bank selection, as a key a pending prune can be matched against. */
export const bankSelectionKey = (banks: readonly string[]): string => joinAtmNameList(banks);

/**
 * A dropdown's options: what the board offers, then — after it — anything chosen that the board no
 * longer offers, so a choice is never invisible and can always be unticked.
 */
export const boardFilterOptions = (
  offered: readonly string[],
  chosen: readonly string[],
): MultiSelectOption[] => [
  ...offered.map((name) => ({ value: name, label: name })),
  ...chosen.filter((name) => !offered.includes(name)).map((name) => ({ value: name, label: name })),
];

/**
 * The facets query, as the dropdowns and the prune read it. While a new bank selection's answer is
 * on its way the query holds the PREVIOUS selection's answer as placeholder data
 * (`isPlaceholderData`), so a bank tick does not empty the bank list under the reader.
 */
export interface FacetsQuery {
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  isPlaceholderData: boolean;
  data: AtmOperationFacetsDto | undefined;
}

/**
 * The two dropdowns' options out of the facets query.
 *
 * The bank list does not depend on the banks chosen (the API reads it from every open row in
 * scope), so the previous selection's list stands in while the new one loads — ticking NBE no
 * longer shrinks the open list to NBE alone, leaving CIB out of reach until the answer lands. The
 * area list DOES depend on them, so the previous selection's areas are never offered for the new
 * one: until this selection's own answer arrives the area list holds only what is chosen, and says
 * it is loading rather than that nothing matched.
 */
export const boardFilterLists = (
  facets: Pick<FacetsQuery, 'isError' | 'isPlaceholderData' | 'data'>,
  chosen: BoardFilters,
): {
  bankOptions: MultiSelectOption[];
  areaOptions: MultiSelectOption[];
  areasLoading: boolean;
} => {
  const areas = facets.isPlaceholderData ? undefined : facets.data?.areas;
  return {
    bankOptions: boardFilterOptions(facets.data?.banks ?? [], chosen.banks),
    areaOptions: boardFilterOptions(areas ?? [], chosen.areas),
    areasLoading: areas === undefined && !facets.isError,
  };
};

/** Where the area list for the CURRENT banks stands. */
export type FacetsState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; facets: AtmOperationFacetsDto };

/**
 * The facets query, read for pruning. Anything being fetched is `loading` — including cached data
 * being re-read, which may be a minute old; a failure is `error` even if older data is still held.
 * Placeholder data is the PREVIOUS bank selection's answer, so it is `loading` too, fetching or not
 * (a request paused offline is not fetching).
 */
export const facetsState = (query: FacetsQuery): FacetsState => {
  if (query.isFetching) return { status: 'loading' };
  if (query.isError) return { status: 'error' };
  if (query.isPlaceholderData) return { status: 'loading' };
  if (query.isSuccess && query.data !== undefined) return { status: 'ready', facets: query.data };
  return { status: 'loading' };
};

/** A bank change the reader just made while areas were chosen: the selection before, and after. */
export interface PendingBankChange {
  from: string;
  to: string;
  /**
   * The address bar has shown `to`. Until it does, showing `from` means the router has not caught
   * up yet; once it has, showing `from` again is a Back press — the reader left the change.
   */
  arrived: boolean;
}

/** The change `setBanks` records, before the address bar has shown it. */
export const pendingBankChange = (
  from: readonly string[],
  to: readonly string[],
): PendingBankChange => ({
  from: bankSelectionKey(from),
  to: bankSelectionKey(to),
  arrived: false,
});

export type AreaPrune =
  /** Nothing pending, or the pending change is settled without a write. */
  | { kind: 'none' }
  /** A bank change is waiting — for the address bar to show it, or for its area list. */
  | { kind: 'wait' }
  /** Write these areas (some chosen ones are not offered under the new banks). */
  | { kind: 'prune'; areas: string[] };

/**
 * What a pending bank change does to the chosen areas.
 *
 * The address bar decides which case this is. Still showing the selection BEFORE the change, and
 * never yet the one chosen, it has not caught up: wait. Showing the selection the reader chose:
 * prune against that selection's area list once it has arrived. Showing anything else — another
 * link, or a Back press, which returns it to the selection before AFTER it showed the new one —
 * moved it somewhere the reader did not just choose, and nothing is pruned: waiting there would
 * hold the board on its loading rows for good, since nothing would ever settle the change. A
 * failed area list prunes nothing either — it knows nothing about which areas exist, and the
 * choice stays visible to untick by hand.
 */
export const decideAreaPrune = ({
  pending,
  banks,
  areas,
  facets,
}: {
  pending: PendingBankChange | null;
  banks: readonly string[];
  areas: readonly string[];
  facets: FacetsState;
}): AreaPrune => {
  if (pending === null) return { kind: 'none' };
  const shown = bankSelectionKey(banks);
  if (shown !== pending.to) {
    return shown === pending.from && !pending.arrived ? { kind: 'wait' } : { kind: 'none' };
  }
  if (facets.status === 'loading') return { kind: 'wait' };
  if (facets.status === 'error') return { kind: 'none' };
  const offered = new Set(facets.facets.areas);
  const kept = areas.filter((area) => offered.has(area));
  return kept.length === areas.length ? { kind: 'none' } : { kind: 'prune', areas: kept };
};

/**
 * The pending change after a render that decided `prune`: gone once settled (anything but `wait`),
 * marked `arrived` the first time the address bar shows the selection the reader chose, and
 * otherwise the very same object — so the hook writes no state when nothing moved.
 */
export const nextPendingBankChange = (
  pending: PendingBankChange | null,
  banks: readonly string[],
  prune: AreaPrune,
): PendingBankChange | null => {
  if (pending === null || prune.kind !== 'wait') return null;
  if (!pending.arrived && bankSelectionKey(banks) === pending.to) {
    return { ...pending, arrived: true };
  }
  return pending;
};
