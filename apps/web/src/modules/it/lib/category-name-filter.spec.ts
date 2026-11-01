// «عايز فلتر الأسم يبقي بعد الفئات … والبيانات اللى فى فلتر الفئات هي نفسها تتفلتر بناء على الفئات
// وعايز الأتنين دول يبقوا Multiselect» — the two lists' round trip through the address bar and the
// request (a name holding a comma arriving whole, an old one-value link reading as a list of one),
// the names dropdown's options, and WHEN a category change drops a chosen name: only once the new
// categories' names have arrived, never on a failed or stale read, and only once.
import { describe, expect, it } from 'vitest';
import {
  ListItAssetNamesQuerySchema,
  ListItAssetsQuerySchema,
  ListItAssignmentsQuerySchema,
} from '@ecms/contracts';
import { buildQuery } from '../../../shared/lib/api-client';
import {
  FILTER_LIST_MAX,
  categoryKey,
  categoryQuery,
  decideNamePrune,
  nameFilterList,
  nameFilterOptions,
  namesQuery,
  namesRead,
  nextPendingCategoryChange,
  pendingCategoryChange,
  capList,
  readCategoryIds,
  readChosenNames,
  readNames,
  writeCategoryIds,
  writeNames,
  type NamesQuery,
  type NamesRead,
  type PendingCategoryChange,
} from './category-name-filter';

const PC = '6a0000000000000000000001';
const PRINTER = '6a0000000000000000000002';
const NAME = 'Lenovo ThinkCentre neo 50a 24';
// Free text, so it may hold a comma — or a backslash.
const COMMA = 'Raml, Station';
const SLASH = 'HP \\ LaserJet';

/** A value through the address bar and back, as the browser would carry it. */
const throughUrl = (key: string, value: string): string | null =>
  new URLSearchParams(new URLSearchParams({ [key]: value }).toString()).get(key);

describe('the address bar', () => {
  it('carries the categories as one comma list, and reads it back in the order picked', () => {
    expect(writeCategoryIds([PRINTER, PC])).toBe(`${PRINTER},${PC}`);
    expect(readCategoryIds(throughUrl('category', writeCategoryIds([PRINTER, PC])))).toEqual([
      PRINTER,
      PC,
    ]);
    expect(writeCategoryIds([])).toBe('');
    expect(readCategoryIds(null)).toEqual([]);
  });

  it('reads a link from when the category took ONE id as a list of one', () => {
    expect(readCategoryIds(PC)).toEqual([PC]);
  });

  it('reads an edited list forgivingly — blanks and repeats dropped', () => {
    expect(readCategoryIds(` ${PC} ,, ${PRINTER},${PC},`)).toEqual([PC, PRINTER]);
  });

  it('carries the names with their commas escaped, and reads each one back whole', () => {
    const names = [COMMA, NAME, SLASH];
    const raw = throughUrl('name', writeNames(names));
    expect(raw).toBe('Raml\\, Station,Lenovo ThinkCentre neo 50a 24,HP \\\\ LaserJet');
    expect(readNames(raw)).toEqual(names);
    expect(writeNames([])).toBe('');
    expect(readNames(null)).toEqual([]);
  });

  it('reads a link from when the name took ONE value as a list of one', () => {
    expect(readNames(NAME)).toEqual([NAME]);
  });

  it('never asks for more than the API takes in one list', () => {
    const many = Array.from({ length: FILTER_LIST_MAX + 5 }, (_, i) => `n${String(i)}`);
    expect(readNames(writeNames(many))).toHaveLength(FILTER_LIST_MAX);
    expect(readCategoryIds(many.join(','))).toHaveLength(FILTER_LIST_MAX);
  });
});

describe('the request', () => {
  /** What the API's schema reads out of the query string the client builds. */
  const parsed = (params: Record<string, string | undefined>): Record<string, unknown> =>
    Object.fromEntries(new URLSearchParams(buildQuery(params).replace(/^\?/u, '')));

  it('sends nothing for a filter not narrowed — never an empty list', () => {
    expect(categoryQuery([])).toBeUndefined();
    expect(namesQuery([])).toBeUndefined();
    expect(buildQuery({ categoryId: categoryQuery([]), name: namesQuery([]) })).toBe('');
  });

  it('reaches the asset register’s schema with every category and every name, a comma’s whole', () => {
    const query = ListItAssetsQuerySchema.parse(
      parsed({ categoryId: categoryQuery([PC, PRINTER]), name: namesQuery([COMMA, NAME]) }),
    );
    expect(query.categoryId).toEqual([PC, PRINTER]);
    expect(query.name).toEqual([COMMA, NAME]);
  });

  it('reaches the custody register’s schema the same way, as `assetName`', () => {
    const query = ListItAssignmentsQuerySchema.parse(
      parsed({ categoryId: categoryQuery([PRINTER]), assetName: namesQuery([COMMA, SLASH]) }),
    );
    expect(query.categoryId).toEqual([PRINTER]);
    expect(query.assetName).toEqual([COMMA, SLASH]);
  });

  it('asks the names for the chosen categories as the list the names query declares', () => {
    expect(
      ListItAssetNamesQuerySchema.parse(parsed({ categoryId: categoryQuery([PC, PRINTER]) })),
    ).toEqual({ categoryId: [PC, PRINTER] });
  });
});

