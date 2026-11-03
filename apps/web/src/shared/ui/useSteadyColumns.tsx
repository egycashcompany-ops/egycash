// COLUMN WIDTHS THAT STAY PUT WHILE THE ROWS CHANGE UNDER THEM — «عرض الأعمدة فى الجدول بيتغير لما
// بعمل فلتر !! عايزك تثبته» (2026-11-03).
//
// A table lays its columns out by what its rows hold. Filter it, and the rows that held the longest
// names leave: every column is re-measured on what is left, and the grid jumps under the reader's
// eye — the area picked, the board narrows; picked again, it widens. So a table that is filtered
// takes its columns' widths ONCE, the first time it is drawn with rows (its column lists start
// empty on every visit), and keeps them as shares of its width, in a `<colgroup>`. The shares
// follow the table when the window changes; a cell longer than its share still widens its column
// rather than spilling out of it — the layout stays the browser's, only told where to start. A new
// set of columns (another view, another language) is measured afresh.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

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

export interface SteadyColumns {
  /** On the `<table>`: its head's first row is what is measured. */
  ref: RefObject<HTMLTableElement>;
  /** The kept shares, in percent, one per column — null until taken (and while off). */
  shares: readonly number[] | null;
}

export const useSteadyColumns = ({
  enabled = true,
  ready,
  signature,
  count,
}: {
  enabled?: boolean;
  /** The table is drawn with rows — what the widths are taken from. Not while loading or empty. */
  ready: boolean;
  /** Names the set of columns: when it changes, the widths are taken again. */
  signature: string;
  /** How many cells the head's first row holds — one per column, a selection box included. */
  count: number;
}): SteadyColumns => {
  const ref = useRef<HTMLTableElement>(null);
  const [kept, setKept] = useState<{ signature: string; shares: readonly number[] } | null>(null);
  const shares = enabled && kept !== null && kept.signature === signature ? kept.shares : null;
  // After every render until taken, not on a list of dependencies: a table first drawn out of sight
  // (a closed tab, a hidden panel) has no width, and is measured on the first render that finds it
  // on screen. Taken in a layout effect, so the kept widths are in place before anything is painted.
  useBrowserLayoutEffect(() => {
    if (!enabled || !ready || shares !== null) return;
    const head = ref.current?.tHead?.rows[0];
    if (head === undefined) return;
    const taken = columnShares(
      Array.from(head.cells, (cell) => cell.getBoundingClientRect().width),
      count,
    );
    if (taken !== null) setKept({ signature, shares: taken });
  });
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
