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
}

export const useColumnFilters = (): ColumnFilters => {
  const [values, setValues] = useState<ColumnFilterValues>({});
  const set = useCallback((key: string, typed: string) => {
    setValues((previous) => {
      if ((previous[key] ?? '') === typed) return previous;
      const next: Record<string, string> = { ...previous };
      if (typed === '') delete next[key];
      else next[key] = typed;
      return next;
    });
  }, []);
  const clear = useCallback(() => setValues({}), []);
  const active = useMemo(() => hasColumnFilters(values), [values]);
  return { values, set, clear, active };
};
