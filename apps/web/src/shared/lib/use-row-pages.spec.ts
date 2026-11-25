import { describe, expect, it } from 'vitest';
import { rowPage } from './use-row-pages';

const rows = Array.from({ length: 250 }, (_unused, i) => i);

describe('a long list shown a page at a time', () => {
  it('shows the asked page and says where it is', () => {
    const page = rowPage(rows, 2, 100);
    expect(page.rows[0]).toBe(100);
    expect(page.rows).toHaveLength(100);
    expect(page.meta).toEqual({ page: 2, pageSize: 100, totalItems: 250, totalPages: 3 });
  });

  it('shows the short last page whole', () => {
    expect(rowPage(rows, 3, 100).rows).toEqual(rows.slice(200));
  });

  it('never leaves the reader past the end of a list that shrank', () => {
    const page = rowPage(rows.slice(0, 40), 3, 100);
    expect(page.meta.page).toBe(1);
    expect(page.rows).toHaveLength(40);
  });

  it('answers an empty list with one empty page', () => {
    expect(rowPage([], 1, 100)).toEqual({
      rows: [],
      meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 1 },
    });
  });
});
