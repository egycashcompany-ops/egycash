// The state behind a table's row of column filters (`useColumnFilters`): what one list's change
// does to what the lists hold. Pure — the hook is a `useState` around it.
import { describe, expect, it } from 'vitest';
import { withColumnFilter } from './useColumnFilters';

describe('one column’s picks change', () => {
  it('records the picks, beside what the other columns hold', () => {
    expect(withColumnFilter({ area: ['الدقي'] }, 'code', ['70493', '70492'])).toEqual({
      area: ['الدقي'],
      code: ['70493', '70492'],
    });
  });

  it('drops a column left with no pick, so the values hold only picks', () => {
    expect(withColumnFilter({ area: ['الدقي'], code: ['70'] }, 'code', [])).toEqual({
      area: ['الدقي'],
    });
  });

  it('keeps an empty cell picked as a pick — «(فارغ)» is a value', () => {
    expect(withColumnFilter({}, 'leader', [''])).toEqual({ leader: [''] });
  });

  it('keeps the very same object when nothing changed — the memos behind it hold', () => {
    const values = { code: ['70', '71'] };
    expect(withColumnFilter(values, 'code', ['70', '71'])).toBe(values);
    expect(withColumnFilter(values, 'area', [])).toBe(values);
    // The same values in another order are another pick order: the trigger names them so.
    expect(withColumnFilter(values, 'code', ['71', '70'])).not.toBe(values);
  });

  it('never changes what it was given, nor keeps the caller’s array', () => {
    const values = { code: ['70'] };
    const picked = ['71'];
    const next = withColumnFilter(values, 'code', picked);
    expect(values).toEqual({ code: ['70'] });
    picked.push('72');
    expect(next).toEqual({ code: ['71'] });
  });
});
