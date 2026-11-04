// COLUMN WIDTHS THAT STAY PUT WHILE THE ROWS CHANGE UNDER THEM — «عرض الأعمدة فى الجدول بيتغير لما
// بعمل فلتر !! عايزك تثبته» (2026-11-03).
//
// A table lays its columns out by what its rows hold. Filter it, and the rows that held the longest
// names leave: every column is re-measured on what is left, and the grid jumps under the reader's
// eye — the area picked, the board narrows; picked again, it widens. So a table that is filtered
// takes its columns' widths the first time it is drawn with rows and keeps them as shares of its
// width, in a `<colgroup>`. The layout stays the browser's own, only told where each column starts,
// so the shares follow the table when the window changes.
//
// Three rules keep the kept widths honest:
//   · WIDTHS TAKEN UNDER A FILTER ARE PROVISIONAL. A page that remembers its filters (the boards'
//     area and bank) can open on a few rows; widths taken from them would squeeze the whole board
//     once the filter is lifted. They hold while the filter does, and are taken afresh — once, from
//     the browser's own layout — at the first draw with no filter on.
//   · A VALUE WIDER THAN ITS SHARE RE-TAKES THEM. A time that cannot break («١١:٢٢ ص») arriving after
//     the widths were taken, a narrower window, the page's text made larger: such a cell widens its
//     column and, the shares adding up to the whole table, the browser takes the room from every
//     other column — and gives it back each time a filter hides that cell. So the widths are taken
//     again from the table as it then stands, every column at least as wide as what it holds, and
//     no later filter moves them. Only growth re-takes them, so they never swing back and forth.
//   · EACH SET OF COLUMNS KEEPS ITS OWN. The boards' «اليوم» view adds the timer, another language
//     renames the heads: each set is measured once and kept for the table's life, so going back to
//     a view finds it as it was left, whatever is filtered on the way back.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefCallback } from 'react';

// A layout effect in the browser; a plain one where there is no layout (a page rendered to a
// string), which has nothing to measure and would only warn — as the fleet's hover cards do.
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Pure: each column's share of the table, in percent, from the widths the browser gave the head's
 * cells — `expected` of them, one per column. Null when there is nothing to go by: a table drawn
 * out of sight (no width yet), or a head that is not one cell per column.
 */
export const columnShares = (cells: readonly number[], expected: number): number[] | null => {
  if (cells.length === 0 || cells.length !== expected) return null;
  if (cells.some((width) => !Number.isFinite(width) || width < 0)) return null;
  const total = cells.reduce((sum, width) => sum + width, 0);
  if (total <= 0) return null;
  return cells.map((width) => Math.round((width / total) * 100_000) / 1000);
};

/** How far past its share a column may sit before the widths are taken again, in pixels. */
const SLACK_PX = 1;

/**
 * Pure: a column now wider than the share it was given — by more than a pixel of rounding — so the
 * browser has started taking its room from the others.
 */
export const outgrown = (shares: readonly number[], cells: readonly number[]): boolean => {
  if (shares.length !== cells.length) return true;
  const total = cells.reduce((sum, width) => sum + width, 0);
  if (total <= 0) return false;
  return cells.some((width, index) => width > ((shares[index] ?? 0) / 100) * total + SLACK_PX);
};

/** What one set of columns keeps: its shares, and whether a filter was on when they were taken. */
export interface KeptColumns {
  shares: readonly number[];
  provisional: boolean;
}

/**
 * Pure: what to do with a set of columns, given what it keeps and the widths the head has now.
 *   · `take` — keep these shares (none kept yet, or a column outgrew its share);
 *   · `release` — drop what is kept, so the next layout is the browser's own and is taken whole:
 *     the kept shares were provisional and the filter they were taken under is gone;
 *   · `keep` — nothing to do.
 */
