// The open boards' bank/area filters as plain functions: the address bar (a name may hold a comma,
// and every link written before still reads), the dropdowns (a choice the board no longer offers
// stays listed so it can be unticked), and the one decision with a timing rule in it — a bank change
// drops the areas it orphaned, and only once the new area list has arrived.
//
// Every bank and area below is synthetic.
import { describe, expect, it } from 'vitest';
import {
  bankSelectionKey,
  boardFilterLists,
  boardFilterOptions,
  boardQuery,
  decideAreaPrune,
  facetsState,
  nextPendingBankChange,
  pendingBankChange,
  readBoardFilters,
  withBoardFilter,
  type BoardFilters,
  type FacetsState,
  type PendingBankChange,
} from './board-filters';

const ready = (areas: string[], banks: string[] = []): FacetsState => ({
  status: 'ready',
  facets: { banks, areas },
});

describe('the address bar', () => {
  it('round-trips names holding commas, Arabic names, and keeps every other parameter', () => {
    const banks = ['SYN Bank, Ltd', 'البنك الأهلي'];
    const areas = ['SYN Raml, Station', 'سموحة'];
    let sp = new URLSearchParams('tab=x');
    sp = withBoardFilter(sp, 'banks', banks);
    sp = withBoardFilter(sp, 'areas', areas);
    expect(sp.get('tab')).toBe('x');
    // Through the real address-bar encoding and back.
    expect(readBoardFilters(new URLSearchParams(sp.toString()))).toEqual({ banks, areas });
  });

  it('reads a link written before the escape existed exactly as before', () => {
    expect(readBoardFilters(new URLSearchParams('banks=SYN+NBE,SYN+CIB&areas=SYN+Smouha'))).toEqual(
      { banks: ['SYN NBE', 'SYN CIB'], areas: ['SYN Smouha'] },
    );
    expect(
      withBoardFilter(new URLSearchParams(), 'banks', ['SYN NBE', 'SYN CIB']).get('banks'),
    ).toBe('SYN NBE,SYN CIB');
  });

  it('drops a cleared filter from the address bar entirely', () => {
    const sp = withBoardFilter(new URLSearchParams('banks=SYN+NBE&areas=SYN+Smouha'), 'areas', []);
    expect(sp.has('areas')).toBe(false);
    expect(readBoardFilters(new URLSearchParams())).toEqual({ banks: [], areas: [] });
  });

  it('sends the API the same escaped list, and nothing for an unnarrowed filter', () => {
    expect(boardQuery({ banks: [], areas: [] })).toEqual({});
    expect(boardQuery({ banks: ['SYN Bank, Ltd'], areas: [] })).toEqual({
      banks: 'SYN Bank\\, Ltd',
    });
  });
});

describe('the dropdown options', () => {
  it('are what the board offers, in its order', () => {
    expect(boardFilterOptions(['SYN CIB', 'SYN NBE'], ['SYN NBE'])).toEqual([
      { value: 'SYN CIB', label: 'SYN CIB' },
      { value: 'SYN NBE', label: 'SYN NBE' },
    ]);
  });

  it('keep a choice the board no longer offers — listed after, so it can be seen and unticked', () => {
    expect(
      boardFilterOptions(['SYN Miami', 'SYN Smouha'], ['SYN Smouha', 'SYN Gone']).map(
        (o) => o.value,
      ),
    ).toEqual(['SYN Miami', 'SYN Smouha', 'SYN Gone']);
    // While the list is still loading, the choices are all there is to show.
    expect(boardFilterOptions([], ['SYN Smouha']).map((o) => o.value)).toEqual(['SYN Smouha']);
  });
});

describe('where the area list stands', () => {
  const base = {
    isFetching: false,
    isError: false,
    isSuccess: false,
    isPlaceholderData: false,
    data: undefined,
  };
  const data = { banks: [], areas: ['SYN Smouha'] };

  it('is loading while anything is being fetched — even cached data being re-read', () => {
    expect(facetsState({ ...base, isFetching: true })).toEqual({ status: 'loading' });
    expect(facetsState({ ...base, isFetching: true, isSuccess: true, data })).toEqual({
      status: 'loading',
    });
    expect(facetsState(base)).toEqual({ status: 'loading' });
  });

  it('is a failure when the last read failed, whatever older data is still held', () => {
    expect(facetsState({ ...base, isError: true, data })).toEqual({ status: 'error' });
  });

  it('is ready once read and settled', () => {
    expect(facetsState({ ...base, isSuccess: true, data })).toEqual({
      status: 'ready',
      facets: data,
    });
  });

  it('is loading while it holds the previous bank selection’s answer — even with no request running', () => {
    // A request paused offline is not fetching; its placeholder is still another selection's list.
    expect(facetsState({ ...base, isSuccess: true, isPlaceholderData: true, data })).toEqual({
      status: 'loading',
    });
  });
});

