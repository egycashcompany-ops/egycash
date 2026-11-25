// Round 34 B — «البيانات المرجعية»'s search and filters, as rules: what the address bar holds, what
// the server is asked, what an arrow key does on the row of kind cards, and the search box's clock.
// «وعاوز الداتا اللي تبقى كبيرة زي الفروع والمناطق والبنوك وهكذا يكون في سيرش اقدر اسيرش بيه».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CATALOG_FILTER_PARAMS,
  CATALOG_PAGE_SIZES,
  CATALOG_SEARCHABLE,
  CATALOG_SEARCH_DEBOUNCE_MS,
  catalogListQuery,
  createSearchBox,
  createSearchDebounce,
  foldCatalogSearch,
  hasCatalogFilter,
  isSearchableKind,
  kindStep,
  matchParts,
  readCatalogFilters,
  searchBoxContext,
  searchBoxKey,
  withCatalogFilters,
  withCatalogKind,
  withCatalogSearch,
  withKnownBank,
  withoutCatalogFilters,
  type CatalogKind,
} from './catalog-filters';

const KINDS: readonly CatalogKind[] = ['banks', 'branches', 'currencies', 'areas', 'shiftTypes'];
const sp = (query: string): URLSearchParams => new URLSearchParams(query);
const NONE = { q: '', status: '', bank: '' } as const;

describe('which kinds take the search', () => {
  it('the lists that grow — banks, branches, areas; never the two dragged lists', () => {
    expect([...CATALOG_SEARCHABLE]).toEqual(['banks', 'branches', 'areas']);
    expect(isSearchableKind('currencies')).toBe(false);
    expect(isSearchableKind('shiftTypes')).toBe(false);
    // A filter on a dragged list would hide the rows a drop lands between — so it never counts.
    expect(hasCatalogFilter('currencies', { q: 'x', status: 'active', bank: 'b' })).toBe(false);
    expect(hasCatalogFilter('shiftTypes', { q: 'x', status: 'active', bank: 'b' })).toBe(false);
  });

  it('waits about 300ms, and pages 25 / 50 / 100 rows', () => {
    expect(CATALOG_SEARCH_DEBOUNCE_MS).toBe(300);
    expect(CATALOG_PAGE_SIZES).toEqual([25, 50, 100]);
  });
});

/** A bank id as the server's are: 24 hex digits. */
const NBE = '64b0c0ffee00000000000010';

describe('the address bar', () => {
  // Round 34 critic — REWRITTEN: it read `bank=b-1` back as the bank «b-1». The server refuses a
  // `bankId` that is no ObjectId, so the whole list failed; such a `bank` is now no filter.
  it('reads `q`, `status` and `bank` — an unknown status, or a bank that is no id, is no filter at all', () => {
    expect(readCatalogFilters(sp(`kind=branches&q=المعادي&status=inactive&bank=${NBE}`))).toEqual({
      q: 'المعادي',
      status: 'inactive',
      bank: NBE,
    });
    expect(readCatalogFilters(sp('status=archived'))).toEqual(NONE);
    expect(readCatalogFilters(sp(''))).toEqual(NONE);
    for (const odd of ['not-an-id', 'b-1', `${NBE}0`, NBE.slice(1), `${NBE.slice(1)}g`, ' ']) {
      expect(readCatalogFilters(sp(`bank=${encodeURIComponent(odd)}`)).bank, odd).toBe('');
    }
    // And so nothing is sent for it.
    expect(
      catalogListQuery('branches', readCatalogFilters(sp('kind=branches&bank=not-an-id')), 1, 25),
    ).toEqual({ page: 1, pageSize: 25 });
  });

  it('a bank that is not on the list is no filter once the list is in — kept while it is on its way', () => {
    const asked = { q: '', status: '' as const, bank: NBE };
    expect(withKnownBank(asked, [NBE, '64b0c0ffee00000000000020'])).toBe(asked);
    expect(withKnownBank(asked, undefined)).toBe(asked);
    expect(withKnownBank(asked, ['64b0c0ffee00000000000020'])).toEqual({ ...asked, bank: '' });
    expect(withKnownBank(asked, [])).toEqual({ ...asked, bank: '' });
    expect(withKnownBank(NONE, ['64b0c0ffee00000000000020'])).toBe(NONE);
  });

  it('a changed filter goes back to the first page and keeps the page size', () => {
    const next = withCatalogFilters(sp('kind=branches&page=7&size=50&q=ا'), { q: 'المعادي' });
    expect(next.get('q')).toBe('المعادي');
    expect(next.get('page')).toBeNull();
    expect(next.get('size')).toBe('50');
    expect(next.get('kind')).toBe('branches');
    // An empty value removes its name rather than leaving `q=` behind.
    expect(withCatalogFilters(next, { q: '' }).has('q')).toBe(false);
    expect(withCatalogFilters(sp('kind=banks&page=3'), { status: 'active' }).toString()).toBe(
      'kind=banks&status=active',
    );
  });

  it('leaves the object it was given as it was', () => {
    const before = sp('kind=areas&page=2&q=x');
    withCatalogFilters(before, { q: 'y' });
    expect(before.toString()).toBe('kind=areas&page=2&q=x');
  });

  it('the reset clears the search and both filters at once, and the page', () => {
    expect(
      withoutCatalogFilters(
        sp('kind=branches&q=x&status=active&bank=b-1&page=4&size=100'),
      ).toString(),
    ).toBe('kind=branches&size=100');
  });

  it('another kind starts clean: its page, search and filters dropped, the page size kept', () => {
    const next = withCatalogKind(
      sp('kind=branches&q=المعادي&status=active&bank=b-1&page=9&size=50'),
      'areas',
    );
    expect(next.toString()).toBe('kind=areas&size=50');
    for (const name of CATALOG_FILTER_PARAMS) expect(next.has(name)).toBe(false);
  });
});