export const nextColumns = (
  kept: KeptColumns | undefined,
  cells: readonly number[],
  count: number,
  filtered: boolean,
): { action: 'take'; kept: KeptColumns } | { action: 'release' } | { action: 'keep' } => {
  if (kept !== undefined && kept.provisional && !filtered) return { action: 'release' };
  if (kept !== undefined && !outgrown(kept.shares, cells)) return { action: 'keep' };
  const shares = columnShares(cells, count);
  if (shares === null) return { action: 'keep' };
  // A first take is provisional while a filter is on; a re-take keeps what the widths were — those
  // taken on every row stay so, whatever is filtered when a column outgrows its share.
  return { action: 'take', kept: { shares, provisional: kept?.provisional ?? filtered } };
};

export interface SteadyColumns {
  /** On the `<table>`: its head's first row is what is measured, and its size is watched. */
  ref: RefCallback<HTMLTableElement>;
  /** The kept shares, in percent, one per column — null until taken (and while off). */
  shares: readonly number[] | null;
}

const NOTHING_KEPT: ReadonlyMap<string, KeptColumns> = new Map();

export const useSteadyColumns = ({
  enabled = true,
  ready,
  signature,
  count,
  filtered = false,
  watch,
}: {
  enabled?: boolean;
  /** The table is drawn with rows — what the widths are taken from. Not while loading or empty. */
  ready: boolean;
  /** Names the set of columns: each set keeps its own widths. */
  signature: string;
  /** How many cells the head's first row holds — one per column, a selection box included. */
  count: number;
  /** A filter narrows the rows (the page's own or a column's): widths taken now are provisional. */
  filtered?: boolean;
  /** The rows: when they change, the widths are checked against them. */
  watch?: unknown;
}): SteadyColumns => {
  const table = useRef<HTMLTableElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const [kept, setKept] = useState(NOTHING_KEPT);
  const shares = enabled ? (kept.get(signature)?.shares ?? null) : null;

  // What the check reads, as of the last render — the resize observer calls it between renders.
  const inputs = useRef({ enabled, ready, signature, count, filtered });
  inputs.current = { enabled, ready, signature, count, filtered };

  const check = useCallback(() => {
    const now = inputs.current;
    if (!now.enabled || !now.ready) return;
    const head = table.current?.tHead?.rows[0];
    if (head === undefined) return;
    const cells = Array.from(head.cells, (cell) => cell.getBoundingClientRect().width);
    setKept((previous) => {
      const next = nextColumns(previous.get(now.signature), cells, now.count, now.filtered);
      if (next.action === 'keep') return previous;
      const updated = new Map(previous);
      if (next.action === 'release') updated.delete(now.signature);
      else updated.set(now.signature, next.kept);
      return updated;
    });
  }, []);

  // After a render that changed what the widths depend on — taken in a layout effect, so the kept
  // widths are in place before anything is painted (a release and the take after it both land
  // before the frame is drawn).
  useBrowserLayoutEffect(() => {
    check();
  }, [check, enabled, ready, signature, count, filtered, watch, kept]);

  // The table's own size: a window made narrower, the page's text made larger, a table drawn out
  // of sight (no width) that comes into view. A callback ref, so a table that is unmounted and
  // drawn again (a tab, a loading state) is watched again.
  const ref = useCallback<RefCallback<HTMLTableElement>>(
    (element) => {
      observer.current?.disconnect();
      observer.current = null;
      table.current = element;
      if (element === null || !inputs.current.enabled || typeof ResizeObserver === 'undefined') {
        return;
      }
      observer.current = new ResizeObserver(check);
      observer.current.observe(element);
    },
    [check],
  );

  return { ref, shares };
};

/**
 * The kept widths, as the table's first child. Nothing at all until they are taken, so the first
 * layout — the one they are taken from — is the browser's own.
 */
export const SteadyColGroup = ({
  shares,
}: {
  shares: readonly number[] | null;
}): JSX.Element | null =>
  shares === null ? null : (
    <colgroup data-steady-columns="true">
      {shares.map((share, index) => (
        // A column with no width when measured (hidden by its page) is left to the browser.
        <col key={String(index)} style={share > 0 ? { width: `${String(share)}%` } : undefined} />
      ))}
    </colgroup>
  );