describe('the dropdowns while a bank tick’s answer loads', () => {
  const previous = { banks: ['SYN CIB', 'SYN NBE', 'SYN QNB'], areas: ['SYN Agami', 'SYN Smouha'] };
  const chosen: BoardFilters = { banks: ['SYN NBE'], areas: ['SYN Smouha'] };

  it('keeps every bank on offer, so a second bank can be ticked before the answer lands', () => {
    const lists = boardFilterLists(
      { isError: false, isPlaceholderData: true, data: previous },
      chosen,
    );
    expect(lists.bankOptions.map((o) => o.value)).toEqual(['SYN CIB', 'SYN NBE', 'SYN QNB']);
  });

  it('never offers the previous selection’s areas for the new one — only the chosen, and says it is loading', () => {
    const lists = boardFilterLists(
      { isError: false, isPlaceholderData: true, data: previous },
      chosen,
    );
    expect(lists.areaOptions.map((o) => o.value)).toEqual(['SYN Smouha']);
    expect(lists.areasLoading).toBe(true);
    // Before any answer at all.
    expect(
      boardFilterLists({ isError: false, isPlaceholderData: false, data: undefined }, chosen),
    ).toMatchObject({ areasLoading: true });
  });

  it('offers the new selection’s own areas once they arrive; a failure is not «loading»', () => {
    const own = { banks: previous.banks, areas: ['SYN Miami', 'SYN Smouha'] };
    const lists = boardFilterLists({ isError: false, isPlaceholderData: false, data: own }, chosen);
    expect(lists.areaOptions.map((o) => o.value)).toEqual(['SYN Miami', 'SYN Smouha']);
    expect(lists.areasLoading).toBe(false);
    expect(
      boardFilterLists({ isError: true, isPlaceholderData: false, data: undefined }, chosen)
        .areasLoading,
    ).toBe(false);
  });
});