describe('the names dropdown', () => {
  const query = (over: Partial<NamesQuery> = {}): NamesQuery => ({
    isFetching: false,
    isError: false,
    isSuccess: true,
    isPlaceholderData: false,
    data: { names: [NAME, COMMA], truncated: false },
    ...over,
  });

  it('offers the names the categories hold, then any chosen beyond them — never invisible', () => {
    expect(nameFilterOptions([NAME, COMMA], ['طابعة HP', NAME])).toEqual([
      { value: NAME, label: NAME },
      { value: COMMA, label: COMMA },
      { value: 'طابعة HP', label: 'طابعة HP' },
    ]);
  });

  it('says it is loading until this choice’s names arrive — and holds only what is chosen', () => {
    const list = nameFilterList(query({ isFetching: true, isSuccess: false, data: undefined }), [
      NAME,
    ]);
    expect(list).toEqual({ options: [{ value: NAME, label: NAME }], loading: true, failed: false });
  });

  it('says it could not read them, rather than that nothing matched — until it tries again', () => {
    const failed = query({ isError: true, isSuccess: false, data: undefined });
    expect(nameFilterList(failed, [])).toMatchObject({ loading: false, failed: true });
    expect(nameFilterList({ ...failed, isFetching: true }, [])).toMatchObject({
      loading: true,
      failed: false,
    });
  });

  it('never offers another choice’s names as this one’s', () => {
    expect(nameFilterList(query({ isPlaceholderData: true }), []).options).toEqual([]);
  });
});

describe('reading the names for a prune', () => {
  const base: NamesQuery = {
    isFetching: false,
    isError: false,
    isSuccess: true,
    isPlaceholderData: false,
    data: { names: [NAME], truncated: false },
  };

  it('is ready only on this choice’s own answer, at rest', () => {
    expect(namesRead(base)).toEqual({ status: 'ready', names: [NAME], truncated: false });
    expect(namesRead({ ...base, data: { names: [NAME], truncated: true } })).toEqual({
      status: 'ready',
      names: [NAME],
      truncated: true,
    });
  });

  it('is loading while anything is being fetched — a cached answer being re-read included', () => {
    expect(namesRead({ ...base, isFetching: true })).toEqual({ status: 'loading' });
    expect(namesRead({ ...base, isPlaceholderData: true })).toEqual({ status: 'loading' });
    expect(namesRead({ ...base, isSuccess: false, data: undefined })).toEqual({
      status: 'loading',
    });
  });

  it('is an error when the read failed, even with older names still held', () => {
    expect(namesRead({ ...base, isError: true })).toEqual({ status: 'error' });
  });
});

