// «البيانات المرجعية» (Round 34 B) — what the screen's search and filters ARE, apart from how they
// are drawn: «وعاوز الداتا اللي تبقى كبيرة زي الفروع والمناطق والبنوك وهكذا يكون في سيرش اقدر
// اسيرش بيه».
//
// THE ADDRESS BAR HOLDS THEM. `?q=` is the typed search, `?status=` «مُفعَّل» / «غير مُفعَّل» (absent:
// all), `?bank=` the branches' bank — beside the screen's `kind`, `page` and `size`. A reload or a
// shared link opens on the same narrowing; they are not remembered across visits (the persistence
// census keeps the screen EXCLUDED — they belong to one kind, and the kind is navigation).
//
// SERVER-SIDE. The lists are paged on the server (Production holds hundreds of branches since Round
// 29b), so a box that filtered the page on screen would find nothing on the other pages. The API
// already takes `search`, `isActive` and, on branches, `bankId`
// (`ListOperationsReferenceQuerySchema`, `ListOperationsBankBranchesQuerySchema`), and folds Arabic
// on its side (apps/api `catalog-search.ts`: «الاسكندريه» finds «الإسكندرية»). The text is folded to
// Latin digits here before it is sent (`foldCatalogSearch`), so «١٢٣» and «123» are one question —
// one cache entry. The server folds the digits too (Round 34 critic): a code STORED as «١٠٤» —
// the form keeps what was typed — is found by «104», which is what the screen sends for «١٠٤».
//
// A LINK IS READ, NOT TRUSTED (Round 34 critic). `?bank=` reaches the server as `bankId`, which it
// refuses unless it is an ObjectId — so a malformed one reads as no filter (`readCatalogFilters`)
// rather than a list that fails; and one that names no bank on the list reads as none once the
// list is in (`withKnownBank`), rather than a bank box showing a raw id.
//
// ONLY THE BIG LISTS. Banks, branches and areas take the search. Currencies and «أنواع التشغيل» are
// small lists dragged into order (Round 8, Round 20): a filter over a dragged list would hide the
// rows a drop lands between, so they keep their drag and have no search (`CATALOG_SEARCHABLE`).
import { asciiDigits, objectId } from '@ecms/contracts';

/** The kinds, in the screen's order — `OPERATIONS_CATALOG_KINDS` (pages/CatalogsPage.tsx). */
export type CatalogKind = 'banks' | 'branches' | 'currencies' | 'areas' | 'shiftTypes';

/** The kinds that take the search and the status filter: the lists that grow. */
export const CATALOG_SEARCHABLE: readonly CatalogKind[] = ['banks', 'branches', 'areas'];

export const isSearchableKind = (kind: CatalogKind): boolean => CATALOG_SEARCHABLE.includes(kind);

/** How long the box waits after the last key before it asks the server — ~300ms, as asked. */
export const CATALOG_SEARCH_DEBOUNCE_MS = 300;

/** The page sizes the pager offers. 25 is the screen's default, as before. */
export const CATALOG_PAGE_SIZES = [25, 50, 100];
export const CATALOG_DEFAULT_PAGE_SIZE = 25;

/** The address bar's names for the narrowing — every one is dropped when the kind changes. */
export const CATALOG_FILTER_PARAMS = ['q', 'status', 'bank'] as const;

export type CatalogStatusFilter = '' | 'active' | 'inactive';

export interface CatalogFilters {
  /** What was typed, as typed — the address bar keeps the reader's own digits. */
  q: string;
  status: CatalogStatusFilter;
  /** The branches' bank (an id), or ''. Read on the branches kind only. */
  bank: string;
}

const readStatus = (raw: string | null): CatalogStatusFilter =>
  raw === 'active' || raw === 'inactive' ? raw : '';

/** The server's own rule for an id (contracts `objectId()`): 24 hex digits. */
const BANK_ID = objectId();

/**
 * The narrowing in the address bar. An unknown `status` is no filter, never «match nothing»; a
 * `bank` that is no id is no filter either — sent, the server would refuse the whole list.
 */
export const readCatalogFilters = (sp: URLSearchParams): CatalogFilters => {
  const bank = sp.get('bank') ?? '';
  return {
    q: sp.get('q') ?? '',
    status: readStatus(sp.get('status')),
    bank: BANK_ID.safeParse(bank).success ? bank : '',
  };
};

/**
 * The bank filter against the bank list: an id that names no bank on it is no filter — once the
 * list is in (`bankIds` undefined: still on its way, the id is kept). A link from elsewhere, or
 * one edited by hand, then lists every branch under «كل البنوك» instead of a box naming a raw id.
 */
export const withKnownBank = (
  filters: CatalogFilters,
  bankIds: readonly string[] | undefined,
): CatalogFilters =>
  filters.bank === '' || bankIds === undefined || bankIds.includes(filters.bank)
    ? filters
    : { ...filters, bank: '' };

