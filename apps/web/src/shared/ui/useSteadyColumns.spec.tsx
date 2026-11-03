// Columns that keep their widths while the rows change — «عرض الأعمدة فى الجدول بيتغير لما بعمل
// فلتر !! عايزك تثبته» (2026-11-03). The measuring needs a browser; what it keeps, and how it is
// drawn, is pinned here.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { columnShares, nextColumns, outgrown, SteadyColGroup } from './useSteadyColumns';

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

describe('a column that outgrew its share', () => {
  // Shares of 25/25/50 on a 400px head: 100, 100, 200.
  const shares = [25, 25, 50];

  it('is one wider than its share by more than a pixel — the browser is taking room from the others', () => {
    // A time that cannot break («١١:٢٢ ص») arrived: its column sits 10px past its share.
    expect(outgrown(shares, [110, 95, 195])).toBe(true);
  });

  it('is not one within a pixel of its share — rounding, not growth', () => {
    expect(outgrown(shares, [100.8, 99.6, 199.6])).toBe(false);
    expect(outgrown(shares, [100, 100, 200])).toBe(false);
  });

  it('is not one narrower than its share — a filter that hid the longest rows changes nothing', () => {
    expect(outgrown(shares, [100, 100, 200])).toBe(false);
  });

  it('counts a head with another number of cells as outgrown — its columns changed', () => {
    expect(outgrown(shares, [100, 300])).toBe(true);
  });
});

describe('what a set of columns does with the head it sees', () => {
  const head = [100, 100, 200];

  it('takes its first widths — provisional while a filter narrows the rows', () => {
    expect(nextColumns(undefined, head, 3, false)).toEqual({
      action: 'take',
      kept: { shares: [25, 25, 50], provisional: false },
    });
    expect(nextColumns(undefined, head, 3, true)).toEqual({
      action: 'take',
      kept: { shares: [25, 25, 50], provisional: true },
    });
  });

  it('keeps them while every column fits its share, filtered or not', () => {
    const kept = { shares: [25, 25, 50], provisional: false };
    expect(nextColumns(kept, head, 3, true)).toEqual({ action: 'keep' });
    expect(nextColumns(kept, [100, 100, 200], 3, false)).toEqual({ action: 'keep' });
  });

  it('takes them again, from the table as it stands, once a column outgrew its share', () => {
    const kept = { shares: [25, 25, 50], provisional: false };
    // Taken on every row, they stay so — a filter on at the time does not make them provisional.
    expect(nextColumns(kept, [120, 90, 190], 3, true)).toEqual({
      action: 'take',
      kept: { shares: [30, 22.5, 47.5], provisional: false },
    });
    // Taken under a filter, still under one: provisional still.
    expect(
      nextColumns({ shares: [25, 25, 50], provisional: true }, [120, 90, 190], 3, true),
    ).toEqual({ action: 'take', kept: { shares: [30, 22.5, 47.5], provisional: true } });
  });

  it('lets go of widths taken under a filter at the first draw with none — to take the whole table', () => {
    // The board opened on a remembered area: its widths were the area's rows'. The filter lifted,
    // they are dropped, and the next layout — the browser's own, on every row — is taken.
    const provisional = { shares: [25, 25, 50], provisional: true };
    expect(nextColumns(provisional, head, 3, false)).toEqual({ action: 'release' });
    expect(nextColumns(provisional, head, 3, true)).toEqual({ action: 'keep' });
  });

  it('takes nothing from a table out of sight', () => {
    expect(nextColumns(undefined, [0, 0, 0], 3, false)).toEqual({ action: 'keep' });
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