describe('a category change and the names it orphans', () => {
  const ready = (names: readonly string[], truncated = false): NamesRead => ({
    status: 'ready',
    names,
    truncated,
  });
  const loading: NamesRead = { status: 'loading' };
  /** Printers → laptops, with a printer's name and a name both hold chosen. */
  const change = pendingCategoryChange([PRINTER], [PC]);
  const chosen = ['طابعة HP', NAME];

  it('drops the chosen names the new categories do not hold, once their names have arrived', () => {
    expect(
      decideNamePrune({ pending: change, categoryIds: [PC], names: chosen, read: ready([NAME]) }),
    ).toEqual({ kind: 'prune', names: [NAME] });
  });

  it('drops nothing against a capped list — a name past the cap may still exist', () => {
    expect(
      decideNamePrune({
        pending: change,
        categoryIds: [PC],
        names: chosen,
        read: ready([NAME], true),
      }),
    ).toEqual({ kind: 'none' });
  });

  it('settles at once a pick that left the categories as they were', () => {
    const same = pendingCategoryChange([PC], [PC]);
    expect(
      decideNamePrune({ pending: same, categoryIds: [PC], names: chosen, read: loading }),
    ).toEqual({ kind: 'none' });
  });

  it('waits while the new categories’ names are loading — never prunes on a stale read', () => {
    expect(
      decideNamePrune({ pending: change, categoryIds: [PC], names: chosen, read: loading }),
    ).toEqual({ kind: 'wait' });
  });

  it('prunes nothing when the names could not be read — the choice stays to untick by hand', () => {
    expect(
      decideNamePrune({
        pending: change,
        categoryIds: [PC],
        names: chosen,
        read: { status: 'error' },
      }),
    ).toEqual({ kind: 'none' });
  });

  it('writes nothing when every chosen name is still held', () => {
    expect(
      decideNamePrune({
        pending: change,
        categoryIds: [PC],
        names: [NAME],
        read: ready([NAME, COMMA]),
      }),
    ).toEqual({ kind: 'none' });
  });

  it('drops nothing outside a category change — a linked or remembered name stays chosen', () => {
    expect(
      decideNamePrune({ pending: null, categoryIds: [PC], names: chosen, read: ready([NAME]) }),
    ).toEqual({ kind: 'none' });
  });

  it('waits for an address bar that has not caught up, and lets a Back press go', () => {
    expect(
      decideNamePrune({ pending: change, categoryIds: [PRINTER], names: chosen, read: loading }),
    ).toEqual({ kind: 'wait' });
    const arrived: PendingCategoryChange = { ...change, arrived: true };
    expect(
      decideNamePrune({
        pending: arrived,
        categoryIds: [PRINTER],
        names: chosen,
        read: ready(['طابعة HP']),
      }),
    ).toEqual({ kind: 'none' });
  });

  it('lets a change go that the address bar moved past — a reset, another link', () => {
    expect(
      decideNamePrune({ pending: change, categoryIds: [], names: chosen, read: ready([NAME]) }),
    ).toEqual({ kind: 'none' });
  });

  it('matches a selection whatever order its categories were picked in', () => {
    expect(categoryKey([PRINTER, PC])).toBe(categoryKey([PC, PRINTER]));
    const both = pendingCategoryChange([PC], [PC, PRINTER]);
    expect(
      decideNamePrune({
        pending: both,
        categoryIds: [PRINTER, PC],
        names: ['X', NAME],
        read: ready([NAME]),
      }),
    ).toEqual({ kind: 'prune', names: [NAME] });
  });

  it('settles in one write — the change is gone after it, so nothing is decided twice (no loop)', () => {
    // The render loop `useCategoryNameFilter` runs, step by step: pick → wait → arrive → prune.
    let pending: PendingCategoryChange | null = change;
    let names: string[] = chosen;
    const writes: string[][] = [];
    const step = (read: NamesRead): void => {
      const prune = decideNamePrune({ pending, categoryIds: [PC], names, read });
      pending = nextPendingCategoryChange(pending, [PC], prune);
      if (prune.kind === 'prune') {
        writes.push(prune.names);
        names = prune.names;
      }
    };
    step(loading);
    expect(pending).toEqual({ ...change, arrived: true });
    step(ready([NAME]));
    step(ready([NAME]));
    step(ready([]));
    expect(writes).toEqual([[NAME]]);
    expect(pending).toBeNull();
  });

  it('keeps the very same pending object while nothing moved — the hook writes no state', () => {
    const arrived: PendingCategoryChange = { ...change, arrived: true };
    expect(nextPendingCategoryChange(arrived, [PC], { kind: 'wait' })).toBe(arrived);
    expect(nextPendingCategoryChange(arrived, [PC], { kind: 'none' })).toBeNull();
  });
});

describe('a link from the single name filter, and the cap', () => {
  it('reads the old `name` as ONE name, raw — its comma never splits it', () => {
    const old = new URLSearchParams({ name: COMMA });
    expect(readChosenNames(old, 'names', 'name')).toEqual([COMMA]);
    expect(readChosenNames(new URLSearchParams({ name: ' ' }), 'names', 'name')).toEqual([]);
  });

  it('prefers the list when both are there, and reads only the list without a legacy name', () => {
    const both = new URLSearchParams({ names: writeNames([NAME]), name: COMMA });
    expect(readChosenNames(both, 'names', 'name')).toEqual([NAME]);
    expect(
      readChosenNames(new URLSearchParams({ asset: writeNames([COMMA, NAME]) }), 'asset'),
    ).toEqual([COMMA, NAME]);
  });

  it('writes at most as many as are read back — a pick past the cap changes nothing', () => {
    const many = Array.from({ length: FILTER_LIST_MAX + 3 }, (_, i) => `c${String(i)}`);
    expect(capList(many)).toHaveLength(FILTER_LIST_MAX);
    expect(capList(['a', 'a', 'b'])).toEqual(['a', 'b']);
    expect(readCategoryIds(writeCategoryIds(capList(many)))).toEqual(capList(many));
  });
});
