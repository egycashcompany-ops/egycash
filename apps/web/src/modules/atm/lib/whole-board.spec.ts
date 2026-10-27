// Reading an open board whole: every page at the platform cap, in order, each row once — read
// again when a write landed between its page reads — and a bound on the requests, so a nonsensical
// page count, or a board that never holds still, cannot loop.
import { describe, expect, it } from 'vitest';
import { MAX_PAGE_SIZE, type Paginated } from '@ecms/contracts';
import {
  MAX_BOARD_PAGES,
  MAX_BOARD_WALKS,
  boardPageCount,
  fetchWholeBoard,
  isBoardCutShort,
} from './whole-board';

type Row = { id: string };

/**
 * A server holding `rows`, answering pages the way `BaseRepository.list` does. `afterFirstPage`
 * is another desk's write, landing right after a walk's first page was answered — before the rest.
 */
const server = (
  rows: Row[],
  totalPages?: number,
  afterFirstPage: (rows: Row[], walk: number) => Row[] = (same) => same,
) => {
  const calls: [number, number][] = [];
  let walks = 0;
  const fetchPage = (page: number, pageSize: number): Promise<Paginated<Row>> => {
    calls.push([page, pageSize]);
    const items = rows.slice((page - 1) * pageSize, page * pageSize);
    const answer = {
      items,
      meta: {
        page,
        pageSize,
        totalItems: rows.length,
        totalPages: totalPages ?? Math.max(1, Math.ceil(rows.length / pageSize)),
      },
    };
    if (page === 1) {
      walks += 1;
      rows = afterFirstPage(rows, walks);
    }
    return Promise.resolve(answer);
  };
  return {
    calls,
    fetchPage,
    get rows() {
      return rows;
    },
  };
};

const rows = (n: number, from = 0): Row[] =>
  Array.from({ length: n }, (_unused, i) => ({ id: `r${String(from + i)}` }));

describe('fetchWholeBoard', () => {
  it('asks once for a board that fits one page — an empty board included', async () => {
    const small = server(rows(40));
    expect((await fetchWholeBoard(small.fetchPage)).items).toHaveLength(40);
    expect(small.calls).toEqual([[1, MAX_PAGE_SIZE]]);
    const empty = server([]);
    expect((await fetchWholeBoard(empty.fetchPage)).items).toEqual([]);
    expect(empty.calls).toHaveLength(1);
  });

  it('reads every page past the hundredth row, at the cap, in the board’s order', async () => {
    const all = rows(230);
    const busy = server(all);
    const board = await fetchWholeBoard(busy.fetchPage);
    expect(board.items).toEqual(all);
    expect(busy.calls.map(([page]) => page).sort()).toEqual([1, 2, 3]);
    expect(busy.calls.every(([, size]) => size === MAX_PAGE_SIZE)).toBe(true);
  });

  it('keeps a row once when an open in between slid it onto the next page as well', async () => {
    const first = rows(100);
    const fetchPage = (page: number): Promise<Paginated<Row>> =>
      Promise.resolve({
        // Page 2 starts with page 1's last row, pushed down by a row opened between the reads.
        items: page === 1 ? first : [{ id: 'r99' }, ...rows(20, 100)],
        meta: { page, pageSize: MAX_PAGE_SIZE, totalItems: 121, totalPages: 2 },
      });
    const board = await fetchWholeBoard(fetchPage);
    expect(board.items).toHaveLength(120);
    expect(new Set(board.items.map((row) => row.id)).size).toBe(120);
  });

  it('reads again when a row on page 1 closed between the reads — the closed row gone, the one that slid back kept', async () => {
    // 150 open rows; another desk closes r10 right after page 1 was read, so r100 slides onto
    // page 1 and page 2 starts at r101. One walk would show r10 and never r100 — and on a first
    // load the realtime signal for that close is swallowed by the read still in flight.
    const busy = server(rows(150), undefined, (now, walk) =>
      walk === 1 ? now.filter((row) => row.id !== 'r10') : now,
    );
    const board = await fetchWholeBoard(busy.fetchPage);
    expect(board.items).toEqual(busy.rows);
    expect(board.items.map((row) => row.id)).toContain('r100');
    expect(board.items.map((row) => row.id)).not.toContain('r10');
    expect(busy.calls.map(([page]) => page)).toEqual([1, 2, 1, 2]);
  });

  it('reads again when the total held but a row was read twice — one opened, another closed', async () => {
    // A row opens at the head and the last closes: the total is unchanged, page 2 repeats r99,
    // and only the count of rows read says the walk missed one.
    const busy = server(rows(150), undefined, (now, walk) =>
      walk === 1 ? [{ id: 'new' }, ...now.slice(0, -1)] : now,
    );
    const board = await fetchWholeBoard(busy.fetchPage);
    expect(board.items).toEqual(busy.rows);
    expect(board.items[0]).toEqual({ id: 'new' });
    expect(board.items.map((row) => row.id)).not.toContain('r149');
  });

  it('stops walking a board that never holds still, and shows the last walk', async () => {
    // Every walk, a row opens at the head right after page 1 was answered.
    const restless = server(rows(150), undefined, (now, walk) => [
      { id: `opened-${String(walk)}` },
      ...now,
    ]);
    const board = await fetchWholeBoard(restless.fetchPage);
    expect(restless.calls.filter(([page]) => page === 1)).toHaveLength(MAX_BOARD_WALKS);
    expect(new Set(board.items.map((row) => row.id)).size).toBe(board.items.length);
  });

  it('stops at the request bound however many pages the server claims', async () => {
    expect(boardPageCount(10_000)).toBe(MAX_BOARD_PAGES);
    expect(boardPageCount(-3)).toBe(0);
    const liar = server(rows(5), 10_000);
    await fetchWholeBoard(liar.fetchPage);
    expect(liar.calls).toHaveLength(MAX_BOARD_PAGES);
  });
});

describe('a board cut short by the request bound', () => {
  it('is one with more pages than the walk may read — and only that', () => {
    expect(isBoardCutShort({ totalPages: MAX_BOARD_PAGES + 1 })).toBe(true);
    expect(isBoardCutShort({ totalPages: MAX_BOARD_PAGES })).toBe(false);
    expect(isBoardCutShort({ totalPages: 0 })).toBe(false);
  });
});
