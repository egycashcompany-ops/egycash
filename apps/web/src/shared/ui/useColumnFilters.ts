// The state behind a table's row of column filters (`shared/lib/column-filter.ts`): what each box
// holds, kept by the page for as long as it is open. Not in the address and not remembered — see
// the rules file for why.
import { useCallback, useMemo, useState } from 'react';
import { hasColumnFilters, type ColumnFilterValues } from '../lib/column-filter';

export interface ColumnFilters {
  values: ColumnFilterValues;
  /** One box changed. An emptied box is dropped, so `values` holds only boxes with text. */
  set: (key: string, typed: string) => void;
  /** Every box emptied — the page's reset. */
  clear: () => void;
  /** Is any box narrowing the table? */
  active: boolean;
  /**
   * Bumped by every `clear()`. The filter row is keyed on it, so a reset remounts the boxes: one
   * the reader was still typing in empties too, and its pending pause never re-applies the text.
   */
  generation: number;
}

/** Pure: the boxes after one box changed — an emptied box dropped, an unchanged one the same object. */
export const withColumnFilter = (
  values: ColumnFilterValues,
  key: string,
  typed: string,
): ColumnFilterValues => {
  if ((values[key] ?? '') === typed) return values;
  const next: Record<string, string> = { ...values };
  if (typed === '') delete next[key];
  else next[key] = typed;
  return next;
};

export const useColumnFilters = (): ColumnFilters => {
  const [values, setValues] = useState<ColumnFilterValues>({});
  const [generation, setGeneration] = useState(0);
  const set = useCallback((key: string, typed: string) => {
    setValues((previous) => withColumnFilter(previous, key, typed));
  }, []);
  const clear = useCallback(() => {
    setValues({});
    setGeneration((current) => current + 1);
  }, []);
  const active = useMemo(() => hasColumnFilters(values), [values]);
  return { values, set, clear, active, generation };
};