describe('a bank change and the chosen areas', () => {
  const NBE = bankSelectionKey(['SYN NBE']);
  const CIB = bankSelectionKey(['SYN CIB']);

  it('nothing pending: nothing to do', () => {
    expect(
      decideAreaPrune({
        pending: null,
        banks: ['SYN CIB'],
        areas: ['SYN Sidi Gaber'],
        facets: ready(['SYN Miami']),
      }),
    ).toEqual({ kind: 'none' });
  });

  it('NBE + Sidi Gaber, switched to CIB: waits for the address bar, then for CIB’s areas, then drops Sidi Gaber', () => {
    const pending = { from: NBE, to: CIB, arrived: false };
    const areas = ['SYN Sidi Gaber'];
    // The address bar has not caught up with the change yet.
    expect(decideAreaPrune({ pending, banks: ['SYN NBE'], areas, facets: ready(areas) })).toEqual({
      kind: 'wait',
    });
    // CIB's areas are on their way — never prune against a list that has not arrived.
    expect(
      decideAreaPrune({ pending, banks: ['SYN CIB'], areas, facets: { status: 'loading' } }),
    ).toEqual({ kind: 'wait' });
    expect(
      decideAreaPrune({
        pending,
        banks: ['SYN CIB'],
        areas,
        facets: ready(['SYN Miami', 'SYN Smouha']),
      }),
    ).toEqual({ kind: 'prune', areas: [] });
  });

  it('keeps the areas the new banks still offer, in the order they were chosen', () => {
    expect(
      decideAreaPrune({
        pending: { from: NBE, to: bankSelectionKey(['SYN NBE', 'SYN CIB']), arrived: true },
        banks: ['SYN NBE', 'SYN CIB'],
        areas: ['SYN Smouha', 'SYN Gone', 'SYN Miami'],
        facets: ready(['SYN Miami', 'SYN Sidi Gaber', 'SYN Smouha']),
      }),
    ).toEqual({ kind: 'prune', areas: ['SYN Smouha', 'SYN Miami'] });
  });

  it('writes nothing when every chosen area is still offered — clearing the banks offers them all', () => {
    expect(
      decideAreaPrune({
        pending: { from: NBE, to: bankSelectionKey([]), arrived: true },
        banks: [],
        areas: ['SYN Sidi Gaber'],
        facets: ready(['SYN Miami', 'SYN Sidi Gaber', 'SYN Smouha']),
      }),
    ).toEqual({ kind: 'none' });
  });

  it('prunes nothing against a failed area list — the choice stays, visible, to untick by hand', () => {
    expect(
      decideAreaPrune({
        pending: { from: NBE, to: CIB, arrived: true },
        banks: ['SYN CIB'],
        areas: ['SYN Sidi Gaber'],
        facets: { status: 'error' },
      }),
    ).toEqual({ kind: 'none' });
  });

  it('prunes nothing when the address bar moved somewhere the reader did not just choose', () => {
    expect(
      decideAreaPrune({
        pending: { from: NBE, to: CIB, arrived: true },
        banks: ['SYN QNB'],
        areas: ['SYN Sidi Gaber'],
        facets: ready(['SYN Agami']),
      }),
    ).toEqual({ kind: 'none' });
  });

  it('waits on the selection before only until the address bar has shown the one chosen', () => {
    const areas = ['SYN Sidi Gaber'];
    const facets = ready(areas);
    expect(
      decideAreaPrune({
        pending: pendingBankChange(['SYN NBE'], ['SYN CIB']),
        banks: ['SYN NBE'],
        areas,
        facets,
      }),
    ).toEqual({ kind: 'wait' });
    // Shown CIB, then back on NBE: a Back press, not a router catching up.
    expect(
      decideAreaPrune({
        pending: { from: NBE, to: CIB, arrived: true },
        banks: ['SYN NBE'],
        areas,
        facets,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('tells a comma inside a bank name from the list separator', () => {
    const to = bankSelectionKey(['SYN Bank, Ltd']);
    expect(to).not.toBe(bankSelectionKey(['SYN Bank', 'Ltd']));
    expect(
      decideAreaPrune({
        pending: { from: NBE, to, arrived: true },
        banks: ['SYN Bank, Ltd'],
        areas: ['SYN Raml, Station', 'SYN Sidi Gaber'],
        facets: ready(['SYN Raml, Station']),
      }),
    ).toEqual({ kind: 'prune', areas: ['SYN Raml, Station'] });
  });
});

/**
 * `useBoardFilters` without React: each render decides the prune from the address bar and the
 * facets, then its effect settles the pending change and writes a prune — the same two functions,
 * in the same order, the hook runs.
 */
const board = (start: BoardFilters, facetsFor: (banks: readonly string[]) => FacetsState) => {
  let url = start;
  let pending: PendingBankChange | null = null;
  const render = (): { settling: boolean } => {
    const prune = decideAreaPrune({ pending, ...url, facets: facetsFor(url.banks) });
    pending = nextPendingBankChange(pending, url.banks, prune);
    if (prune.kind === 'prune') url = { ...url, areas: prune.areas };
    return { settling: prune.kind !== 'none' };
  };
  return {
    render,
    /** The reader ticks banks: the address bar and the pending change move in one batch. */
    setBanks: (banks: string[]) => {
      pending = url.areas.length > 0 ? pendingBankChange(url.banks, banks) : null;
      url = { ...url, banks };
    },
    /** The browser moves the address bar; the screen stays mounted. */
    navigate: (to: BoardFilters) => {
      url = to;
    },
    get url() {
      return url;
    },
    get pending() {
      return pending;
    },
  };
};

describe('a bank change, render by render', () => {
  const NBE_AREAS = ['SYN Heliopolis'];
  const CIB_AREAS = ['SYN Smouha'];

  it('NBE + Heliopolis, switched to CIB: settles once CIB’s areas arrive, Heliopolis dropped', () => {
    let cibReady = false;
    const b = board({ banks: ['SYN NBE'], areas: NBE_AREAS }, (banks) =>
      banks[0] === 'SYN CIB' && !cibReady ? { status: 'loading' } : ready(CIB_AREAS),
    );
    b.setBanks(['SYN CIB']);
    expect(b.render()).toEqual({ settling: true });
    cibReady = true;
    expect(b.render()).toEqual({ settling: true }); // the prune is written in this render's effect
    expect(b.url).toEqual({ banks: ['SYN CIB'], areas: [] });
    expect(b.render()).toEqual({ settling: false });
    expect(b.pending).toBeNull();
  });

  it('Back to NBE while CIB’s areas are still loading: the board settles, nothing is dropped', () => {
    let cibReady = false;
    const before = { banks: ['SYN NBE'], areas: NBE_AREAS };
    const b = board(before, (banks) =>
      banks[0] === 'SYN CIB'
        ? cibReady
          ? ready(CIB_AREAS)
          : { status: 'loading' }
        : ready(NBE_AREAS),
    );
    b.setBanks(['SYN CIB']);
    expect(b.render()).toEqual({ settling: true });
    b.navigate(before);
    // Held on its loading rows, with its list request disabled, for good — before the fix.
    expect(b.render()).toEqual({ settling: false });
    expect(b.pending).toBeNull();
    cibReady = true;
    expect(b.render()).toEqual({ settling: false });
    expect(b.url).toEqual(before);
  });
});