// Round 34 critic — ✕ / Escape on a text never sent, or a space added, used to write the address
// bar anyway: the page went back to the first although the question had not changed, and a `q`
// of spaces was left in it.
describe('what the box writes to the address bar', () => {
  it('a new question: written, as typed, and back to the first page', () => {
    const next = withCatalogSearch(sp('kind=branches&page=3&size=50'), 'المعادي');
    expect(next?.toString()).toBe(
      new URLSearchParams('kind=branches&size=50&q=المعادي').toString(),
    );
    expect(withCatalogSearch(sp('kind=branches&q=١٠'), '١٠٤')?.get('q')).toBe('١٠٤');
  });

  it('the same question once folded writes nothing — the page the reader is on stays', () => {
    // ✕ or Escape on a text never sent: '' where '' already was.
    expect(withCatalogSearch(sp('kind=branches&page=3'), '')).toBeNull();
    // A box of spaces is no search, and was none.
    expect(withCatalogSearch(sp('kind=branches&page=4'), '   ')).toBeNull();
    // A space added at the end, two between the words, the digits on the other keyboard.
    expect(withCatalogSearch(sp('kind=branches&q=المعادي&page=2'), 'المعادي ')).toBeNull();
    expect(withCatalogSearch(sp('q=مصر الجديدة&page=2'), 'مصر   الجديدة')).toBeNull();
    expect(withCatalogSearch(sp('q=104&page=2'), '١٠٤')).toBeNull();
  });

  it('a question cleared writes no `q` at all — never one of spaces', () => {
    const cleared = withCatalogSearch(sp('kind=branches&q=المعادي&page=2'), '   ');
    expect(cleared?.has('q')).toBe(false);
    expect(cleared?.has('page')).toBe(false);
    expect(withCatalogSearch(sp('kind=branches&q=المعادي'), '')?.toString()).toBe('kind=branches');
  });
});

describe('what the server is asked', () => {
  it('the plain list is the very query the screen always asked — `{ page, pageSize }`', () => {
    for (const kind of CATALOG_SEARCHABLE) {
      expect(catalogListQuery(kind, NONE, 1, 25)).toEqual({ page: 1, pageSize: 25 });
    }
  });

  it('sends the search folded, the status as `isActive`, the bank as `bankId` on branches only', () => {
    expect(
      catalogListQuery('branches', { q: '  المعادي ', status: 'active', bank: 'b-1' }, 2, 50),
    ).toEqual({ page: 2, pageSize: 50, search: 'المعادي', isActive: true, bankId: 'b-1' });
    expect(
      catalogListQuery('areas', { q: 'الجيزة', status: 'inactive', bank: 'b-1' }, 1, 25),
    ).toEqual({ page: 1, pageSize: 25, search: 'الجيزة', isActive: false });
    expect(catalogListQuery('banks', { q: '', status: '', bank: 'b-1' }, 1, 25)).toEqual({
      page: 1,
      pageSize: 25,
    });
  });

  it('digits typed on an Arabic keyboard reach the server as Latin digits — the server folds letters, not digits', () => {
    expect(foldCatalogSearch('١٢٣')).toBe('123');
    expect(foldCatalogSearch('۴۵۶')).toBe('456');
    expect(foldCatalogSearch('فرع ٢٠٥')).toBe('فرع 205');
    expect(catalogListQuery('branches', { q: '٠٤٢', status: '', bank: '' }, 1, 25)).toEqual({
      page: 1,
      pageSize: 25,
      search: '042',
    });
  });

  it('spaces are one space, the ends trimmed; nothing but spaces is no search', () => {
    expect(foldCatalogSearch('  مصر    الجديدة ')).toBe('مصر الجديدة');
    expect(foldCatalogSearch('   ')).toBe('');
    expect(hasCatalogFilter('banks', { q: '   ', status: '', bank: '' })).toBe(false);
    expect(hasCatalogFilter('banks', { q: 'x', status: '', bank: '' })).toBe(true);
    // The bank filter narrows the branches only.
    expect(hasCatalogFilter('areas', { q: '', status: '', bank: 'b-1' })).toBe(false);
    expect(hasCatalogFilter('branches', { q: '', status: '', bank: 'b-1' })).toBe(true);
    expect(hasCatalogFilter('areas', { q: '', status: 'inactive', bank: '' })).toBe(true);
  });
});

