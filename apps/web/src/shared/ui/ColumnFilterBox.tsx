// One box of a table's filter row — «فلتر لكل عمود» (2026-11-02, the ATM tables). `DataTable`
// draws a row of these under its head (`columnFilters`); a table built by hand renders them in a
// row of its own `<thead>`. The matching rules are `shared/lib/column-filter.ts`.
import { useEffect, useRef, useState } from 'react';
import { Input } from './form';

/**
 * One box of the filter row: it reports what was typed once the typist pauses (200 ms).
 *
 * Its own small debounce rather than `DebouncedInput`, for one reason: the latest `onValueChange`
 * is kept in a REF, so a parent that re-renders on a clock (the ATM boards tick every second for
 * their timers) never restarts the pause — `DebouncedInput` re-arms its timer whenever the
 * callback's identity changes, and a board that re-renders more often than the pause would never
 * apply the filter at all. Typing re-renders this box only, never the table.
 *
 * `size={1}` and `w-full`: the box FILLS its column and never sizes it — a box's natural width
 * would widen every column and squeeze the rest.
 */
export const ColumnFilterBox = ({
  value,
  onValueChange,
  label,
  columnKey,
  placeholder,
}: {
  value: string;
  onValueChange: (typed: string) => void;
  label: string;
  columnKey: string;
  placeholder?: string;
}): JSX.Element => {
  const [text, setText] = useState(value);
  const report = useRef(onValueChange);
  report.current = onValueChange;
  // A change from outside — the page's reset — replaces what the box shows.
  useEffect(() => {
    setText(value);
  }, [value]);
  useEffect(() => {
    if (text === value) return undefined;
    const id = window.setTimeout(() => report.current(text), 200);
    return () => window.clearTimeout(id);
  }, [text, value]);
  return (
    <Input
      type="search"
      density="tight"
      size={1}
      className="h-8 w-full min-w-0 py-1 text-xs"
      value={text}
      onChange={(event) => setText(event.target.value)}
      aria-label={label}
      data-column-filter={columnKey}
      {...(placeholder === undefined ? {} : { placeholder })}
    />
  );
};
