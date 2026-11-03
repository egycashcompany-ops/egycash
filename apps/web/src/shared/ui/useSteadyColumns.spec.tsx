// Columns that keep their widths while the rows change — «عرض الأعمدة فى الجدول بيتغير لما بعمل
// فلتر !! عايزك تثبته» (2026-11-03). The measuring needs a browser; what it keeps, and how it is
// drawn, is pinned here.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { columnShares, SteadyColGroup } from './useSteadyColumns';

describe('each column’s share of the table', () => {
  it('is its width over the head’s, in percent — the shares make the whole table', () => {
    const shares = columnShares([48, 104, 248], 3);
    expect(shares).toEqual([12, 26, 62]);
  });

  it('keeps three decimals, so a wide table does not drift by rounding', () => {
    const shares = columnShares([100, 100, 100], 3) as number[];
    expect(shares).toEqual([33.333, 33.333, 33.333]);
  });

  it('takes nothing from a table out of sight, or from a head that is not one cell per column', () => {
    expect(columnShares([0, 0, 0], 3)).toBeNull();
    expect(columnShares([], 0)).toBeNull();
    expect(columnShares([50, 50], 3)).toBeNull();
    expect(columnShares([50, Number.NaN, 50], 3)).toBeNull();
    expect(columnShares([50, -1, 50], 3)).toBeNull();
  });

  it('leaves a column hidden when measured at no share — the browser sizes it when it shows', () => {
    expect(columnShares([0, 50, 50], 3)).toEqual([0, 50, 50]);
  });
});

describe('the kept widths, drawn', () => {
  it('draw nothing until they are taken: the first layout is the browser’s own', () => {
    expect(renderToStaticMarkup(<SteadyColGroup shares={null} />)).toBe('');
  });

  it('are one `<col>` per column, each its share of the table', () => {
    const html = renderToStaticMarkup(<SteadyColGroup shares={[12, 26, 62]} />);
    expect(html).toBe(
      '<colgroup data-steady-columns="true"><col style="width:12%"/><col style="width:26%"/><col style="width:62%"/></colgroup>',
    );
  });

  it('give no width to a column that had none', () => {
    const html = renderToStaticMarkup(<SteadyColGroup shares={[0, 100]} />);
    expect(html).toBe(
      '<colgroup data-steady-columns="true"><col/><col style="width:100%"/></colgroup>',
    );
  });
});