describe('the row of kind cards is a real tab list', () => {
  it('in Arabic the left arrow is the NEXT card (the row runs right to left), round at the ends', () => {
    expect(kindStep(KINDS, 'banks', 'ArrowLeft', 'rtl')).toBe('branches');
    expect(kindStep(KINDS, 'banks', 'ArrowRight', 'rtl')).toBe('shiftTypes');
    expect(kindStep(KINDS, 'shiftTypes', 'ArrowLeft', 'rtl')).toBe('banks');
  });

  it('in English the right arrow is the next card', () => {
    expect(kindStep(KINDS, 'banks', 'ArrowRight', 'ltr')).toBe('branches');
    expect(kindStep(KINDS, 'banks', 'ArrowLeft', 'ltr')).toBe('shiftTypes');
  });

  it('Home and End jump to the first and the last; any other key does nothing', () => {
    expect(kindStep(KINDS, 'areas', 'Home', 'rtl')).toBe('banks');
    expect(kindStep(KINDS, 'areas', 'End', 'ltr')).toBe('shiftTypes');
    for (const key of ['Enter', ' ', 'ArrowUp', 'ArrowDown', 'a', 'Tab']) {
      expect(kindStep(KINDS, 'areas', key, 'rtl')).toBeNull();
    }
  });
});

describe('the search box’s clock', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks the server ONCE, for the last text, when the reader pauses', () => {
    const sent: string[] = [];
    const clock = createSearchDebounce(CATALOG_SEARCH_DEBOUNCE_MS, (text) => sent.push(text));
    clock.push('ا');
    vi.advanceTimersByTime(120);
    clock.push('ال');
    vi.advanceTimersByTime(120);
    clock.push('المعادي');
    vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(['المعادي']);
  });

  it('two pauses are two questions', () => {
    const sent: string[] = [];
    const clock = createSearchDebounce(CATALOG_SEARCH_DEBOUNCE_MS, (text) => sent.push(text));
    clock.push('مصر');
    vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS);
    clock.push('مصر الجديدة');
    vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS);
    expect(sent).toEqual(['مصر', 'مصر الجديدة']);
  });

  it('the ✕ and Escape send the empty search at once, and what was waiting never comes back', () => {
    const sent: string[] = [];
    const clock = createSearchDebounce(CATALOG_SEARCH_DEBOUNCE_MS, (text) => sent.push(text));
    clock.push('الإسكندرية');
    clock.clear();
    expect(sent).toEqual(['']);
    vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS * 3);
    expect(sent).toEqual(['']);
  });

  it('an outside change (the reset, another kind) drops a waiting search silently', () => {
    const sent: string[] = [];
    const clock = createSearchDebounce(CATALOG_SEARCH_DEBOUNCE_MS, (text) => sent.push(text));
    clock.push('طنطا');
    clock.cancel();
    vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS * 3);
    expect(sent).toEqual([]);
  });

  it('Escape clears a box that holds something, and only Escape', () => {
    expect(searchBoxKey('Escape', 'المعادي')).toBe('clear');
    expect(searchBoxKey('Escape', '')).toBeNull();
    expect(searchBoxKey('Enter', 'المعادي')).toBeNull();
    expect(searchBoxKey('Backspace', 'م')).toBeNull();
  });
});