/**
 * The text the server is asked for: Arabic-Indic and Persian digits as Latin («١٢٣» → «123» — the
 * server folds the letters but not the digits), runs of spaces as one, the ends trimmed. Empty
 * means no search.
 */
export const foldCatalogSearch = (typed: string): string =>
  asciiDigits(typed).replace(/\s+/gu, ' ').trim();

/** Is anything narrowing this kind's list? (The reset and the empty state ask.) */
export const hasCatalogFilter = (kind: CatalogKind, filters: CatalogFilters): boolean =>
  isSearchableKind(kind) &&
  (foldCatalogSearch(filters.q) !== '' ||
    filters.status !== '' ||
    (kind === 'branches' && filters.bank !== ''));

// A type, not an interface: the list hooks take an index-signed `QueryParams`, which only an
// object TYPE is assignable to.
export type CatalogListQuery = {
  page: number;
  pageSize: number;
  search?: string;
  isActive?: boolean;
  bankId?: string;
};

/**
 * What a searchable kind's list asks the server for. A key is present only when it narrows, so the
 * plain list's query — `{ page, pageSize }` — is exactly the one the screen always asked for.
 */
export const catalogListQuery = (
  kind: CatalogKind,
  filters: CatalogFilters,
  page: number,
  pageSize: number,
): CatalogListQuery => {
  const search = foldCatalogSearch(filters.q);
  return {
    page,
    pageSize,
    ...(search === '' ? {} : { search }),
    ...(filters.status === '' ? {} : { isActive: filters.status === 'active' }),
    ...(kind === 'branches' && filters.bank !== '' ? { bankId: filters.bank } : {}),
  };
};

/**
 * The address bar after a filter changed: the change written (an empty value removes its name) and
 * the page back to the first — a page 7 of the old answer is not a page of the new one. `size`
 * stays. Returns a NEW object; the one given is left as it was.
 */
export const withCatalogFilters = (
  sp: URLSearchParams,
  updates: Partial<Record<(typeof CATALOG_FILTER_PARAMS)[number], string>>,
): URLSearchParams => {
  const next = new URLSearchParams(sp);
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === '') next.delete(key);
    else next.set(key, value);
  }
  next.delete('page');
  return next;
};

/**
 * The address bar after the box sent `typed`, or null when the QUESTION is unchanged — the same
 * text once folded (a space added, ✕ or Escape on a text never sent): the address bar, and so the
 * page the reader is on, is left alone. A text that folds to nothing writes no `q` at all.
 */
export const withCatalogSearch = (sp: URLSearchParams, typed: string): URLSearchParams | null => {
  const folded = foldCatalogSearch(typed);
  if (folded === foldCatalogSearch(sp.get('q') ?? '')) return null;
  return withCatalogFilters(sp, { q: folded === '' ? '' : typed });
};

/** Every narrowing cleared at once — the toolbar's reset and the empty state's «مسح كل المرشحات». */
export const withoutCatalogFilters = (sp: URLSearchParams): URLSearchParams =>
  withCatalogFilters(sp, { q: '', status: '', bank: '' });

/**
 * The address bar for another kind: the kind written, its page, search and filters dropped (a
 * branch's search means nothing to the currencies, and a bank id nothing to the areas). The page
 * SIZE stays — a reader who asked for 100 rows a page asked it of the screen.
 */
export const withCatalogKind = (sp: URLSearchParams, kind: CatalogKind): URLSearchParams => {
  const next = new URLSearchParams(sp);
  next.set('kind', kind);
  next.delete('page');
  for (const name of CATALOG_FILTER_PARAMS) next.delete(name);
  return next;
};

/**
 * The kind an arrow key moves to on the row of kind cards — a real tab list: the arrows walk it in
 * the READING direction (in Arabic «←» is the next card, the row running right to left), round at
 * either end, and Home / End jump to the first and the last. Null for any other key.
 */
export const kindStep = (
  kinds: readonly CatalogKind[],
  current: CatalogKind,
  key: string,
  dir: 'rtl' | 'ltr',
): CatalogKind | null => {
  const at = kinds.indexOf(current);
  if (at === -1 || kinds.length === 0) return null;
  const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
  if (key === forward) return kinds[(at + 1) % kinds.length] ?? null;
  if (key === back) return kinds[(at - 1 + kinds.length) % kinds.length] ?? null;
  if (key === 'Home') return kinds[0] ?? null;
  if (key === 'End') return kinds[kinds.length - 1] ?? null;
  return null;
};

/**
 * The search box's clock: what the reader typed is sent once they PAUSE. Each key restarts the
 * wait, so «م», «مع», «معا» typed in a breath ask the server once, for «معا» — and the early,
 * wide questions never race the last one back. `clear()` (the ✕, Escape) sends '' at once and
 * drops whatever was waiting, so a term typed just before the clear cannot come back after it;
 * `cancel()` drops it silently (an outside change of the box — the toolbar's reset, another kind —
 * or the box going away).
 */
