// A long list the screen already holds, shown a page at a time: «تظهرهم عادى على صفحات فى الجدول
// مش كله مره واحده». The rows stay whole — the column filters, the sort and the Excel/PDF are still
// about all of them — only the table draws one page, so a month of thousands of rows does not ask
// the browser to lay out every one of them at once.
import { useMemo, useState } from 'react';
import { type PageMeta } from '@ecms/contracts';

/** The page sizes a reader may pick. */
export const ROW_PAGE_SIZES = [50, 100, 250, 500];

/** The page size a list opens with. */
export const DEFAULT_ROW_PAGE_SIZE = 100;

export interface RowPages<T> {
  /** The rows of the page on screen. */
  rows: T[];
  /** The page as the shared `Pagination` reads it. */
  meta: PageMeta;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
}

/**
 * The page `page` of `rows` at `pageSize` — clamped into the list, so a list that shrank never
 * leaves the reader past its end. Pure; the hook below keeps the page and size.
 */
export const rowPage = <T>(
  rows: readonly T[],
  page: number,
  pageSize: number,
): { rows: T[]; meta: PageMeta } => {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(page, 1), totalPages);
  return {
    rows: rows.slice((current - 1) * pageSize, current * pageSize),
    meta: { page: current, pageSize, totalItems: rows.length, totalPages },
  };
};

/**
 * One page of `rows`. `resetKey` names what the rows ARE (the range, the filters, the order): when it
 * changes the reader is taken back to page 1, while a refresh of the same rows keeps the page.
 */
export const useRowPages = <T>(
  rows: readonly T[],
  resetKey: string,
  initialPageSize: number = DEFAULT_ROW_PAGE_SIZE,
): RowPages<T> => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [shownKey, setShownKey] = useState(resetKey);
  if (shownKey !== resetKey) {
    // Other rows: from their first page (React's «adjust state while rendering»).
    setShownKey(resetKey);
    setPage(1);
  }
  const shown = useMemo(() => rowPage(rows, page, pageSize), [rows, page, pageSize]);
  return {
    rows: shown.rows,
    meta: shown.meta,
    setPage,
    setPageSize: (next: number) => {
      setPageSize(next);
      setPage(1);
    },
  };
};