// Round 34 critic — the box as a whole, against the address bar as the screen writes it. Opened on
// «غير مُفعَّل», «xyz» typed, the bar's reset pressed inside the wait: the URL went back to
// `kind=branches` with «xyz» still in the box, and 300ms later `q=xyz` landed after the reset.
describe('the search box against the address bar', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * The screen in miniature, wired as CatalogsPage and CatalogToolbar wire it: the address bar; the
   * box's sends written by `withCatalogSearch`; and the bar handed back to the box (`sync`) when
   * its `q` or the rest of its narrowing changed — the toolbar's effect and its deps.
   */
  const screen = (url: string) => {
    let bar = sp(url);
    const look = () => {
      const filters = readCatalogFilters(bar);
      return { value: filters.q, context: searchBoxContext(filters) };
    };
    let seen = look();
    let shown = seen.value;
    const rerender = (): void => {
      const now = look();
      if (now.value === seen.value && now.context === seen.context) return;
      seen = now;
      const again = box.sync(now.value, now.context);
      if (again !== null) shown = again;
    };
    const box = createSearchBox(
      CATALOG_SEARCH_DEBOUNCE_MS,
      (text) => {
        bar = withCatalogSearch(bar, text) ?? bar;
        rerender();
      },
      seen,
    );
    return {
      type: (text: string) => {
        shown = text;
        box.type(text);
      },
      clear: () => {
        shown = '';
        box.clear();
      },
      /** A change made elsewhere — the reset, a filter, the back button. */
      navigate: (next: URLSearchParams) => {
        bar = next;
        rerender();
      },
      bar: () => Object.fromEntries(bar),
      shown: () => shown,
    };
  };

  it('the reset inside the wait drops the term: the box empties and no `q` lands after it', () => {
    const s = screen('kind=branches&status=inactive');
    s.type('xyz');
    vi.advanceTimersByTime(100);
    s.navigate(withoutCatalogFilters(new URLSearchParams(s.bar())));
    expect(s.bar()).toEqual({ kind: 'branches' });
    expect(s.shown()).toBe('');
    vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS * 3);
    expect(s.bar()).toEqual({ kind: 'branches' });
  });

  it('the back button over a filter inside the wait drops it too', () => {
    const s = screen('kind=branches&status=active');
    s.type('طنطا');
    s.navigate(sp('kind=branches'));
    vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS * 3);
    expect(s.bar()).toEqual({ kind: 'branches' });
    expect(s.shown()).toBe('');
  });

  it('another `q` from elsewhere (the empty state’s «مسح البحث», the back button) replaces the box', () => {
    const s = screen('kind=branches&q=المعادي');
    s.type('المعادي ش');
    s.navigate(sp('kind=branches'));
    expect(s.shown()).toBe('');
    vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS * 3);
    expect(s.bar()).toEqual({ kind: 'branches' });
  });

  it('its own send coming back is no change from elsewhere: what is typed next still goes', () => {
    const s = screen('kind=branches&page=3');
    s.type('مصر');
    vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS);
    expect(s.bar()).toEqual({ kind: 'branches', q: 'مصر' });
    expect(s.shown()).toBe('مصر');
    s.type('مصر الجديدة');
    vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS);
    expect(s.bar()).toEqual({ kind: 'branches', q: 'مصر الجديدة' });
  });

  it('✕ on a text never sent leaves the page the reader is on; ✕ on a sent one clears it', () => {
    const s = screen('kind=branches&page=3');
    s.type('q');
    s.clear();
    vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS * 3);
    expect(s.bar()).toEqual({ kind: 'branches', page: '3' });
    const t = screen('kind=branches&q=المعادي&page=2');
    t.clear();
    expect(t.bar()).toEqual({ kind: 'branches' });
  });

  it('a box of spaces asks nothing and writes nothing', () => {
    const s = screen('kind=branches&page=4');
    s.type('   ');
    vi.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS * 3);
    expect(s.bar()).toEqual({ kind: 'branches', page: '4' });
  });
});

describe('what the search found, marked in the row', () => {
  const hits = (text: string, typed: string): string[] =>
    matchParts(text, typed)
      .filter((part) => part.hit)
      .map((part) => part.text);

  it('cuts the cell where the search matched, and keeps every letter', () => {
    const parts = matchParts('فرع المعادي - شارع 9', 'المعادي');
    expect(parts).toEqual([
      { text: 'فرع ', hit: false },
      { text: 'المعادي', hit: true },
      { text: ' - شارع 9', hit: false },
    ]);
    expect(parts.map((part) => part.text).join('')).toBe('فرع المعادي - شارع 9');
  });

  it('folds as the server folds — the hamza, the taa marbuta, the tashkeel — and any case', () => {
    expect(hits('الإسكندرية - سموحة', 'الاسكندريه')).toEqual(['الإسكندرية']);
    expect(hits('مُحَمَّد فريد', 'محمد')).toEqual(['مُحَمَّد']);
    expect(hits('National Bank of Egypt', 'bank')).toEqual(['Bank']);
  });

  it('marks a code typed on an Arabic keyboard', () => {
    expect(hits('2045', '٢٠٤')).toEqual(['204']);
  });

  it('marks every match, and nothing without a search or a match', () => {
    expect(hits('مصر الجديدة - مصر', 'مصر')).toEqual(['مصر', 'مصر']);
    expect(matchParts('طنطا', '')).toEqual([{ text: 'طنطا', hit: false }]);
    expect(matchParts('طنطا', '   ')).toEqual([{ text: 'طنطا', hit: false }]);
    expect(matchParts('طنطا', 'أسوان')).toEqual([{ text: 'طنطا', hit: false }]);
  });
});