export const createSearchDebounce = (
  ms: number,
  emit: (text: string) => void,
): { push: (text: string) => void; clear: () => void; cancel: () => void } => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    push: (text) => {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        emit(text);
      }, ms);
    },
    clear: () => {
      cancel();
      emit('');
    },
    cancel,
  };
};

/**
 * What the search box keeps an eye on besides its own `q`: the rest of the narrowing. The box's
 * own sends never change it, so when it changes the change was made elsewhere.
 */
export const searchBoxContext = (filters: CatalogFilters): string =>
  `${filters.status}|${filters.bank}`;

/**
 * The search box, apart from how it is drawn (Round 34 critic): what is typed goes through the
 * clock; the address bar comes back through `sync`. A change made ELSEWHERE — another `q` (the
 * empty state's «مسح البحث», the back button), or the rest of the narrowing (`searchBoxContext`:
 * the toolbar's reset, a filter, the back button over one) — replaces what the box shows and drops
 * whatever was still waiting to be sent, so a term typed just before the reset never lands after
 * it. The box's own echo — the `q` it just sent coming back — changes nothing.
 */
export const createSearchBox = (
  ms: number,
  emit: (text: string) => void,
  start: { value: string; context: string },
): {
  /** The reader typed `text` (the box already shows it). */
  type: (text: string) => void;
  /** ✕ / Escape: the empty search, at once. */
  clear: () => void;
  /** The address bar as it is now. Returns the text the box must show, or null to keep its own. */
  sync: (value: string, context: string) => string | null;
  /** The box is going away. */
  cancel: () => void;
} => {
  // The last text this box sent (or was handed), and the narrowing it last saw.
  let sent = start.value;
  let seen = start.context;
  const clock = createSearchDebounce(ms, (next) => {
    sent = next;
    emit(next);
  });
  return {
    type: (text) => {
      if (text === sent) clock.cancel();
      else clock.push(text);
    },
    clear: () => clock.clear(),
    sync: (value, context) => {
      const elsewhere = context !== seen || value !== sent;
      seen = context;
      if (!elsewhere) return null;
      sent = value;
      clock.cancel();
      return value;
    },
    cancel: () => clock.cancel(),
  };
};

/** What a key does in the search box: Escape clears a box that holds something. */
export const searchBoxKey = (key: string, text: string): 'clear' | null =>
  key === 'Escape' && text !== '' ? 'clear' : null;

// ── The match, marked in the rows ──────────────────────────────────────────────────────────────

/**
 * Tashkeel and tatweel — the marks the server's fold skips (apps/api `catalog-search.ts` MARKS,
 * range for range), so the mark drawn on a row covers exactly what the server matched.
 */
const MARK = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ]/u;

/** One letter as the server compares it: «أ إ آ ٱ → ا», «ى ئ → ي», «ة → ه», «ؤ → و», no marks, any case. */
const foldLetter = (ch: string): string => {
  if (MARK.test(ch)) return '';
  if ('أإآٱ'.includes(ch)) return 'ا';
  if ('ىئ'.includes(ch)) return 'ي';
  if (ch === 'ة') return 'ه';
  if (ch === 'ؤ') return 'و';
  return asciiDigits(ch).toLocaleLowerCase('en');
};

export interface MatchPart {
  text: string;
  hit: boolean;
}

/**
 * A cell's text cut where the search matched it, so the row can mark what was found — «المعادي»
 * inside «فرع المعادي - شارع 9». Folded as the server folds (so «الاسكندريه» marks «الإسكندرية»),
 * the digits as Latin (so «١٢٣» marks «123»), and a mark on the matched letters stays inside the
 * marked part. No search, or no match: the whole text, unmarked.
 */
export const matchParts = (text: string, typed: string): MatchPart[] => {
  const term = [...foldCatalogSearch(typed)].map(foldLetter).join('');
  if (term === '' || text === '') return [{ text, hit: false }];
  const chars = [...text];
  let folded = '';
  // `at[k]` — which character of `text` the k-th folded letter came from.
  const at: number[] = [];
  chars.forEach((ch, i) => {
    for (const letter of foldLetter(ch)) {
      folded += letter;
      at.push(i);
    }
  });
  const parts: MatchPart[] = [];
  let from = 0;
  let k = folded.indexOf(term);
  while (k !== -1) {
    const start = at[k] as number;
    let end = (at[k + term.length - 1] as number) + 1;
    // Marks written on the last matched letter belong to it.
    while (end < chars.length && foldLetter(chars[end] as string) === '') end += 1;
    if (start > from) parts.push({ text: chars.slice(from, start).join(''), hit: false });
    parts.push({ text: chars.slice(start, end).join(''), hit: true });
    from = end;
    k = folded.indexOf(term, k + term.length);
  }
  if (from < chars.length) parts.push({ text: chars.slice(from).join(''), hit: false });
  return parts;
};
