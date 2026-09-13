// THE 100-ROW CAP MUST NOT COME BACK.
//
// The drivers' board carries no «السابق / التالي» — the owner asked for it gone. The first attempt
// at that left a board which fetched ONE page and stopped: the count beside the filters said «٤٤٠»
// over a hundred visible rows, and no control anywhere reached the other three hundred and forty.
// A count that is true and unreachable is worse than no count.
//
// These are the two rules that make the rest reachable, tested where a test can reach them — the
// panel itself renders through `renderToStaticMarkup`, which cannot press a button, so the
// «press it four times and see row 440» half is proved in Chromium against a real >100 dataset.
import { describe, expect, it } from 'vitest';
import { type PageMeta } from '@ecms/contracts';
import { nextViolationsPage, violationsLoadState } from './violations-paging';

const meta = (over: Partial<PageMeta> = {}): PageMeta => ({
  page: 1,
  pageSize: 100,
  totalItems: 440,
  totalPages: 5,
  ...over,
});

describe('the board keeps asking until it has the whole answer', () => {
  it('walks every page of a 440-row answer and then stops', () => {
    // The exact case that was broken: MAX_PAGE_SIZE is 100, so 440 rows is five pages and four of
    // them were unreachable.
    const walked: number[] = [];
    let loaded = 0;
    for (;;) {
      const next = nextViolationsPage(meta(), loaded);
      if (next === undefined) break;
      walked.push(next);
      loaded = next;
      if (loaded > 50) throw new Error('paging did not terminate');
    }
    expect(walked, 'every page is asked for, in order').toEqual([1, 2, 3, 4, 5]);
    expect(loaded * 100, 'and five pages of 100 covers all 440').toBeGreaterThanOrEqual(440);
  });

  it('stops exactly at the last page — never one past it', () => {
    // Asking for page 6 of 5 fetches an empty page and, worse, keeps «تحميل المزيد» on screen
    // offering it again.
    expect(nextViolationsPage(meta(), 5), 'nothing after the last page').toBeUndefined();
    expect(nextViolationsPage(meta(), 4), 'but the last page itself is asked for').toBe(5);
  });

  it('finishes on an EXACT multiple of the page size without an extra empty fetch', () => {
    // This is why the stop reads the server's `totalPages` instead of «did the page come back
    // full?»: 200 rows in pages of 100 both come back full, and the inferring form has to fetch a
    // third, empty page to discover it is done — telling the reader there is more until it does.
    const exact = meta({ totalItems: 200, totalPages: 2 });
    expect(nextViolationsPage(exact, 1)).toBe(2);
    expect(nextViolationsPage(exact, 2)).toBeUndefined();
  });

  it('asks for nothing before the first answer, or when there is nothing to ask for', () => {
    expect(nextViolationsPage(undefined, 0), 'no meta yet — do not race the first page').toBeUndefined();
    expect(nextViolationsPage(meta({ totalItems: 0, totalPages: 0 }), 0), 'an empty list').toBeUndefined();
    expect(nextViolationsPage(meta({ totalPages: -1 }), 0), 'a nonsense total').toBeUndefined();
  });

  it('a single page of results offers no «more»', () => {
    expect(nextViolationsPage(meta({ totalItems: 12, totalPages: 1 }), 1)).toBeUndefined();
  });
});

describe('the board says how much of the answer is on screen', () => {
  it('names both numbers while rows are still missing', () => {
    // The pair is the point: «٤٤٠» alone was the bug.
    expect(violationsLoadState(meta(), 100)).toEqual({
      shown: 100,
      total: 440,
      remaining: 340,
      complete: false,
    });
  });

  it('reports complete only when every matched row is really on screen', () => {
    expect(violationsLoadState(meta(), 439).complete, '439 of 440 is not complete').toBe(false);
    expect(violationsLoadState(meta(), 440).complete, '440 of 440 is').toBe(true);
  });

  it('never reports a negative remainder if the server answers with fewer than it counted', () => {
    expect(violationsLoadState(meta({ totalItems: 3 }), 10)).toEqual({
      shown: 10,
      total: 3,
      remaining: 0,
      complete: true,
    });
  });

  it('falls back to what is shown when there is no meta at all', () => {
    expect(violationsLoadState(undefined, 7)).toEqual({
      shown: 7,
      total: 7,
      remaining: 0,
      complete: true,
    });
  });
});
