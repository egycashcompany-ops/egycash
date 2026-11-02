// The state behind a table's row of column filters (`useColumnFilters`): what one box's change
// does to what the boxes hold. Pure — the hook is a `useState` around it.
import { describe, expect, it } from 'vitest';
import { withColumnFilter } from './useColumnFilters';

describe('one box changes', () => {
  it('records what was typed, beside what the other boxes hold', () => {
    expect(withColumnFilter({ area: 'دقي' }, 'code', '70')).toEqual({ area: 'دقي', code: '70' });
  });

  it('drops a box emptied, so the values hold only boxes with text', () => {
    expect(withColumnFilter({ area: 'دقي', code: '70' }, 'code', '')).toEqual({ area: 'دقي' });
  });

  it('keeps the very same object when nothing changed — the memos behind it hold', () => {
    const values = { code: '70' };
    expect(withColumnFilter(values, 'code', '70')).toBe(values);
    expect(withColumnFilter(values, 'area', '')).toBe(values);
  });

  it('never changes what it was given', () => {
    const values = { code: '70' };
    withColumnFilter(values, 'code', '71');
    expect(values).toEqual({ code: '70' });
  });
});
