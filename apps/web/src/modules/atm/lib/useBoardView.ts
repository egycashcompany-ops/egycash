// What an operation table shows of the rows it read — on the open boards one day view — in the
// reader's order, wired to the address bar once for the four tables. The rules are `board-day.ts`
// (which day) and the shared `sort-rows` / `table-sort` (which order: «عايز الجدول يكون فيه Sort
// للأعمده», 2026-10-27).
//
// THE ORDER IS THE BROWSER'S, HONESTLY: every one of these tables is read whole, so there is no
// second page for an arrow to be wrong about — the Fleet whole boards' rule. The screen's own order
// (the server's: by area on a board, by close time on a done page — the legacy's) carries no arrow
// and breaks every tie, so rows the reader's columns cannot separate stay where they were (the ATM
// machine list's way: `chosenSorts`).
import { useMemo } from 'react';
import { type useSearchParams } from 'react-router-dom';
import { sortRows } from '../../../shared/lib/sort-rows';
import {
  chosenSorts,
  clickChosenSort,
  writeSorts,
  type TableSort,
} from '../../../shared/lib/table-sort';
import {
  dayViewCounts,
  dayViewRange,
  readBoardDayView,
  rowsInDayView,
  type BoardDayView,
} from './board-day';
import { knownSorts, operationSortValue, type AtmOperationRow } from './operation-sheet';
import { cairoDay } from './operation-view';

type SearchParams = ReturnType<typeof useSearchParams>;

/** Replaces rather than pushes: a view of a table is not a place to go Back to. */
const patchParam = ([sp, setSp]: SearchParams, key: string, value: string | null): void => {
  const next = new URLSearchParams(sp);
  if (value === null || value === '') next.delete(key);
  else next.set(key, value);
  setSp(next, { replace: true });
};

export interface ReaderOrder<T> {
  /** The rows, in the reader's order. */
  rows: T[];
  /** The reader's order — empty until they click a header. */
  sorts: TableSort[];
  changeSort: (key: string) => void;
}

/** `rows` in the order `?sort=` asks for, the rows' own order breaking every tie. */
export const useReaderOrder = <T extends AtmOperationRow>(
  params: SearchParams,
  rows: readonly T[],
  columns: readonly { key: string }[],
): ReaderOrder<T> => {
  const sortParam = params[0].get('sort');
  const keys = columns.map((column) => column.key).join(',');
  const sorts = useMemo(() => knownSorts(chosenSorts(sortParam), columns), [sortParam, keys]);
  const ordered = useMemo(() => {
    const position = new Map(rows.map((row, index) => [row.id, index]));
    return sortRows(
      rows,
      sorts,
      operationSortValue,
      (a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0),
    );
  }, [rows, sorts]);
  return {
    rows: ordered,
    sorts,
    changeSort: (key) => patchParam(params, 'sort', writeSorts(clickChosenSort(sortParam, key))),
  };
};

export interface BoardView<T> extends ReaderOrder<T> {
  view: BoardDayView;
  setView: (next: BoardDayView) => void;
  counts: Record<BoardDayView, number>;
  /** The day or days the view's statement is «عن». */
  range: { from: string; to: string };
}

/** An open board: the rows of its day view (`?day=`, today by default), in the reader's order. */
export const useBoardView = <T extends AtmOperationRow>(
  params: SearchParams,
  rows: readonly T[],
  columns: readonly { key: string }[],
  now: Date,
): BoardView<T> => {
  const view = readBoardDayView(params[0].get('day'));
  // The view moves on at Cairo midnight, not every second the timer ticks.
  const today = cairoDay(now);
  const inView = useMemo(() => rowsInDayView(rows, view, now), [rows, view, today]);
  const counts = useMemo(() => dayViewCounts(rows, now), [rows, today]);
  const order = useReaderOrder(params, inView, columns);
  return {
    ...order,
    view,
    setView: (next) => patchParam(params, 'day', next === 'today' ? null : next),
    counts,
    range: dayViewRange(view, order.rows, now),
  };
};
