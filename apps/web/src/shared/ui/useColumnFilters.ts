// The state behind a table's row of column filters (`shared/lib/column-filter.ts`): what each
// column's list has picked, kept by the page for as long as it is open. Not in the address and
// not remembered — see the rules file for why.
import { useCallback, useMemo, useState } from 'react';
import { hasColumnFilters, type ColumnFilterValues } from '../lib/column-filter';

export interface ColumnFilters {
  values: ColumnFilterValues;
  /** One column's picks changed. A column left with none is dropped, so `values` holds only picks. */
  set: (key: string, picked: readonly string[]) => void;
  /** Every pick dropped — the page's reset. */
  clear: () => void;
  /** Is any column narrowing the table? */
  active: boolean;
  /**
   * Bumped by every `clear()`. The filter row is keyed on it, so a reset remounts the lists: one
   * the reader still had open closes, rather than staying open on picks that are gone.
   */
  generation: number;
}

/**
 * Pure: the picks after one column's changed — a column with none dropped, an unchanged one (the
 * same values, in the same order) the same object, so nothing downstream refilters for nothing.
 */
export const withColumnFilter = (
  values: ColumnFilterValues,
  key: string,
  picked: readonly string[],
): ColumnFilterValues => {
  const before = values[key] ?? [];
  if (before.length === picked.length && before.every((value, at) => value === picked[at])) {
    return values;
  }
  const next: Record<string, readonly string[]> = { ...values };
  if (picked.length === 0) delete next[key];
  else next[key] = [...picked];
  return next;
};

export const useColumnFilters = (): ColumnFilters => {
  const [values, setValues] = useState<ColumnFilterValues>({});
  const [generation, setGeneration] = useState(0);
  const set = useCallback((key: string, picked: readonly string[]) => {
    setValues((previous) => withColumnFilter(previous, key, picked));
  }, []);
  const clear = useCallback(() => {
    setValues({});
    setGeneration((current) => current + 1);
  }, []);
  const active = useMemo(() => hasColumnFilters(values), [values]);
  return { values, set, clear, active, generation };
};
